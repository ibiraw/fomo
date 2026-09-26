/**
 * @file meteora-dbc.test.ts
 * @description Tests for Meteora DBC decoding and MeteoraDbcPriceFeed (pricing, graduation, refusals).
 * @author Reborn1987
 */

import { getAddressEncoder, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';

import { AccountDecodeError, UnsupportedPoolError } from '../../src/core/errors.js';
import { PYTH_SOL_USD_ACCOUNT, USDC_MINT } from '../../src/core/pricing/addresses.js';
import { dbcPrice, decodeDbcPool, decodeDbcQuoteMint } from '../../src/core/pricing/meteora-dbc.js';
import { MeteoraDbcPriceFeed } from '../../src/core/pricing/meteora-dbc-price-feed.js';
import { PoolDirectory } from '../../src/core/pricing/pool-directory.js';
import { UsdQuotes } from '../../src/core/pricing/usd-quotes.js';
import { HttpJsonPort } from '../../src/ports/http-json.js';
import type { PriceTick } from '../../src/ports/price-feed.js';
import { FakeAccounts, pythBytes } from '../helpers/fake-accounts.js';
import { FakePriceFeed } from '../helpers/fakes.js';

const EYES = 'ZrueWB1YvjruJpTGiJSYYfyuL71FZeeSUwJY1ZPeyes' as Address;
const POOL = 'BkYnXoVkNXQxSBKF3R7nRADoiTPZaWotUp1NhWRm15j7' as Address;
const CFG = '7wRiChrmFZZYME6vv1NYXJeCEeFnHVmtzhgh3GNSjy6W' as Address;
const LIVE_DISC = [237, 219, 184, 23, 42, 189, 169, 35];
const IDL_DISC = [213, 224, 5, 209, 98, 69, 119, 92];
const enc = getAddressEncoder();
const Q64 = 2n ** 64n;

/** sqrt price (Q64.64) for a quote-per-base raw price. */
function sqrtQ64(rawPrice: number): bigint {
  return BigInt(Math.round(Math.sqrt(rawPrice) * 2 ** 32)) * 2n ** 32n;
}

/** VirtualPool bytes. */
function poolBytes(opts: { sqrt: bigint; migrated?: boolean; base?: Address; disc?: number[] }): Uint8Array {
  const b = new Uint8Array(424);
  b.set(opts.disc ?? LIVE_DISC, 0);
  b.set(enc.encode(CFG), 72);
  b.set(enc.encode(opts.base ?? EYES), 136);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(280, opts.sqrt & (Q64 - 1n), true);
  dv.setBigUint64(288, opts.sqrt >> 64n, true);
  b[305] = opts.migrated ? 1 : 0;
  return b;
}

/** PoolConfig bytes with a quote mint. */
function cfgBytes(quote: Address): Uint8Array {
  const b = new Uint8Array(1128);
  b.set(enc.encode(quote), 8);
  return b;
}

/** DexScreener stub. */
class Http extends HttpJsonPort {
  pools: unknown[] = [{ dexId: 'meteoradbc', pairAddress: POOL, liquidity: { usd: 0 } }];
  async getJson(url: string): Promise<unknown> {
    if (url.includes('dexscreener')) return this.pools;
    throw new Error('HTTP 404');
  }
}

/** Feed with a USDC-quoted EYES curve at $0.000638 (6/6 decimals ⇒ raw price 0.000638). */
async function setup(pool: Uint8Array = poolBytes({ sqrt: sqrtQ64(0.000638) })) {
  const accounts = new FakeAccounts();
  accounts.data.set(PYTH_SOL_USD_ACCOUNT, pythBytes(12000n, -2));
  accounts.data.set(POOL, pool);
  accounts.data.set(CFG, cfgBytes(USDC_MINT));
  accounts.supplies.set(EYES, { amount: 995_900_000_000_000n, decimals: 6 });
  accounts.supplies.set(USDC_MINT, { amount: 1n, decimals: 6 });
  const http = new Http();
  const errors: unknown[] = [];
  const quotes = new UsdQuotes(accounts, http, 'https://jup', 60_000, (e) => errors.push(e));
  await quotes.start();
  const graduated = new FakePriceFeed();
  const feed = new MeteoraDbcPriceFeed(accounts, new PoolDirectory(http), quotes, graduated, (e) => errors.push(e));
  return { accounts, http, graduated, feed, errors };
}

describe('Meteora DBC decoding', () => {
  it('decodes both known discriminators and computes the price', () => {
    const live = decodeDbcPool(poolBytes({ sqrt: sqrtQ64(0.000638) }));
    expect(live).toMatchObject({ config: CFG, baseMint: EYES, isMigrated: false });
    expect(decodeDbcPool(poolBytes({ sqrt: 1n, disc: IDL_DISC })).baseMint).toBe(EYES);
    expect(dbcPrice(live.sqrtPrice, 6, 6)).toBeCloseTo(0.000638, 9);
    expect(dbcPrice(Q64, 6, 9)).toBeCloseTo(0.001, 12); // raw 1 ⇒ 10^(6−9)
    expect(decodeDbcQuoteMint(cfgBytes(USDC_MINT))).toBe(USDC_MINT);
  });

  it('rejects wrong accounts', () => {
    expect(() => decodeDbcPool(new Uint8Array(100))).toThrow(AccountDecodeError);
    expect(() => decodeDbcPool(poolBytes({ sqrt: 1n, disc: [1, 2, 3, 4, 5, 6, 7, 8] }))).toThrow(/discriminator/);
    expect(() => decodeDbcQuoteMint(new Uint8Array(10))).toThrow(AccountDecodeError);
  });
});

describe('MeteoraDbcPriceFeed', () => {
  it('prices the curve in USD and follows trades', async () => {
    const { accounts, feed } = await setup();
    const ticks: PriceTick[] = [];
    const w = await feed.watch(EYES, (t) => ticks.push(t));
    expect(ticks.at(-1)).toMatchObject({ source: 'meteora-dbc' });
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.000638, 9);
    expect(ticks.at(-1)!.marketCapUsd).toBeCloseTo(635_384, -2);
    accounts.push(POOL, poolBytes({ sqrt: sqrtQ64(0.0007) }));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.0007, 9);
    const late: PriceTick[] = [];
    await feed.watch(EYES, (t) => late.push(t));
    expect(late).toHaveLength(1);
    w.stop();
    await feed.close();
  });

  it('hands off to the graduated feed after migration', async () => {
    const { accounts, graduated, feed } = await setup();
    const ticks: PriceTick[] = [];
    await feed.watch(EYES, (t) => ticks.push(t));
    accounts.push(POOL, poolBytes({ sqrt: 1n, migrated: true }));
    await vi.waitFor(() => expect(graduated.listeners.has(EYES)).toBe(true));
    graduated.tick(EYES, 0.002);
    expect(ticks.at(-1)!.priceUsd).toBe(0.002);
  });

  it('reports bad stream data and a failed hand-off', async () => {
    const { accounts, graduated, feed, errors } = await setup();
    graduated.unsupported.add(EYES);
    await feed.watch(EYES, () => undefined);
    accounts.push(POOL, new Uint8Array(3));
    expect(errors[0]).toBeInstanceOf(AccountDecodeError);
    accounts.push(POOL, poolBytes({ sqrt: 1n, migrated: true }));
    await vi.waitFor(() => expect(errors.some((e) => e instanceof UnsupportedPoolError)).toBe(true));
  });

  it('refuses tokens without a curve, foreign or migrated pools, and missing accounts', async () => {
    const a = await setup();
    a.http.pools = [];
    await expect(a.feed.watch(EYES, () => undefined)).rejects.toThrow(/No Meteora bonding curve/);
    const b = await setup();
    b.accounts.data.delete(POOL);
    await expect(b.feed.watch(EYES, () => undefined)).rejects.toThrow(/not found on-chain/);
    const c = await setup(poolBytes({ sqrt: 1n, base: USDC_MINT }));
    await expect(c.feed.watch(EYES, () => undefined)).rejects.toThrow(/is not for/);
    const d = await setup(poolBytes({ sqrt: 1n, migrated: true }));
    await expect(d.feed.watch(EYES, () => undefined)).rejects.toThrow(/graduated/);
    const e = await setup();
    e.accounts.data.delete(CFG);
    await expect(e.feed.watch(EYES, () => undefined)).rejects.toThrow(/config/);
  });
});
