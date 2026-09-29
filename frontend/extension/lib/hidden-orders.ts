/**
 * @file hidden-orders.ts
 * @description Finished orders the user removed from their order list (the ✕ on a filled, failed, cancelled or
 *              "check fomo" order). Kept on this device only (storage.local), so the order history on the server is
 *              untouched; the popup and every Limit panel follow changes live. Ids of orders the server no longer
 *              lists are dropped when the list is saved, and the list is capped.
 * @author Reborn1987
 */

import type { OrderStatus } from './types';

export const HIDDEN_ORDERS_KEY = 'hiddenOrders';
/** Most ids kept (oldest dropped first). */
const MAX_HIDDEN = 2_000;

/** Orders that are over (nothing left to cancel or wait for) and so can be removed from the list. */
export function canRemove(status: OrderStatus): boolean {
  return status === 'filled' || status === 'failed' || status === 'cancelled' || status === 'unknown';
}

/** A stored value as a list of ids (anything else → empty). */
export function toHiddenIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 100) : [];
}

/** The removed ids. */
export async function loadHiddenOrders(): Promise<string[]> {
  return toHiddenIds((await browser.storage.local.get(HIDDEN_ORDERS_KEY))[HIDDEN_ORDERS_KEY]);
}

/**
 * Adds `id` to the removed list. `known` (the ids the server currently lists) prunes ids of orders that are gone.
 */
export async function hideOrder(id: string, known: readonly string[]): Promise<void> {
  const keep = new Set(known);
  const ids = [...(await loadHiddenOrders()).filter((x) => keep.has(x) && x !== id), id].slice(-MAX_HIDDEN);
  await browser.storage.local.set({ [HIDDEN_ORDERS_KEY]: ids });
}

/** Calls `cb` whenever the removed list changes (any popup or tab). Returns an unsubscribe function. */
export function onHiddenOrdersChange(cb: (ids: string[]) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area === 'local' && HIDDEN_ORDERS_KEY in changes) cb(toHiddenIds(changes[HIDDEN_ORDERS_KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
