/**
 * @file monitoring.test.ts
 * @description Activity log + Telegram relay: batching, delivery, backoff, rate limits, error throttling, order texts.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { SqliteActivityStoreAdapter } from '../../src/adapters/storage/sqlite-activity-store.adapter.js';
import { TelegramNotifierAdapter, type FetchFn } from '../../src/adapters/telegram/telegram-notifier.adapter.js';
import { ActivityRelay, ENTRY_SEPARATOR, packMessages } from '../../src/core/monitoring/activity-relay.js';
import { describeOrder, networkIcon, tokenLabel, usdCompact } from '../../src/core/monitoring/describe.js';
import { stripHtml, telegramHtml } from '../../src/core/monitoring/telegram-format.js';
import type { Order } from '../../src/core/orders/order.js';
import { NotifierPort, NotifierRateLimitError } from '../../src/ports/activity.js';

class FakeNotifier extends NotifierPort {
  sent: string[] = [];
  fail: Error | null = null;
  async send(text: string): Promise<void> {
    if (this.fail) throw this.fail;
    this.sent.push(text);
  }
}

function setup() {
  let t = 0;
  const store = new SqliteActivityStoreAdapter(':memory:');
  const notifier = new FakeNotifier();
  const errors: unknown[] = [];
  const relay = new ActivityRelay(store, notifier, (e) => errors.push(e), 60_000, () => t);
  return { store, notifier, errors, relay, advance: (ms: number) => { t += ms; } };
}

describe('ActivityRelay', () => {
  it('delivers logged entries in one message and marks them sent', async () => {
    const { store, notifier, relay } = setup();
    relay.record('account', 'new account\nLM-222222'); // one line: newlines flattened
    relay.record('order', 'LM-222222\n\n🧍LM-222222 (@me)\n\n🟢 placed Limit buy $5\n\n x'); // order layout kept, parts trimmed
    await relay.deliver();
    expect(notifier.sent).toHaveLength(1);
    // Times are US Eastern: t=0 is 7:00:00 PM ET on Dec 31, 1969. Orders lead with ⏰.
    expect(notifier.sent[0]).toBe(`👤 7:00:00 PM ET new account LM-222222${ENTRY_SEPARATOR}⏰ 7:00:00 PM ET LM-222222\n\n🧍LM-222222 (@me)\n\n🟢 placed Limit buy $5\n\nx`);
    expect(store.pending(10)).toEqual([]);
    await relay.deliver(); // nothing left
    expect(notifier.sent).toHaveLength(1);
  });

  it('keeps entries when delivery fails, backs off, and honours Telegram rate limits', async () => {
    const { store, notifier, errors, relay, advance } = setup();
    relay.record('server', 'started');
    notifier.fail = new Error('offline');
    await relay.deliver();
    expect(store.pending(10)).toHaveLength(1);
    expect(errors).toHaveLength(1);
    notifier.fail = null;
    await relay.deliver(); // still backing off
    expect(notifier.sent).toHaveLength(0);
    advance(5_000);
    await relay.deliver();
    expect(notifier.sent).toHaveLength(1);

    relay.record('server', 'again');
    notifier.fail = new NotifierRateLimitError(30_000);
    await relay.deliver();
    notifier.fail = null;
    advance(29_000);
    await relay.deliver();
    expect(notifier.sent).toHaveLength(1);
    advance(1_000);
    await relay.deliver();
    expect(notifier.sent).toHaveLength(2);
  });

  it('reports each error source at most once per 5 minutes', () => {
    const { store, relay, advance } = setup();
    relay.recordError('rpc', new Error('socket closed\nstack…'));
    relay.recordError('rpc', new Error('socket closed'));
    relay.recordError('pay:base', 'boom');
    advance(5 * 60_000);
    relay.recordError('rpc', new Error('again'));
    expect(store.pending(10).map((e) => e.text)).toEqual(['rpc: socket closed', 'pay:base: boom', 'rpc: again']);
  });

  it('does nothing without a notifier (log only), and packs long batches into several messages', async () => {
    const store = new SqliteActivityStoreAdapter(':memory:');
    const relay = new ActivityRelay(store, null, () => undefined);
    relay.start();
    relay.record('server', 'x');
    await relay.deliver();
    relay.stop();
    expect(store.pending(10)).toHaveLength(1);
    expect(packMessages(['a'.repeat(6), 'b'.repeat(6), 'c'], 10, '|')).toEqual([{ text: 'aaaaaa', count: 1 }, { text: 'bbbbbb|c', count: 2 }]);
    expect(packMessages(['z'.repeat(20)], 10, '|')).toEqual([{ text: 'zzzzzzzzz…', count: 1 }]);
  });
});

describe('TelegramNotifierAdapter', () => {
  const reply = (ok: boolean, status: number, body: unknown) => ({ ok, status, json: async () => body });
  it('posts to the chat, surfaces rate limits and never leaks the token in errors', async () => {
    const calls: { url: string; body: string }[] = [];
    let next = reply(true, 200, { ok: true });
    const fetchFn: FetchFn = async (url, init) => { calls.push({ url, body: init.body }); return next; };
    const tg = new TelegramNotifierAdapter('123:SECRET', '-100', fetchFn);
    await tg.send('hello');
    expect(calls[0]!.url).toBe('https://api.telegram.org/bot123:SECRET/sendMessage');
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ chat_id: '-100', text: 'hello', parse_mode: 'HTML' });
    // Rejected markup → the same message again as plain text.
    const replies = [reply(false, 400, { description: "Bad Request: can't parse entities" }), reply(true, 200, { ok: true })];
    const tg2 = new TelegramNotifierAdapter('123:SECRET', '-100', async (url, init) => { calls.push({ url, body: init.body }); return replies.shift()!; });
    await tg2.send('<code>x</code> &amp;');
    expect(JSON.parse(calls.at(-1)!.body)).toEqual({ chat_id: '-100', disable_web_page_preview: true, text: 'x &' });
    next = reply(false, 429, { parameters: { retry_after: 7 } });
    await expect(tg.send('x')).rejects.toMatchObject({ retryAfterMs: 7000 });
    next = reply(false, 400, { description: 'chat not found' });
    const err = await tg.send('x').catch((e: Error) => e);
    expect((err as Error).message).toMatch(/chat not found/);
    expect((err as Error).message).not.toMatch(/SECRET/);
  });
});

describe('telegramHtml', () => {
  it('makes addresses tap-to-copy, links fomo usernames, and escapes everything else', () => {
    expect(telegramHtml('LM-2 (@ibiraw) placed 🎯 Take profit 50% · base:0x9500af4f2936aaffbc72860ce19e8d5ed2e8db07 · MC ≥ $120K'))
      .toBe('LM-2 (<a href="https://fomo.family/profile/ibiraw">@ibiraw</a>) placed 🎯 Take profit 50% · base <code>0x9500af4f2936aaffbc72860ce19e8d5ed2e8db07</code> · MC ≥ $120K');
    expect(telegramHtml('buy EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump now')).toBe('buy <code>EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump</code> now');
    expect(telegramHtml('<b>x</b> & @? 5 < 6')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; @? 5 &lt; 6');
    const sig = '5amakyYoQ1Hbe63wguvHR7DpoN2xHJmycSt6VFC1qoziZjqbZStRyihLW7Nf3uW39xAEUBWtQfADxZj5V5ZpMDnJ';
    expect(telegramHtml(`tx ${sig}`)).toBe(`tx ${sig}`); // signatures are too long to be addresses
    expect(telegramHtml('mail a@b.c')).toBe('mail a@b.c'); // not a username
    expect(stripHtml(telegramHtml('@me &'))).toBe('@me &');
    expect(telegramHtml('🛒 **SPOT BUY** on fomo: Buying $3')).toBe('🛒 <b>SPOT BUY</b> on fomo: Buying $3');
    expect(telegramHtml('**<i>x</i>**')).toBe('<b>&lt;i&gt;x&lt;/i&gt;</b>'); // bold text is escaped too
  });
});

describe('describeOrder', () => {
  const base = {
    id: 'o', userId: 'u', mint: 'base:0x9500af4f2936aaffbc72860ce19e8d5ed2e8db07', side: 'sell',
    trigger: { metric: 'marketCap', direction: 'above', value: 120_000, supply: null }, amount: { kind: 'percent', value: 50 },
    status: 'open', attempts: 0, maxAttempts: 3, lastError: null, triggeredAtValue: null, createdAt: 1, updatedAt: 1,
  } as unknown as Order;
  it('describes placements and outcomes, and skips intermediate states', () => {
    const ADDR = '0x9500af4f2936aaffbc72860ce19e8d5ed2e8db07'; // shown without the chain name: 💙 means Base
    expect(describeOrder(base, 'LM-2 (@ibiraw)')).toBe(`LM-2\n\n🧍LM-2 (@ibiraw)\n\n🎯 placed **TAKE PROFIT** 50%\n\n💙 ${ADDR}\n\n📊 MC ≥ $120.0K`);
    expect(describeOrder(base, 'LM-2')).toBe(`LM-2\n\n🧍LM-2\n\n🎯 placed **TAKE PROFIT** 50%\n\n💙 ${ADDR}\n\n📊 MC ≥ $120.0K`); // no handle yet
    expect(describeOrder(base, 'LM-2', 16_400)).toMatch(/📊 MC ≥ \$120\.0K - current MC = \$16\.4K$/); // the token's MC when placed
    expect(describeOrder({ ...base, trigger: { ...base.trigger, metric: 'price', value: 0.002 } } as Order, 'LM-2', 0.0015)).toMatch(/📊 price ≥ \$\S+ - current price = \$\S+$/);
    expect(describeOrder({ ...base, attempts: 1, lastError: 'slippage: x' }, 'LM-2')).toMatch(/🎯 re-armed \*\*TAKE PROFIT\*\* 50% after slippage\n\n[\s\S]*\n\nℹ️ slippage: x$/);
    expect(describeOrder({ ...base, status: 'filled', triggeredAtValue: 121_000 }, 'LM-2')).toBe(`LM-2\n\n🧍LM-2\n\n🎯 FILLED **TAKE PROFIT** 50%\n\n💙 ${ADDR}\n\n📊 at $121.0K`);
    expect(describeOrder({ ...base, status: 'cancelled' }, 'LM-2')).toBe(`LM-2\n\n🧍LM-2\n\n🎯 cancelled **TAKE PROFIT** 50%\n\n💙 ${ADDR}`); // type icon, no detail line
    const kind = (side: string, direction: string) => describeOrder({ ...base, side, trigger: { ...base.trigger, direction } } as Order, 'x')!;
    expect([kind('buy', 'below'), kind('buy', 'above'), kind('sell', 'above'), kind('sell', 'below')].map((t) => t.split('\n\n')[2]!.replace('placed ', '').replace(/ \S+$/, '')))
      .toEqual(['🟢 **LIMIT BUY**', '🚀 **BREAKOUT BUY**', '🎯 **TAKE PROFIT**', '🛑 **STOP LOSS**']);
    expect(describeOrder({ ...base, status: 'failed', lastError: 'ui_error: y' }, 'LM-2')).toMatch(/FAILED [\s\S]*\n\nℹ️ ui_error: y$/);
    expect(describeOrder({ ...base, status: 'unknown' }, 'LM-2')).toMatch(/outcome unknown/);
    expect(describeOrder({ ...base, status: 'cancelled', lastError: 'auto_cancelled: gone' }, 'LM-2')).toMatch(/cancelled [\s\S]*\n\nℹ️ auto_cancelled: gone$/);
    expect(describeOrder({ ...base, status: 'triggered' }, 'LM-2')).toBeNull();
    const buy = { ...base, side: 'buy', trigger: { ...base.trigger, metric: 'price', direction: 'below', value: 0.00042 }, amount: { kind: 'usd', value: 25 } } as unknown as Order;
    expect(describeOrder(buy, 'LM-2')).toBe(`LM-2\n\n🧍LM-2\n\n🟢 placed **LIMIT BUY** $25\n\n💙 ${ADDR}\n\n📊 price ≤ $0.000420`);
    expect(describeOrder({ ...buy, trigger: { ...buy.trigger, direction: 'above' } }, 'LM-2')).toMatch(/\*\*BREAKOUT BUY\*\*/);
    expect(describeOrder({ ...base, trigger: { ...base.trigger, direction: 'below' } }, 'LM-2')).toMatch(/\*\*STOP LOSS\*\*/);
  });
  it('gives each network a coloured heart: Solana purple, Base blue, Ethereum light blue, BNB yellow, Robinhood green, Arc grey', () => {
    expect(['EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump', 'base:0x1', 'ethereum:0x1', 'bnb:0x1', 'robinhood:0x1', 'arc:0x1', 'other:0x1'].map(networkIcon))
      .toEqual(['💜', '💙', '🩵', '💛', '💚', '🩶', '🤍']);
  });

  it('formats amounts and tokens compactly', () => {
    expect([usdCompact(2.5e9), usdCompact(3.456e6), usdCompact(12.3)]).toEqual(['$2.50B', '$3.46M', '$12.30']);
    expect(tokenLabel('EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump')).toBe('EcwFm5…pump');
    expect(tokenLabel('short')).toBe('short');
  });
});
