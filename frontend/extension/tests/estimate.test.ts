/**
 * @file estimate.test.ts
 * @description Order estimates: price at a market-cap or price target, dollars for % and $ sells, tokens for $ buys,
 *              and unknowns (no supply, no position, % buys, empty amounts).
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { estimateFill, formatTokenCount, priceAtTarget, type EstimateInput } from '../lib/estimate';

const base: EstimateInput = { side: 'sell', unit: 'percent', amount: 50, metric: 'marketCap', target: 100_000, supply: 1_000_000_000, heldTokens: 2_000_000 };

describe('estimateFill', () => {
  it('turns a market-cap target into a price', () => {
    expect(priceAtTarget('marketCap', 100_000, 1_000_000_000)).toBe(0.0001);
    expect(priceAtTarget('price', 0.002, null)).toBe(0.002);
    expect(priceAtTarget('marketCap', 100_000, null)).toBeNull();
    expect(priceAtTarget('marketCap', 0, 1)).toBeNull();
  });

  it('gives dollars for sells: % of the position at the target price, or the $ amount itself', () => {
    expect(estimateFill(base)).toEqual({ kind: 'usd', value: 100 }); // 50% of 2M × $0.0001
    expect(estimateFill({ ...base, amount: 150 })).toEqual({ kind: 'usd', value: 200 }); // capped at 100%
    expect(estimateFill({ ...base, unit: 'usd', amount: 25 })).toEqual({ kind: 'usd', value: 25 });
    expect(estimateFill({ ...base, heldTokens: null })).toBeNull();
  });

  it('gives tokens for $ buys, and nothing for % buys or missing numbers', () => {
    expect(estimateFill({ ...base, side: 'buy', unit: 'usd', amount: 10 })).toEqual({ kind: 'tokens', value: 100_000 });
    expect(estimateFill({ ...base, side: 'buy', unit: 'percent', amount: 10 })).toBeNull();
    expect(estimateFill({ ...base, amount: 0 })).toBeNull();
    expect(estimateFill({ ...base, supply: null })).toBeNull();
  });

  it('formats token counts compactly', () => {
    expect(formatTokenCount(1_234_567)).toBe('1.23M');
    expect(formatTokenCount(45_600)).toBe('45.6K');
    expect(formatTokenCount(812.4)).toBe('812');
    expect(formatTokenCount(3_200_000_000)).toBe('3.20B');
    expect(formatTokenCount(0.01234)).toBe('0.0123');
  });
});
