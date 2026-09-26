/**
 * @file supply.test.ts
 * @description Tests for reading fomo's displayed supply and computing order market caps with it.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { parseCompact, readSupply } from '../lib/fomo-dom';
import { orderMarketCap } from '../lib/format';

describe('fomo supply', () => {
  it('parses compact numbers', () => {
    expect(parseCompact('999.9M')).toBeCloseTo(999_900_000);
    expect(parseCompact('12.5K')).toBe(12_500);
    expect(parseCompact('1.02B')).toBeCloseTo(1_020_000_000);
    expect(parseCompact('1,234')).toBe(1234);
    expect(parseCompact('n/a')).toBeNull();
  });

  it('reads the About > Supply row (structure observed on fomo 2026-09-26)', () => {
    document.body.innerHTML = '<div><div><span>Launchpad</span><div>Pump.fun</div></div><div><span>Supply</span><div></div><div>999.9M</div></div></div>';
    expect(readSupply(document)).toBeCloseTo(999_900_000);
    document.body.innerHTML = '<div><span>Supply</span><div>—</div></div>';
    expect(readSupply(document)).toBeNull();
    document.body.innerHTML = '';
    expect(readSupply(document)).toBeNull();
  });

  it('computes an order market cap with its supply when set', () => {
    const tick = { priceUsd: 0.0001, marketCapUsd: 95_000 };
    expect(orderMarketCap({ trigger: { metric: 'marketCap', direction: 'above', value: 1, supply: 1_000_000_000 } }, tick)).toBeCloseTo(100_000);
    expect(orderMarketCap({ trigger: { metric: 'marketCap', direction: 'above', value: 1, supply: null } }, tick)).toBe(95_000);
    expect(orderMarketCap({ trigger: { metric: 'marketCap', direction: 'above', value: 1 } }, tick)).toBe(95_000);
  });
});
