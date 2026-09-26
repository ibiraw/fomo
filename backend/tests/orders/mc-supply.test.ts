/**
 * @file mc-supply.test.ts
 * @description Tests for market-cap triggers that use fomo's displayed supply, and the DB migration.
 * @author Reborn1987
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { CreateOrderSchema, isTriggered, metricValue } from '../../src/core/orders/order.js';
import type { PriceTick } from '../../src/ports/price-feed.js';

const MINT = '92hjfSi5HrUgUpPWvgKtVrz2MQn2zJrAPQSRzdjmpump';
// On-chain supply 956.9M gives MC $106.6K; fomo shows supply 999.9M => MC $111.3K at the same price.
const tick: PriceTick = { mint: MINT, priceUsd: 0.00011136, marketCapUsd: 106_555, source: 'pump-swap', receivedAt: 0 };

describe('market cap with fomo supply', () => {
  it('uses the order supply when present, the feed MC otherwise', () => {
    expect(metricValue({ trigger: { metric: 'marketCap', supply: 999_900_000 } }, tick)).toBeCloseTo(111_349, 0);
    expect(metricValue({ trigger: { metric: 'marketCap', supply: null } }, tick)).toBe(106_555);
    expect(metricValue({ trigger: { metric: 'price', supply: 999_900_000 } }, tick)).toBe(0.00011136);
  });

  it('fires a take-profit when fomo\u2019s MC crosses, even if on-chain-supply MC has not', () => {
    const tp = { trigger: { metric: 'marketCap' as const, direction: 'above' as const, value: 106_806 } };
    expect(isTriggered({ trigger: { ...tp.trigger, supply: null } }, tick)).toBe(false);
    expect(isTriggered({ trigger: { ...tp.trigger, supply: 999_900_000 } }, tick)).toBe(true);
  });

  it('defaults supply to null and stores it', () => {
    const store = new SqliteOrderStoreAdapter(':memory:');
    const base = { mint: MINT, side: 'sell', amount: { kind: 'percent', value: 100 } };
    const a = store.create(CreateOrderSchema.parse({ ...base, trigger: { metric: 'marketCap', direction: 'above', value: 1 } }));
    const b = store.create(CreateOrderSchema.parse({ ...base, trigger: { metric: 'marketCap', direction: 'above', value: 1, supply: 999_900_000 } }));
    expect(a.trigger.supply).toBeNull();
    expect(b.trigger.supply).toBe(999_900_000);
  });

  it('migrates an existing database without the supply column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fomo-mig-'));
    try {
      const path = join(dir, 'orders.db');
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE orders (id TEXT PRIMARY KEY, mint TEXT NOT NULL, side TEXT NOT NULL, trigger_metric TEXT NOT NULL,
        trigger_direction TEXT NOT NULL, trigger_value REAL NOT NULL, amount_kind TEXT NOT NULL, amount_value REAL NOT NULL,
        status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL, last_error TEXT,
        triggered_at_value REAL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        INSERT INTO orders VALUES ('o1','${MINT}','buy','price','below',1,'usd',5,'open',0,3,NULL,NULL,1,1);`);
      old.close();
      const store = new SqliteOrderStoreAdapter(path);
      expect(store.get('o1')?.trigger.supply).toBeNull();
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
