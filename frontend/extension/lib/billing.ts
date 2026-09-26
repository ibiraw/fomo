/**
 * @file billing.ts
 * @description Unlock (paywall) types mirrored from the server's BillingService, plus display helpers.
 * @author Reborn1987
 */

/** Unlock state of the account. */
export interface BillingStatus {
  readonly unlocked: boolean;
  readonly freeOrdersLeft: number;
  readonly creditUsd: number;
  readonly priceUsd: number;
  readonly tokenPriceUsd: number;
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

/** True when the account can't place more orders until it unlocks. */
export function mustUnlock(s: BillingStatus | null): boolean {
  return !!s && !s.unlocked && s.freeOrdersLeft <= 0;
}
