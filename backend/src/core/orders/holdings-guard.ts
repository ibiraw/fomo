/**
 * @file holdings-guard.ts
 * @description Cancels an account's open sell orders on a token once that account's wallet holds none of it (e.g. a
 *              100% sell filled, or the user sold manually on FOMO). Sell orders can only be placed with a balance, so
 *              a zero balance means the position is gone. A zero must be read twice in a row (the second read a few
 *              seconds later) before anything is cancelled, so one glitchy RPC answer can't cancel orders.
 * @author Reborn1987
 */

import type { ConfirmerLookup } from './order-engine.js';
import type { Order } from './order.js';

/** Reason stored on auto-cancelled orders. */
export const SOLD_OUT_REASON = 'auto_cancelled: You no longer hold this token';

/** Zero-balance reads in a row needed before cancelling. */
const ZERO_READS_TO_CANCEL = 2;

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
  /** Zero-balance reads in a row, per holding. */
  private readonly zeroReads = new Map<string, number>();
  private readonly checking = new Set<string>();
  private readonly confirmTimers = new Set<NodeJS.Timeout>();
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param orders engine access @param confirmerFor balance reader for an account's wallets
   * @param intervalMs sweep interval @param onError sink for RPC errors
   * @param confirmMs delay before re-reading a zero balance
   */
  constructor(
    private readonly orders: GuardedOrders,
    private readonly confirmerFor: ConfirmerLookup,
    private readonly intervalMs: number,
    private readonly onError: (err: unknown) => void,
    private readonly confirmMs = 5_000,
  ) {}

  /** Starts the periodic sweep. */
  start(): void {
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
  }

  /** Stops the sweep and pending confirmations. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.confirmTimers) clearTimeout(t);
    this.confirmTimers.clear();
  }

  /** Checks every holding that has open sell orders. */
  async sweep(): Promise<void> {
    await Promise.all(this.sellHoldings().map((h) => this.check(h.userId, h.mint)));
  }

  /** Engine event hook: re-check a holding after any of its orders changes (e.g. a sell filled). */
  onOrderChanged(order: Order): void {
    if (this.sellHoldings().some((h) => h.userId === order.userId && h.mint === order.mint)) void this.check(order.userId, order.mint);
  }

  /** Reads the balance; after two zero reads in a row, cancels the holding's open sells. */
  async check(userId: string, mint: string): Promise<void> {
    const key = keyOf({ userId, mint });
    const wallet = this.confirmerFor(userId);
    if (!wallet?.covers(mint) || this.checking.has(key)) return;
    this.checking.add(key);
    try {
      if ((await wallet.snapshot(mint)) > 0n) {
        this.zeroReads.delete(key);
        return;
      }
      const zeros = (this.zeroReads.get(key) ?? 0) + 1;
      if (zeros < ZERO_READS_TO_CANCEL) {
        this.zeroReads.set(key, zeros);
        this.confirmLater(userId, mint);
        return;
      }
      this.zeroReads.delete(key);
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

  /** Re-reads a zero balance after `confirmMs`. */
  private confirmLater(userId: string, mint: string): void {
    const t = setTimeout(() => {
      this.confirmTimers.delete(t);
      void this.check(userId, mint);
    }, this.confirmMs);
    this.confirmTimers.add(t);
  }

  /** Distinct (account, token) pairs with at least one open sell order. */
  private sellHoldings(): Holding[] {
    const out = new Map<string, Holding>();
    for (const o of this.orders.listOrders()) if (isOpenSell(o)) out.set(keyOf(o), { userId: o.userId, mint: o.mint });
    return [...out.values()];
  }
}
