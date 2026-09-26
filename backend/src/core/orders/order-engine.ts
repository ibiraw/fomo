/**
 * @file order-engine.ts
 * @description Watches prices for open orders, triggers them atomically and executes them one at a
 *              time through the TradeExecutorPort. Slippage failures re-arm the order.
 * @author Reborn1987
 */

import { OrderStateError, ValidationError } from '../errors.js';
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

export class OrderEngine {
  private readonly watches = new Map<string, PriceWatch>();
  private readonly pendingWatches = new Map<string, Promise<PriceWatch>>();
  private readonly lastTick = new Map<string, PriceTick>();
  private readonly queue: string[] = [];
  /** mint -> time until which someone is viewing it (keeps the price stream open without orders). */
  private readonly viewers = new Map<string, number>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private busy = false;

  /**
   * @param store durable orders @param feed live prices @param executor trade placement
   * @param onEvent event sink (gateway broadcast) @param onError sink for background errors
   * @param confirmer optional on-chain confirmation (null when no wallet is configured)
   * @param chainGraceMs extra wait for on-chain evidence after the UI reports unknown/timeout
   */
  constructor(
    private readonly store: OrderStorePort,
    private readonly feed: PriceFeedPort,
    private readonly executor: TradeExecutorPort,
    private readonly onEvent: (e: EngineEvent) => void,
    private readonly onError: (err: unknown) => void,
    private readonly confirmer: TradeConfirmerPort | null = null,
    private readonly chainGraceMs = 20_000,
    private readonly now: () => number = Date.now,
  ) {
    executor.onReady(() => void this.pump());
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
    for (const o of this.store.list(['triggered']).reverse()) this.queue.push(o.id);
    this.sweepTimer = setInterval(() => this.sweepViewers(), 60_000);
    void this.pump();
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

  /** Validates input, confirms the token can be priced, then persists the order. */
  async createOrder(input: unknown): Promise<Order> {
    const parsed = CreateOrderSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.') || 'order'}: ${i.message}`).join('; '));
    }
    await this.ensureWatch(parsed.data.mint); // throws UnsupportedPoolError before anything is saved
    const order = this.store.create(parsed.data);
    this.publish(order);
    const tick = this.lastTick.get(order.mint);
    if (tick) this.evaluate(tick);
    return order;
  }

  /** Cancels an order that has not started executing. */
  cancelOrder(id: string): Order {
    const order = this.store.transition(id, [...ACTIVE], 'cancelled');
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

  /** All orders, newest first. */
  listOrders(): Order[] {
    return this.store.list();
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
    let queued = false;
    for (const o of this.store.list(['open'])) {
      if (o.mint !== tick.mint || !isTriggered(o, tick)) continue;
      const t = this.store.transition(o.id, ['open'], 'triggered', { triggeredAtValue: metricValue(o, tick) });
      if (!t) continue; // someone else moved it first
      this.publish(t);
      this.queue.push(t.id);
      queued = true;
    }
    if (queued) void this.pump();
  }

  /** Executes queued orders one at a time while an executor is connected. */
  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0 && this.executor.isReady()) {
        const id = this.queue.shift() as string;
        await this.executeOne(id);
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.busy = false;
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
    if (!this.confirmer) return this.executor.execute(order);
    let before: bigint;
    try {
      before = await this.confirmer.snapshot(order.mint);
    } catch (err) {
      this.onError(err); // RPC hiccup: fall back to UI confirmation only
      return this.executor.execute(order);
    }
    const abort = new AbortController();
    const chain = this.confirmer.waitForChange(order.mint, before, order.side, abort.signal);
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
