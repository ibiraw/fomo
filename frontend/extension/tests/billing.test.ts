/**
 * @file billing.test.ts
 * @description Subscription display helpers.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { chainName, daysLeft, mustUnlock, remainingUsd, renewSoon, type BillingStatus } from '../lib/billing';

const DAY = 86_400_000;
const status: BillingStatus = {
  unlocked: false, permanent: false, paidUntil: null, everPaid: false, periodDays: 30,
  freeOrdersLeft: 0, freeOrdersWaiting: 0, creditUsd: 20, priceUsd: 50, tokenPriceUsd: 35,
};

describe('billing helpers', () => {
  it('names chains, counts what is left, and knows when a payment is needed', () => {
    expect(chainName('bnb')).toBe('BNB Chain');
    expect(chainName('mystery')).toBe('mystery');
    expect(remainingUsd(status)).toBe(30);
    expect(remainingUsd({ ...status, creditUsd: 60 })).toBe(0);
    expect(mustUnlock(status)).toBe(true);
    expect(mustUnlock({ ...status, freeOrdersLeft: 1 })).toBe(false);
    expect(mustUnlock({ ...status, unlocked: true })).toBe(false);
    expect(mustUnlock(null)).toBe(false);
  });

  it('counts days left and reminds within 5 days of the end', () => {
    const now = 1_000;
    const active = { ...status, unlocked: true, everPaid: true, paidUntil: now + 10 * DAY };
    expect(daysLeft(active, now)).toBe(10);
    expect(renewSoon(active, now)).toBe(false);
    expect(renewSoon({ ...active, paidUntil: now + 4.5 * DAY }, now)).toBe(true);
    expect(renewSoon({ ...active, permanent: true, paidUntil: null }, now)).toBe(false);
    expect(daysLeft({ ...active, paidUntil: now - 1 }, now)).toBe(0);
    expect(renewSoon(null)).toBe(false);
  });
});
