/**
 * @file graduation.ts
 * @description Following a token from its bonding curve to the pool it graduates to. Right after graduation the new
 *              pool is often not listed yet (DexScreener indexes it a little later), so the hand-off keeps trying until
 *              the pool feed accepts the token or the watch is stopped. Before this, one failed try left the token
 *              without a price for good (FLIGHT14, 2026-09-28).
 * @author Reborn1987
 */

import type { PriceListener, PriceFeedPort } from '../../ports/price-feed.js';

/** How long to wait between tries while the graduated pool isn't found yet. */
export const GRADUATION_RETRY_MS = 30_000;

/**
 * Hands `mint`'s listener over to `pools`, retrying every `retryMs` until it succeeds. Returns a stop function that
 * ends the pool watch (or the retries).
 */
export function followGraduation(
  pools: PriceFeedPort,
  mint: string,
  listener: PriceListener,
  onError: (err: unknown) => void,
  retryMs = GRADUATION_RETRY_MS,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let stopWatch: (() => void) | null = null;
  const attempt = (): void => {
    timer = null;
    pools
      .watch(mint, listener)
      .then((w) => {
        if (stopped) w.stop();
        else stopWatch = () => w.stop();
      })
      .catch((err: unknown) => {
        onError(err);
        if (!stopped) timer = setTimeout(attempt, retryMs);
      });
  };
  attempt();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    stopWatch?.();
  };
}
