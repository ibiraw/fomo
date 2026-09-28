/**
 * @file token-line.test.ts
 * @description The entry's token line: reading its token, finishing it with the ticker and name (cleaned, once, only
 *              there) and the full address on its own line, the labeler keeping entries in order and giving up on slow
 *              lookups, and how the finished line reads in Telegram.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { telegramHtml } from '../../src/core/monitoring/telegram-format.js';
import { cleanName, cleanTicker, TokenLabeler, tokenKeyOfEntry, withTokenLabel } from '../../src/core/monitoring/token-line.js';

const SOL = 'FaoGhqyKofREyNWyu2E1wYqHziLVyq8X2EqcBiWJpump';
const EVM = '0x9500af4f2936aaffbc72860ce19e8d5ed2e8db07';
const entry = (line: string): string => `LM-2\n\n🧍LM-2\n\n🛑 FILLED **STOP LOSS** 100%\n\n${line}\n\n📊 at $6.8K`;

describe('token line', () => {
  it('reads the token from the heart and address', () => {
    expect(tokenKeyOfEntry(entry(`💜 ${SOL}`))).toBe(SOL);
    expect(tokenKeyOfEntry(entry(`💙 ${EVM.toUpperCase().replace('0X', '0x')}`))).toBe(`base:${EVM}`);
    expect(tokenKeyOfEntry('🖥 server started')).toBeNull();
  });

  it('finishes it with the ticker and name, and the full address on the next line', () => {
    expect(withTokenLabel(entry(`💜 ${SOL}`), { symbol: 'COMPUTE', name: 'Compute Network' })).toBe(entry(`💜 $COMPUTE Compute Network\n${SOL}`));
    expect(withTokenLabel(entry(`💙 ${EVM}`), { symbol: 'PEPE', name: 'pepe' })).toBe(entry(`💙 $PEPE\n${EVM}`)); // name = ticker
    const done = withTokenLabel(entry(`💜 ${SOL}`), { symbol: 'A', name: 'B' });
    expect(withTokenLabel(done, { symbol: 'X', name: 'Y' })).toBe(done); // only once
    expect(withTokenLabel(entry(`💜 ${SOL}`), null)).toBe(entry(`💜 ${SOL}`));
    expect(withTokenLabel(entry(`💜 ${SOL}`), { symbol: '🐸', name: 'Frog' })).toBe(entry(`💜 ${SOL}`)); // unusable ticker
  });

  it('cleans tickers and names of markup', () => {
    expect(cleanTicker('<b>PEPE</b> 🐸')).toBe('bPEPEb');
    expect(cleanTicker('태리')).toBe('태리');
    expect(cleanName('  **Pepe**   @the   Frog <3 ')).toBe('Pepe the Frog 3');
    expect(cleanName('🐸')).toBeNull();
  });

  it('keeps entries in order and records them as they are when the lookup is slow or fails', async () => {
    const recorded: string[] = [];
    const lookups: Record<string, () => Promise<{ symbol: string; name: string } | null>> = {
      [SOL]: () => new Promise((r) => setTimeout(() => r({ symbol: 'SLOW', name: 'Slow' }), 200)),
      [`base:${EVM}`]: async () => ({ symbol: 'FAST', name: 'Fast One' }),
    };
    const t = new TokenLabeler<'order'>((k) => lookups[k]!(), (_k, text) => recorded.push(text), 30);
    t.push('order', entry(`💜 ${SOL}`));
    t.push('order', entry(`💙 ${EVM}`));
    t.push('order', 'no token here');
    await t.flush();
    expect(recorded).toEqual([entry(`💜 ${SOL}`), entry(`💙 $FAST Fast One\n${EVM}`), 'no token here']);
    const failing = new TokenLabeler<'order'>(async () => { throw new Error('rpc'); }, (_k, text) => recorded.push(text));
    failing.push('order', entry(`💜 ${SOL}`));
    await failing.flush();
    expect(recorded.at(-1)).toBe(entry(`💜 ${SOL}`));
  });
});

describe('telegramHtml token line', () => {
  it('shows the ticker and name, and the full address tap-to-copy', () => {
    expect(telegramHtml(`💜 $COMPUTE Compute Network\n${SOL}`)).toBe(`💜 $COMPUTE Compute Network\n<code>${SOL}</code>`);
    expect(telegramHtml(`💚 ${EVM}`)).toBe(`💚 <code>${EVM}</code>`); // no ticker found: the address alone
  });
});
