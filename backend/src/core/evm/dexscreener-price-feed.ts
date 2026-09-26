/**
 * @file dexscreener-price-feed.ts
 * @description Last-resort PriceFeedPort for one EVM chain: polls DexScreener's token endpoint (one batched
 *              request for up to 30 watched tokens) for tokens whose pool or curve we cannot read on-chain.
 *              Seconds, not sub-second — ticks are tagged source "dexscreener" so the UI can say "slower".
 * @author Reborn1987
 */

import { dexScreenerChain, parseTokenKey, type EvmChain } from '../chains/token-key.js';
import { FomoError, UnsupportedPoolError } from '../errors.js';
import type { Hex } from '../../ports/evm-rpc.js';
import type { HttpJsonPort } from '../../ports/http-json.js';
import { PriceFeedPort, type PriceListener, type PriceWatch } from '../../ports/price-feed.js';
import type { Erc20Reader } from './erc20.js';
import { toUnits } from './pool-math.js';

const DEXSCREENER_TOKENS_URL = 'https://api.dexscreener.com/tokens/v1/';
/** DexScreener accepts up to 30 addresses per request. */
const MAX_IDS = 30;
const REQUEST_TIMEOUT_MS = 6_000;

interface Watched {
  readonly listeners: Set<PriceListener>;
  readonly supply: number;
}

/**
 * Reads DexScreener's pairs response into token address (lowercase) → USD price, taking each token's
 * most liquid pair where it is the base token.
 */
export function parseDexScreenerPrices(json: unknown): Map<string, number> {
  if (!Array.isArray(json)) throw new FomoError('DexScreener returned an unexpected response');
  const best = new Map<string, { price: number; liquidity: number }>();
  for (const p of json as Record<string, unknown>[]) {
    const addr = String((p.baseToken as { address?: unknown } | undefined)?.address ?? '').toLowerCase();
    const price = Number(p.priceUsd);
    const liquidity = Number((p.liquidity as { usd?: unknown } | undefined)?.usd ?? 0) || 0;
    if (!addr || !Number.isFinite(price) || price <= 0) continue;
    const cur = best.get(addr);
    if (!cur || liquidity > cur.liquidity) best.set(addr, { price, liquidity });
  }
  return new Map([...best].map(([a, v]) => [a, v.price]));
}

export class DexScreenerPriceFeed extends PriceFeedPort {
  private readonly watched = new Map<string, Watched>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  /**
   * @param chain the EVM chain this feed serves @param http JSON fetcher @param erc20 supply reader
   * @param pollMs poll interval @param onError sink for transient poll failures
   */
  constructor(
    private readonly chain: EvmChain,
    private readonly http: HttpJsonPort,
    private readonly erc20: Erc20Reader,
    private readonly pollMs: number,
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

  /** Starts polling `key`. Rejects with UnsupportedPoolError when DexScreener has no price for it. */
  async watch(key: string, listener: PriceListener): Promise<PriceWatch> {
    let w = this.watched.get(key);
    if (!w) {
      const address = parseTokenKey(key).address as Hex;
      const [prices, raw, decimals] = await Promise.all([this.fetch([address]), this.erc20.totalSupply(address), this.erc20.decimals(address)]);
      const price = prices.get(address);
      if (price === undefined) throw new UnsupportedPoolError(`No price source found for ${key} (not listed on DexScreener)`);
      w = { listeners: new Set([listener]), supply: toUnits(raw, decimals) };
      this.watched.set(key, w);
      if (!this.timer) this.timer = setInterval(() => void this.pollOnce(), this.pollMs);
      this.emit(key, w, price);
    } else {
      w.listeners.add(listener);
    }
    const state = w;
    return {
      mint: key,
      stop: () => {
        state.listeners.delete(listener);
        if (state.listeners.size === 0) this.watched.delete(key);
        if (this.watched.size === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
      },
    };
  }

  /** Runs one poll round for every watched token (exposed for tests). */
  async pollOnce(): Promise<void> {
    if (this.polling || this.watched.size === 0) return;
    this.polling = true;
    try {
      const keys = [...this.watched.keys()];
      for (let i = 0; i < keys.length; i += MAX_IDS) {
        const batch = keys.slice(i, i + MAX_IDS);
        const prices = await this.fetch(batch.map((k) => parseTokenKey(k).address));
        for (const k of batch) {
          const price = prices.get(parseTokenKey(k).address);
          const w = this.watched.get(k);
          if (w && price !== undefined) this.emit(k, w, price);
        }
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.polling = false;
    }
  }

  /** Fetches USD prices for up to 30 addresses. */
  private async fetch(addresses: string[]): Promise<Map<string, number>> {
    const url = `${DEXSCREENER_TOKENS_URL}${dexScreenerChain(this.chain)}/${addresses.join(',')}`;
    return parseDexScreenerPrices(await this.http.getJson(url, REQUEST_TIMEOUT_MS));
  }

  /** Sends a tick to the token's listeners. */
  private emit(key: string, w: Watched, priceUsd: number): void {
    const tick = { mint: key, priceUsd, marketCapUsd: priceUsd * w.supply, source: 'dexscreener' as const, receivedAt: Date.now() };
    for (const l of w.listeners) l(tick);
  }
}
