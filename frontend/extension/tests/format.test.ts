/**
 * @file format.test.ts
 * @description Tests for display formatting helpers.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import {
  amountLabel,
  formatPrice,
  formatUsdCompact,
  isCancellable,
  mintFromFomoUrl,
  orderKind,
  shortMint,
  triggerLabel,
} from '../lib/format';

describe('format', () => {
  it('formats USD compactly', () => {
    expect(formatUsdCompact(4242)).toBe('$4.2K');
    expect(formatUsdCompact(1_350_000)).toBe('$1.35M');
    expect(formatUsdCompact(2_500_000_000)).toBe('$2.50B');
    expect(formatUsdCompact(12.5)).toBe('$12.50');
  });

  it('formats prices', () => {
    expect(formatPrice(0.0000043988)).toBe('$0.000004399');
    expect(formatPrice(1.5)).toBe('$1.5000');
  });

  it('names order kinds and triggers', () => {
    expect(orderKind({ side: 'buy', trigger: { metric: 'price', direction: 'below', value: 1 } })).toBe('Limit buy');
    expect(orderKind({ side: 'buy', trigger: { metric: 'price', direction: 'above', value: 1 } })).toBe('Breakout buy');
    expect(orderKind({ side: 'sell', trigger: { metric: 'price', direction: 'above', value: 1 } })).toBe('Take profit');
    expect(orderKind({ side: 'sell', trigger: { metric: 'price', direction: 'below', value: 1 } })).toBe('Stop loss');
    expect(triggerLabel({ trigger: { metric: 'marketCap', direction: 'below', value: 3000 } })).toBe('MC ≤ $3.0K');
    expect(triggerLabel({ trigger: { metric: 'price', direction: 'above', value: 0.00001 } })).toBe('Price ≥ $0.00001000');
  });

  it('labels amounts, mints and cancellability', () => {
    expect(amountLabel({ side: 'buy', amount: { kind: 'usd', value: 5 } })).toBe('$5.00');
    expect(amountLabel({ side: 'sell', amount: { kind: 'percent', value: 25 } })).toBe('25% of position');
    expect(amountLabel({ side: 'buy', amount: { kind: 'percent', value: 10 } })).toBe('10% of cash');
    expect(shortMint('EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump')).toBe('EcwF…Wpump');
    expect(shortMint('short')).toBe('short');
    expect(isCancellable('open')).toBe(true);
    expect(isCancellable('filled')).toBe(false);
  });

  it('extracts the mint from FOMO token URLs', () => {
    expect(mintFromFomoUrl('https://fomo.family/tokens/solana/EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump?x=1')).toBe('EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump');
    expect(mintFromFomoUrl('https://fomo.family/tokens/base/0xabc')).toBeNull();
    expect(mintFromFomoUrl(undefined)).toBeNull();
  });
});

describe('curveStatusFromSource', () => {
  it('reads a curve or a graduated pool from the price source, and nothing from the fallbacks', async () => {
    const { curveStatusFromSource } = await import('../lib/format');
    expect(curveStatusFromSource('pump-curve')).toBe('curve');
    expect(curveStatusFromSource('flap')).toBe('curve');
    expect(curveStatusFromSource('v3-pool')).toBe('graduated');
    expect(curveStatusFromSource('pump-swap')).toBe('graduated');
    expect(curveStatusFromSource('dexscreener')).toBeNull();
    expect(curveStatusFromSource(null)).toBeNull();
  });
});

describe('trailing stops (v2.1.0)', () => {
  const t = { side: 'sell' as const, kind: 'trailing' as const, trailPct: 20, trigger: { metric: 'price' as const, direction: 'below' as const, value: 0.0008 } };
  it('names the order and shows the distance and the current stop', () => {
    expect(orderKind(t)).toBe('Trailing stop');
    expect(triggerLabel(t)).toBe(`20% under the high · stop ${formatPrice(0.0008)}`);
    expect(triggerLabel({ ...t, trigger: { ...t.trigger, metric: 'marketCap', value: 80_000 } })).toBe(`20% under the high · stop MC ${formatUsdCompact(80_000)}`);
  });
});
