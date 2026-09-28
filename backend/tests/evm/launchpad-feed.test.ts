/**
 * @file launchpad-feed.test.ts
 * @description four.meme / flap.sh / pons curve feeds (including graduation hand-off) and the DexScreener fallback feed.
 * @author Reborn1987
 */

import { toEventSelector } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FomoError, UnsupportedPoolError } from '../../src/core/errors.js';
import { DexScreenerPriceFeed, parseDexScreenerPrices } from '../../src/core/evm/dexscreener-price-feed.js';
import { ERC20_ABI, Erc20Reader } from '../../src/core/evm/erc20.js';
import { EvmUsdQuotes } from '../../src/core/evm/evm-usd-quotes.js';
import { flap, fourMeme, LaunchpadPriceFeed, pons } from '../../src/core/evm/launchpad-price-feed.js';
import type { Hex } from '../../src/ports/evm-rpc.js';
import { HttpJsonPort } from '../../src/ports/http-json.js';
import { PriceFeedPort, type PriceListener, type PriceTick, type PriceWatch } from '../../src/ports/price-feed.js';
import { FakeEvmRpc, words } from '../helpers/fake-evm.js';

const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const TOKEN = '0xa4d36e7b88ed13adf3e7eac874e2d93920c8ffff';
const OTHER = '0x0833946c29eeed019bc1cca2a030523168ae7777';
const MANAGER = '0x5c952063c7fc8610ffdb798152d69f0b9550762b' as Hex;
const HELPER = '0xf251f83e40a78868fcfa3fa4599dad6494e46034' as Hex;
const PORTAL = '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0' as Hex;
const WAD = 10n ** 18n;
const ZERO = '0x0000000000000000000000000000000000000000';

const FOUR_PURCHASE = toEventSelector('TokenPurchase(address,address,uint256,uint256,uint256,uint256,uint256,uint256)');
const FOUR_LIQUIDITY_ADDED = toEventSelector('LiquidityAdded(address,uint256,address,uint256)');
const FLAP_SOLD = toEventSelector('TokenSold(uint256,address,address,uint256,uint256,uint256,uint256)');
const FLAP_LAUNCHED = toEventSelector('LaunchedToDEX(address,address,uint256,uint256)');

/** four.meme getTokenInfo words: version, manager, quote, lastPrice, …, liquidityAdded. */
const fourInfo = (price: bigint, quote = ZERO, graduated = false, manager: string = MANAGER) => words(2, manager, quote, price, 100, 0, 0, 0, 0, 0, 0, graduated);
/** flap getTokenV7 words: status, reserve, circulating, price, … quote @9, … (17 words). */
const flapInfo = (status: number, price: bigint, quote = ZERO) => words(status, 0, 0, price, 0, 0, 0, 0, 0, quote, 0, 0, 0, ZERO, 0, 0, 0);

/** Feed standing in for "pools": fixed quote prices, and optionally the graduated token. */
class PoolsStub extends PriceFeedPort {
  failures = 0;
  readonly listeners = new Map<string, PriceListener>();
  constructor(private readonly usd: Record<string, number>) { super(); }
  async start(): Promise<void> {}
  async close(): Promise<void> {}
  async watch(key: string, l: PriceListener): Promise<PriceWatch> {
    const a = key.split(':')[1]!;
    if (this.failures > 0) { this.failures--; throw new UnsupportedPoolError('pool not listed yet'); }
    if (!(a in this.usd)) throw new UnsupportedPoolError(`no pool for ${a}`);
    this.listeners.set(key, l);
    l({ mint: key, priceUsd: this.usd[a]!, marketCapUsd: 0, source: 'v2-pool', receivedAt: 0 });
    return { mint: key, stop: () => this.listeners.delete(key) };
  }
}

function setup(protocol: 'four' | 'flap') {
  const rpc = new FakeEvmRpc('bnb');
  for (const t of [TOKEN, OTHER]) rpc.on(t, ERC20_ABI, 'decimals', 18).on(t, ERC20_ABI, 'totalSupply', 10n ** 27n);
  const quotes = new EvmUsdQuotes('bnb', new Set([USDT]), WBNB);
  const pools = new PoolsStub({ [WBNB]: 800 });
  quotes.setFeed(pools);
  const errors: unknown[] = [];
  const p = protocol === 'four' ? fourMeme(MANAGER, HELPER) : flap(PORTAL);
  const feed = new LaunchpadPriceFeed(rpc, new Erc20Reader(rpc), quotes, p, pools, (e) => errors.push(e), 5);
  return { rpc, feed, pools, errors };
}

describe('four.meme curve feed', () => {
  it('prices a curve token from getTokenInfo, then from trade events for that token only', async () => {
    const { rpc, feed } = setup('four');
    rpc.raw(HELPER, '0x1f69565f', (data) => (data.includes(TOKEN.slice(2)) ? fourInfo(5n * WAD / 1_000_000_000n) : fourInfo(0n, ZERO, false, ZERO)));
    const ticks: PriceTick[] = [];
    const w = await feed.watch(`bnb:${TOKEN}`, (t) => ticks.push(t));
    expect(ticks[0]).toMatchObject({ source: 'four-meme' });
    expect(ticks[0]!.priceUsd).toBeCloseTo(4e-6, 12); // 5e-9 BNB × $800
    expect(ticks[0]!.marketCapUsd).toBeCloseTo(4000, 3);

    rpc.emit({ address: MANAGER, topics: [FOUR_PURCHASE], data: words(OTHER, ZERO, 10n * WAD) }); // another token
    rpc.emit({ address: MANAGER, topics: ['0xdead'], data: '0x' });
    expect(ticks).toHaveLength(1);
    rpc.emit({ address: MANAGER, topics: [FOUR_PURCHASE], data: words(TOKEN, ZERO, 10n * WAD / 1_000_000_000n) });
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(8e-6, 12);

    await expect(feed.watch(`bnb:${OTHER}`, () => undefined)).rejects.toThrow(/not a four-meme token/);
    w.stop();
    expect(rpc.live()).toBe(0);
  });

  it('refuses graduated tokens and hands watchers to the pool feed when a token graduates', async () => {
    const { rpc, feed, pools, errors } = setup('four');
    rpc.raw(HELPER, '0x1f69565f', fourInfo(WAD / 1_000_000_000n, ZERO, true));
    await expect(feed.watch(`bnb:${TOKEN}`, () => undefined)).rejects.toThrow(/left the four-meme curve/);

    rpc.raw(HELPER, '0x1f69565f', fourInfo(WAD / 1_000_000_000n));
    const ticks: PriceTick[] = [];
    const w = await feed.watch(`bnb:${TOKEN}`, (t) => ticks.push(t));
    pools.failures = 1; // the new pool isn't listed on the first try
    Object.assign(pools, { usd: { [WBNB]: 800, [TOKEN]: 0.5 } });
    rpc.emit({ address: MANAGER, topics: [FOUR_LIQUIDITY_ADDED], data: words(TOKEN, 0, ZERO, 0) });
    await vi.waitFor(() => expect(ticks.at(-1)!.source).toBe('v2-pool'));
    expect(ticks.at(-1)!.priceUsd).toBe(0.5);
    expect(errors).toHaveLength(1);
    rpc.emit({ address: MANAGER, topics: [FOUR_PURCHASE], data: words(TOKEN, ZERO, WAD) }); // curve events no longer count
    expect(ticks.at(-1)!.priceUsd).toBe(0.5);
    w.stop();
    expect(pools.listeners.has(`bnb:${TOKEN}`)).toBe(false);
  });
});

describe('flap curve feed', () => {
  it('reads getTokenV7 (non-native quote), follows TokenSold, rejects unknown and DEX tokens', async () => {
    const { rpc, feed, errors } = setup('flap');
    rpc.raw(PORTAL, '0xf99abb9e', (data) => {
      if (data.includes(TOKEN.slice(2))) return flapInfo(1, 2n * WAD, USDT);
      if (data.includes(OTHER.slice(2))) return flapInfo(4, WAD);
      return flapInfo(0, 0n);
    });
    const ticks: PriceTick[] = [];
    await feed.watch(`bnb:${TOKEN}`, (t) => ticks.push(t));
    expect(ticks[0]).toMatchObject({ source: 'flap', priceUsd: 2 });
    rpc.emit({ address: PORTAL, topics: [FLAP_SOLD], data: words(0, TOKEN, ZERO, 0, 0, 0, 3n * WAD) });
    expect(ticks.at(-1)!.priceUsd).toBe(3);
    await expect(feed.watch(`bnb:${OTHER}`, () => undefined)).rejects.toThrow(/left the flap curve/);
    await expect(feed.watch(`bnb:${WBNB}`, () => undefined)).rejects.toThrow(/not a flap token/);

    rpc.raw(PORTAL, '0xf99abb9e', new Error('execution reverted: 0xde6137d1'));
    await expect(feed.watch(`bnb:${USDT}`, () => undefined)).rejects.toThrow(UnsupportedPoolError);
    rpc.raw(PORTAL, '0xf99abb9e', new Error('fetch failed'));
    await expect(feed.watch(`bnb:${USDT}`, () => undefined)).rejects.toThrow('fetch failed');

    rpc.emit({ address: PORTAL, topics: [FLAP_LAUNCHED], data: words(TOKEN, ZERO, 0, 0) });
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0)); // no pool yet: retried in the background
    await feed.close();
  });
});

class FakeHttp extends HttpJsonPort {
  calls: string[] = [];
  fail = false;
  constructor(public docs: Record<string, unknown>) { super(); }
  async getJson(url: string): Promise<unknown> {
    this.calls.push(url);
    if (this.fail) throw new Error('HTTP 429');
    return this.docs[url] ?? [];
  }
}

describe('pons curve feed (a curve contract per token)', () => {
  const PONS = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e' as Hex;
  const CURVE = '0x70236fd97bf2187ad558e70fbc7c6e5701b2b189';
  const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
  const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
  const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

  /** A pons token whose curve answers from mutable state. */
  function ponsSetup(state: { quote: string; quoteReserve: bigint; tokenReserve: bigint; graduated?: boolean; factory?: string }) {
    const rpc = new FakeEvmRpc('robinhood');
    rpc.on(TOKEN, ERC20_ABI, 'decimals', 18).on(TOKEN, ERC20_ABI, 'totalSupply', 10n ** 27n).on(USDG, ERC20_ABI, 'decimals', 6);
    rpc.raw(TOKEN, '0x7165485d', words(CURVE));
    rpc.raw(CURVE, '0xc45a0155', () => words(state.factory ?? PONS));
    rpc.raw(CURVE, '0x0902f1ac', () => words(state.quoteReserve, state.tokenReserve));
    rpc.raw(CURVE, '0x3de35b79', () => words(state.quote));
    rpc.raw(CURVE, '0xe7c2b772', () => words(state.graduated ?? false));
    const quotes = new EvmUsdQuotes('robinhood', new Set([USDG]), WETH);
    const pools = new PoolsStub({ [WETH]: 2_500, [TOKEN]: 0.0002 });
    quotes.setFeed(pools);
    const errors: unknown[] = [];
    const feed = new LaunchpadPriceFeed(rpc, new Erc20Reader(rpc), quotes, pons(PONS), pools, (e) => errors.push(e), 5);
    return { rpc, feed, errors };
  }

  it('prices from the curve reserves in USDG and re-reads them after each log from the curve', async () => {
    const state = { quote: USDG, quoteReserve: 6_720_567_724n, tokenReserve: 481_506_943_775n * 10n ** 15n };
    const { rpc, feed } = ponsSetup(state);
    const ticks: PriceTick[] = [];
    const w = await feed.watch(`robinhood:${TOKEN}`, (t) => ticks.push(t));
    expect(ticks[0]).toMatchObject({ source: 'pons' });
    expect(ticks[0]!.marketCapUsd).toBeCloseTo(13_957.5, 0); // 6,720.57 USDG ÷ 481.5M tokens × 1B supply
    state.quoteReserve = 3_360_283_862n; // someone sold: half the USDG
    rpc.emit({ address: OTHER, topics: ['0xdead'], data: '0x' }); // not the curve
    await settle();
    expect(ticks).toHaveLength(1);
    rpc.emit({ address: CURVE, topics: ['0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df'], data: '0x' });
    await settle();
    expect(ticks.at(-1)!.marketCapUsd).toBeCloseTo(6_978.7, 0);
    w.stop();
    expect(rpc.live()).toBe(0);
  });

  it('prices native-ETH curves through the ETH price, and hands a graduating token to the pools', async () => {
    const state = { quote: ZERO, quoteReserve: 1_680n * 10n ** 15n, tokenReserve: 10n ** 27n, graduated: false };
    const { rpc, feed } = ponsSetup(state);
    const ticks: PriceTick[] = [];
    await feed.watch(`robinhood:${TOKEN}`, (t) => ticks.push(t));
    expect(ticks[0]!.priceUsd).toBeCloseTo(4.2e-6, 12); // 1.68 ETH / 1B tokens × $2,500
    state.graduated = true;
    rpc.emit({ address: CURVE, topics: ['0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df'], data: '0x' });
    await settle();
    expect(ticks.at(-1)).toMatchObject({ source: 'v2-pool', priceUsd: 0.0002 });
    expect(rpc.subs.find((s) => s.filter.address === CURVE)?.stopped).toBe(true);
  });

  it('coalesces a burst of curve logs into one read in flight plus one more afterwards', async () => {
    const state = { quote: USDG, quoteReserve: 6_720_567_724n, tokenReserve: 481_506_943_775n * 10n ** 15n };
    const { rpc, feed } = ponsSetup(state);
    const ticks: PriceTick[] = [];
    await feed.watch(`robinhood:${TOKEN}`, (t) => ticks.push(t));
    let reads = 0;
    rpc.raw(CURVE, '0x0902f1ac', () => { reads++; return words(state.quoteReserve, state.tokenReserve); });
    state.quoteReserve = 3_360_283_862n;
    for (let i = 0; i < 10; i++) rpc.emit({ address: CURVE, topics: ['0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df'], data: '0x' });
    await settle();
    await settle();
    expect(reads).toBe(2); // not 10: the first read, then one catching up with the rest of the burst
    expect(ticks.at(-1)!.marketCapUsd).toBeCloseTo(6_978.7, 0);
  });

  it("rejects tokens without a pons curve, someone else's curve, and graduated curves", async () => {
    const graduated = ponsSetup({ quote: USDG, quoteReserve: 1n, tokenReserve: 0n });
    await expect(graduated.feed.watch(`robinhood:${TOKEN}`, () => undefined)).rejects.toThrow(/left the pons curve/);
    const foreign = ponsSetup({ quote: USDG, quoteReserve: 1n, tokenReserve: 1n, factory: OTHER });
    await expect(foreign.feed.watch(`robinhood:${TOKEN}`, () => undefined)).rejects.toThrow(/not a pons token/);
    const plain = ponsSetup({ quote: USDG, quoteReserve: 1n, tokenReserve: 1n });
    plain.rpc.raw(TOKEN, '0x7165485d', '0x');
    await expect(plain.feed.watch(`robinhood:${TOKEN}`, () => undefined)).rejects.toThrow(/not a pons token/);
  });
});

describe('DexScreenerPriceFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const listing = (base: string, price: number, liquidity: number) => ({ baseToken: { address: base.toUpperCase().replace('0X', '0x') }, priceUsd: String(price), liquidity: { usd: liquidity } });

  it('parses the most liquid price per base token', () => {
    const m = parseDexScreenerPrices([listing(TOKEN, 1, 10), listing(TOKEN, 2, 50), listing(OTHER, 0, 5), { baseToken: {} }]);
    expect([...m]).toEqual([[TOKEN, 2]]);
    expect(() => parseDexScreenerPrices({})).toThrow(FomoError);
  });

  it('polls watched tokens in one request and stops when unwatched', async () => {
    const rpc = new FakeEvmRpc('bnb');
    for (const t of [TOKEN, OTHER]) rpc.on(t, ERC20_ABI, 'decimals', 18).on(t, ERC20_ABI, 'totalSupply', 10n ** 27n);
    const url1 = `https://api.dexscreener.com/tokens/v1/bsc/${TOKEN}`;
    const http = new FakeHttp({ [url1]: [listing(TOKEN, 0.001, 1)], [`https://api.dexscreener.com/tokens/v1/bsc/${OTHER}`]: [listing(OTHER, 0.5, 1)] });
    const errors: unknown[] = [];
    const feed = new DexScreenerPriceFeed('bnb', http, new Erc20Reader(rpc), 1000, (e) => errors.push(e));
    await feed.start();
    const a: PriceTick[] = [];
    const wa = await feed.watch(`bnb:${TOKEN}`, (t) => a.push(t));
    const wa2 = await feed.watch(`bnb:${TOKEN}`, () => undefined);
    expect(a[0]).toMatchObject({ source: 'dexscreener', priceUsd: 0.001, marketCapUsd: 1_000_000 });
    await feed.watch(`bnb:${OTHER}`, () => undefined);
    http.docs[`https://api.dexscreener.com/tokens/v1/bsc/${TOKEN},${OTHER}`] = [listing(TOKEN, 0.002, 1), listing(OTHER, 0.6, 1)];
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.at(-1)!.priceUsd).toBe(0.002);
    http.fail = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toHaveLength(1);
    wa.stop();
    wa2.stop();
    http.fail = false;
    rpc.on(WBNB, ERC20_ABI, 'decimals', 18).on(WBNB, ERC20_ABI, 'totalSupply', 1n);
    await expect(feed.watch(`bnb:${WBNB}`, () => undefined)).rejects.toThrow(/No price source/);
    await feed.close();
    await feed.pollOnce(); // nothing watched: no request
  });
});
