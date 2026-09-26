/**
 * @file composite-price-feed.ts
 * @description Tries price feeds in priority order (fast on-chain first, Jupiter fallback last). A feed
 *              that cannot price a token rejects with UnsupportedPoolError and the next one is tried;
 *              any other error (e.g. RPC failure) is rethrown so it is not mistaken for "unsupported".
 * @author Reborn1987
 */

import { UnsupportedPoolError } from '../errors.js';
import { PriceFeedPort, type PriceListener, type PriceWatch } from '../../ports/price-feed.js';

export class CompositePriceFeed extends PriceFeedPort {
  /** @param feeds in priority order */
  constructor(private readonly feeds: readonly PriceFeedPort[]) {
    super();
  }

  /** Starts every feed. */
  async start(): Promise<void> {
    for (const f of this.feeds) await f.start();
  }

  /** Closes every feed. */
  async close(): Promise<void> {
    for (const f of this.feeds) await f.close();
  }

  /** Watches with the first feed that supports the token; explains every refusal otherwise. */
  async watch(mint: string, listener: PriceListener): Promise<PriceWatch> {
    const reasons: string[] = [];
    for (const f of this.feeds) {
      try {
        return await f.watch(mint, listener);
      } catch (err) {
        if (!(err instanceof UnsupportedPoolError)) throw err;
        reasons.push(err.message);
      }
    }
    throw new UnsupportedPoolError(reasons.join(' | ') || `No price feed configured for ${mint}`);
  }
}
