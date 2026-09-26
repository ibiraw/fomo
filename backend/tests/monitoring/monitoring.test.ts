/**
 * @file monitoring.test.ts
 * @description Activity log + Telegram relay: batching, delivery, backoff, rate limits, error throttling, order texts.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { SqliteActivityStoreAdapter } from '../../src/adapters/storage/sqlite-activity-store.adapter.js';
import { TelegramNotifierAdapter, type FetchFn } from '../../src/adapters/telegram/telegram-notifier.adapter.js';
import { ActivityRelay, packMessages } from '../../src/core/monitoring/activity-relay.js';
import { describeOrder, tokenLabel, usdCompact } from '../../src/core/monitoring/describe.js';
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
    relay.record('account', 'new account AF-222222');
    relay.record('order', 'AF-222222 placed Limit buy $5\n· x'); // newlines flattened
    await relay.deliver();
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toBe('👤 00:00:00 new account AF-222222\n📈 00:00:00 AF-222222 placed Limit buy $5 · x');
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
    expect(packMessages(['a'.repeat(6), 'b'.repeat(6), 'c'], 10)).toEqual(['aaaaaa', 'bbbbbb\nc']);
    expect(packMessages(['z'.repeat(20)], 10)).toEqual(['zzzzzzzzz…']);
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
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ chat_id: '-100', text: 'hello' });
    next = reply(false, 429, { parameters: { retry_after: 7 } });
    await expect(tg.send('x')).rejects.toMatchObject({ retryAfterMs: 7000 });
    next = reply(false, 400, { description: 'chat not found' });
    const err = await tg.send('x').catch((e: Error) => e);
    expect((err as Error).message).toMatch(/chat not found/);
    expect((err as Error).message).not.toMatch(/SECRET/);
  });
});

describe('describeOrder', () => {
  const base = {
    id: 'o', userId: 'u', mint: 'base:0x9500af4f2936aaffbc72860ce19e8d5ed2e8db07', side: 'sell',
    trigger: { metric: 'marketCap', direction: 'above', value: 120_000, supply: null }, amount: { kind: 'percent', value: 50 },
    status: 'open', attempts: 0, maxAttempts: 3, lastError: null, triggeredAtValue: null, createdAt: 1, updatedAt: 1,
  } as unknown as Order;
  it('describes placements and outcomes, and skips intermediate states', () => {
    expect(describeOrder(base, 'AF-2')).toBe('AF-2 placed Take profit 50% · base:0x9500…db07 · MC ≥ $120.0K');
    expect(describeOrder({ ...base, attempts: 1, lastError: 'slippage: x' }, 'AF-2')).toMatch(/re-armed after slippage/);
    expect(describeOrder({ ...base, status: 'filled', triggeredAtValue: 121_000 }, 'AF-2')).toBe('AF-2 FILLED Take profit 50% · base:0x9500…db07 at $121.0K');
    expect(describeOrder({ ...base, status: 'failed', lastError: 'ui_error: y' }, 'AF-2')).toMatch(/FAILED .*ui_error: y/);
    expect(describeOrder({ ...base, status: 'unknown' }, 'AF-2')).toMatch(/outcome unknown/);
    expect(describeOrder({ ...base, status: 'cancelled', lastError: 'auto_cancelled: gone' }, 'AF-2')).toMatch(/cancelled .*\(auto_cancelled: gone\)/);
    expect(describeOrder({ ...base, status: 'triggered' }, 'AF-2')).toBeNull();
    const buy = { ...base, side: 'buy', trigger: { ...base.trigger, metric: 'price', direction: 'below', value: 0.00042 }, amount: { kind: 'usd', value: 25 } } as unknown as Order;
    expect(describeOrder(buy, 'AF-2')).toBe('AF-2 placed Limit buy $25 · base:0x9500…db07 · price ≤ $0.000420');
    expect(describeOrder({ ...buy, trigger: { ...buy.trigger, direction: 'above' } }, 'AF-2')).toMatch(/Breakout buy/);
    expect(describeOrder({ ...base, trigger: { ...base.trigger, direction: 'below' } }, 'AF-2')).toMatch(/Stop loss/);
  });
  it('formats amounts and tokens compactly', () => {
    expect([usdCompact(2.5e9), usdCompact(3.456e6), usdCompact(12.3)]).toEqual(['$2.50B', '$3.46M', '$12.30']);
    expect(tokenLabel('EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump')).toBe('EcwFm5…pump');
    expect(tokenLabel('short')).toBe('short');
  });
});
