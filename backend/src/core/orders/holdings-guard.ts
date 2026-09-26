/**
 * @file holdings-guard.ts
 * @description Cancels open sell orders on a token once the wallet no longer holds it (e.g. a 100% sell
 *              filled, or the user sold manually on FOMO). A mint is only eligible after the guard has seen
 *              a non-zero balance, so take-profits placed before buying are not cancelled prematurely.
 * @author Reborn1987
 */

import type { TradeConfirmerPort } from '../../ports/trade-confirmer.js';
import type { Order } from './order.js';

/** Reason stored on auto-cancelled orders. */
export const SOLD_OUT_REASON = 'auto_cancelled: You no longer hold this token';

/** What the guard needs from the order engine. */
export interface GuardedOrders {
  listOrders(): Order[];
  cancelOrder(id: string, reason?: string): Order;
}

export class HoldingsGuard {
  /** Mints seen with a non-zero balance since the last sell-out. */
  private readonly held = new Set<string>();
  private readonly checking = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param orders engine access @param wallet balance reader (the FOMO wallet)
   * @param intervalMs sweep interval @param onError sink for RPC errors
   */
  constructor(
    private readonly orders: GuardedOrders,
    private readonly wallet: TradeConfirmerPort,
    private readonly intervalMs: number,
    private readonly onError: (err: unknown) => void,
  ) {}

  /** Starts the periodic sweep. */
  start(): void {
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
  }

  /** Stops the sweep. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Checks every mint that has open sell orders. */
  async sweep(): Promise<void> {
    await Promise.all([...this.sellMints()].filter((m) => this.wallet.covers(m)).map((m) => this.check(m)));
  }

  /** Engine event hook: re-check a mint after any of its orders changes (e.g. a sell filled). */
  onOrderChanged(order: Order): void {
    if (this.wallet.covers(order.mint) && this.sellMints().has(order.mint)) void this.check(order.mint);
  }

  /** Reads the balance; marks the mint held, or cancels its open sells after a sell-out. */
  async check(mint: string): Promise<void> {
    if (this.checking.has(mint)) return;
    this.checking.add(mint);
    try {
      const balance = await this.wallet.snapshot(mint);
      if (balance > 0n) {
        this.held.add(mint);
        return;
      }
      if (!this.held.has(mint)) return; // never seen held: e.g. a take-profit placed before buying
      this.held.delete(mint);
      for (const o of this.openSells(mint)) {
        try {
          this.orders.cancelOrder(o.id, SOLD_OUT_REASON);
        } catch (err) {
          this.onError(err); // it started executing in the meantime — leave it alone
        }
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.checking.delete(mint);
    }
  }

  /** Open or triggered sell orders on `mint`. */
  private openSells(mint: string): Order[] {
    return this.orders.listOrders().filter((o) => o.mint === mint && o.side === 'sell' && (o.status === 'open' || o.status === 'triggered'));
  }

  /** Mints with at least one open sell order. */
  private sellMints(): Set<string> {
    return new Set(this.orders.listOrders().filter((o) => o.side === 'sell' && (o.status === 'open' || o.status === 'triggered')).map((o) => o.mint));
  }
}
