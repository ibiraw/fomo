/**
 * @file auto-exit.ts
 * @description v2.1.0 auto take profit / stop loss: after a buy, limit places the account's chosen exit orders by
 *              itself. Each account picks which buys get them (limit buys, quick buys, buys made by hand on fomo), the
 *              take profit (+X%, sell Y%) and the stop loss (−X%, sell Y%, fixed or trailing). A new buy of the same
 *              token replaces the earlier automatic exits, measured from the new buy's price.
 *              Quick and manual buys are seen from fomo's toast, before the tokens land: the exits wait until the
 *              wallet shows the tokens (else the holdings guard would cancel them as "sold out" a few seconds later).
 * @author Reborn1987
 */

import { z } from 'zod';

import type { AutoExitStorePort } from '../../ports/auto-exit-store.js';
import type { PriceTick } from '../../ports/price-feed.js';
import { MAX_TRAIL_PCT, MIN_TRAIL_PCT, type Order } from './order.js';
import type { ConfirmerLookup } from './order-engine.js';

/** Where a buy came from. */
export type BuyOrigin = 'limit' | 'quick' | 'manual';

export const AutoExitSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** Which buys get exits. */
    buys: z.object({ limit: z.boolean(), quick: z.boolean(), manual: z.boolean() }).strict(),
    takeProfit: z.object({ enabled: z.boolean(), pct: z.number().finite().min(1).max(10_000), sellPct: z.number().finite().gt(0).max(100) }).strict(),
    stopLoss: z.object({
      enabled: z.boolean(),
      pct: z.number().finite().min(MIN_TRAIL_PCT).max(MAX_TRAIL_PCT),
      sellPct: z.number().finite().gt(0).max(100),
      /** Trailing: the stop sits `pct` % under the highest price since the buy instead of under the buy price. */
      trailing: z.boolean(),
    }).strict(),
  })
  .strict();

export type AutoExitSettings = z.infer<typeof AutoExitSettingsSchema>;

/** Off until the user switches it on; then take profit at 2x selling all, stop loss at −50% selling all. */
export const DEFAULT_AUTO_EXIT: AutoExitSettings = {
  enabled: false,
  buys: { limit: true, quick: true, manual: false },
  takeProfit: { enabled: true, pct: 100, sellPct: 100 },
  stopLoss: { enabled: true, pct: 50, sellPct: 100, trailing: false },
};

/** What the service needs from the order engine. */
export interface AutoExitOrders {
  createOrder(userId: string, input: unknown, source: 'auto'): Promise<Order>;
  cancelOrder(id: string, reason?: string, userId?: string): Order;
  listOrders(userId?: string, statuses?: readonly Order['status'][], mint?: string): Order[];
  viewMint(mint: string): Promise<PriceTick | null>;
  latestTick(mint: string): PriceTick | null;
}

/** Timings (injectable for tests). */
export interface AutoExitTimings {
  /** How often the wallet is read while waiting for the bought tokens to land. */
  readonly pollMs: number;
  /** How long to wait for them before giving up. */
  readonly landMs: number;
  /** Wait for a first price after a buy on a token nobody was watching. */
  readonly priceMs: number;
}

export const DEFAULT_AUTO_EXIT_TIMINGS: AutoExitTimings = { pollMs: 3_000, landMs: 90_000, priceMs: 10_000 };

/** Note stored on automatic exits replaced by a newer buy. */
export const REPLACED_REASON = 'replaced: a newer buy set fresh auto exits';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class AutoExitService {
  /** Holdings with a placement in progress (a second buy meanwhile waits for it). */
  private readonly running = new Map<string, Promise<void>>();

  /**
   * @param store per-account settings @param orders engine access @param confirmerFor wallet balance reader
   * @param allowed whether the account's version has auto exits (and trailing stops)
   * @param report what happened, for the activity log and the owner (one line)
   * @param onError sink for unexpected errors
   */
  constructor(
    private readonly store: AutoExitStorePort,
    private readonly orders: AutoExitOrders,
    private readonly confirmerFor: ConfirmerLookup,
    private readonly allowed: (userId: string) => boolean,
    private readonly report: (userId: string, mint: string, line: string) => void,
    private readonly onError: (err: unknown) => void,
    private readonly t: AutoExitTimings = DEFAULT_AUTO_EXIT_TIMINGS,
  ) {}

  /** The account's settings (defaults when it never saved any). */
  get(userId: string): AutoExitSettings {
    return this.store.get(userId) ?? DEFAULT_AUTO_EXIT;
  }

  /** Validates and saves the account's settings. */
  set(userId: string, input: unknown): AutoExitSettings {
    const settings = AutoExitSettingsSchema.parse(input);
    this.store.set(userId, settings);
    return settings;
  }

  /** Engine hook: a limit (or old-style market) buy filled. */
  onOrderFilled(order: Order, priceUsd: number | null): void {
    if (order.side !== 'buy') return;
    this.onBuy(order.userId, order.mint, order.kind === 'market' ? 'quick' : 'limit', priceUsd);
  }

  /** A buy happened: places the account's exits if it wants them for this kind of buy. */
  onBuy(userId: string, mint: string, origin: BuyOrigin, priceUsd: number | null = null): void {
    if (!this.allowed(userId)) return;
    const s = this.get(userId);
    if (!s.enabled || !s.buys[origin] || (!s.takeProfit.enabled && !s.stopLoss.enabled)) return;
    const key = `${userId}|${mint}`;
    const prev = this.running.get(key) ?? Promise.resolve();
    const next = prev
      .then(() => this.place(userId, mint, origin, priceUsd, s))
      .catch((err: unknown) => this.onError(err))
      .finally(() => { if (this.running.get(key) === next) this.running.delete(key); });
    this.running.set(key, next);
  }

  /** Waits for settled tokens and a price, replaces earlier automatic exits and places the new ones. */
  private async place(userId: string, mint: string, origin: BuyOrigin, fillPrice: number | null, s: AutoExitSettings): Promise<void> {
    if (origin !== 'limit' && !(await this.tokensLanded(userId, mint))) {
      this.report(userId, mint, '🤖 Auto TP/SL not set: the bought tokens never showed up in the wallet');
      return;
    }
    const entry = (origin === 'limit' ? fillPrice : null) ?? (await this.currentPrice(mint));
    if (!entry) {
      this.report(userId, mint, '🤖 Auto TP/SL not set: no price for this token');
      return;
    }
    for (const o of this.orders.listOrders(userId, ['open', 'triggered'], mint)) {
      if (o.source !== 'auto') continue;
      try {
        this.orders.cancelOrder(o.id, REPLACED_REASON, userId);
      } catch {
        // started executing meanwhile: leave it
      }
    }
    const placed: string[] = [];
    const failed: string[] = [];
    const attempt = async (label: string, input: unknown): Promise<void> => {
      try {
        await this.orders.createOrder(userId, input, 'auto');
        placed.push(label);
      } catch (err) {
        failed.push(`${label} (${err instanceof Error ? err.message : String(err)})`);
      }
    };
    if (s.takeProfit.enabled) {
      await attempt(`take profit +${s.takeProfit.pct}%`, {
        kind: 'limit', mint, side: 'sell',
        trigger: { metric: 'price', direction: 'above', value: entry * (1 + s.takeProfit.pct / 100), supply: null },
        amount: { kind: 'percent', value: s.takeProfit.sellPct },
      });
    }
    if (s.stopLoss.enabled) {
      await attempt(
        s.stopLoss.trailing ? `trailing stop ${s.stopLoss.pct}%` : `stop loss −${s.stopLoss.pct}%`,
        s.stopLoss.trailing
          ? { kind: 'trailing', mint, side: 'sell', metric: 'price', trailPct: s.stopLoss.pct, reference: entry, amount: { kind: 'percent', value: s.stopLoss.sellPct } }
          : {
            kind: 'limit', mint, side: 'sell',
            trigger: { metric: 'price', direction: 'below', value: entry * (1 - s.stopLoss.pct / 100), supply: null },
            amount: { kind: 'percent', value: s.stopLoss.sellPct },
          },
      );
    }
    if (failed.length) this.report(userId, mint, `🤖 Auto TP/SL after a ${origin} buy: ${placed.length ? `set ${placed.join(' + ')}; ` : ''}not set: ${failed.join('; ')}`);
  }

  /** True once the wallet holds the token (immediately when no wallet is known: nothing to wait for). */
  private async tokensLanded(userId: string, mint: string): Promise<boolean> {
    const wallet = this.confirmerFor(userId);
    if (!wallet?.covers(mint)) return true;
    const until = Date.now() + this.t.landMs;
    for (;;) {
      try {
        if ((await wallet.snapshot(mint)) > 0n) return true;
      } catch (err) {
        this.onError(err);
      }
      if (Date.now() >= until) return false;
      await sleep(this.t.pollMs);
    }
  }

  /** The token's latest USD price, starting a price stream (and waiting briefly) when there is none yet. */
  private async currentPrice(mint: string): Promise<number | null> {
    const first = (await this.orders.viewMint(mint))?.priceUsd ?? null;
    if (first) return first;
    const until = Date.now() + this.t.priceMs;
    while (Date.now() < until) {
      await sleep(Math.min(500, this.t.pollMs));
      const p = this.orders.latestTick(mint)?.priceUsd;
      if (p) return p;
    }
    return null;
  }
}
