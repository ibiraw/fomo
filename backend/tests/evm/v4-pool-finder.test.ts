/**
 * @file v4-pool-finder.test.ts
 * @description On-chain Uniswap v4 pool discovery for tokens DexScreener doesn't list: finds Initialize logs with the
 *              token as currency0 or currency1, stops at the token's first mint, skips empty pools, orders by liquidity,
 *              caches; and the pool feed falls back to it when DexScreener lists nothing usable.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { ERC20_ABI, Erc20Reader } from '../../src/core/evm/erc20.js';
import { EvmPoolPriceFeed, POOL_ABI, STATE_VIEW_ABI } from '../../src/core/evm/evm-pool-price-feed.js';
import { EvmUsdQuotes } from '../../src/core/evm/evm-usd-quotes.js';
import { V4_INITIALIZE_TOPIC, V4PoolFinder } from '../../src/core/evm/v4-pool-finder.js';
import { PoolDirectory } from '../../src/core/pricing/pool-directory.js';
import type { EvmLog, Hex } from '../../src/ports/evm-rpc.js';
import { HttpJsonPort } from '../../src/ports/http-json.js';
import type { PriceTick } from '../../src/ports/price-feed.js';
import { FakeEvmRpc, words } from '../helpers/fake-evm.js';

const PM = '0x498581ff718922c3f8e6a244956af099b2652b2b' as Hex;
const SV = '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71' as Hex;
const TOKEN = '0x2222222222222222222222222222222222222222';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH = '0x4200000000000000000000000000000000000006';
const NATIVE = '0x0000000000000000000000000000000000000000';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as Hex;
const topic = (a: string): Hex => `0x${'0'.repeat(24)}${a.slice(2)}` as Hex;
const id = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}` as Hex;
const Q96 = 2 ** 96;
const sqrtX96 = (raw: number): bigint => BigInt(Math.round(Math.sqrt(raw) * Q96));

const init = (pool: Hex, c0: string, c1: string, block: bigint): EvmLog =>
  ({ address: PM, topics: [V4_INITIALIZE_TOPIC, pool, topic(c0), topic(c1)], data: '0x', blockNumber: block, logIndex: 0, transactionHash: '0x01' }) as EvmLog;
const mint = (block: bigint): EvmLog =>
  ({ address: TOKEN, topics: [TRANSFER, topic(NATIVE), topic(WETH)], data: words(1), blockNumber: block, logIndex: 0, transactionHash: '0x02' }) as EvmLog;

/** A chain where TOKEN (minted at block 350) has a native pool, a USDC pool and an empty pool. */
function chain() {
  const rpc = new FakeEvmRpc('base');
  rpc.head = 1_000n;
  rpc.history = [
    mint(350n),
    init(id(1), NATIVE, TOKEN, 360n),   // token as currency1 (native sorts first)
    init(id(2), TOKEN, USDC.replace('0x8', '0xf'), 400n), // token as currency0
    init(id(3), NATIVE, TOKEN, 900n),   // empty
    init(id(9), NATIVE, '0x3333333333333333333333333333333333333333', 500n), // another token
  ];
  rpc.raw(SV, '0xfa6793d5', (data) => words(data.endsWith('1') ? 5_000n : data.endsWith('2') ? 90_000n : 0n)); // getLiquidity
  return rpc;
}

describe('V4PoolFinder', () => {
  it('finds the token\'s pools as currency0 or currency1, most liquid first, skipping empty ones and other tokens', async () => {
    const rpc = chain();
    let t = 0;
    const f = new V4PoolFinder(rpc, PM, SV, { chunkBlocks: 100n, maxChunks: 20, concurrency: 2, cacheMs: 60_000 }, () => t);
    const pools = await f.find(TOKEN);
    expect(pools.map((p) => p.address)).toEqual([id(2), id(1)]);
    expect(pools[1]).toMatchObject({ labels: ['v4'], baseAddress: TOKEN, quoteAddress: NATIVE });
    // it stopped with the batch holding the mint (block 350): blocks 201..1000 scanned, nothing older
    expect(Math.min(...rpc.getLogsCalls.map(([from]) => Number(from)))).toBe(201);
    const calls = rpc.getLogsCalls.length;
    await f.find(TOKEN);
    expect(rpc.getLogsCalls.length).toBe(calls); // cached
    t += 61_000; await f.find(TOKEN);
    expect(rpc.getLogsCalls.length).toBeGreaterThan(calls);
  });

  it('gives up at the end of its window with nothing when the token has no v4 pool', async () => {
    const rpc = chain();
    const f = new V4PoolFinder(rpc, PM, SV, { chunkBlocks: 100n, maxChunks: 3, concurrency: 3, cacheMs: 60_000 });
    expect(await f.find('0x4444444444444444444444444444444444444444')).toEqual([]);
    expect(rpc.getLogsCalls.length).toBe(9); // 3 chunks × (as currency0, as currency1, mint)
  });

  it('lets the pool feed price a token DexScreener doesn\'t list, from its on-chain pool', async () => {
    const rpc = chain();
    for (const [a, d] of [[TOKEN, 18], [WETH, 18], [USDC, 6]] as const) rpc.on(a, ERC20_ABI, 'decimals', d).on(a, ERC20_ABI, 'totalSupply', 10n ** 27n);
    rpc.raw(SV, '0xfa6793d5', (data) => words(data.endsWith('1') ? 5_000n : 0n));       // only the native pool has liquidity
    rpc.on(SV, STATE_VIEW_ABI, 'getSlot0', [sqrtX96(1e6), 0, 0, 0]);                      // 1e6 tokens per ETH
    rpc.on('0x5555555555555555555555555555555555555555', POOL_ABI, 'token0', WETH).raw('0x5555555555555555555555555555555555555555', '0x3850c7bd', words(sqrtX96(2000e-12), 0, 0));
    class Http extends HttpJsonPort {
      async getJson(url: string): Promise<unknown> {
        if (url.includes(WETH)) return [{ dexId: 'uniswap', labels: ['v3'], pairAddress: '0x5555555555555555555555555555555555555555', liquidity: { usd: 1e6 }, baseToken: { address: WETH }, quoteToken: { address: USDC, symbol: 'USDC' }, priceNative: '2000', priceUsd: '2000' }];
        return []; // TOKEN is not listed
      }
    }
    const quotes = new EvmUsdQuotes('base', new Set([USDC]), WETH);
    const finder = new V4PoolFinder(rpc, PM, SV, { chunkBlocks: 100n, maxChunks: 20, concurrency: 2, cacheMs: 60_000 });
    const feed = new EvmPoolPriceFeed('base', rpc, new Erc20Reader(rpc), new PoolDirectory(new Http()), quotes, { poolManager: PM, stateView: SV }, () => undefined, 120_000, finder);
    quotes.setFeed(feed);
    const ticks: PriceTick[] = [];
    await feed.watch(`base:${TOKEN}`, (tk) => ticks.push(tk));
    expect(ticks.at(-1)).toMatchObject({ source: 'v4-pool' });
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(2000 / 1e6, 8);                            // 1e-6 ETH × $2000
    await feed.close();
  });
});

