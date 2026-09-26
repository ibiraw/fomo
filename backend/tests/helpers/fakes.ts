/**
 * @file fakes.ts
 * @description Fake PriceFeedPort and TradeExecutorPort for order-engine tests.
 * @author Reborn1987
 */

import { UnsupportedPoolError } from '../../src/core/errors.js';
import type { Order } from '../../src/core/orders/order.js';
import { PriceFeedPort, type PriceListener, type PriceTick, type PriceWatch } from '../../src/ports/price-feed.js';
import { TradeExecutorPort, type ExecutionResult } from '../../src/ports/trade-executor.js';

/** Price feed driven manually via tick(). Mints in `unsupported` reject like a non-pump token. */
export class FakePriceFeed extends PriceFeedPort {
  readonly listeners = new Map<string, Set<PriceListener>>();
  readonly unsupported = new Set<string>();
  watchCalls = 0;

  /** No-op. */
  async start(): Promise<void> {}
  /** Drops all listeners. */
  async close(): Promise<void> { this.listeners.clear(); }

  /** Registers a listener or rejects for unsupported mints. */
  async watch(mint: string, listener: PriceListener): Promise<PriceWatch> {
    this.watchCalls++;
    if (this.unsupported.has(mint)) throw new UnsupportedPoolError(`unsupported ${mint}`);
    let set = this.listeners.get(mint);
    if (!set) this.listeners.set(mint, (set = new Set()));
    set.add(listener);
    return { mint, stop: () => { set.delete(listener); if (set.size === 0) this.listeners.delete(mint); } };
  }

  /** Emits a tick with the given USD price (MC = price * 1e9). */
  tick(mint: string, priceUsd: number): void {
    const t: PriceTick = { mint, priceUsd, marketCapUsd: priceUsd * 1e9, source: 'pump-swap', receivedAt: Date.now() };
    this.listeners.get(mint)?.forEach((l) => l(t));
  }
}

/** Executor returning queued results; records every order it was asked to execute. */
export class FakeExecutor extends TradeExecutorPort {
  ready = true;
  readonly executed: Order[] = [];
  readonly results: ExecutionResult[] = [];
  private readyCb: ((userId: string) => void) | null = null;
  /** When set, execute() waits for this promise before answering. */
  gate: Promise<void> | null = null;

  /** Current readiness (the same for every account). */
  isReady(_userId: string): boolean { return this.ready; }

  /** Stores the readiness callback. */
  onReady(cb: (userId: string) => void): void { this.readyCb = cb; }

  /** Flips to ready and notifies the engine for `userId`. */
  connect(userId = 'u1'): void { this.ready = true; this.readyCb?.(userId); }

  /** Returns the next queued result (default: success). */
  async execute(order: Order): Promise<ExecutionResult> {
    this.executed.push(order);
    if (this.gate) await this.gate;
    return this.results.shift() ?? { ok: true, detail: 'filled' };
  }
}
