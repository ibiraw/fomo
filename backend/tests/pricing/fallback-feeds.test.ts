/**
 * @file fallback-feeds.test.ts
 * @description Tests for JupiterPriceFeed (polled fallback) and CompositePriceFeed (priority + fallback).
 * @author Reborn1987
 */

import { describe, expect, it, vi } from 'vitest';

import { UnsupportedPoolError } from '../../src/core/errors.js';
import { CompositePriceFeed } from '../../src/core/pricing/composite-price-feed.js';
import { JupiterPriceFeed, parseJupiterPrices } from '../../src/core/pricing/jupiter-price-feed.js';
import { HttpJsonPort } from '../../src/ports/http-json.js';
import type { PriceTick } from '../../src/ports/price-feed.js';
import { FakeAccounts } from '../helpers/fake-accounts.js';
import { FakePriceFeed } from '../helpers/fakes.js';

const BOP = '527PdUTGwcFxVEMXt8tyRJA1nYbVedgSiSfh4s2LWTWz';
const JUP_URL = 'https://lite-api.jup.ag/price/v3';

/** Jupiter stub: returns prices from a mutable table, records requested URLs. */
class FakeJupiter extends HttpJsonPort {
  prices: Record<string, number> = {};
  calls: string[] = [];
  fail = false;
  async getJson(url: string): Promise<unknown> {
    this.calls.push(url);
    if (this.fail) throw new Error('HTTP 429');
    const ids = new URL(url).searchParams.get('ids')!.split(',');
    return Object.fromEntries(ids.filter((id) => id in this.prices).map((id) => [id, { usdPrice: this.prices[id], decimals: 6 }]));
  }
}

/** Jupiter feed with a 1B-supply token. */
function setup() {
  const http = new FakeJupiter();
  const accounts = new FakeAccounts();
  accounts.supplies.set(BOP, { amount: 1_000_000_000_000_000n, decimals: 6 });
  const errors: unknown[] = [];
  const feed = new JupiterPriceFeed(http, accounts, { url: JUP_URL, pollMs: 60_000 }, (e) => errors.push(e));
  return { http, accounts, feed, errors };
}

describe('parseJupiterPrices', () => {
  it('keeps valid prices and rejects junk responses', () => {
    expect(parseJupiterPrices({ a: { usdPrice: 1 }, b: { usdPrice: 0 }, c: null, d: { usdPrice: 'x' } })).toEqual(new Map([['a', 1]]));
    expect(() => parseJupiterPrices('nope')).toThrow(/unexpected/);
  });
});

describe('JupiterPriceFeed', () => {
  it('emits an initial tick with market cap, then polls', async () => {
    const { http, feed } = setup();
    http.prices[BOP] = 0.000637;
    const ticks: PriceTick[] = [];
    const w = await feed.watch(BOP, (t) => ticks.push(t));
    expect(ticks[0]).toMatchObject({ source: 'jupiter', priceUsd: 0.000637 });
    expect(ticks[0]!.marketCapUsd).toBeCloseTo(637_000);
    http.prices[BOP] = 0.0007;
    await feed.pollOnce();
    expect(ticks.at(-1)!.priceUsd).toBe(0.0007);
    w.stop();
    await feed.pollOnce(); // nothing watched: no request
    expect(http.calls).toHaveLength(2);
    await feed.close();
  });

  it('rejects tokens Jupiter cannot price', async () => {
    const { feed } = setup();
    await expect(feed.watch(BOP, () => undefined)).rejects.toThrow(UnsupportedPoolError);
  });

  it('shares one watch per mint and reports poll errors without stopping', async () => {
    const { http, feed, errors } = setup();
    http.prices[BOP] = 1;
    const a = vi.fn();
    const b = vi.fn();
    const wa = await feed.watch(BOP, a);
    await feed.watch(BOP, b);
    http.fail = true;
    await feed.pollOnce();
    expect(errors).toHaveLength(1);
    http.fail = false;
    await feed.pollOnce();
    expect(b).toHaveBeenCalled();
    wa.stop();
    await feed.close();
  });
});

describe('CompositePriceFeed', () => {
  it('uses the first feed that supports the token and falls back on UnsupportedPoolError', async () => {
    const fast = new FakePriceFeed();
    const slow = new FakePriceFeed();
    fast.unsupported.add(BOP);
    const c = new CompositePriceFeed([fast, slow]);
    await c.start();
    await c.watch(BOP, () => undefined);
    expect(slow.listeners.has(BOP)).toBe(true);
    await c.watch('M2', () => undefined);
    expect(fast.listeners.has('M2')).toBe(true);
    await c.close();
  });

  it('combines every refusal, and rethrows other errors', async () => {
    const a = new FakePriceFeed();
    const b = new FakePriceFeed();
    a.unsupported.add(BOP);
    b.unsupported.add(BOP);
    await expect(new CompositePriceFeed([a, b]).watch(BOP, () => undefined)).rejects.toThrow(/unsupported .* \| unsupported/);
    const broken = new FakePriceFeed();
    broken.watch = async () => { throw new Error('RPC down'); };
    await expect(new CompositePriceFeed([broken, b]).watch(BOP, () => undefined)).rejects.toThrow('RPC down');
    await expect(new CompositePriceFeed([]).watch(BOP, () => undefined)).rejects.toThrow(/No price feed/);
  });
});
