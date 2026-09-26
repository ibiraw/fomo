/**
 * @file order-store.ts
 * @description OrderStorePort — durable order persistence with atomic status transitions.
 * @author Reborn1987
 */

import type { Order, OrderStatus, ValidCreateOrder } from '../core/orders/order.js';

/** Optional field updates applied together with a status transition. */
export interface TransitionPatch {
  readonly attempts?: number;
  readonly lastError?: string | null;
  readonly triggeredAtValue?: number | null;
}

/** Abstract order storage. Adapter: SqliteOrderStoreAdapter. */
export abstract class OrderStorePort {
  /** Persists a new order in status 'open' for `userId`. */
  abstract create(input: ValidCreateOrder, userId: string): Order;

  /** Returns an order or null. */
  abstract get(id: string): Order | null;

  /**
   * Returns orders in any of the given statuses (all statuses when omitted or empty), newest first;
   * only `userId`'s orders when given.
   */
  abstract list(statuses?: readonly OrderStatus[], userId?: string): Order[];

  /**
   * Atomically moves an order from one of `from` to `to` (compare-and-set).
   * Returns the updated order, or null if the order was not in an allowed `from` status.
   */
  abstract transition(id: string, from: readonly OrderStatus[], to: OrderStatus, patch?: TransitionPatch): Order | null;
}
