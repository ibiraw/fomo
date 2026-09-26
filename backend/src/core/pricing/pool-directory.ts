/**
 * @file pool-directory.ts
 * @description Finds which pools a token trades in, using DexScreener's free token endpoint. Used only to
 *              discover pool addresses; prices are then read on-chain and every pool is verified on-chain
 *              by its account layout before use.
 * @author Reborn1987
 */

import type { HttpJsonPort } from '../../ports/http-json.js';

const DEXSCREENER_TOKEN_URL = 'https://api.dexscreener.com/tokens/v1/';
/** Lists up to 30 pools per token (the tokens endpoint returns only a token's main pair on EVM chains). */
const DEXSCREENER_PAIRS_URL = 'https://api.dexscreener.com/token-pairs/v1/';
const CACHE_MS = 10 * 60_000;

/** One listed pool. */
export interface ListedPool {
  readonly dexId: string;
  readonly labels: readonly string[];
  readonly address: string;
  readonly liquidityUsd: number;
  /** The listed token's side of the pair (DexScreener "baseToken") and the other side ("quoteToken"). */
  readonly baseAddress: string;
  readonly quoteAddress: string;
  readonly quoteSymbol: string;
  /** Price of the base token in the quote token, per DexScreener (used only to sanity-check on-chain orientation). */
  readonly priceNative: number;
  /** DexScreener's USD price (fallback feed only). */
  readonly priceUsd: number;
}

export class PoolDirectory {
  private readonly cache = new Map<string, { at: number; pools: ListedPool[] }>();

  /** @param http JSON fetcher @param now clock */
  constructor(private readonly http: HttpJsonPort, private readonly now: () => number = Date.now) {}

  /**
   * Pools for `mint`, highest liquidity first (cached 10 min).
   * @param chain DexScreener chain id ('solana', 'ethereum', 'base', 'bsc', 'robinhood', 'arc')
   */
  async find(mint: string, chain = 'solana', maxAgeMs = CACHE_MS): Promise<ListedPool[]> {
    const key = `${chain}:${mint}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < maxAgeMs) return hit.pools;
    const json = await this.http.getJson(`${chain === 'solana' ? DEXSCREENER_TOKEN_URL : DEXSCREENER_PAIRS_URL}${chain}/${mint}`, 8_000);
    const pools = (Array.isArray(json) ? json : [])
      .map((p: Record<string, unknown>): ListedPool => ({
        dexId: String(p.dexId ?? ''),
        labels: Array.isArray(p.labels) ? p.labels.map(String) : [],
        address: String(p.pairAddress ?? ''),
        liquidityUsd: Number((p.liquidity as { usd?: unknown } | undefined)?.usd ?? 0) || 0,
        baseAddress: String((p.baseToken as { address?: unknown } | undefined)?.address ?? ''),
        quoteAddress: String((p.quoteToken as { address?: unknown } | undefined)?.address ?? ''),
        quoteSymbol: String((p.quoteToken as { symbol?: unknown } | undefined)?.symbol ?? ''),
        priceNative: Number(p.priceNative ?? 0) || 0,
        priceUsd: Number(p.priceUsd ?? 0) || 0,
      }))
      .filter((p) => p.address)
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    this.cache.set(key, { at: this.now(), pools });
    return pools;
  }
}
