/**
 * @file use-hidden-orders.ts
 * @description The finished orders the user removed from their list, live across the popup and Limit panels.
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { loadHiddenOrders, onHiddenOrdersChange } from '@/lib/hidden-orders';

/** Ids of removed orders (empty until storage answers). */
export function useHiddenOrders(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let alive = true;
    void loadHiddenOrders().then((list) => { if (alive) setIds(new Set(list)); }).catch(() => undefined);
    const off = onHiddenOrdersChange((list) => setIds(new Set(list)));
    return () => { alive = false; off(); };
  }, []);
  return ids;
}
