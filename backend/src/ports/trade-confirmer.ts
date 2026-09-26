/**
 * @file trade-confirmer.ts
 * @description TradeConfirmerPort — independent (on-chain) confirmation that a trade happened.
 * @author Reborn1987
 */

import type { OrderSide } from '../core/orders/order.js';

/** Evidence that the wallet's token balance moved in the trade's direction. */
export interface BalanceChange {
  readonly before: bigint;
  readonly after: bigint;
}

/** Abstract confirmer. Implementation: WalletTradeConfirmer (polls the FOMO wallet's token balance). */
export abstract class TradeConfirmerPort {
  /** Current token balance for `mint` (raw units). */
  abstract snapshot(mint: string): Promise<bigint>;

  /**
   * Resolves when the balance rises (buy) or falls (sell) relative to `before`,
   * or null when `signal` aborts first.
   */
  abstract waitForChange(mint: string, before: bigint, side: OrderSide, signal: AbortSignal): Promise<BalanceChange | null>;
}
