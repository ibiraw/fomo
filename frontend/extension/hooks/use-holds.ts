/**
 * @file use-holds.ts
 * @description Whether the wallet holds a token, so the form can disable selling instead of erroring.
 *              Re-checked every few seconds and whenever an order on the token changes (e.g. a buy filled).
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import type { Order } from '@/lib/types';

import type { SendFn } from './use-background';

const POLL_MS = 8_000;

/** true / false once known; null while unknown (not connected, no wallet configured, or check failed). */
export function useHolds(mint: string | null, connected: boolean, send: SendFn, orders: readonly Order[]): boolean | null {
  const [holds, setHolds] = useState<boolean | null>(null);
  // Changes whenever an order on this token changes status, triggering an immediate re-check.
  const orderKey = orders.filter((o) => o.mint === mint).map((o) => `${o.id}:${o.status}`).join('|');
  useEffect(() => {
    setHolds(null);
  }, [mint]);
  useEffect(() => {
    if (!mint || !connected) return;
    let alive = true;
    const check = (): void => {
      send({ type: 'wallet.holds', mint })
        .then((r) => { if (alive) setHolds((r as { holds: boolean | null }).holds); })
        .catch(() => { if (alive) setHolds(null); }); // unknown: the server still validates on submit
    };
    check();
    const t = setInterval(check, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [mint, connected, send, orderKey]);
  return holds;
}
