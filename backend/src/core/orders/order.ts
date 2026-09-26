/**
 * @file order.ts
 * @description Order domain model: types, creation schema/validation and trigger evaluation.
 * @author Reborn1987
 */

import { z } from 'zod';

import type { PriceTick } from '../../ports/price-feed.js';

/** FOMO's minimum trade size in USD. */
export const MIN_TRADE_USD = 2;
/** Default number of execution attempts (slippage failures re-arm the order). */
export const DEFAULT_MAX_ATTEMPTS = 3;

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
  readonly mint: string;
  readonly side: OrderSide;
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

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Validated input for creating an order. */
export const CreateOrderSchema = z
  .object({
    mint: z.string().regex(SOLANA_ADDRESS, 'Not a valid Solana token address'),
    side: z.enum(['buy', 'sell']),
    trigger: z.object({
      metric: z.enum(['price', 'marketCap']),
      direction: z.enum(['below', 'above']),
      value: z.number().positive().finite(),
      supply: z.number().positive().finite().nullable().default(null),
    }),
    amount: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('usd'), value: z.number().finite().min(MIN_TRADE_USD, `Minimum trade is $${MIN_TRADE_USD}`) }),
      z.object({ kind: z.literal('percent'), value: z.number().finite().gt(0).max(100) }),
    ]),
    maxAttempts: z.number().int().min(1).max(10).default(DEFAULT_MAX_ATTEMPTS),
  })
  .strict();

export type CreateOrderInput = z.input<typeof CreateOrderSchema>;
export type ValidCreateOrder = z.output<typeof CreateOrderSchema>;

/** Returns the tick value the trigger compares against (MC uses the order's supply when it has one). */
export function metricValue(order: { readonly trigger: Pick<Order['trigger'], 'metric' | 'supply'> }, tick: PriceTick): number {
  if (order.trigger.metric === 'price') return tick.priceUsd;
  return order.trigger.supply ? tick.priceUsd * order.trigger.supply : tick.marketCapUsd;
}

/** True when the tick satisfies the order's trigger condition. */
export function isTriggered(order: { readonly trigger: Pick<Order['trigger'], 'metric' | 'supply' | 'direction' | 'value'> }, tick: PriceTick): boolean {
  const v = metricValue(order, tick);
  return order.trigger.direction === 'below' ? v <= order.trigger.value : v >= order.trigger.value;
}
