/**
 * @file order.ts
 * @description Order domain model: types, creation schema/validation and trigger evaluation. Two kinds: `limit`
 *              (waits for its price / market-cap trigger) and `market` (v2.0.0 quick trades from fomo's Feed and Alerts:
 *              triggered right away; stored with an always-met trigger, price >= 0).
 * @author Reborn1987
 */

import { z } from 'zod';

import type { PriceTick } from '../../ports/price-feed.js';
import { canonicalTokenKey, isTokenKey } from '../chains/token-key.js';

/** FOMO's minimum trade size in USD. */
export const MIN_TRADE_USD = 2;
/** Default number of execution attempts (slippage failures re-arm the order). */
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Quick (market) trades retry a slippage failure once, so they never land long after the tap. */
export const MARKET_MAX_ATTEMPTS = 2;
/** A quick trade that hasn't started this long after the tap (server restart, extension offline) is cancelled. */
export const MARKET_MAX_WAIT_MS = 30_000;

/** `limit`: waits for its trigger. `market`: trades right away (quick Buy/Sell buttons). */
export type OrderKind = 'limit' | 'market';

export type OrderSide = 'buy' | 'sell';
/** Trigger fires when the metric goes at-or-below ("below") or at-or-above ("above") the target. */
export type TriggerDirection = 'below' | 'above';
export type TriggerMetric = 'price' | 'marketCap';

export type OrderStatus =
  | 'open' // waiting for the price condition
  | 'triggered' // condition met, queued for the executor
  | 'executing' // sent to the extension, awaiting result
  | 'filled'
  | 'failed'
  | 'cancelled'
  | 'unknown'; // execution outcome could not be confirmed (timeout / restart) — user must check FOMO

/** Trade size: fixed USD or a percentage (of cash for buys, of the position for sells). */
export type OrderAmount = { readonly kind: 'usd'; readonly value: number } | { readonly kind: 'percent'; readonly value: number };

/** A persisted order. */
export interface Order {
  readonly id: string;
  /** Account that owns the order (only that account sees it, and only its extension executes it). */
  readonly userId: string;
  /** Token key: a Solana mint or `<chain>:<0xaddress>` (see core/chains/token-key.ts). */
  readonly mint: string;
  readonly side: OrderSide;
  readonly kind: OrderKind;
  readonly trigger: {
    readonly metric: TriggerMetric;
    readonly direction: TriggerDirection;
    readonly value: number;
    /**
     * Supply to compute market cap with (the figure fomo displays). fomo's supply can differ from the
     * on-chain mint supply (e.g. after burns), so MC orders placed from the fomo page carry it to match
     * exactly what the user sees. Null = use the price feed's market cap.
     */
    readonly supply: number | null;
  };
  readonly amount: OrderAmount;
  readonly status: OrderStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastError: string | null;
  /** USD price / market cap observed when the order last triggered. */
  readonly triggeredAtValue: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Statuses from which an order can no longer change. */
export const FINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(['filled', 'failed', 'cancelled', 'unknown']);

const Mint = z.string().refine(isTokenKey, 'Not a valid token address').transform(canonicalTokenKey);
const Amount = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('usd'), value: z.number().finite().min(MIN_TRADE_USD, `Minimum trade is $${MIN_TRADE_USD}`) }),
  z.object({ kind: z.literal('percent'), value: z.number().finite().gt(0).max(100) }),
]);

const LimitOrderSchema = z
  .object({
    kind: z.literal('limit'),
    mint: Mint,
    side: z.enum(['buy', 'sell']),
    trigger: z.object({
      metric: z.enum(['price', 'marketCap']),
      direction: z.enum(['below', 'above']),
      value: z.number().positive().finite(),
      supply: z.number().positive().finite().nullable().default(null),
    }),
    amount: Amount,
    maxAttempts: z.number().int().min(1).max(10).default(DEFAULT_MAX_ATTEMPTS),
  })
  .strict();

const MarketOrderSchema = z
  .object({
    kind: z.literal('market'),
    mint: Mint,
    side: z.enum(['buy', 'sell']),
    amount: Amount,
    maxAttempts: z.number().int().min(1).max(MARKET_MAX_ATTEMPTS).default(MARKET_MAX_ATTEMPTS),
  })
  .strict();

/** The trigger stored with a market order: always met (price >= 0). */
export const MARKET_TRIGGER = { metric: 'price', direction: 'above', value: 0, supply: null } as const;

/** Validated input for creating an order (no `kind` = a limit order, as before quick trades existed). */
export const CreateOrderSchema = z
  .preprocess(
    (v) => (v && typeof v === 'object' && !Array.isArray(v) && !('kind' in v) ? { ...v, kind: 'limit' } : v),
    z.discriminatedUnion('kind', [LimitOrderSchema, MarketOrderSchema]),
  )
  .transform((o) => (o.kind === 'market' ? { ...o, trigger: { ...MARKET_TRIGGER } } : o));

export type CreateOrderInput = z.input<typeof CreateOrderSchema>;
export type ValidCreateOrder = z.output<typeof CreateOrderSchema>;

/** Returns the tick value the trigger compares against (MC uses the order's supply when it has one). */
export function metricValue(order: { readonly trigger: Pick<Order['trigger'], 'metric' | 'supply'> }, tick: PriceTick): number {
  if (order.trigger.metric === 'price') return tick.priceUsd;
  return order.trigger.supply ? tick.priceUsd * order.trigger.supply : tick.marketCapUsd;
}

/** True when the tick satisfies the order's trigger condition (always, for a market order). */
export function isTriggered(order: { readonly kind?: OrderKind; readonly trigger: Pick<Order['trigger'], 'metric' | 'supply' | 'direction' | 'value'> }, tick: PriceTick): boolean {
  if (order.kind === 'market') return true;
  const v = metricValue(order, tick);
  return order.trigger.direction === 'below' ? v <= order.trigger.value : v >= order.trigger.value;
}
