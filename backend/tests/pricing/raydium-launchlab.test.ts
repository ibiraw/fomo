/**
 * @file raydium-launchlab.test.ts
 * @description Tests for LaunchLab decoding and RaydiumLaunchLabPriceFeed (pricing, graduation hand-off, refusals).
 * @author Reborn1987
 */

import { getAddressEncoder, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';

import { AccountDecodeError, UnsupportedPoolError } from '../../src/core/errors.js';
import { PYTH_SOL_USD_ACCOUNT, WSOL_MINT } from '../../src/core/pricing/addresses.js';
import {
  decodeCurveType,
  decodeLaunchLabPool,
  deriveLaunchLabPool,
  LAUNCHLAB_POOL_DISCRIMINATOR,
  launchLabReserves,
} from '../../src/core/pricing/raydium-launchlab.js';
import { LAUNCHLAB_QUOTES, RaydiumLaunchLabPriceFeed } from '../../src/core/pricing/raydium-launchlab-price-feed.js';
import { UsdQuotes } from '../../src/core/pricing/usd-quotes.js';
import { HttpJsonPort } from '../../src/ports/http-json.js';
import type { PriceTick } from '../../src/ports/price-feed.js';
import { FakeAccounts, pythBytes } from '../helpers/fake-accounts.js';
import { FakePriceFeed } from '../helpers/fakes.js';

const MINT = 'BQYSLwLtTGArYi89xqgsTxFcYLfLJerfwM1TsgZKzray' as Address;
const CFG = '6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX' as Address;
const enc = getAddressEncoder();

/** LaunchLab PoolState bytes (429 bytes like the live accounts). */
function poolBytes(opts: { status?: number; vBase: bigint; vQuote: bigint; rBase: bigint; rQuote: bigint; quote?: Address }): Uint8Array {
  const b = new Uint8Array(429);
  b.set(LAUNCHLAB_POOL_DISCRIMINATOR, 0);
  b[17] = opts.status ?? 0;
  b[18] = 6;
  b[19] = 9;
  const dv = new DataView(b.buffer);
  dv.setBigUint64(37, opts.vBase, true);
  dv.setBigUint64(45, opts.vQuote, true);
  dv.setBigUint64(53, opts.rBase, true);
  dv.setBigUint64(61, opts.rQuote, true);
  b.set(enc.encode(CFG), 141);
  b.set(enc.encode(MINT), 205);
  b.set(enc.encode(opts.quote ?? WSOL_MINT), 237);
  return b;
}

/** GlobalConfig bytes with a curve type. */
function cfgBytes(curveType: number): Uint8Array {
  const b = new Uint8Array(400);
  b[16] = curveType;
  return b;
}

/** HTTP stub that never finds anything (SOL quotes don't need Jupiter). */
class NoHttp extends HttpJsonPort {
  async getJson(): Promise<unknown> { throw new Error('HTTP 404'); }
}

/** Feed with a live SOL-quoted curve: 30 SOL virtual, 1,073M virtual tokens. */
async function setup(poolOpts: Partial<Parameters<typeof poolBytes>[0]> = {}, curveType = 0) {
  const accounts = new FakeAccounts();
  accounts.data.set(PYTH_SOL_USD_ACCOUNT, pythBytes(10000n, -2)); // SOL $100
  accounts.supplies.set(MINT, { amount: 1_000_000_000_000_000n, decimals: 6 });
  const pool = await deriveLaunchLabPool(MINT, WSOL_MINT);
  accounts.data.set(pool, poolBytes({ vBase: 1_073_000_000_000_000n, vQuote: 30_000_000_000n, rBase: 73_000_000_000_000n, rQuote: 0n, ...poolOpts }));
  accounts.data.set(CFG, cfgBytes(curveType));
  const errors: unknown[] = [];
  const quotes = new UsdQuotes(accounts, new NoHttp(), 'https://jup', 60_000, (e) => errors.push(e));
  await quotes.start();
  const graduated = new FakePriceFeed();
  const feed = new RaydiumLaunchLabPriceFeed(accounts, quotes, graduated, (e) => errors.push(e));
  return { accounts, pool, quotes, graduated, feed, errors };
}

describe('LaunchLab decoding', () => {
  it('decodes the pool, the curve type and the reserves', () => {
    const p = decodeLaunchLabPool(poolBytes({ vBase: 10n, vQuote: 20n, rBase: 3n, rQuote: 4n }));
    expect(p).toMatchObject({ status: 0, baseDecimals: 6, quoteDecimals: 9, globalConfig: CFG, baseMint: MINT, quoteMint: WSOL_MINT });
    expect(launchLabReserves(p)).toEqual({ base: 7n, quote: 24n });
    expect(decodeCurveType(cfgBytes(2))).toBe(2);
  });

  it('rejects short or foreign accounts', () => {
    expect(() => decodeLaunchLabPool(new Uint8Array(10))).toThrow(AccountDecodeError);
    const b = poolBytes({ vBase: 1n, vQuote: 1n, rBase: 0n, rQuote: 0n });
    b[0] = 9;
    expect(() => decodeLaunchLabPool(b)).toThrow(/discriminator/);
    expect(() => decodeCurveType(new Uint8Array(3))).toThrow(AccountDecodeError);
  });
});

describe('RaydiumLaunchLabPriceFeed', () => {
  it('prices the curve in USD and follows trades', async () => {
    const { accounts, pool, feed } = await setup();
    const ticks: PriceTick[] = [];
    const w = await feed.watch(MINT, (t) => ticks.push(t));
    // 30 SOL / 1,000M tokens = 3e-8 SOL = $3e-6; MC $3,000
    expect(ticks.at(-1)).toMatchObject({ source: 'raydium-launchlab' });
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(3e-6, 12);
    expect(ticks.at(-1)!.marketCapUsd).toBeCloseTo(3000, 4);
    accounts.push(pool, poolBytes({ vBase: 1_073_000_000_000_000n, vQuote: 30_000_000_000n, rBase: 573_000_000_000_000n, rQuote: 30_000_000_000n }));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(1.2e-5, 12); // 60 SOL / 500M
    const late: PriceTick[] = [];
    await feed.watch(MINT, (t) => late.push(t));
    expect(late).toHaveLength(1);
    w.stop();
    await feed.close();
  });

  it('hands listeners over to the graduated feed when the curve migrates', async () => {
    const { accounts, pool, graduated, feed } = await setup();
    const ticks: PriceTick[] = [];
    await feed.watch(MINT, (t) => ticks.push(t));
    accounts.push(pool, poolBytes({ status: 2, vBase: 1n, vQuote: 1n, rBase: 0n, rQuote: 0n }));
    await vi.waitFor(() => expect(graduated.listeners.has(MINT)).toBe(true));
    graduated.tick(MINT, 0.5);
    expect(ticks.at(-1)).toMatchObject({ priceUsd: 0.5 });
    expect(accounts.subscriberCount(pool)).toBe(0);
  });

  it('reports a failed hand-off', async () => {
    const { accounts, pool, graduated, feed, errors } = await setup();
    graduated.unsupported.add(MINT);
    await feed.watch(MINT, () => undefined);
    accounts.push(pool, poolBytes({ status: 2, vBase: 1n, vQuote: 1n, rBase: 0n, rQuote: 0n }));
    await vi.waitFor(() => expect(errors[0]).toBeInstanceOf(UnsupportedPoolError));
  });

  it('refuses tokens without a curve, graduated curves and other curve types', async () => {
    const none = await setup();
    none.accounts.data.delete(none.pool);
    await expect(none.feed.watch(MINT, () => undefined)).rejects.toThrow(/No Raydium LaunchLab curve/);
    const dusted = await setup();
    dusted.accounts.data.set(dusted.pool, new Uint8Array(0)); // someone sent SOL to the pool address
    await expect(dusted.feed.watch(MINT, () => undefined)).rejects.toThrow(/No Raydium LaunchLab curve/);
    const done = await setup({ status: 2 });
    await expect(done.feed.watch(MINT, () => undefined)).rejects.toThrow(/graduated/);
    const linear = await setup({}, 1);
    await expect(linear.feed.watch(MINT, () => undefined)).rejects.toThrow(/curve type/);
  });

  it('finds a pool paired with another token by searching (stonkfun + a tokenized stock) and prices it through that token', async () => {
    const STOCK = 'Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8' as Address;
    const accounts = new FakeAccounts();
    accounts.data.set(PYTH_SOL_USD_ACCOUNT, pythBytes(10000n, -2));
    accounts.supplies.set(MINT, { amount: 1_000_000_000_000_000n, decimals: 6 });
    // 30 stock tokens (9 decimals here) against 1,000M tokens; the stock trades at $250
    accounts.data.set('3Vc5zM8nzPuvjxXXrTXbY6K1XCxGRB6WFojxQDLddCjN', poolBytes({ vBase: 1_073_000_000_000_000n, vQuote: 30_000_000_000n, rBase: 73_000_000_000_000n, rQuote: 0n, quote: STOCK }));
    accounts.data.set(CFG, cfgBytes(0));
    const jup = new (class extends HttpJsonPort { async getJson(): Promise<unknown> { return { [STOCK]: { usdPrice: 250 } }; } })();
    const quotes = new UsdQuotes(accounts, jup, 'https://jup', 60_000, () => undefined);
    await quotes.start();
    const feed = new RaydiumLaunchLabPriceFeed(accounts, quotes, new FakePriceFeed(), () => undefined);
    const ticks: PriceTick[] = [];
    await feed.watch(MINT, (t) => ticks.push(t));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(7.5e-6, 12); // 3e-8 stock × $250
    expect(ticks.at(-1)!.marketCapUsd).toBeCloseTo(7500, 4);
    await feed.close();
  });

  it('checks every supported quote token and routes bad stream data to onError', async () => {
    expect(LAUNCHLAB_QUOTES).toContain(WSOL_MINT);
    const { accounts, pool, feed, errors } = await setup();
    await feed.watch(MINT, () => undefined);
    accounts.push(pool, new Uint8Array(4));
    expect(errors[0]).toBeInstanceOf(AccountDecodeError);
  });
});
