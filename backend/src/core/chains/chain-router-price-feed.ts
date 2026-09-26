/**
 * @file chain-router-price-feed.ts
 * @description Routes price watches to the feed for the token's chain (Solana feeds or one feed per EVM chain).
 * @author Reborn1987
 */

import { UnsupportedPoolError } from '../errors.js';
import { PriceFeedPort, type PriceListener, type PriceWatch } from '../../ports/price-feed.js';
import { parseTokenKey, type Chain } from './token-key.js';

export class ChainRouterPriceFeed extends PriceFeedPort {
  /** @param feeds one feed per enabled chain */
  constructor(private readonly feeds: ReadonlyMap<Chain, PriceFeedPort>) {
    super();
  }

  /** Starts every chain's feed. */
  async start(): Promise<void> {
    for (const f of this.feeds.values()) await f.start();
  }

  /** Closes every chain's feed. */
  async close(): Promise<void> {
    for (const f of this.feeds.values()) await f.close();
  }

  /** Watches `key` on its chain's feed; UnsupportedPoolError when that chain is not configured. */
  watch(key: string, listener: PriceListener): Promise<PriceWatch> {
    const { chain } = parseTokenKey(key);
    const feed = this.feeds.get(chain);
    if (!feed) return Promise.reject(new UnsupportedPoolError(`${chain} is not enabled — add its RPC URLs to backend/.env`));
    return feed.watch(key, listener);
  }
}
