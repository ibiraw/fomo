/**
 * @file types.ts
 * @description Types shared with the backend gateway protocol (mirror of backend/src/core/orders/order.ts,
 *              backend/src/ports/price-feed.ts and backend/src/ports/trade-executor.ts — keep in sync).
 * @author Reborn1987
 */

export type OrderSide = 'buy' | 'sell';
export type TriggerDirection = 'below' | 'above';
export type TriggerMetric = 'price' | 'marketCap';
export type OrderStatus = 'open' | 'triggered' | 'executing' | 'filled' | 'failed' | 'cancelled' | 'unknown';
export type OrderAmount = { readonly kind: 'usd'; readonly value: number } | { readonly kind: 'percent'; readonly value: number };

export interface Order {
  readonly id: string;
  readonly mint: string;
  readonly side: OrderSide;
  readonly trigger: {
    readonly metric: TriggerMetric;
    readonly direction: TriggerDirection;
    readonly value: number;
    /** Supply for market-cap triggers (fomo's displayed supply); null = the server's on-chain MC. */
    readonly supply?: number | null;
  };
  readonly amount: OrderAmount;
  readonly status: OrderStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastError: string | null;
  readonly triggeredAtValue: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface NewOrder {
  readonly mint: string;
  readonly side: OrderSide;
  readonly trigger: Order['trigger'];
  readonly amount: OrderAmount;
}

export interface PriceTick {
  readonly mint: string;
  readonly priceUsd: number;
  readonly marketCapUsd: number;
  /** On-chain sources are sub-second; 'jupiter' is a polled fallback (a few seconds behind). */
  readonly source: 'pump-curve' | 'pump-swap' | 'raydium-launchlab' | 'raydium-cpmm' | 'meteora-dbc' | 'meteora-damm2' | 'jupiter';
  readonly receivedAt: number;
}

export type ExecutionErrorKind = 'slippage' | 'not_logged_in' | 'insufficient_funds' | 'ui_error' | 'timeout' | 'unknown';

export type ExecutionResult =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly kind: ExecutionErrorKind; readonly message: string };

/** Trade instruction sent from the background worker to the FOMO content script. */
export interface TradeRequest {
  readonly side: OrderSide;
  readonly amount: OrderAmount;
}

/** FOMO's minimum trade size in USD. */
export const MIN_TRADE_USD = 2;
