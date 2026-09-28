/**
 * @file token-line.test.ts
 * @description The entry's token line: reading its token, adding the ticker (cleaned, once, only there), the enricher
 *              keeping entries in order and giving up on slow lookups, and Telegram's short linked address.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { telegramHtml } from '../../src/core/monitoring/telegram-format.js';
import { cleanTicker, TickerEnricher, tokenKeyOfEntry, withTicker } from '../../src/core/monitoring/token-line.js';

const SOL = 'FaoGhqyKofREyNWyu2E1wYqHziLVyq8X2EqcBiWJpump';
const EVM = '0x9500af4f2936aaffbc72860ce19e8d5ed2e8db07';
const entry = (line: string): string => `LM-2\n\n🧍LM-2\n\n🛑 FILLED **STOP LOSS** 100%\n\n${line}\n\n📊 at $6.8K`;

describe('token line', () => {
  it('reads the token from the heart and address', () => {
    expect(tokenKeyOfEntry(entry(`💜 ${SOL}`))).toBe(SOL);
    expect(tokenKeyOfEntry(entry(`💙 ${EVM.toUpperCase().replace('0X', '0x')}`))).toBe(`base:${EVM}`);
    expect(tokenKeyOfEntry('🖥 server started')).toBeNull();
  });

  it('adds a cleaned ticker once, only to the token line', () => {
    expect(withTicker(entry(`💜 ${SOL}`), 'COMPUTE')).toBe(entry(`💜 ${SOL} - $COMPUTE`));
    expect(withTicker(entry(`💜 ${SOL} - $COMPUTE`), 'OTHER')).toBe(entry(`💜 ${SOL} - $COMPUTE`));
    expect(withTicker(entry(`💜 ${SOL}`), null)).toBe(entry(`💜 ${SOL}`));
    expect(cleanTicker('<b>PEPE</b> 🐸')).toBe('bPEPEb');
    expect(cleanTicker('🐸')).toBeNull();
    expect(cleanTicker('태리')).toBe('태리');
  });

  it('keeps entries in order and records without a ticker when the lookup is slow or fails', async () => {
    const recorded: string[] = [];
    const lookups: Record<string, () => Promise<string | null>> = {
      [SOL]: () => new Promise((r) => setTimeout(() => r('SLOW'), 200)),
      [`base:${EVM}`]: async () => 'FAST',
    };
    const t = new TickerEnricher<'order'>((k) => lookups[k]!(), (_k, text) => recorded.push(text), 30);
    t.push('order', entry(`💜 ${SOL}`));
    t.push('order', entry(`💙 ${EVM}`));
    t.push('order', 'no token here');
    await t.flush();
    expect(recorded).toEqual([entry(`💜 ${SOL}`), entry(`💙 ${EVM} - $FAST`), 'no token here']);
    const failing = new TickerEnricher<'order'>(async () => { throw new Error('rpc'); }, (_k, text) => recorded.push(text));
    failing.push('order', entry(`💜 ${SOL}`));
    await failing.flush();
    expect(recorded.at(-1)).toBe(entry(`💜 ${SOL}`));
  });
});

describe('telegramHtml token line', () => {
  it('shows a short address linking to the token on fomo, then the ticker', () => {
    expect(telegramHtml(`💜 ${SOL} - $COMPUTE`)).toBe(`💜 <a href="https://fomo.family/tokens/solana/${SOL}">FaoGhq…WJpump</a> - $COMPUTE`);
    expect(telegramHtml(`💚 ${EVM}`)).toBe(`💚 <a href="https://fomo.family/tokens/robinhood/${EVM}">0x9500…e8db07</a>`);
    expect(telegramHtml(`from ${SOL}`)).toBe(`from <code>${SOL}</code>`); // other addresses stay tap-to-copy
  });
});
