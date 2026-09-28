/**
 * @file graduation.test.ts
 * @description Following a graduated token to its new pool: the hand-off keeps trying until the pool is listed (it
 *              often isn't right after graduation), and stopping the watch ends the retries or the pool watch.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { followGraduation } from '../../src/core/pricing/graduation.js';
import type { PriceTick } from '../../src/ports/price-feed.js';
import { FakePriceFeed } from '../helpers/fakes.js';

const MINT = 'FAAg5VLNJpTqawCbVxg5BqSVUAku5xrBebqU6vSGCm3n';
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('followGraduation', () => {
  it('retries until the graduated pool is found, then relays its prices', async () => {
    const pools = new FakePriceFeed();
    pools.unsupported.add(MINT); // not listed yet
    const ticks: PriceTick[] = [];
    const errors: unknown[] = [];
    const stop = followGraduation(pools, MINT, (t) => ticks.push(t), (e) => errors.push(e), 10);
    await wait(25);
    expect(pools.watchCalls).toBeGreaterThanOrEqual(2);
    pools.unsupported.delete(MINT); // the pool got listed
    await wait(20);
    const calls = pools.watchCalls;
    pools.tick(MINT, 0.5);
    expect(ticks.at(-1)).toMatchObject({ priceUsd: 0.5 });
    await wait(30);
    expect(pools.watchCalls).toBe(calls); // found: no more tries
    expect(errors.length).toBeGreaterThan(0);
    stop();
    expect(pools.listeners.get(MINT)?.size ?? 0).toBe(0);
  });

  it('stops trying once the watch is stopped', async () => {
    const pools = new FakePriceFeed();
    pools.unsupported.add(MINT);
    const stop = followGraduation(pools, MINT, () => undefined, () => undefined, 10);
    await wait(5);
    stop();
    const calls = pools.watchCalls;
    await wait(40);
    expect(pools.watchCalls).toBe(calls);
  });

  it('drops a pool watch that arrives after it was stopped', async () => {
    const pools = new FakePriceFeed();
    const stop = followGraduation(pools, MINT, () => undefined, () => undefined, 10);
    stop(); // before the pool watch resolved
    await wait(5);
    expect(pools.listeners.get(MINT)?.size ?? 0).toBe(0);
  });
});
