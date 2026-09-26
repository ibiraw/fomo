/**
 * @file pool-directory.ts
 * @description Finds which pools a token trades in, using DexScreener's free token endpoint. Used only to
 *              discover pool addresses; prices are then read on-chain and every pool is verified on-chain
 *              by its account layout before use.
 * @author Reborn1987
 */

import type { HttpJsonPort } from '../../ports/http-json.js';

const DEXSCREENER_TOKEN_URL = 'https://api.dexscreener.com/tokens/v1/solana/';
const CACHE_MS = 10 * 60_000;

/** One listed pool. */
export interface ListedPool {
  readonly dexId: string;
  readonly labels: readonly string[];
  readonly address: string;
  readonly liquidityUsd: number;
}

export class PoolDirectory {
  private readonly cache = new Map<string, { at: number; pools: ListedPool[] }>();

  /** @param http JSON fetcher @param now clock */
  constructor(private readonly http: HttpJsonPort, private readonly now: () => number = Date.now) {}

  /** Pools for `mint`, highest liquidity first (cached 10 min). */
  async find(mint: string): Promise<ListedPool[]> {
    const hit = this.cache.get(mint);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.pools;
    const json = await this.http.getJson(DEXSCREENER_TOKEN_URL + mint, 8_000);
    const pools = (Array.isArray(json) ? json : [])
      .map((p: Record<string, unknown>): ListedPool => ({
        dexId: String(p.dexId ?? ''),
        labels: Array.isArray(p.labels) ? p.labels.map(String) : [],
        address: String(p.pairAddress ?? ''),
        liquidityUsd: Number((p.liquidity as { usd?: unknown } | undefined)?.usd ?? 0) || 0,
      }))
      .filter((p) => p.address)
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    this.cache.set(mint, { at: this.now(), pools });
    return pools;
  }
}
