/**
 * @file wallet-confirmers.ts
 * @description Per-account on-chain confirmers: builds (and caches) a TradeConfirmerPort for an account's wallet
 *              addresses. Cached entries are dropped when the account's wallets change.
 * @author Reborn1987
 */

import type { UserWallets } from '../../ports/account-store.js';
import type { TradeConfirmerPort } from '../../ports/trade-confirmer.js';

/** Builds a confirmer for a set of wallets (null when none are set). */
export type ConfirmerFactory = (wallets: UserWallets) => TradeConfirmerPort | null;

export class WalletConfirmers {
  private readonly cache = new Map<string, TradeConfirmerPort | null>();

  /** @param wallets current wallets of an account @param build confirmer factory */
  constructor(
    private readonly wallets: (userId: string) => UserWallets,
    private readonly build: ConfirmerFactory,
  ) {}

  /** The account's confirmer (null when it has no wallets on record). */
  for(userId: string): TradeConfirmerPort | null {
    if (!this.cache.has(userId)) {
      const w = this.wallets(userId);
      this.cache.set(userId, w.solana || w.evm ? this.build(w) : null);
    }
    return this.cache.get(userId) ?? null;
  }

  /** Forgets the cached confirmer (call after the account's wallets change or it is deleted). */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}
