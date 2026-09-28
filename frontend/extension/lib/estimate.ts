/**
 * @file estimate.ts
 * @description What an order would give if it filled exactly at its target: dollars for a sell, tokens for a buy.
 *              Before fomo's fees and slippage, so it is shown as "≈". Unknown (null) when the needed numbers aren't
 *              on hand — a % sell without the position, a % buy (cash isn't read), or no price yet.
 * @author Reborn1987
 */

import type { AmountUnit } from '@/hooks/use-presets';
import type { OrderSide, TriggerMetric } from './types';

export interface EstimateInput {
  readonly side: OrderSide;
  readonly unit: AmountUnit;
  /** $ or %, per `unit`. */
  readonly amount: number;
  readonly metric: TriggerMetric;
  /** Target market cap or price ($). */
  readonly target: number;
  /** Supply that turns market cap into price (fomo's displayed supply); null when unknown. */
  readonly supply: number | null;
  /** Tokens held (from fomo's positions list); null when unknown. */
  readonly heldTokens: number | null;
}

export type Estimate = { readonly kind: 'usd'; readonly value: number } | { readonly kind: 'tokens'; readonly value: number };

/** Token price when the target is reached, or null when it can't be told. */
export function priceAtTarget(metric: TriggerMetric, target: number, supply: number | null): number | null {
  if (!(target > 0)) return null;
  if (metric === 'price') return target;
  return supply && supply > 0 ? target / supply : null;
}

/** The fill at the target, or null when it can't be estimated. */
export function estimateFill(i: EstimateInput): Estimate | null {
  if (!(i.amount > 0)) return null;
  const price = priceAtTarget(i.metric, i.target, i.supply);
  if (price === null) return null;
  if (i.side === 'buy') return i.unit === 'usd' ? { kind: 'tokens', value: i.amount / price } : null;
  if (i.unit === 'usd') return { kind: 'usd', value: i.amount };
  return i.heldTokens && i.heldTokens > 0 ? { kind: 'usd', value: (Math.min(i.amount, 100) / 100) * i.heldTokens * price } : null;
}

/** "1.23M", "45.6K", "812" for token counts. */
export function formatTokenCount(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v >= 1 ? v.toFixed(0) : v.toPrecision(3);
}
