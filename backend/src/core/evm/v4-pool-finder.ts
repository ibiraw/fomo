/**
 * @file v4-pool-finder.ts
 * @description Finds a token's Uniswap v4 pools straight from the chain, for tokens DexScreener doesn't list (brand-new
 *              coins in their first minutes, or tiny pools it never indexes: FLOORSWEEPER on Robinhood, 2026-09-30, a $5
 *              v4 pool). Reads the PoolManager's Initialize logs where the token is currency0 or currency1, scanning back
 *              from the head in provider-sized chunks and stopping at the token's creation (its first mint) or when the
 *              budget runs out. Pools come back as directory listings (label "v4", id as address), most liquid first
 *              (StateView.getLiquidity), so the pool feed can stream them like listed ones. Answers are cached.
 * @author Reborn1987
 */

import { parseAbi, toEventSelector } from 'viem';

import type { ListedPool } from '../pricing/pool-directory.js';
import type { EvmLog, EvmRpcPort, Hex } from '../../ports/evm-rpc.js';
import { readContract } from './contract.js';

export const V4_INITIALIZE_TOPIC = toEventSelector('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)');
const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');
const ZERO_TOPIC = `0x${'0'.repeat(64)}` as Hex;
const LIQUIDITY_ABI = parseAbi(['function getLiquidity(bytes32 poolId) view returns (uint128)']);

export interface V4FinderOptions {
  /** Blocks per eth_getLogs request (the provider's limit). */
  readonly chunkBlocks: bigint;
  /** Most chunks scanned back (the "fresh token" window, as for holder stats). */
  readonly maxChunks: number;
  /** Chunks in flight at once. */
  readonly concurrency: number;
  /** How long an answer (pools found, or none) is reused. */
  readonly cacheMs: number;
}

/** A token as an indexed topic. */
const topicOf = (address: string): Hex => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}` as Hex;
/** Address in an indexed topic. */
const addressOf = (topic: Hex): string => `0x${topic.slice(26)}`.toLowerCase();

export class V4PoolFinder {
  private readonly cache = new Map<string, { at: number; pools: ListedPool[] }>();

  /**
   * @param rpc chain access @param poolManager Uniswap v4 PoolManager @param stateView StateView (liquidity reads)
   * @param opts scan budget and cache @param now clock
   */
  constructor(
    private readonly rpc: EvmRpcPort,
    private readonly poolManager: Hex,
    private readonly stateView: Hex,
    private readonly opts: V4FinderOptions,
    private readonly now: () => number = Date.now,
  ) {}

  /** The token's v4 pools, most liquid first; empty when none was created within the scan window. */
  async find(token: string): Promise<ListedPool[]> {
    const key = token.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.opts.cacheMs) return hit.pools;
    const pools = await this.scan(key);
    this.cache.set(key, { at: this.now(), pools });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return pools;
  }

  /** Scans back for Initialize logs naming the token, stopping at its first mint. */
  private async scan(token: string): Promise<ListedPool[]> {
    const { chunkBlocks, maxChunks, concurrency } = this.opts;
    const head = await this.rpc.blockNumber();
    const t = topicOf(token);
    const inits: EvmLog[] = [];
    let created = false;
    for (let start = 0; start < maxChunks && !created; start += concurrency) {
      const ranges: [bigint, bigint][] = [];
      for (let i = start; i < Math.min(start + concurrency, maxChunks); i++) {
        const to = head - BigInt(i) * chunkBlocks;
        if (to < 0n) break;
        ranges.push([to - chunkBlocks + 1n < 0n ? 0n : to - chunkBlocks + 1n, to]);
      }
      if (ranges.length === 0) break;
      const batches = await Promise.all(ranges.map(async ([from, to]) => {
        const [as0, as1, mints] = await Promise.all([
          this.rpc.getLogs({ address: this.poolManager, topics: [V4_INITIALIZE_TOPIC, null, t] }, from, to),
          this.rpc.getLogs({ address: this.poolManager, topics: [V4_INITIALIZE_TOPIC, null, null, t] }, from, to),
          this.rpc.getLogs({ address: token as Hex, topics: [TRANSFER_TOPIC, ZERO_TOPIC] }, from, to),
        ]);
        return { pools: [...as0, ...as1], minted: mints.length > 0 };
      }));
      for (const b of batches) { inits.push(...b.pools); if (b.minted) created = true; }
      if (ranges[ranges.length - 1]![0] === 0n) break;
    }
    const pools = await Promise.all(inits.map(async (l): Promise<ListedPool | null> => {
      const c0 = addressOf(l.topics[2]!), c1 = addressOf(l.topics[3]!);
      const other = c0 === token ? c1 : c0;
      const liquidity = await readContract<bigint>(this.rpc, this.stateView, LIQUIDITY_ABI, 'getLiquidity', [l.topics[1]!]).catch(() => 0n);
      if (liquidity === 0n) return null; // an empty pool can't be priced
      return {
        dexId: 'uniswap', labels: ['v4'], address: l.topics[1]!, liquidityUsd: 0,
        baseAddress: token, quoteAddress: other, quoteSymbol: '', priceNative: Number.NaN, priceUsd: 0,
        rawLiquidity: liquidity,
      } as ListedPool & { rawLiquidity: bigint };
    }));
    return (pools.filter((p) => p !== null) as (ListedPool & { rawLiquidity: bigint })[])
      .sort((a, b) => (b.rawLiquidity > a.rawLiquidity ? 1 : b.rawLiquidity < a.rawLiquidity ? -1 : 0));
  }
}
