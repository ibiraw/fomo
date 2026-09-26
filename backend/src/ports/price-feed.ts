/**
 * @file price-feed.ts
 * @description PriceFeedPort — live USD price/market-cap stream per token mint.
 * @author Reborn1987
 */

/** One live price observation for a token. */
export interface PriceTick {
  readonly mint: string;
  readonly priceUsd: number;
  readonly marketCapUsd: number;
  /** Which source produced the tick. On-chain sources are sub-second; 'jupiter' is a polled fallback (seconds). */
  readonly source: 'pump-curve' | 'pump-swap' | 'raydium-launchlab' | 'raydium-cpmm' | 'jupiter';
  readonly receivedAt: number;
}

/** Callback invoked on every tick for a watched mint. */
export type PriceListener = (tick: PriceTick) => void;

/** Handle returned by watch(); call stop() to unsubscribe. */
export interface PriceWatch {
  readonly mint: string;
  stop(): void;
}

/** Abstract live price source. Adapters: ChainstackPriceFeedAdapter. */
export abstract class PriceFeedPort {
  /** Opens connections and the SOL/USD reference stream. */
  abstract start(): Promise<void>;

  /** Closes all subscriptions and connections. */
  abstract close(): Promise<void>;

  /**
   * Starts streaming ticks for `mint`. Rejects with UnsupportedPoolError if the token's
   * pool type cannot be priced, or AccountNotFoundError if the mint has no known pool.
   */
  abstract watch(mint: string, listener: PriceListener): Promise<PriceWatch>;
}
