/**
 * @file use-watch-price.ts
 * @description Asks the server to stream a token's price while it is on screen (renewed every 2 min,
 *              the server keeps interest for 5 min), so the form can show the live market cap.
 *              Returns the server's error when the token cannot be priced (e.g. unsupported pool). A slow or lost
 *              answer is not such an error: the first price of a graduated coin can take the server over the 15 s
 *              request limit (SI, 2026-09-29), which used to show "not available" for 2 minutes. It is asked again
 *              after 5 s instead, and a real error is re-checked every minute.
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { isTransientError } from '@/lib/server-connection';

import type { SendFn } from './use-background';

const RENEW_MS = 2 * 60_000;
const RETRY_TRANSIENT_MS = 5_000;
const RETRY_ERROR_MS = 60_000;

/** Keeps the server streaming `mint` while mounted and connected; returns the last error, if any. */
export function useWatchPrice(mint: string | null, connected: boolean, send: SendFn): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    if (!mint || !connected) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = (): void => {
      send({ type: 'price.watch', mint })
        .then(() => {
          if (!alive) return;
          setError(null);
          timer = setTimeout(ask, RENEW_MS);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          const message = err instanceof Error ? err.message : String(err);
          if (isTransientError(message)) {
            timer = setTimeout(ask, RETRY_TRANSIENT_MS);
          } else {
            setError(message);
            timer = setTimeout(ask, RETRY_ERROR_MS);
          }
        });
    };
    ask();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [mint, connected, send]);
  return error;
}
