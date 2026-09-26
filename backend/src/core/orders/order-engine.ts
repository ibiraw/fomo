/**
 * @file order-engine.ts
 * @description Watches prices for open orders, triggers them atomically and executes them through the
 *              TradeExecutorPort — one trade at a time per account (each account's own extension trades), accounts
 *              in parallel. Slippage failures re-arm the order. Prices are shared by every account.
 * @author Reborn1987
 */

import { LimitError, OrderStateError, ValidationError } from '../errors.js';
import type { OrderStorePort } from '../../ports/order-store.js';
import type { PriceFeedPort, PriceTick, PriceWatch } from '../../ports/price-feed.js';
import type { TradeConfirmerPort } from '../../ports/trade-confirmer.js';
import type { ExecutionResult, TradeExecutorPort } from '../../ports/trade-executor.js';
import { CreateOrderSchema, isTriggered, metricValue, type Order } from './order.js';

/** Resolves after `ms`, or immediately when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Events pushed to UIs / notifiers. */
export type EngineEvent =
  | { readonly type: 'order'; readonly order: Order }
  | { readonly type: 'tick'; readonly tick: PriceTick };

/** Orders in these statuses need a live price stream. */
const ACTIVE = ['open', 'triggered'] as const;
/** How long a viewer's interest keeps a mint's price stream alive without orders. */
export const VIEW_TTL_MS = 5 * 60_000;
/** Default cap on open + triggered orders per account. */
export const DEFAULT_MAX_ACTIVE_PER_USER = 25;

/** The on-chain confirmer for an account's wallets (null when the account has none set). */
export type ConfirmerLookup = (userId: string) => TradeConfirmerPort | null;

/** Throws when an account may not place another order (e.g. free orders used and not unlocked). */
export type AccessGate = (userId: string) => void;

export class OrderEngine {
  private readonly watches = new Map<string, PriceWatch>();
  private readonly pendingWatches = new Map<string, Promise<PriceWatch>>();
  private readonly lastTick = new Map<string, PriceTick>();
  /** Triggered order ids waiting to execute, per account. */
  private readonly queues = new Map<string, string[]>();
  /** Accounts with a trade in progress. */
  private readonly busy = new Set<string>();
  /** mint -> time until which someone is viewing it (keeps the price stream open without orders). */
  private readonly viewers = new Map<string, number>();
  private sweepTimer: NodeJS.Timeout | null = null;

  /**
   * @param store durable orders @param feed live prices @param executor trade placement
   * @param onEvent event sink (gateway broadcast) @param onError sink for background errors
   * @param confirmerFor on-chain confirmation for an account's wallets
   * @param chainGraceMs extra wait for on-chain evidence after the UI reports unknown/timeout
   * @param maxActivePerUser cap on open + triggered orders per account
   * @param accessGate paywall check run before an order is accepted
   */
  constructor(
    private readonly store: OrderStorePort,
    private readonly feed: PriceFeedPort,
    private readonly executor: TradeExecutorPort,
    private readonly onEvent: (e: EngineEvent) => void,
    private readonly onError: (err: unknown) => void,
    private readonly confirmerFor: ConfirmerLookup = () => null,
    private readonly chainGraceMs = 20_000,
    private readonly now: () => number = Date.now,
    private readonly maxActivePerUser = DEFAULT_MAX_ACTIVE_PER_USER,
    private readonly accessGate: AccessGate = () => undefined,
  ) {
    executor.onReady((userId) => void this.pump(userId));
  }

  /**
   * Recovers state after a restart: 'executing' orders become 'unknown' (the trade may or may not
   * have gone through), triggered orders are re-queued, and every active mint is watched again.
   */
  async start(): Promise<void> {
    for (const o of this.store.list(['executing'])) {
      this.publish(this.store.transition(o.id, ['executing'], 'unknown', {
        lastError: 'Server restarted while this trade was executing. Check FOMO to see if it went through.',
      }));
    }
    for (const mint of new Set(this.store.list([...ACTIVE]).map((o) => o.mint))) {
      try {
        await this.ensureWatch(mint);
      } catch (err) {
        this.onError(err);
      }
    }
    for (const o of this.store.list(['triggered']).reverse()) this.enqueue(o);
    this.sweepTimer = setInterval(() => this.sweepViewers(), 60_000);
    for (const userId of this.queues.keys()) void this.pump(userId);
  }

  /**
   * Streams a mint's price for someone viewing it (the on-page Limit view), even without orders.
   * Interest lasts VIEW_TTL_MS; call again to renew. Returns the latest tick if one is known.
   */
  async viewMint(mint: string): Promise<PriceTick | null> {
    await this.ensureWatch(mint);
    this.viewers.set(mint, this.now() + VIEW_TTL_MS);
    return this.lastTick.get(mint) ?? null;
  }

  /** Drops expired viewer interest and closes streams nobody needs. */
  sweepViewers(): void {
    for (const [mint, until] of this.viewers) {
      if (until > this.now()) continue;
      this.viewers.delete(mint);
      this.releaseWatchIfIdle(mint);
    }
  }

  /** Validates input, checks the account's limit, confirms the token can be priced, then persists the order. */
  async createOrder(userId: string, input: unknown): Promise<Order> {
    const parsed = CreateOrderSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.') || 'order'}: ${i.message}`).join('; '));
    }
    this.accessGate(userId);
    if (this.store.list([...ACTIVE], userId).length >= this.maxActivePerUser) {
      throw new LimitError(`You can have up to ${this.maxActivePerUser} open orders. Cancel one to add another.`);
    }
    await this.ensureWatch(parsed.data.mint); // throws UnsupportedPoolError before anything is saved
    if (parsed.data.side === 'sell') await this.requireHolding(userId, parsed.data.mint);
    const order = this.store.create(parsed.data, userId);
    this.publish(order);
    const tick = this.lastTick.get(order.mint);
    if (tick) this.evaluate(tick);
    return order;
  }

  /**
   * Whether the wallet holds `mint` (for the UI to disable selling). Null when no wallet is configured,
   * so the caller knows it cannot tell rather than being told "no".
   */
  async holds(userId: string, mint: string): Promise<boolean | null> {
    const confirmer = this.confirmerFor(userId);
    if (!confirmer?.covers(mint)) return null;
    return (await confirmer.snapshot(mint)) > 0n;
  }

  /**
   * Sell orders (take profit / stop loss) need a balance to sell. Checked on-chain against the configured
   * wallet; without a wallet there is nothing to check against, so the order is accepted.
   */
  private async requireHolding(userId: string, mint: string): Promise<void> {
    const confirmer = this.confirmerFor(userId);
    if (!confirmer?.covers(mint)) return;
    let balance: bigint;
    try {
      balance = await confirmer.snapshot(mint);
    } catch (err) {
      throw new ValidationError(`Couldn't check your balance of this token (${err instanceof Error ? err.message : String(err)}). Try again in a moment.`);
    }
    if (balance <= 0n) {
      throw new ValidationError("You don't hold this token — buy it first, then set a take profit or stop loss.");
    }
  }

  /**
   * Cancels an order that has not started executing; `reason` is stored as its note. With `userId`, only that
   * account's orders can be cancelled (someone else's order reads as not found).
   */
  cancelOrder(id: string, reason?: string, userId?: string): Order {
    const owned = this.store.get(id);
    if (!owned || (userId !== undefined && owned.userId !== userId)) throw new OrderStateError(`Order ${id} not found`);
    const order = this.store.transition(id, [...ACTIVE], 'cancelled', reason === undefined ? {} : { lastError: reason });
    if (!order) {
      const existing = this.store.get(id);
      throw new OrderStateError(existing
        ? `Order is ${existing.status} and can no longer be cancelled`
        : `Order ${id} not found`);
    }
    this.publish(order);
    this.releaseWatchIfIdle(order.mint);
    return order;
  }

  /** Orders newest first — one account's, or everyone's when `userId` is omitted. */
  listOrders(userId?: string): Order[] {
    return this.store.list(undefined, userId);
  }

  /** Cancels an account's active orders (account deletion). Order history stays in the database. Returns how many were cancelled. */
  closeUserOrders(userId: string): number {
    let cancelled = 0;
    for (const o of this.store.list([...ACTIVE], userId)) {
      try {
        this.cancelOrder(o.id, 'Account deleted', userId);
        cancelled++;
      } catch {
        // started executing meanwhile; its outcome is still recorded
      }
    }
    this.queues.delete(userId);
    return cancelled;
  }

  /** Latest known tick per watched mint. */
  latestTicks(): PriceTick[] {
    return [...this.lastTick.values()];
  }

  /** Stops all price streams. */
  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.watches.forEach((w) => w.stop());
    this.watches.clear();
  }

  /** Subscribes to a mint's price if not already watching. */
  private async ensureWatch(mint: string): Promise<void> {
    if (this.watches.has(mint)) return;
    // Share one in-flight watch() per mint so concurrent creates don't open duplicate streams.
    let pending = this.pendingWatches.get(mint);
    if (!pending) {
      pending = this.feed.watch(mint, (tick) => this.onTick(tick));
      this.pendingWatches.set(mint, pending);
    }
    try {
      const w = await pending;
      this.watches.set(mint, w);
    } finally {
      this.pendingWatches.delete(mint);
    }
  }

  /** Stops watching a mint when no active orders remain on it. */
  private releaseWatchIfIdle(mint: string): void {
    if ((this.viewers.get(mint) ?? 0) > this.now()) return;
    if (this.store.list([...ACTIVE]).some((o) => o.mint === mint)) return;
    this.watches.get(mint)?.stop();
    this.watches.delete(mint);
    this.lastTick.delete(mint);
  }

  /** Handles a live price tick. */
  private onTick(tick: PriceTick): void {
    this.lastTick.set(tick.mint, tick);
    this.onEvent({ type: 'tick', tick });
    try {
      this.evaluate(tick);
    } catch (err) {
      this.onError(err);
    }
  }

  /** Triggers every open order on the tick's mint whose condition is met. */
  private evaluate(tick: PriceTick): void {
    const queued = new Set<string>();
    for (const o of this.store.list(['open'])) {
      if (o.mint !== tick.mint || !isTriggered(o, tick)) continue;
      const t = this.store.transition(o.id, ['open'], 'triggered', { triggeredAtValue: metricValue(o, tick) });
      if (!t) continue; // someone else moved it first
      this.publish(t);
      this.enqueue(t);
      queued.add(t.userId);
    }
    for (const userId of queued) void this.pump(userId);
  }

  /** Adds a triggered order to its account's queue. */
  private enqueue(order: Order): void {
    let q = this.queues.get(order.userId);
    if (!q) this.queues.set(order.userId, (q = []));
    q.push(order.id);
  }

  /** Executes an account's queued orders one at a time while its extension is connected. */
  private async pump(userId: string): Promise<void> {
    if (this.busy.has(userId)) return;
    this.busy.add(userId);
    try {
      const q = this.queues.get(userId);
      while (q && q.length > 0 && this.executor.isReady(userId)) {
        await this.executeOne(q.shift() as string);
      }
      if (q?.length === 0) this.queues.delete(userId);
    } catch (err) {
      this.onError(err);
    } finally {
      this.busy.delete(userId);
    }
  }

  /** Re-checks the trigger, marks the order executing, runs it and records the outcome. */
  private async executeOne(id: string): Promise<void> {
    const order = this.store.get(id);
    if (!order || order.status !== 'triggered') return;
    const tick = this.lastTick.get(order.mint);
    if (tick && !isTriggered(order, tick)) {
      // Price moved back while waiting for the executor; wait for the condition again.
      this.publish(this.store.transition(id, ['triggered'], 'open'));
      return;
    }
    const executing = this.store.transition(id, ['triggered'], 'executing', { attempts: order.attempts + 1 });
    if (!executing) return;
    this.publish(executing);
    const result = await this.executeWithConfirmation(executing);
    this.publish(this.recordResult(executing, result));
    this.releaseWatchIfIdle(order.mint);
  }

  /**
   * Runs the trade through the executor while watching the wallet on-chain. On-chain evidence marks
   * the order filled as soon as it appears, and also rescues results the UI could not confirm
   * (unknown / timeout). Without a confirmer this is just executor.execute().
   */
  private async executeWithConfirmation(order: Order): Promise<ExecutionResult> {
    const confirmer = this.confirmerFor(order.userId);
    if (!confirmer?.covers(order.mint)) return this.executor.execute(order);
    let before: bigint;
    try {
      before = await confirmer.snapshot(order.mint);
    } catch (err) {
      this.onError(err); // RPC hiccup: fall back to UI confirmation only
      return this.executor.execute(order);
    }
    const abort = new AbortController();
    const chain = confirmer.waitForChange(order.mint, before, order.side, abort.signal);
    void chain.then((change) => {
      if (change) this.publish(this.store.transition(order.id, ['executing'], 'filled', { lastError: null }));
    });
    try {
      const result = await this.executor.execute(order);
      if (result.ok || (result.kind !== 'unknown' && result.kind !== 'timeout')) return result;
      const change = await Promise.race([chain, sleep(this.chainGraceMs, abort.signal).then(() => null)]);
      return change
        ? { ok: true, detail: `Confirmed on-chain (token balance ${change.before} → ${change.after})` }
        : result;
    } finally {
      abort.abort();
    }
  }

  /** Maps an execution result to the order's next status. */
  private recordResult(order: Order, result: ExecutionResult): Order | null {
    if (result.ok) return this.store.transition(order.id, ['executing'], 'filled', { lastError: null });
    const lastError = `${result.kind}: ${result.message}`;
    if (result.kind === 'slippage' && order.attempts < order.maxAttempts) {
      return this.store.transition(order.id, ['executing'], 'open', { lastError });
    }
    const next = result.kind === 'timeout' || result.kind === 'unknown' ? 'unknown' : 'failed';
    return this.store.transition(order.id, ['executing'], next, { lastError });
  }

  /** Emits an order event when a transition succeeded. */
  private publish(order: Order | null): void {
    if (order) this.onEvent({ type: 'order', order });
  }
}
