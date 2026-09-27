/**
 * @file trade-executor.ts
 * @description TradeExecutorPort — something that can place a trade on FOMO (the Chrome extension).
 * @author Reborn1987
 */

import type { Order } from '../core/orders/order.js';

/**
 * Why a trade failed. `slippage` is retryable; `unknown` means the outcome could not be confirmed; `layout` means
 * fomo's page wasn't recognised and nothing was clicked — the order goes back to waiting and the account's trades
 * pause until the layout settings work again.
 */
export type ExecutionErrorKind =
  | 'layout'
  | 'slippage'
  | 'not_logged_in'
  | 'insufficient_funds'
  | 'ui_error'
  | 'timeout'
  | 'unknown';

/** Result of one execution attempt (Service Result pattern). */
export type ExecutionResult =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly kind: ExecutionErrorKind; readonly message: string };

/** Abstract trade executor. Adapter: WsGateway (drives the Chrome extension). */
export abstract class TradeExecutorPort {
  /** True when `userId`'s executor (their extension) is connected and able to trade right now. */
  abstract isReady(userId: string): boolean;

  /** Places the trade for `order` through its owner's executor. Must resolve (never reject) with a typed result. */
  abstract execute(order: Order): Promise<ExecutionResult>;

  /** Registers a callback fired with the account id whenever that account's executor becomes ready. */
  abstract onReady(cb: (userId: string) => void): void;
}
