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
  /**
   * `market`: a quick trade (v2.0.0), traded right away; `trailing`: a trailing stop (v2.1.0), its stop in
   * `trigger.value` follows the highest value seen. Absent on servers from before quick trades.
   */
  readonly kind?: 'limit' | 'market' | 'trailing';
  /** Trailing stops: distance under the high in % (v2.1.0). */
  readonly trailPct?: number | null;
  /** Trailing stops: the highest value seen since placing, in the trigger's metric (v2.1.0). */
  readonly peak?: number | null;
  /** `auto`: placed by limit after a buy (v2.1.0 auto take profit / stop loss). */
  readonly source?: 'user' | 'auto';
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

export type NewOrder =
  | {
    readonly mint: string;
    readonly side: OrderSide;
    readonly trigger: Order['trigger'];
    readonly amount: OrderAmount;
  }
  | {
    /** v2.1.0 trailing stop: sells once the value drops `trailPct` % under its highest point since placing. */
    readonly kind: 'trailing';
    readonly mint: string;
    readonly side: 'sell';
    readonly metric: TriggerMetric;
    readonly trailPct: number;
    /** The current value seen on the page (the server uses its own latest value when it has one). */
    readonly reference: number;
    readonly supply: number | null;
    readonly amount: OrderAmount;
  };

/** v2.1.0 auto take profit / stop loss settings (mirror of backend core/orders/auto-exit.ts). */
export interface AutoExitSettings {
  readonly enabled: boolean;
  readonly buys: { readonly limit: boolean; readonly quick: boolean; readonly manual: boolean };
  readonly takeProfit: { readonly enabled: boolean; readonly pct: number; readonly sellPct: number };
  readonly stopLoss: { readonly enabled: boolean; readonly pct: number; readonly sellPct: number; readonly trailing: boolean };
}

/** Allowed trailing distance (%), as on the server. */
export const MIN_TRAIL_PCT = 1;
export const MAX_TRAIL_PCT = 90;

export interface PriceTick {
  readonly mint: string;
  readonly priceUsd: number;
  readonly marketCapUsd: number;
  /** On-chain sources are sub-second; 'jupiter' and 'dexscreener' are polled fallbacks (a few seconds behind). */
  readonly source:
    | 'pump-curve' | 'pump-swap' | 'raydium-launchlab' | 'raydium-cpmm' | 'meteora-dbc' | 'meteora-damm2'
    | 'v2-pool' | 'v3-pool' | 'v4-pool' | 'four-meme' | 'flap' | 'pons'
    | 'jupiter' | 'dexscreener';
  readonly receivedAt: number;
}

/**
 * `layout`: fomo's page wasn't recognised (a redesign) and nothing was clicked — the server pauses the account's trades
 * instead of failing the order, and they resume once the layout settings are fixed.
 */
export type ExecutionErrorKind = 'slippage' | 'rejected' | 'not_logged_in' | 'insufficient_funds' | 'ui_error' | 'timeout' | 'unknown' | 'layout';

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
