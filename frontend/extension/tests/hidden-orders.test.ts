/**
 * @file hidden-orders.test.ts
 * @description Removing finished orders from the order list: which orders can be removed, the stored list (bad
 *              values ignored, ids of orders the server no longer lists pruned, no duplicates) and live changes.
 * @author Reborn1987
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canRemove, hideOrder, HIDDEN_ORDERS_KEY, loadHiddenOrders, onHiddenOrdersChange, toHiddenIds } from '../lib/hidden-orders';

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

/** In-memory browser.storage.local with change events. */
function fakeStorage() {
  const data: Record<string, unknown> = {};
  const listeners = new Set<Listener>();
  return {
    data,
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (items: Record<string, unknown>) => {
          Object.assign(data, items);
          const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
          listeners.forEach((l) => l(changes, 'local'));
        },
      },
      onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
  };
}

let store: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  store = fakeStorage();
  vi.stubGlobal('browser', store);
});

describe('hidden orders', () => {
  it('only offers removal for orders that are over', () => {
    expect(['filled', 'failed', 'cancelled', 'unknown'].every((s) => canRemove(s as never))).toBe(true);
    expect(['open', 'triggered', 'executing'].some((s) => canRemove(s as never))).toBe(false);
  });

  it('reads only valid ids', () => {
    expect(toHiddenIds(['a', '', 3, null, 'b'])).toEqual(['a', 'b']);
    expect(toHiddenIds('a')).toEqual([]);
  });

  it('adds an id once, drops ids of orders that are gone, and tells every list', async () => {
    const seen: string[][] = [];
    const off = onHiddenOrdersChange((ids) => seen.push(ids));
    store.data[HIDDEN_ORDERS_KEY] = ['gone', 'o1'];
    await hideOrder('o2', ['o1', 'o2', 'o3']);
    await hideOrder('o2', ['o1', 'o2', 'o3']);
    expect(await loadHiddenOrders()).toEqual(['o1', 'o2']);
    expect(seen.at(-1)).toEqual(['o1', 'o2']);
    off();
    await hideOrder('o3', ['o1', 'o2', 'o3']);
    expect(seen).toHaveLength(2); // unsubscribed
  });
});
