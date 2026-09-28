/**
 * @file market-orders.test.ts
 * @description v2.0.0 quick (market) orders: the schema (no trigger, limited retries, orders without a kind stay
 *              limit orders), trading right away with or without a price yet, one slippage retry, storage and
 *              migration of the kind column, and how they read in monitoring.
 * @author Reborn1987
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { describeOrder } from '../../src/core/monitoring/describe.js';
import { CreateOrderSchema, isTriggered, MARKET_MAX_ATTEMPTS } from '../../src/core/orders/order.js';
import { OrderEngine } from '../../src/core/orders/order-engine.js';
import { FakeExecutor, FakePriceFeed } from '../helpers/fakes.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const quickBuy = (usd = 50): Record<string, unknown> => ({ kind: 'market', mint: MINT, side: 'buy', amount: { kind: 'usd', value: usd } });
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('CreateOrderSchema', () => {
  it('reads orders without a kind as limit orders, and market orders without a trigger', () => {
    const limit = CreateOrderSchema.parse({ mint: MINT, side: 'buy', trigger: { metric: 'price', direction: 'below', value: 1 }, amount: { kind: 'usd', value: 5 } });
    expect(limit.kind).toBe('limit');
    const market = CreateOrderSchema.parse(quickBuy());
    expect(market).toMatchObject({ kind: 'market', trigger: { metric: 'price', direction: 'above', value: 0, supply: null }, maxAttempts: MARKET_MAX_ATTEMPTS });
  });

  it('rejects a market order with a trigger, too many retries, or a tiny amount', () => {
    expect(CreateOrderSchema.safeParse({ ...quickBuy(), trigger: { metric: 'price', direction: 'below', value: 1 } }).success).toBe(false);
    expect(CreateOrderSchema.safeParse({ ...quickBuy(), maxAttempts: 5 }).success).toBe(false);
    expect(CreateOrderSchema.safeParse(quickBuy(1)).success).toBe(false);
    expect(CreateOrderSchema.safeParse({ ...quickBuy(), kind: 'stop' }).success).toBe(false);
  });

  it('treats a market order as always triggered', () => {
    const tick = { mint: MINT, priceUsd: 5, marketCapUsd: 5e6, source: 'pump-curve', receivedAt: 0 } as const;
    expect(isTriggered({ kind: 'market', trigger: { metric: 'price', direction: 'below', value: 1, supply: null } }, tick)).toBe(true);
    expect(isTriggered({ kind: 'limit', trigger: { metric: 'price', direction: 'below', value: 1, supply: null } }, tick)).toBe(false);
  });
});

describe('OrderEngine market orders', () => {
  let store: SqliteOrderStoreAdapter;
  let feed: FakePriceFeed;
  let exec: FakeExecutor;
  let engine: OrderEngine;

  beforeEach(async () => {
    store = new SqliteOrderStoreAdapter(':memory:');
    feed = new FakePriceFeed();
    exec = new FakeExecutor();
    engine = new OrderEngine(store, feed, exec, () => undefined, () => undefined);
    await engine.start();
  });

  it('trades right away, even before the first price, and records the value it was placed at when known', async () => {
    const first = await engine.createOrder('u1', quickBuy());
    expect(first.status).toBe('triggered');
    await settle();
    expect(store.get(first.id)).toMatchObject({ status: 'filled', kind: 'market', triggeredAtValue: null });
    // A waiting limit order keeps the token's price stream open, so the next quick buy knows the price.
    await engine.createOrder('u1', { mint: MINT, side: 'buy', trigger: { metric: 'price', direction: 'below', value: 1 }, amount: { kind: 'usd', value: 5 } });
    feed.tick(MINT, 2);
    const second = await engine.createOrder('u1', quickBuy(20));
    await settle();
    expect(store.get(second.id)).toMatchObject({ status: 'filled', triggeredAtValue: 2 });
    expect(exec.executed.map((o) => o.kind)).toEqual(['market', 'market']); // the limit order is still waiting
  });

  it('retries a slippage failure once, then fails', async () => {
    exec.results.push({ ok: false, kind: 'slippage', message: 'slippage' }, { ok: false, kind: 'slippage', message: 'slippage' });
    const o = await engine.createOrder('u1', quickBuy());
    await settle();
    feed.tick(MINT, 1); // the re-armed order triggers again on the next price
    await settle();
    expect(store.get(o.id)).toMatchObject({ status: 'failed', attempts: 2 });
  });
});

describe('order kind storage', () => {
  it('adds the kind column to an older database, keeping its orders as limit orders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orders-'));
    const file = join(dir, 'orders.db');
    try {
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE orders (id TEXT PRIMARY KEY, mint TEXT NOT NULL, side TEXT NOT NULL, trigger_metric TEXT NOT NULL,
        trigger_direction TEXT NOT NULL, trigger_value REAL NOT NULL, amount_kind TEXT NOT NULL, amount_value REAL NOT NULL,
        status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL, last_error TEXT,
        triggered_at_value REAL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, trigger_supply REAL, user_id TEXT)`);
      old.exec(`INSERT INTO orders VALUES ('o1','${MINT}','buy','price','below',1,'usd',5,'open',0,3,NULL,NULL,1,1,NULL,'u1')`);
      old.close();
      const store = new SqliteOrderStoreAdapter(file);
      expect(store.get('o1')?.kind).toBe('limit');
      const market = store.create(CreateOrderSchema.parse(quickBuy()), 'u1');
      expect(store.get(market.id)?.kind).toBe('market');
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('monitoring text for quick trades', () => {
  it('reads ⚡ QUICK BUY / QUICK SELL with the value it was placed at', () => {
    const base = { id: 'o', userId: 'u', mint: 'base:0x' + 'a'.repeat(40), side: 'buy', kind: 'market', trigger: { metric: 'price', direction: 'above', value: 0, supply: null }, amount: { kind: 'usd', value: 50 }, status: 'open', attempts: 0, maxAttempts: 2, lastError: null, triggeredAtValue: null, createdAt: 0, updatedAt: 0 } as const;
    expect(describeOrder(base, 'LM-2', 0.0015)).toMatch(/⚡ placed \*\*QUICK BUY\*\* \$50[\s\S]*📊 current price = \$\S+$/);
    expect(describeOrder({ ...base, side: 'sell', amount: { kind: 'percent', value: 50 } }, 'LM-2')).toMatch(/⚡ placed \*\*QUICK SELL\*\* 50%\n\n💙 0xa+$/);
  });
});
