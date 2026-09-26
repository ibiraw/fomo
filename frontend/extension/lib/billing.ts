/**
 * @file billing.ts
 * @description Unlock (paywall) types mirrored from the server's BillingService, plus display helpers.
 * @author Reborn1987
 */

/** Access state of the account (monthly). */
export interface BillingStatus {
  /** Access is active right now (paid up, or permanent). */
  readonly unlocked: boolean;
  /** Owner / tester access that never expires. */
  readonly permanent: boolean;
  /** Paid up until (ms); null when never paid or permanent. */
  readonly paidUntil: number | null;
  /** Has paid before (the free trial no longer applies). */
  readonly everPaid: boolean;
  readonly periodDays: number;
  /** Free orders not yet used by a fill (only fills use them up). */
  readonly freeOrdersLeft: number;
  /** Of those, how many are held by orders still waiting to fill. */
  readonly freeOrdersWaiting: number;
  /** Credit toward the next period. */
  readonly creditUsd: number;
  readonly priceUsd: number;
  readonly tokenPriceUsd: number;
}

/** Days before the end of a paid period when renewal reminders start. */
export const RENEW_REMINDER_DAYS = 5;

/** Whole days of paid access left (0 when not paid up or permanent). */
export function daysLeft(s: BillingStatus, now: number = Date.now()): number {
  return s.paidUntil && s.paidUntil > now ? Math.ceil((s.paidUntil - now) / 86_400_000) : 0;
}

/** How to pay on one chain / coin. */
export interface PaymentMethod {
  readonly chain: string;
  readonly symbol: string;
  readonly kind: 'stable' | 'token';
  readonly payTo: string;
  /** Exact amount when paying from a wallet that isn't the user's fomo wallet. */
  readonly amount: string;
}

export interface BillingQuote extends BillingStatus {
  readonly code: number;
  readonly expiresAt: number;
  readonly methods: readonly PaymentMethod[];
}

const CHAIN_NAMES: Record<string, string> = {
  solana: 'Solana', ethereum: 'Ethereum', base: 'Base', bnb: 'BNB Chain', robinhood: 'Robinhood', arc: 'Arc',
};

/** Display name of a chain slug. */
export function chainName(chain: string): string {
  return CHAIN_NAMES[chain] ?? chain;
}

/** Dollars still owed toward the unlock (never negative). */
export function remainingUsd(s: BillingStatus): number {
  return Math.max(0, s.priceUsd - s.creditUsd);
}

/** True when the account can't place more orders until it pays. */
export function mustUnlock(s: BillingStatus | null): boolean {
  return !!s && !s.unlocked && s.freeOrdersLeft <= 0;
}

/** True when paid access ends within the reminder window. */
export function renewSoon(s: BillingStatus | null, now: number = Date.now()): boolean {
  return !!s && s.unlocked && !s.permanent && daysLeft(s, now) <= RENEW_REMINDER_DAYS;
}
