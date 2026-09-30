/**
 * @file raydium-cpmm.test.ts
 * @description Tests for Raydium CPMM decoding/pricing, UsdQuotes, PoolDirectory and VaultPair.
 * @author Reborn1987
 */

import { getAddressEncoder, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';

import { AccountDecodeError, UnsupportedPoolError } from '../../src/core/errors.js';
import { PYTH_SOL_USD_ACCOUNT, USDC_MINT, WSOL_MINT } from '../../src/core/pricing/addresses.js';
import { PoolDirectory } from '../../src/core/pricing/pool-directory.js';
import { CPMM_POOL_DISCRIMINATOR, decodeCpmmPool } from '../../src/core/pricing/raydium-cpmm.js';
import { RaydiumCpmmPriceFeed, sidesFor } from '../../src/core/pricing/raydium-cpmm-price-feed.js';
import { isOnchainReadable, UsdQuotes } from '../../src/core/pricing/usd-quotes.js';
import { VaultPair } from '../../src/core/pricing/vault-pair.js';
import { HttpJsonPort } from '../../src/ports/http-json.js';
import type { PriceTick } from '../../src/ports/price-feed.js';
import { FakeAccounts, pythBytes, tokenAccountBytes } from '../helpers/fake-accounts.js';
import { FakePriceFeed } from '../helpers/fakes.js';

const BOP = '527PdUTGwcFxVEMXt8tyRJA1nYbVedgSiSfh4s2LWTWz' as Address;
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' as Address;
const POOL = '2Sra9Xw28W25LecbFhHzV4nP2BoWx7G1mqyMJPnJHFF5' as Address;
const V0 = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' as Address;
const V1 = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' as Address;
const JUP = 'https://lite-api.jup.ag/price/v3';
const DS = `https://api.dexscreener.com/token-pairs/v1/solana/${BOP}`;
const enc = getAddressEncoder();

/** CPMM pool bytes (token0 = quote, token1 = BOP, like BOP's real pool ordering may be). */
function cpmmBytes(opts: { mint0: Address; mint1: Address; dec0: number; dec1: number; fees0?: bigint; fees1?: bigint; creator?: boolean }): Uint8Array {
  const b = new Uint8Array(opts.creator === false ? 381 : 637);
  b.set(CPMM_POOL_DISCRIMINATOR, 0);
  b.set(enc.encode(V0), 72);
  b.set(enc.encode(V1), 104);
  b.set(enc.encode(opts.mint0), 168);
  b.set(enc.encode(opts.mint1), 200);
  b[331] = opts.dec0;
  b[332] = opts.dec1;
  const dv = new DataView(b.buffer);
  dv.setBigUint64(341, opts.fees0 ?? 0n, true); // protocol fees 0
  dv.setBigUint64(349, opts.fees1 ?? 0n, true); // protocol fees 1
  if (opts.creator !== false) dv.setBigUint64(397, 1n, true); // creator fees 0
  return b;
}

/** HTTP stub keyed by exact URL; Jupiter URLs answered from a price table. */
class FakeHttp extends HttpJsonPort {
  docs: Record<string, unknown> = {};
  jup: Record<string, number> = {};
  failJup = false;
  async getJson(url: string): Promise<unknown> {
    if (url.startsWith(JUP)) {
      if (this.failJup) throw new Error('HTTP 429');
      const ids = new URL(url).searchParams.get('ids')!.split(',');
      return Object.fromEntries(ids.filter((i) => i in this.jup).map((i) => [i, { usdPrice: this.jup[i] }]));
    }
    if (!(url in this.docs)) throw new Error('HTTP 404');
    return this.docs[url];
  }
}

/** Full CPMM setup: BONK-quoted pool, 1B BOP supply. */
async function setup() {
  const accounts = new FakeAccounts();
  const http = new FakeHttp();
  accounts.data.set(PYTH_SOL_USD_ACCOUNT, pythBytes(15000n, -2)); // SOL $150
  accounts.supplies.set(BOP, { amount: 1_000_000_000_000_000n, decimals: 6 });
  http.docs[DS] = [
    { dexId: 'meteora', labels: [], pairAddress: 'x', liquidity: { usd: 999_999 } },
    { dexId: 'raydium', labels: ['CPMM'], pairAddress: POOL, liquidity: { usd: 83_000 } },
  ];
  http.jup[BONK] = 0.00002; // $0.00002 per BONK
  accounts.data.set(POOL, cpmmBytes({ mint0: BONK, mint1: BOP, dec0: 5, dec1: 6, fees0: 1_000_000n }));
  // 30,000,000 BONK (+ fees) vs 1,000,000 BOP => 30 BONK/BOP => $0.0006
  accounts.data.set(V0, tokenAccountBytes(3_000_000_000_000n + 1_000_000n + 1n));
  accounts.data.set(V1, tokenAccountBytes(1_000_000_000_000n));
  const errors: unknown[] = [];
  const quotes = new UsdQuotes(accounts, http, JUP, 60_000, (e) => errors.push(e));
  await quotes.start();
  const feed = new RaydiumCpmmPriceFeed(accounts, new PoolDirectory(http), quotes, (e) => errors.push(e));
  return { accounts, http, quotes, feed, errors };
}

describe('decodeCpmmPool / sidesFor', () => {
  it('decodes vaults, mints, decimals and summed fees (with and without creator fees)', () => {
    const p = decodeCpmmPool(cpmmBytes({ mint0: BONK, mint1: BOP, dec0: 5, dec1: 6, fees0: 10n, fees1: 20n }));
    expect(p).toMatchObject({ vault0: V0, vault1: V1, mint0: BONK, mint1: BOP, decimals0: 5, decimals1: 6, fees0: 11n, fees1: 20n });
    expect(decodeCpmmPool(cpmmBytes({ mint0: BONK, mint1: BOP, dec0: 5, dec1: 6, fees0: 10n, creator: false })).fees0).toBe(10n);
  });

  it('rejects wrong accounts', () => {
    expect(() => decodeCpmmPool(new Uint8Array(10))).toThrow(AccountDecodeError);
    const b = cpmmBytes({ mint0: BONK, mint1: BOP, dec0: 5, dec1: 6 });
    b[0] = 0;
    expect(() => decodeCpmmPool(b)).toThrow(/discriminator/);
  });

  it('orients base/quote either way and rejects foreign mints', () => {
    const p = decodeCpmmPool(cpmmBytes({ mint0: BOP, mint1: WSOL_MINT, dec0: 6, dec1: 9 }));
    expect(sidesFor(p, BOP)).toMatchObject({ baseVault: V0, quoteVault: V1, quoteMint: WSOL_MINT, baseDecimals: 6, quoteDecimals: 9 });
    expect(sidesFor(p, WSOL_MINT)).toMatchObject({ baseVault: V1, quoteMint: BOP });
    expect(() => sidesFor(p, BONK)).toThrow(UnsupportedPoolError);
  });
});

describe('RaydiumCpmmPriceFeed', () => {
  it('prices a BONK-quoted pool in USD net of fees, and re-prices when BONK moves', async () => {
    const { http, quotes, feed } = await setup();
    const ticks: PriceTick[] = [];
    const w = await feed.watch(BOP, (t) => ticks.push(t));
    expect(ticks.at(-1)).toMatchObject({ source: 'raydium-cpmm' });
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.0006, 10);
    expect(ticks.at(-1)!.marketCapUsd).toBeCloseTo(600_000, 2);
    http.jup[BONK] = 0.00004;
    await quotes.poll();
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.0012, 10);
    const late: PriceTick[] = [];
    await feed.watch(BOP, (t) => late.push(t)); // second listener gets the last tick immediately
    expect(late).toHaveLength(1);
    w.stop();
    await feed.close();
    quotes.close();
  });

  it('follows fee changes in the pool account', async () => {
    const { accounts, feed } = await setup();
    const ticks: PriceTick[] = [];
    await feed.watch(BOP, (t) => ticks.push(t));
    accounts.push(POOL, cpmmBytes({ mint0: BONK, mint1: BOP, dec0: 5, dec1: 6, fees0: 1_500_000_000_000n }));
    accounts.push(V1, tokenAccountBytes(1_000_000_000_000n)); // next swap re-prices with new fees
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.0003, 8);
  });

  it('refuses tokens without a CPMM pool, missing pools, and quote tokens without a USD price', async () => {
    const a = await setup();
    a.http.docs[DS] = [{ dexId: 'meteora', labels: ['DLMM'], pairAddress: 'x' }];
    await expect(a.feed.watch(BOP, () => undefined)).rejects.toThrow(/No Raydium CPMM pool/);
    const b = await setup();
    b.accounts.data.delete(POOL);
    await expect(b.feed.watch(BOP, () => undefined)).rejects.toThrow(/not found on-chain/);
    const c = await setup();
    delete c.http.jup[BONK];
    await expect(c.feed.watch(BOP, () => undefined)).rejects.toThrow(/No USD price for quote/);
  });

  it('routes bad stream data to onError', async () => {
    const { accounts, feed, errors } = await setup();
    await feed.watch(BOP, () => undefined);
    accounts.push(POOL, new Uint8Array(5));
    expect(errors[0]).toBeInstanceOf(AccountDecodeError);
  });
});

describe('UsdQuotes', () => {
  it('prices SOL from Pyth, stables at $1, polls others and survives poll errors', async () => {
    const { http, quotes, errors } = await setup();
    expect(quotes.usd(WSOL_MINT)).toBe(150);
    expect(quotes.usd(USDC_MINT)).toBe(1);
    expect(quotes.usd(BONK)).toBeNull();
    await quotes.track(USDC_MINT);
    await quotes.track(BONK);
    expect(quotes.usd(BONK)).toBe(0.00002);
    const seen = vi.fn();
    const off = quotes.onChange(seen);
    http.failJup = true;
    await quotes.poll();
    expect(errors).toHaveLength(1);
    http.failJup = false;
    http.jup[BONK] = 0.00003;
    await quotes.poll();
    expect(seen).toHaveBeenCalledWith(BONK);
    off();
    quotes.close();
  });

  it('fails fast without Pyth', async () => {
    const q = new UsdQuotes(new FakeAccounts(), new FakeHttp(), JUP, 1000, () => undefined);
    await expect(q.start()).rejects.toThrow(/Pyth/);
    await q.poll(); // nothing tracked: no-op
  });
});

describe('UsdQuotes on-chain chaining', () => {
  /** UsdQuotes with a fake on-chain feed. */
  async function chainSetup(firstTickMs = 200) {
    const accounts = new FakeAccounts();
    accounts.data.set(PYTH_SOL_USD_ACCOUNT, pythBytes(15000n, -2));
    const http = new FakeHttp();
    const errors: unknown[] = [];
    const quotes = new UsdQuotes(accounts, http, JUP, 60_000, (e) => errors.push(e), firstTickMs);
    await quotes.start();
    const onchain = new FakePriceFeed();
    quotes.setOnchainFeed(onchain);
    return { http, quotes, onchain, errors };
  }

  it('prices a quote token live through the on-chain feeds before Jupiter', async () => {
    const { http, quotes, onchain } = await chainSetup();
    http.jup[BONK] = 0.00002;
    const p = quotes.track(BONK);
    await vi.waitFor(() => expect(onchain.listeners.has(BONK)).toBe(true));
    onchain.tick(BONK, 0.00003);
    await p;
    expect(quotes.usd(BONK)).toBe(0.00003); // on-chain value, not Jupiter's
    const seen = vi.fn();
    quotes.onChange(seen);
    onchain.tick(BONK, 0.00004);
    expect(seen).toHaveBeenCalledWith(BONK);
    await quotes.track(BONK); // already live: no-op
  });

  it('falls back to Jupiter when no on-chain route exists or no price arrives in time', async () => {
    const a = await chainSetup();
    a.onchain.unsupported.add(BONK);
    a.http.jup[BONK] = 0.00002;
    await a.quotes.track(BONK);
    expect(a.quotes.usd(BONK)).toBe(0.00002);
    const b = await chainSetup(20);
    b.http.jup[BONK] = 0.00005;
    await b.quotes.track(BONK); // on-chain watch never ticks
    expect(b.quotes.usd(BONK)).toBe(0.00005);
    expect(b.onchain.listeners.has(BONK)).toBe(false);
  });

  it('uses Jupiter when the quote token trades mostly in pools the feeds cannot read (TTWO: CLMM $151K vs CPMM $545)', async () => {
    const { http, quotes, onchain } = await chainSetup();
    const ds = `https://api.dexscreener.com/token-pairs/v1/solana/${BONK}`;
    http.docs[ds] = [
      { dexId: 'raydium', labels: ['CPMM'], pairAddress: 'thin', liquidity: { usd: 545 } },
      { dexId: 'raydium', labels: ['CLMM'], pairAddress: 'deep', liquidity: { usd: 151_360 } },
      { dexId: 'meteora', labels: ['DLMM'], pairAddress: 'dlmm', liquidity: { usd: 6_109 } },
    ];
    quotes.setOnchainFeed(onchain, new PoolDirectory(http));
    http.jup[BONK] = 202.69;
    await quotes.track(BONK);
    expect(quotes.usd(BONK)).toBe(202.69);
    expect(onchain.listeners.has(BONK)).toBe(false); // the thin CPMM pool was never used
  });

  it('keeps the live on-chain route when the most liquid pool is readable, or the directory has nothing to say', async () => {
    const a = await chainSetup();
    const ds = `https://api.dexscreener.com/token-pairs/v1/solana/${BONK}`;
    a.http.docs[ds] = [
      { dexId: 'meteora', labels: ['DYN2'], pairAddress: 'main', liquidity: { usd: 90_000 } },
      { dexId: 'raydium', labels: ['CLMM'], pairAddress: 'side', liquidity: { usd: 2_000 } },
    ];
    a.quotes.setOnchainFeed(a.onchain, new PoolDirectory(a.http));
    const p = a.quotes.track(BONK);
    await vi.waitFor(() => expect(a.onchain.listeners.has(BONK)).toBe(true));
    a.onchain.tick(BONK, 0.00003);
    await p;
    expect(a.quotes.usd(BONK)).toBe(0.00003);
    // DexScreener down (404 here): logged, and the on-chain route is still tried.
    const b = await chainSetup();
    b.quotes.setOnchainFeed(b.onchain, new PoolDirectory(b.http));
    const q = b.quotes.track(BONK);
    await vi.waitFor(() => expect(b.onchain.listeners.has(BONK)).toBe(true));
    b.onchain.tick(BONK, 0.00004);
    await q;
    expect(b.quotes.usd(BONK)).toBe(0.00004);
    expect(b.errors.some((e) => e instanceof Error && /404/.test(e.message))).toBe(true);
  });

  it('knows which listed pools the on-chain feeds read', () => {
    const pool = (dexId: string, labels: string[] = []) => ({ dexId, labels, address: 'x', liquidityUsd: 1, baseAddress: '', quoteAddress: '', quoteSymbol: '', priceNative: 0, priceUsd: 0 });
    expect([pool('pumpfun'), pool('pumpswap'), pool('meteoradbc'), pool('raydium', ['CPMM']), pool('raydium', ['LaunchLab']), pool('meteora', ['DYN2'])].every(isOnchainReadable)).toBe(true);
    expect([pool('raydium', ['CLMM']), pool('raydium'), pool('meteora', ['DLMM']), pool('orca'), pool('meteora', ['DYN'])].some(isOnchainReadable)).toBe(false);
  });

  it('refuses cycles and reports unexpected on-chain errors', async () => {
    const { http, quotes, onchain, errors } = await chainSetup();
    http.jup[BOP] = 1;
    onchain.watch = async (mint) => { await quotes.track(mint); throw new Error('unreachable'); };
    await quotes.track(BOP); // the inner track(BOP) hits the cycle guard; outer falls back to Jupiter
    expect(quotes.usd(BOP)).toBe(1);
    expect(errors.some((e) => e instanceof Error && /unreachable/.test(e.message))).toBe(false);
  });
});

describe('PoolDirectory', () => {
  it('sorts by liquidity, drops entries without address, and caches', async () => {
    const http = new FakeHttp();
    http.docs[DS] = [{ dexId: 'a', pairAddress: 'p1', liquidity: { usd: 5 } }, { dexId: 'b', pairAddress: 'p2', liquidity: { usd: 50 } }, { dexId: 'c' }];
    let now = 0;
    const d = new PoolDirectory(http, () => now);
    expect((await d.find(BOP)).map((p) => p.address)).toEqual(['p2', 'p1']);
    http.docs[DS] = [];
    expect(await d.find(BOP)).toHaveLength(2); // cached
    now = 11 * 60_000;
    expect(await d.find(BOP)).toHaveLength(0);
  });
});

describe('VaultPair', () => {
  it('only emits consistent pairs, ignores stale slots, and times out', () => {
    vi.useFakeTimers();
    try {
      const out: [bigint, bigint][] = [];
      const pair = new VaultPair((a, b) => out.push([a, b]), 400);
      pair.updateA(1n, 1n);
      pair.updateB(2n, 1n);
      expect(out).toEqual([[1n, 2n]]);
      pair.updateA(3n, 2n);
      pair.updateA(9n, 1n); // stale
      expect(out).toHaveLength(1);
      vi.advanceTimersByTime(400);
      expect(out.at(-1)).toEqual([3n, 2n]);
      pair.refresh();
      expect(out).toHaveLength(3);
      pair.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
