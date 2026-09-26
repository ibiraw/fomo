/**
 * @file jupiter-price-feed.ts
 * @description Fallback PriceFeedPort for tokens whose pools we cannot read on-chain yet. Polls Jupiter's
 *              Price API v3 (one batched request for all watched mints). Slower than on-chain feeds
 *              (seconds, not sub-second); ticks are tagged source "jupiter" so the UI can say so.
 * @author Reborn1987
 */

import { FomoError, UnsupportedPoolError } from '../errors.js';
import type { HttpJsonPort } from '../../ports/http-json.js';
import { PriceFeedPort, type PriceListener, type PriceWatch } from '../../ports/price-feed.js';
import type { SolanaAccountsPort } from '../../ports/solana-accounts.js';
import { marketCapUsd } from './math.js';

/** Jupiter accepts up to 50 ids per request. */
const MAX_IDS = 50;
const REQUEST_TIMEOUT_MS = 5_000;

/** Jupiter endpoint settings. */
export interface JupiterOptions {
  /** e.g. https://lite-api.jup.ag/price/v3 (keyless) or https://api.jup.ag/price/v3 (with key). */
  readonly url: string;
  readonly pollMs: number;
}

/** Per-mint state. */
interface Watched {
  readonly listeners: Set<PriceListener>;
  readonly supply: bigint;
  readonly decimals: number;
}

/** Parses Jupiter's response into mint → usdPrice (omitting tokens without a price). */
export function parseJupiterPrices(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!json || typeof json !== 'object') throw new FomoError('Jupiter returned an unexpected response');
  for (const [mint, v] of Object.entries(json as Record<string, unknown>)) {
    const p = (v as { usdPrice?: unknown } | null)?.usdPrice;
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) out.set(mint, p);
  }
  return out;
}

export class JupiterPriceFeed extends PriceFeedPort {
  private readonly watched = new Map<string, Watched>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  /**
   * @param http JSON fetcher (headers such as an API key are the adapter's concern)
   * @param accounts RPC for mint supply @param opts endpoint and poll interval
   * @param onError sink for transient poll failures
   */
  constructor(
    private readonly http: HttpJsonPort,
    private readonly accounts: SolanaAccountsPort,
    private readonly opts: JupiterOptions,
    private readonly onError: (err: unknown) => void,
  ) {
    super();
  }

  /** Nothing to open up front; polling starts with the first watch. */
  async start(): Promise<void> {}

  /** Stops polling and drops all watches. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watched.clear();
  }

  /** Starts polling `mint`. Rejects with UnsupportedPoolError when Jupiter has no price for it. */
  async watch(mint: string, listener: PriceListener): Promise<PriceWatch> {
    let w = this.watched.get(mint);
    if (!w) {
      const [prices, supply] = await Promise.all([this.fetch([mint]), this.accounts.getMintSupply(mint)]);
      if (!prices.has(mint)) throw new UnsupportedPoolError(`No price source found for ${mint} (not listed on Jupiter)`);
      w = { listeners: new Set(), supply: supply.amount, decimals: supply.decimals };
      this.watched.set(mint, w);
      this.ensurePolling();
      w.listeners.add(listener);
      this.emit(mint, w, prices.get(mint)!);
    } else {
      w.listeners.add(listener);
    }
    const state = w;
    return {
      mint,
      stop: () => {
        state.listeners.delete(listener);
        if (state.listeners.size === 0) this.watched.delete(mint);
        if (this.watched.size === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
      },
    };
  }

  /** Runs one poll round for every watched mint (exposed for tests). */
  async pollOnce(): Promise<void> {
    if (this.polling || this.watched.size === 0) return;
    this.polling = true;
    try {
      const mints = [...this.watched.keys()];
      for (let i = 0; i < mints.length; i += MAX_IDS) {
        const prices = await this.fetch(mints.slice(i, i + MAX_IDS));
        for (const [mint, price] of prices) {
          const w = this.watched.get(mint);
          if (w) this.emit(mint, w, price);
        }
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.polling = false;
    }
  }

  /** Starts the poll timer if needed. */
  private ensurePolling(): void {
    if (!this.timer) this.timer = setInterval(() => void this.pollOnce(), this.opts.pollMs);
  }

  /** Fetches prices for up to 50 mints. */
  private async fetch(mints: string[]): Promise<Map<string, number>> {
    const url = `${this.opts.url}?ids=${mints.join(',')}`;
    return parseJupiterPrices(await this.http.getJson(url, REQUEST_TIMEOUT_MS));
  }

  /** Sends a tick to the mint's listeners. */
  private emit(mint: string, w: Watched, priceUsd: number): void {
    const tick = { mint, priceUsd, marketCapUsd: marketCapUsd(priceUsd, w.supply, w.decimals), source: 'jupiter' as const, receivedAt: Date.now() };
    for (const l of w.listeners) l(tick);
  }
}
