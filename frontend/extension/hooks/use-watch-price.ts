/**
 * @file use-watch-price.ts
 * @description Asks the server to stream a token's price while it is on screen (renewed every 2 min,
 *              the server keeps interest for 5 min), so the form can show the live market cap.
 *              Returns the server's error when the token cannot be priced (e.g. unsupported pool).
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import type { SendFn } from './use-background';

const RENEW_MS = 2 * 60_000;

/** Keeps the server streaming `mint` while mounted and connected; returns the last error, if any. */
export function useWatchPrice(mint: string | null, connected: boolean, send: SendFn): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    if (!mint || !connected) return;
    let alive = true;
    const ask = (): void => {
      send({ type: 'price.watch', mint })
        .then(() => { if (alive) setError(null); })
        .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)); });
    };
    ask();
    const t = setInterval(ask, RENEW_MS);
    return () => { alive = false; clearInterval(t); };
  }, [mint, connected, send]);
  return error;
}
