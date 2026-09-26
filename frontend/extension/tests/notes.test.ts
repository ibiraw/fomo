/**
 * @file notes.test.ts
 * @description Tests for compact order labels: amountShort and shortNote.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { amountShort, shortNote } from '../lib/format';

describe('amountShort', () => {
  it('formats dollars and percents compactly', () => {
    expect(amountShort({ amount: { kind: 'usd', value: 5 } })).toBe('$5');
    expect(amountShort({ amount: { kind: 'usd', value: 2.5 } })).toBe('$2.50');
    expect(amountShort({ amount: { kind: 'percent', value: 25 } })).toBe('25%');
  });
});

describe('shortNote', () => {
  it('maps stored notes to plain one-liners', () => {
    expect(shortNote({ status: 'open', lastError: null })).toBeNull();
    expect(shortNote({ status: 'cancelled', lastError: 'auto_cancelled: You no longer hold this token' })).toBe('Auto-cancelled: token sold');
    expect(shortNote({ status: 'open', lastError: 'slippage: too much' })).toBe('Slippage — will retry');
    expect(shortNote({ status: 'failed', lastError: 'slippage: too much' })).toBe('Failed: slippage on every try');
    expect(shortNote({ status: 'unknown', lastError: 'unknown: Clicked buy but could not confirm within 30s — check FOMO' })).toBe('Unconfirmed — check FOMO');
    expect(shortNote({ status: 'unknown', lastError: 'Server restarted while this trade was executing.' })).toBe('Unconfirmed — check FOMO');
    expect(shortNote({ status: 'failed', lastError: 'insufficient_funds: Needs $5' })).toBe('Not enough balance');
  });

  it('truncates unknown long notes', () => {
    const n = shortNote({ status: 'failed', lastError: 'x'.repeat(80) })!;
    expect(n.length).toBe(46);
    expect(n.endsWith('…')).toBe(true);
    expect(shortNote({ status: 'failed', lastError: 'short text' })).toBe('short text');
  });
});
