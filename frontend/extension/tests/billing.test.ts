/**
 * @file billing.test.ts
 * @description Unlock display helpers.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { chainName, mustUnlock, remainingUsd } from '../lib/billing';

const status = { unlocked: false, freeOrdersLeft: 0, freeOrdersWaiting: 0, creditUsd: 20, priceUsd: 50, tokenPriceUsd: 35 };

describe('billing helpers', () => {
  it('names chains, counts what is left, and knows when an unlock is needed', () => {
    expect(chainName('bnb')).toBe('BNB Chain');
    expect(chainName('mystery')).toBe('mystery');
    expect(remainingUsd(status)).toBe(30);
    expect(remainingUsd({ ...status, creditUsd: 60 })).toBe(0);
    expect(mustUnlock(status)).toBe(true);
    expect(mustUnlock({ ...status, freeOrdersLeft: 1 })).toBe(false);
    expect(mustUnlock({ ...status, unlocked: true })).toBe(false);
    expect(mustUnlock(null)).toBe(false);
  });
});
