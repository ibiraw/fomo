/**
 * @file use-watch-price.ts
 * @description Asks the server to stream a token's price while it is on screen (renewed every 2 min,
 *              the server keeps interest for 5 min), so the form can show the live market cap.
 * @author Reborn1987
 */

import { useEffect } from 'react';

import type { SendFn } from './use-background';

const RENEW_MS = 2 * 60_000;

/** Keeps the server streaming `mint` while mounted and connected. */
export function useWatchPrice(mint: string | null, connected: boolean, send: SendFn): void {
  useEffect(() => {
    if (!mint || !connected) return;
    const ask = (): void => { void send({ type: 'price.watch', mint }).catch(() => undefined); };
    ask();
    const t = setInterval(ask, RENEW_MS);
    return () => clearInterval(t);
  }, [mint, connected, send]);
}
