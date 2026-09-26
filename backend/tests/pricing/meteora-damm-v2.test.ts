/**
 * @file meteora-damm-v2.test.ts
 * @description Tests for Meteora DAMM v2 decoding and MeteoraDammV2PriceFeed (token as A or B, refusals).
 * @author Reborn1987
 */

import { getAddressEncoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { AccountDecodeError } from '../../src/core/errors.js';
import { PYTH_SOL_USD_ACCOUNT, USDC_MINT } from '../../src/core/pricing/addresses.js';
import { dammV2PriceBPerA, DAMM_V2_POOL_DISCRIMINATOR, decodeDammV2Pool } from '../../src/core/pricing/meteora-damm-v2.js';
import { MeteoraDammV2PriceFeed } from '../../src/core/pricing/meteora-damm-v2-price-feed.js';
import { PoolDirectory } from '../../src/core/pricing/pool-directory.js';
import { UsdQuotes } from '../../src/core/pricing/usd-quotes.js';
import { HttpJsonPort } from '../../src/ports/http-json.js';
import type { PriceTick } from '../../src/ports/price-feed.js';
import { FakeAccounts, pythBytes } from '../helpers/fake-accounts.js';

const SCAR = 'DMPAgkCZmz4TZKJrbV11KGvHZUnCqc8uvnLL62SapDZJ' as Address;
const VBUCKS = 'At541hRZhK9LWKj9w2dqN2wCdpFyZgRa1Un2yG7xa43m' as Address;
const POOL = '7hBA7i3LkN3YZLyjK6KJL7aCNdr4VpR1Y7sgi8tzNMWC' as Address;
const JUP = 'https://lite-api.jup.ag/price/v3';
const enc = getAddressEncoder();

/** sqrt price (Q64.64) for a B-per-A raw price. */
const sqrtQ64 = (raw: number): bigint => BigInt(Math.round(Math.sqrt(raw) * 2 ** 32)) * 2n ** 32n;

/** DAMM v2 Pool bytes. */
function poolBytes(a: Address, b: Address, sqrt: bigint): Uint8Array {
  const buf = new Uint8Array(1112);
  buf.set(DAMM_V2_POOL_DISCRIMINATOR, 0);
  buf.set(enc.encode(a), 168);
  buf.set(enc.encode(b), 200);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(456, sqrt & (2n ** 64n - 1n), true);
  dv.setBigUint64(464, sqrt >> 64n, true);
  return buf;
}

/** DexScreener + Jupiter stub. */
class Http extends HttpJsonPort {
  pools: unknown[] = [{ dexId: 'meteora', labels: ['DYN2'], pairAddress: POOL }];
  jup: Record<string, number> = { [VBUCKS]: 0.0015 };
  async getJson(url: string): Promise<unknown> {
    if (url.includes('dexscreener')) return this.pools;
    const ids = new URL(url).searchParams.get('ids')!.split(',');
    return Object.fromEntries(ids.filter((i) => i in this.jup).map((i) => [i, { usdPrice: this.jup[i] }]));
  }
}

/** SCAR/VBUCKS pool at 0.0319 VBUCKS per SCAR. */
async function setup(pool: Uint8Array = poolBytes(SCAR, VBUCKS, sqrtQ64(0.0319))) {
  const accounts = new FakeAccounts();
  accounts.data.set(PYTH_SOL_USD_ACCOUNT, pythBytes(12000n, -2));
  accounts.data.set(POOL, pool);
  for (const m of [SCAR, VBUCKS, USDC_MINT]) accounts.supplies.set(m, { amount: 1_000_000_000_000_000n, decimals: 6 });
  const http = new Http();
  const errors: unknown[] = [];
  const quotes = new UsdQuotes(accounts, http, JUP, 60_000, (e) => errors.push(e));
  await quotes.start();
  return { accounts, http, feed: new MeteoraDammV2PriceFeed(accounts, new PoolDirectory(http), quotes, (e) => errors.push(e)), errors };
}

describe('DAMM v2 decoding', () => {
  it('decodes mints and sqrt price, and rejects other accounts', () => {
    const p = decodeDammV2Pool(poolBytes(SCAR, VBUCKS, sqrtQ64(0.0319)));
    expect(p).toMatchObject({ tokenAMint: SCAR, tokenBMint: VBUCKS, status: 0 });
    expect(dammV2PriceBPerA(p.sqrtPrice, 6, 6)).toBeCloseTo(0.0319, 8);
    expect(() => decodeDammV2Pool(new Uint8Array(10))).toThrow(AccountDecodeError);
    const bad = poolBytes(SCAR, VBUCKS, 1n);
    bad[0] = 0;
    expect(() => decodeDammV2Pool(bad)).toThrow(/discriminator/);
  });
});

describe('MeteoraDammV2PriceFeed', () => {
  it('prices a token quoted in another token (token A side) and follows swaps', async () => {
    const { accounts, feed } = await setup();
    const ticks: PriceTick[] = [];
    const w = await feed.watch(SCAR, (t) => ticks.push(t));
    expect(ticks.at(-1)).toMatchObject({ source: 'meteora-damm2' });
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.0319 * 0.0015, 10);
    accounts.push(POOL, poolBytes(SCAR, VBUCKS, sqrtQ64(0.04)));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.04 * 0.0015, 10);
    const late: PriceTick[] = [];
    await feed.watch(SCAR, (t) => late.push(t));
    expect(late).toHaveLength(1);
    w.stop();
    await feed.close();
  });

  it('inverts the price when the token is side B', async () => {
    const { feed } = await setup(poolBytes(USDC_MINT, SCAR, sqrtQ64(20_000))); // 20,000 SCAR per USDC
    const ticks: PriceTick[] = [];
    await feed.watch(SCAR, (t) => ticks.push(t));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(0.00005, 10);
  });

  it('refuses missing, foreign and unlisted pools, and reports bad stream data', async () => {
    const a = await setup();
    a.http.pools = [];
    await expect(a.feed.watch(SCAR, () => undefined)).rejects.toThrow(/No Meteora DAMM v2 pool/);
    const b = await setup();
    b.accounts.data.delete(POOL);
    await expect(b.feed.watch(SCAR, () => undefined)).rejects.toThrow(/not found on-chain/);
    const c = await setup(poolBytes(USDC_MINT, VBUCKS, 1n));
    await expect(c.feed.watch(SCAR, () => undefined)).rejects.toThrow(/is not for/);
    const d = await setup();
    await d.feed.watch(SCAR, () => undefined);
    d.accounts.push(POOL, new Uint8Array(3));
    expect(d.errors[0]).toBeInstanceOf(AccountDecodeError);
  });
});
