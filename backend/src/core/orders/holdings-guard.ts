/**
 * @file holdings-guard.ts
 * @description Cancels an account's open sell orders on a token once that account's wallet no longer holds it
 *              (e.g. a 100% sell filled, or the user sold manually on FOMO). A token is only eligible after the guard
 *              has seen a non-zero balance, so take-profits placed before buying are not cancelled prematurely.
 * @author Reborn1987
 */

import type { ConfirmerLookup } from './order-engine.js';
import type { Order } from './order.js';

/** Reason stored on auto-cancelled orders. */
export const SOLD_OUT_REASON = 'auto_cancelled: You no longer hold this token';

/** What the guard needs from the order engine. */
export interface GuardedOrders {
  listOrders(): Order[];
  cancelOrder(id: string, reason?: string): Order;
}

/** One account's position in one token. */
interface Holding {
  readonly userId: string;
  readonly mint: string;
}

/** Map key for a holding. */
const keyOf = (h: Holding): string => `${h.userId}|${h.mint}`;

/** Open or triggered sell. */
const isOpenSell = (o: Order): boolean => o.side === 'sell' && (o.status === 'open' || o.status === 'triggered');

export class HoldingsGuard {
  /** Holdings seen with a non-zero balance since the last sell-out. */
  private readonly held = new Set<string>();
  private readonly checking = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param orders engine access @param confirmerFor balance reader for an account's wallets
   * @param intervalMs sweep interval @param onError sink for RPC errors
   */
  constructor(
    private readonly orders: GuardedOrders,
    private readonly confirmerFor: ConfirmerLookup,
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

  /** Checks every holding that has open sell orders. */
  async sweep(): Promise<void> {
    await Promise.all(this.sellHoldings().map((h) => this.check(h.userId, h.mint)));
  }

  /** Engine event hook: re-check a holding after any of its orders changes (e.g. a sell filled). */
  onOrderChanged(order: Order): void {
    if (this.sellHoldings().some((h) => h.userId === order.userId && h.mint === order.mint)) void this.check(order.userId, order.mint);
  }

  /** Reads the balance; marks the holding held, or cancels its open sells after a sell-out. */
  async check(userId: string, mint: string): Promise<void> {
    const key = keyOf({ userId, mint });
    const wallet = this.confirmerFor(userId);
    if (!wallet?.covers(mint) || this.checking.has(key)) return;
    this.checking.add(key);
    try {
      const balance = await wallet.snapshot(mint);
      if (balance > 0n) {
        this.held.add(key);
        return;
      }
      if (!this.held.has(key)) return; // never seen held: e.g. a take-profit placed before buying
      this.held.delete(key);
      for (const o of this.orders.listOrders().filter((o) => o.userId === userId && o.mint === mint && isOpenSell(o))) {
        try {
          this.orders.cancelOrder(o.id, SOLD_OUT_REASON);
        } catch (err) {
          this.onError(err); // it started executing in the meantime — leave it alone
        }
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.checking.delete(key);
    }
  }

  /** Distinct (account, token) pairs with at least one open sell order. */
  private sellHoldings(): Holding[] {
    const out = new Map<string, Holding>();
    for (const o of this.orders.listOrders()) if (isOpenSell(o)) out.set(keyOf(o), { userId: o.userId, mint: o.mint });
    return [...out.values()];
  }
}
