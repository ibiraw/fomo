/**
 * @file evm-pool-feed.test.ts
 * @description EvmPoolPriceFeed (v2 / v3 / v4 pools) together with EvmUsdQuotes (quote → USD chaining).
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { UnsupportedPoolError } from '../../src/core/errors.js';
import { ERC20_ABI, Erc20Reader } from '../../src/core/evm/erc20.js';
import { EvmPoolPriceFeed, POOL_ABI, PANCAKE_V3_SWAP_TOPIC, poolKind, STATE_VIEW_ABI, SYNC_TOPIC, V4_SWAP_TOPIC } from '../../src/core/evm/evm-pool-price-feed.js';
import { EvmUsdQuotes } from '../../src/core/evm/evm-usd-quotes.js';
import { CompositePriceFeed } from '../../src/core/pricing/composite-price-feed.js';
import { PoolDirectory, type ListedPool } from '../../src/core/pricing/pool-directory.js';
import type { Hex } from '../../src/ports/evm-rpc.js';
import { HttpJsonPort } from '../../src/ports/http-json.js';
import { PriceFeedPort, type PriceListener, type PriceTick, type PriceWatch } from '../../src/ports/price-feed.js';
import { FakeEvmRpc, words } from '../helpers/fake-evm.js';

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH = '0x4200000000000000000000000000000000000006';
const TOKEN = '0x1111111111111111111111111111111111111111'; // v2 vs WETH
const TOKEN4 = '0x2222222222222222222222222222222222222222'; // v4 vs native ETH (listed as WETH)
const WETH_POOL = '0x5555555555555555555555555555555555555555'; // v3 WETH/USDC
const PAIR = '0x6666666666666666666666666666666666666666'; // v2 TOKEN/WETH
const BAD = '0x7777777777777777777777777777777777777777'; // "v2" that reverts
const POOL_ID = `0x${'ab'.repeat(32)}` as Hex;
const V4 = { poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b' as Hex, stateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71' as Hex };
const Q96 = 2 ** 96;

/** sqrtPriceX96 for a raw token1-per-token0 ratio. */
const sqrtX96 = (rawRatio: number): bigint => BigInt(Math.round(Math.sqrt(rawRatio) * Q96));

/** DexScreener pair JSON. */
const pair = (p: { dexId?: string; labels?: string[]; address: string; base: string; quote: string; priceNative: number; liquidity?: number }) => ({
  dexId: p.dexId ?? 'uniswap', labels: p.labels ?? [], pairAddress: p.address, liquidity: { usd: p.liquidity ?? 1000 },
  baseToken: { address: p.base }, quoteToken: { address: p.quote, symbol: 'Q' }, priceNative: String(p.priceNative), priceUsd: '0',
});

class FakeHttp extends HttpJsonPort {
  constructor(readonly docs: Record<string, unknown>) { super(); }
  async getJson(url: string): Promise<unknown> {
    if (!(url in this.docs)) throw new Error(`HTTP 404 ${url}`);
    return this.docs[url];
  }
}
const pairsUrl = (a: string) => `https://api.dexscreener.com/token-pairs/v1/base/${a}`;

/** A Base-like chain: WETH/USDC v3 at $2000, TOKEN/WETH v2 at 1e-6 WETH, TOKEN4/ETH v4 at 1e-6 ETH. */
function setup(extra: Record<string, unknown> = {}) {
  const rpc = new FakeEvmRpc('base');
  for (const [t, d] of [[USDC, 6], [WETH, 18], [TOKEN, 18], [TOKEN4, 18]] as const) rpc.on(t, ERC20_ABI, 'decimals', d).on(t, ERC20_ABI, 'totalSupply', 10n ** 27n);
  rpc.on(WETH_POOL, POOL_ABI, 'token0', WETH).raw(WETH_POOL, '0x3850c7bd', words(sqrtX96(2000e-12), 0, 0));
  rpc.on(PAIR, POOL_ABI, 'token0', TOKEN).on(PAIR, POOL_ABI, 'getReserves', [10n ** 24n, 10n ** 18n, 0]);
  rpc.on(BAD, POOL_ABI, 'getReserves', new Error('execution reverted')).on(BAD, POOL_ABI, 'token0', TOKEN);
  rpc.on(V4.stateView, STATE_VIEW_ABI, 'getSlot0', [sqrtX96(1e6), 0, 0, 0]); // currency0 = native, currency1 = TOKEN4
  const http = new FakeHttp({
    [pairsUrl(WETH)]: [pair({ labels: ['v3'], address: WETH_POOL, base: WETH, quote: USDC, priceNative: 2000 })],
    [pairsUrl(TOKEN)]: [
      pair({ address: BAD, base: TOKEN, quote: WETH, priceNative: 1e-6, liquidity: 9e9 }),
      pair({ labels: ['v2'], address: PAIR, base: TOKEN, quote: WETH, priceNative: 1e-6 }),
    ],
    [pairsUrl(TOKEN4)]: [pair({ labels: ['v4'], address: POOL_ID, base: TOKEN4, quote: WETH, priceNative: 1e-6 })],
    ...extra,
  });
  const quotes = new EvmUsdQuotes('base', new Set([USDC]), WETH);
  const errors: unknown[] = [];
  const feed = new EvmPoolPriceFeed('base', rpc, new Erc20Reader(rpc), new PoolDirectory(http), quotes, V4, (e) => errors.push(e));
  quotes.setFeed(feed);
  return { rpc, feed, quotes, errors };
}

describe('poolKind', () => {
  const base: ListedPool = { dexId: 'x', labels: [], address: PAIR, liquidityUsd: 0, baseAddress: TOKEN, quoteAddress: WETH, quoteSymbol: 'Q', priceNative: 1, priceUsd: 1 };
  it('classifies listings by label and address width', () => {
    expect(poolKind({ ...base, labels: ['v4'], address: POOL_ID })).toBe('v4');
    expect(poolKind({ ...base, labels: ['v4'] })).toBeNull();
    expect(poolKind({ ...base, labels: ['v3'] })).toBe('v3');
    expect(poolKind({ ...base, labels: ['v2'] })).toBe('v2');
    expect(poolKind(base)).toBe('v2');
    expect(poolKind({ ...base, labels: ['CL'] })).toBeNull();
    expect(poolKind({ ...base, address: POOL_ID })).toBeNull();
  });
});

describe('EvmPoolPriceFeed', () => {
  it('moves to a much more liquid pool once it is listed (graduation: only dust pools listed at first)', async () => {
    const DUST = '0x8888888888888888888888888888888888888888';
    const { rpc, quotes } = setup();
    rpc.on(DUST, POOL_ABI, 'token0', TOKEN).on(DUST, POOL_ABI, 'getReserves', [10n ** 24n, 2n * 10n ** 17n, 0]); // a fifth of the real price
    const http = new FakeHttp({
      [pairsUrl(WETH)]: [pair({ labels: ['v3'], address: WETH_POOL, base: WETH, quote: USDC, priceNative: 2000 })],
      [pairsUrl(TOKEN)]: [pair({ labels: ['v2'], address: DUST, base: TOKEN, quote: WETH, priceNative: 2e-7, liquidity: 1 })],
    });
    const feed = new EvmPoolPriceFeed('base', rpc, new Erc20Reader(rpc), new PoolDirectory(http), quotes, V4, () => undefined, 20);
    quotes.setFeed(feed);
    const ticks: PriceTick[] = [];
    const w = await feed.watch(`base:${TOKEN}`, (t) => ticks.push(t));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.0004, 7);
    http.docs[pairsUrl(TOKEN)] = [
      pair({ labels: ['v2'], address: PAIR, base: TOKEN, quote: WETH, priceNative: 1e-6, liquidity: 25_000 }),
      pair({ labels: ['v2'], address: DUST, base: TOKEN, quote: WETH, priceNative: 2e-7, liquidity: 1 }),
    ];
    await new Promise((r) => setTimeout(r, 80));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.002, 6); // the real pool
    const n = ticks.length;
    rpc.emit({ address: DUST, topics: [SYNC_TOPIC], data: words(10n ** 24n, 10n ** 17n) }); // the dust pool no longer counts
    expect(ticks).toHaveLength(n);
    rpc.emit({ address: PAIR, topics: [SYNC_TOPIC], data: words(10n ** 24n, 2n * 10n ** 18n) });
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.004, 6);
    w.stop();
    expect(rpc.subs.filter((x) => !x.stopped && (x.filter.address === PAIR || x.filter.address === DUST))).toHaveLength(0);
    await feed.close();
  });

  it('opens a new stream from a fresh listing, not one cached minutes ago with only dust pools (IRIS, 2026-09-30)', async () => {
    const DUST = '0x8888888888888888888888888888888888888888';
    const { rpc, quotes } = setup();
    rpc.on(DUST, POOL_ABI, 'token0', TOKEN).on(DUST, POOL_ABI, 'getReserves', [10n ** 24n, 2n * 10n ** 17n, 0]);
    const http = new FakeHttp({
      [pairsUrl(WETH)]: [pair({ labels: ['v3'], address: WETH_POOL, base: WETH, quote: USDC, priceNative: 2000 })],
      [pairsUrl(TOKEN)]: [pair({ labels: ['v2'], address: DUST, base: TOKEN, quote: WETH, priceNative: 2e-7, liquidity: 1 })],
    });
    let t = 0;
    const feed = new EvmPoolPriceFeed('base', rpc, new Erc20Reader(rpc), new PoolDirectory(http, () => t), quotes, V4, () => undefined, 3_600_000);
    quotes.setFeed(feed);
    const first = await feed.watch(`base:${TOKEN}`, () => undefined);
    first.stop(); // nobody watching: the stream closes, the listing stays cached
    http.docs[pairsUrl(TOKEN)] = [
      pair({ labels: ['v2'], address: PAIR, base: TOKEN, quote: WETH, priceNative: 1e-6, liquidity: 25_000 }),
      pair({ labels: ['v2'], address: DUST, base: TOKEN, quote: WETH, priceNative: 2e-7, liquidity: 1 }),
    ];
    t += 60_000; // a minute later, well inside the directory's 10-min cache
    const ticks: PriceTick[] = [];
    const w = await feed.watch(`base:${TOKEN}`, (tk) => ticks.push(tk));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.002, 6); // the real pool straight away
    w.stop();
    await feed.close();
  });

  it('never moves to a pool quoted in a non-anchor token, however liquid (two streams could price each other)', async () => {
    const DUST = '0x8888888888888888888888888888888888888888';
    const OTHER_TOKEN = '0x9999999999999999999999999999999999999999';
    const BIG = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const { rpc, quotes } = setup();
    rpc.on(DUST, POOL_ABI, 'token0', TOKEN).on(DUST, POOL_ABI, 'getReserves', [10n ** 24n, 2n * 10n ** 17n, 0]);
    const http = new FakeHttp({
      [pairsUrl(WETH)]: [pair({ labels: ['v3'], address: WETH_POOL, base: WETH, quote: USDC, priceNative: 2000 })],
      [pairsUrl(TOKEN)]: [pair({ labels: ['v2'], address: DUST, base: TOKEN, quote: WETH, priceNative: 2e-7, liquidity: 1 })],
    });
    const feed = new EvmPoolPriceFeed('base', rpc, new Erc20Reader(rpc), new PoolDirectory(http), quotes, V4, () => undefined, 20);
    quotes.setFeed(feed);
    const ticks: PriceTick[] = [];
    const w = await feed.watch(`base:${TOKEN}`, (t) => ticks.push(t));
    http.docs[pairsUrl(TOKEN)] = [
      pair({ labels: ['v2'], address: BIG, base: TOKEN, quote: OTHER_TOKEN, priceNative: 1, liquidity: 1e6 }),
      pair({ labels: ['v2'], address: DUST, base: TOKEN, quote: WETH, priceNative: 2e-7, liquidity: 1 }),
    ];
    await new Promise((r) => setTimeout(r, 80));
    expect(rpc.subs.some((x) => x.filter.address === BIG)).toBe(false);
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.0004, 7); // still the anchored pool
    w.stop();
    await feed.close();
  });

  it('prices a v2 pair through its quote token, skipping pools that revert', async () => {
    const { rpc, feed } = setup();
    const ticks: PriceTick[] = [];
    await feed.watch(`base:${TOKEN}`, (t) => ticks.push(t));
    expect(ticks[0]!.source).toBe('v2-pool');
    expect(ticks[0]!.priceUsd).toBeCloseTo(0.002, 6);
    expect(ticks[0]!.marketCapUsd).toBeCloseTo(2_000_000, -1);

    rpc.emit({ address: PAIR, topics: [SYNC_TOPIC], data: words(10n ** 24n, 2n * 10n ** 18n) }); // price doubles
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.004, 6);

    rpc.emit({ address: WETH_POOL, topics: [PANCAKE_V3_SWAP_TOPIC], data: words(0, 0, sqrtX96(3000e-12)) }); // WETH → $3000
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.006, 6);
  });

  it('shares one stream per token, replays the last tick and tears down after the last stop', async () => {
    const { rpc, feed } = setup();
    const a: PriceTick[] = [];
    const b: PriceTick[] = [];
    const wa = await feed.watch(`base:${TOKEN}`, (t) => a.push(t));
    const wb = await feed.watch(`base:${TOKEN}`, (t) => b.push(t));
    expect(b).toHaveLength(1);
    const live = rpc.live();
    wa.stop();
    expect(rpc.live()).toBe(live);
    wb.stop();
    expect(rpc.live()).toBe(live - 1);
    await feed.close();
    expect(rpc.live()).toBe(0);
  });

  it('reads v4 pools from StateView and picks native-currency orientation from the listed price', async () => {
    const { rpc, feed } = setup();
    const ticks: PriceTick[] = [];
    await feed.watch(`base:${TOKEN4}`, (t) => ticks.push(t));
    expect(ticks[0]!.source).toBe('v4-pool');
    expect(ticks[0]!.priceUsd).toBeCloseTo(0.002, 6);
    const sub = rpc.subs.find((s) => s.filter.address === V4.poolManager)!;
    expect(sub.filter.topics).toEqual([V4_SWAP_TOPIC, POOL_ID]);
    rpc.emit({ address: V4.poolManager, topics: [V4_SWAP_TOPIC, POOL_ID], data: words(0, 0, sqrtX96(5e5)) }); // half as many tokens per ETH
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.004, 6);
  });

  it('rejects tokens with no supported pool, listing the reasons', async () => {
    const other = '0x3333333333333333333333333333333333333333';
    const { feed } = setup({ [pairsUrl(other)]: [pair({ labels: ['CL'], address: PAIR, base: other, quote: WETH, priceNative: 1 })] });
    await expect(feed.watch(`base:${other}`, () => undefined)).rejects.toThrow(/uniswap CL not supported/);
    const noV4 = setup().rpc;
    const quotes = new EvmUsdQuotes('base', new Set([USDC]), WETH);
    const feedNoV4 = new EvmPoolPriceFeed('base', noV4, new Erc20Reader(noV4), new PoolDirectory(new FakeHttp({ [pairsUrl(TOKEN4)]: [pair({ labels: ['v4'], address: POOL_ID, base: TOKEN4, quote: WETH, priceNative: 1 })] })), quotes, null, () => undefined);
    await expect(feedNoV4.watch(`base:${TOKEN4}`, () => undefined)).rejects.toThrow(UnsupportedPoolError);
  });

  it('rethrows RPC failures that are not reverts', async () => {
    const { rpc, feed } = setup();
    rpc.on(PAIR, POOL_ABI, 'token0', new Error('socket hang up'));
    rpc.on(BAD, POOL_ABI, 'token0', new Error('socket hang up'));
    await expect(feed.watch(`base:${TOKEN}`, () => undefined)).rejects.toThrow('socket hang up');
  });

  it('skips a pool whose quote token cannot be priced and uses the next one', async () => {
    const orphan = '0x4444444444444444444444444444444444444444';
    const { feed, rpc } = setup({
      [pairsUrl(TOKEN)]: [
        pair({ labels: ['v2'], address: BAD, base: TOKEN, quote: orphan, priceNative: 1, liquidity: 9e9 }),
        pair({ labels: ['v2'], address: PAIR, base: TOKEN, quote: WETH, priceNative: 1e-6 }),
      ],
      [pairsUrl(orphan)]: [],
    });
    rpc.on(orphan, ERC20_ABI, 'decimals', 18);
    const ticks: PriceTick[] = [];
    await feed.watch(`base:${TOKEN}`, (t) => ticks.push(t));
    expect(ticks[0]!.priceUsd).toBeCloseTo(0.002, 6);
  });

  it('handles a token listed as the quote side of its pool', async () => {
    const { feed } = setup({ [pairsUrl(TOKEN)]: [pair({ labels: ['v2'], address: PAIR, base: WETH, quote: TOKEN, priceNative: 1e6 })] });
    const ticks: PriceTick[] = [];
    await feed.watch(`base:${TOKEN}`, (t) => ticks.push(t));
    expect(ticks[0]!.priceUsd).toBeCloseTo(0.002, 6);
  });
});

/** Feed that prices listed keys at fixed USD values, can loop back into quotes, or never answers. */
class ScriptedFeed extends PriceFeedPort {
  watched: string[] = [];
  constructor(private readonly script: (key: string, l: PriceListener) => Promise<void>) { super(); }
  async start(): Promise<void> {}
  async close(): Promise<void> {}
  async watch(key: string, l: PriceListener): Promise<PriceWatch> {
    this.watched.push(key);
    await this.script(key, l);
    return { mint: key, stop: () => undefined };
  }
}
const tick = (mint: string, priceUsd: number): PriceTick => ({ mint, priceUsd, marketCapUsd: 0, source: 'v2-pool', receivedAt: 0 });

describe('EvmUsdQuotes', () => {
  it('prices stables at $1, native as wrapped native, and notifies on changes', async () => {
    let push: PriceListener = () => undefined;
    const q = new EvmUsdQuotes('base', new Set([USDC]), WETH);
    const feed = new ScriptedFeed(async (key, l) => { push = l; l(tick(key, 2000)); });
    q.setFeed(feed);
    expect(q.usd(USDC.toUpperCase())).toBe(1);
    expect(q.isAnchor(WETH) && q.isAnchor(USDC) && !q.isAnchor(TOKEN)).toBe(true);
    await Promise.all([q.ensure('0x0000000000000000000000000000000000000000'), q.ensure(WETH)]);
    expect(feed.watched).toEqual([`base:${WETH}`]);
    expect(q.usd('0x0000000000000000000000000000000000000000')).toBe(2000);
    const changed: string[] = [];
    const off = q.onChange((a) => changed.push(a));
    push(tick('x', 2100));
    push(tick('x', 2100)); // unchanged: no event
    off();
    push(tick('x', 2200));
    expect(changed).toEqual([WETH]);
    await q.ensure(WETH); // already watched
    q.close();
  });

  it('rejects loops, missing feeds and lookups that hang', async () => {
    const q = new EvmUsdQuotes('base', new Set([USDC]), WETH, 20);
    await expect(q.ensure(TOKEN)).rejects.toThrow(/No base feed/);
    // Pricing TOKEN needs WETH, whose pool needs TOKEN again → loop rejected, not a deadlock.
    q.setFeed(new ScriptedFeed(async (key) => {
      expect(q.resolvingQuote()).toBe(true);
      if (key === `base:${WETH}`) await q.ensure(TOKEN, WETH);
    }));
    await expect(q.ensure(WETH, TOKEN)).rejects.toThrow(/loops back/);
    expect(q.onPath(TOKEN)).toBe(false);
    q.setFeed(new ScriptedFeed(() => new Promise(() => undefined)));
    await expect(q.ensure(TOKEN4)).rejects.toThrow(/Timed out/);
  });

  it('bounds the lookup depth', async () => {
    const chainOf = ['0xa', '0xb', '0xc', '0xd', '0xe'].map((s) => s.padEnd(42, '0'));
    const q = new EvmUsdQuotes('base', new Set([USDC]), WETH);
    q.setFeed(new ScriptedFeed(async (key) => {
      const i = chainOf.indexOf(key.split(':')[1]!);
      await q.ensure(chainOf[i + 1]!, chainOf[i]);
    }));
    await expect(q.ensure(chainOf[1]!, chainOf[0])).rejects.toThrow(/within 4 hops/);
  });

  it('works inside a composite feed: pool feed first, anchors preferred for quotes', async () => {
    const { feed, quotes } = setup({
      [pairsUrl(WETH)]: [
        pair({ labels: ['v2'], address: PAIR, base: TOKEN, quote: WETH, priceNative: 1e-6, liquidity: 9e9 }),
        pair({ labels: ['v3'], address: WETH_POOL, base: WETH, quote: USDC, priceNative: 2000 }),
      ],
    });
    const composite = new CompositePriceFeed([feed]);
    quotes.setFeed(composite);
    const ticks: PriceTick[] = [];
    await composite.watch(`base:${TOKEN}`, (t) => ticks.push(t));
    expect(quotes.usd(WETH)).toBeCloseTo(2000, 6);
    expect(ticks[0]!.priceUsd).toBeCloseTo(0.002, 6);
  });
});
