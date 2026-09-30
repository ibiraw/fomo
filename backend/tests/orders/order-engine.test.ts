/**
 * @file order-engine.test.ts
 * @description Tests for OrderEngine: validation, triggering, execution outcomes, retries, recovery.
 * @author Reborn1987
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { OrderStateError, UnsupportedPoolError, ValidationError } from '../../src/core/errors.js';
import { CreateOrderSchema } from '../../src/core/orders/order.js';
import { OrderEngine, REWATCH_MS, type EngineEvent } from '../../src/core/orders/order-engine.js';
import { FakeExecutor, FakePriceFeed } from '../helpers/fakes.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const MINT2 = '6mEf9TXKfFwAd3xSGXRDq3cMb3q8H4R8wEqWsqWxpump';

let store: SqliteOrderStoreAdapter;
let feed: FakePriceFeed;
let exec: FakeExecutor;
let events: EngineEvent[];
let errors: unknown[];
let engine: OrderEngine;

/** Builds a valid create-order payload. */
function limitBuy(value: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { mint: MINT, side: 'buy', trigger: { metric: 'price', direction: 'below', value }, amount: { kind: 'usd', value: 5 }, ...extra };
}

/** Lets queued microtasks / async execution settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  store = new SqliteOrderStoreAdapter(':memory:');
  feed = new FakePriceFeed();
  exec = new FakeExecutor();
  events = [];
  errors = [];
  engine = new OrderEngine(store, feed, exec, (e) => events.push(e), (e) => errors.push(e));
  await engine.start();
});

describe('OrderEngine.createOrder', () => {
  it('rejects invalid input with readable messages', async () => {
    await expect(engine.createOrder('u1', limitBuy(1, { amount: { kind: 'usd', value: 1 } }))).rejects.toThrow(/Minimum trade is \$2/);
    await expect(engine.createOrder('u1', { mint: 'bad' })).rejects.toThrow(ValidationError);
    await expect(engine.createOrder('u1', limitBuy(1, { extra: 1 }))).rejects.toThrow(ValidationError);
  });

  it('refuses unsupported tokens without saving anything', async () => {
    feed.unsupported.add(MINT);
    await expect(engine.createOrder('u1', limitBuy(1))).rejects.toThrow(UnsupportedPoolError);
    expect(engine.listOrders()).toHaveLength(0);
  });

  it('shares one price stream across orders on the same mint', async () => {
    await Promise.all([engine.createOrder('u1', limitBuy(1)), engine.createOrder('u1', limitBuy(2))]);
    expect(feed.watchCalls).toBe(1);
    expect(feed.listeners.get(MINT)?.size).toBe(1);
  });

  it('triggers immediately if the last known price already meets the target', async () => {
    await engine.createOrder('u1', limitBuy(0.5));
    feed.tick(MINT, 1);
    const o = await engine.createOrder('u1', limitBuy(2));
    await settle();
    expect(store.get(o.id)?.status).toBe('filled');
  });
});

describe('OrderEngine triggering and execution', () => {
  it("puts an order back in front of the queue on a layout miss, without spending an attempt, until the executor is ready again", async () => {
    const o = await engine.createOrder('u1', limitBuy(1));
    exec.results.push({ ok: false, kind: 'layout', message: 'Amount box not found' });
    feed.tick(MINT, 1);
    await settle();
    let now = store.get(o.id)!;
    expect(now).toMatchObject({ status: 'triggered', attempts: 0, lastError: 'layout: Amount box not found' });
    expect(exec.executed).toHaveLength(1); // the pump stopped instead of looping
    exec.connect('u1'); // executor ready again (settings fixed / self-check passed)
    await settle();
    now = store.get(o.id)!;
    expect(now.status).toBe('filled');
    expect(exec.executed).toHaveLength(2);
  });

  it('fills a limit buy when price drops to target, and stops watching afterwards', async () => {
    const o = await engine.createOrder('u1', limitBuy(1));
    feed.tick(MINT, 1.5);
    expect(exec.executed).toHaveLength(0);
    feed.tick(MINT, 1);
    await settle();
    const done = store.get(o.id)!;
    expect(done).toMatchObject({ status: 'filled', attempts: 1, triggeredAtValue: 1 });
    expect(events.filter((e) => e.type === 'order').map((e) => e.type === 'order' && e.order.status))
      .toEqual(['open', 'triggered', 'executing', 'filled']);
    expect(feed.listeners.has(MINT)).toBe(false);
    expect(engine.latestTicks()).toHaveLength(0);
  });

  it('supports take-profit on market cap ("above")', async () => {
    const o = await engine.createOrder('u1', {
      mint: MINT, side: 'sell', trigger: { metric: 'marketCap', direction: 'above', value: 2e9 }, amount: { kind: 'percent', value: 50 },
    });
    feed.tick(MINT, 1); // MC 1e9
    feed.tick(MINT, 2); // MC 2e9
    await settle();
    expect(store.get(o.id)?.status).toBe('filled');
  });

  it('only fires each order once even with rapid ticks', async () => {
    await engine.createOrder('u1', limitBuy(1));
    feed.tick(MINT, 0.9);
    feed.tick(MINT, 0.8);
    feed.tick(MINT, 0.7);
    await settle();
    expect(exec.executed).toHaveLength(1);
  });

  it('re-arms on slippage and fails after max attempts', async () => {
    const o = await engine.createOrder('u1', limitBuy(1, { maxAttempts: 2 }));
    exec.results.push({ ok: false, kind: 'slippage', message: 'slippage exceeded' });
    exec.results.push({ ok: false, kind: 'slippage', message: 'slippage exceeded' });
    feed.tick(MINT, 1);
    await settle();
    expect(store.get(o.id)).toMatchObject({ status: 'open', attempts: 1, lastError: 'slippage: slippage exceeded' });
    feed.tick(MINT, 1);
    await settle();
    expect(store.get(o.id)).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('tries a sell fomo refused again on the next trigger, but never a refused buy', async () => {
    const sell = await engine.createOrder('u1', {
      mint: MINT, side: 'sell', trigger: { metric: 'price', direction: 'above', value: 1 }, amount: { kind: 'percent', value: 50 }, maxAttempts: 2,
    });
    exec.results.push({ ok: false, kind: 'rejected', message: 'FOMO reported: Failed to sell 1M X' });
    feed.tick(MINT, 1);
    await settle();
    expect(store.get(sell.id)).toMatchObject({ status: 'open', attempts: 1, lastError: 'rejected: FOMO reported: Failed to sell 1M X' });
    feed.tick(MINT, 1.1);
    await settle();
    expect(store.get(sell.id)).toMatchObject({ status: 'filled', attempts: 2 });
    const buy = await engine.createOrder('u1', { ...limitBuy(1), mint: MINT2 });
    exec.results.push({ ok: false, kind: 'rejected', message: 'FOMO reported: Failed to buy X' });
    feed.tick(MINT2, 1);
    await settle();
    expect(store.get(buy.id)).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('marks timeouts as unknown and other errors as failed', async () => {
    const a = await engine.createOrder('u1', limitBuy(1));
    const b = await engine.createOrder('u1', { ...limitBuy(1), mint: MINT2 });
    exec.results.push({ ok: false, kind: 'timeout', message: 'no answer' });
    exec.results.push({ ok: false, kind: 'not_logged_in', message: 'log in' });
    feed.tick(MINT, 1);
    await settle();
    feed.tick(MINT2, 1);
    await settle();
    expect(store.get(a.id)?.status).toBe('unknown');
    expect(store.get(b.id)?.status).toBe('failed');
  });

  it('waits for an executor, then re-checks the price before trading', async () => {
    exec.ready = false;
    const a = await engine.createOrder('u1', limitBuy(1));
    feed.tick(MINT, 1);
    await settle();
    expect(store.get(a.id)?.status).toBe('triggered');
    feed.tick(MINT, 1.2); // price recovered above the limit
    exec.connect();
    await settle();
    expect(store.get(a.id)?.status).toBe('open');
    expect(exec.executed).toHaveLength(0);
  });

  it('executes one trade at a time', async () => {
    let release!: () => void;
    exec.gate = new Promise((r) => (release = r));
    await engine.createOrder('u1', limitBuy(1));
    await engine.createOrder('u1', limitBuy(1));
    feed.tick(MINT, 1);
    await settle();
    expect(exec.executed).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(exec.executed).toHaveLength(2));
  });

  it('routes evaluation errors to onError', async () => {
    await engine.createOrder('u1', limitBuy(1));
    vi.spyOn(store, 'list').mockImplementationOnce(() => { throw new Error('db down'); });
    feed.tick(MINT, 1);
    expect(errors).toHaveLength(1);
  });
});

describe('OrderEngine.viewMint', () => {
  it('streams a viewed mint without orders and releases it after the viewer TTL', async () => {
    let now = 0;
    const s = new SqliteOrderStoreAdapter(':memory:');
    const f = new FakePriceFeed();
    const e = new OrderEngine(s, f, new FakeExecutor(), () => undefined, () => undefined, () => null, 20_000, () => now);
    await e.start();
    expect(await e.viewMint(MINT)).toBeNull();
    f.tick(MINT, 2);
    expect((await e.viewMint(MINT))?.priceUsd).toBe(2);
    expect(f.watchCalls).toBe(1);
    now = 4 * 60_000;
    e.sweepViewers();
    expect(f.listeners.has(MINT)).toBe(true); // still within TTL of the renewal
    now = 6 * 60_000;
    e.sweepViewers();
    expect(f.listeners.has(MINT)).toBe(false);
    e.stop();
  });

  it('keeps the stream for a viewer when an order on the mint finishes', async () => {
    await engine.viewMint(MINT);
    const o = await engine.createOrder('u1', limitBuy(1));
    engine.cancelOrder(o.id);
    expect(feed.listeners.has(MINT)).toBe(true);
  });
});

describe('OrderEngine.cancelOrder', () => {
  it('cancels active orders and rejects others', async () => {
    const o = await engine.createOrder('u1', limitBuy(1));
    expect(engine.cancelOrder(o.id).status).toBe('cancelled');
    expect(feed.listeners.has(MINT)).toBe(false);
    expect(() => engine.cancelOrder(o.id)).toThrow(/can no longer be cancelled/);
    expect(() => engine.cancelOrder('missing')).toThrow(OrderStateError);
  });
});

describe('OrderEngine.start recovery', () => {
  it('marks executing as unknown, re-queues triggered and re-watches mints', async () => {
    const s = new SqliteOrderStoreAdapter(':memory:');
    const parse = (v: number): ReturnType<typeof CreateOrderSchema.parse> => CreateOrderSchema.parse(limitBuy(v));
    const executing = s.create(parse(1), 'u1');
    s.transition(executing.id, ['open'], 'executing');
    const triggered = s.create(parse(1), 'u1');
    s.transition(triggered.id, ['open'], 'triggered');
    const f = new FakePriceFeed();
    const x = new FakeExecutor();
    const e = new OrderEngine(s, f, x, () => undefined, () => undefined);
    await e.start();
    await settle();
    expect(s.get(executing.id)).toMatchObject({ status: 'unknown' });
    expect(s.get(executing.id)?.lastError).toMatch(/restarted/);
    expect(s.get(triggered.id)?.status).toBe('filled');
    e.stop();
    expect(f.listeners.size).toBe(0);
  });

  it('reports watch failures during recovery without crashing', async () => {
    const s = new SqliteOrderStoreAdapter(':memory:');
    s.create(CreateOrderSchema.parse(limitBuy(1)), 'u1');
    const f = new FakePriceFeed();
    f.unsupported.add(MINT);
    const errs: unknown[] = [];
    await new OrderEngine(s, f, new FakeExecutor(), () => undefined, (err) => errs.push(err)).start();
    expect(errs[0]).toBeInstanceOf(UnsupportedPoolError);
  });

  it('keeps retrying a watch that failed at restart, then triggers the order (RPC busy, 2026-09-30)', async () => {
    vi.useFakeTimers();
    try {
      const s = new SqliteOrderStoreAdapter(':memory:');
      const order = s.create(CreateOrderSchema.parse(limitBuy(1)), 'u1');
      const f = new FakePriceFeed();
      let refuse = 2;
      const realWatch = f.watch.bind(f);
      f.watch = async (mint, l) => {
        if (refuse-- > 0) throw new Error('scan aborted: scan abandoned after waiting 17238ms for a scan slot');
        return realWatch(mint, l);
      };
      const errs: unknown[] = [];
      const x = new FakeExecutor();
      const e = new OrderEngine(s, f, x, () => undefined, (err) => errs.push(err));
      await e.start();
      expect(f.listeners.has(MINT)).toBe(false);
      await vi.advanceTimersByTimeAsync(REWATCH_MS); // second refusal
      expect(f.listeners.has(MINT)).toBe(false);
      await vi.advanceTimersByTimeAsync(REWATCH_MS); // watched now
      expect(f.listeners.has(MINT)).toBe(true);
      expect(errs).toHaveLength(2);
      f.tick(MINT, 0.5);
      await vi.advanceTimersByTimeAsync(0);
      expect(x.executed.map((o) => o.id)).toEqual([order.id]);
      const calls = f.watchCalls;
      await vi.advanceTimersByTimeAsync(REWATCH_MS * 3); // already watched: no more attempts
      expect(f.watchCalls).toBe(calls);
      e.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
