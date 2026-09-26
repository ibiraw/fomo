/**
 * @file sqlite-order-store.test.ts
 * @description Tests for SqliteOrderStoreAdapter: create/get/list and compare-and-set transitions.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { CreateOrderSchema } from '../../src/core/orders/order.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const input = CreateOrderSchema.parse({
  mint: MINT, side: 'buy', trigger: { metric: 'marketCap', direction: 'below', value: 3000 }, amount: { kind: 'usd', value: 5 },
});

describe('SqliteOrderStoreAdapter', () => {
  it('creates and reads back an open order', () => {
    const store = new SqliteOrderStoreAdapter(':memory:', () => 1000);
    const o = store.create(input);
    expect(o).toMatchObject({
      mint: MINT, side: 'buy', status: 'open', attempts: 0, maxAttempts: 3, lastError: null, triggeredAtValue: null,
      trigger: { metric: 'marketCap', direction: 'below', value: 3000 }, amount: { kind: 'usd', value: 5 }, createdAt: 1000,
    });
    expect(store.get(o.id)).toEqual(o);
    expect(store.get('nope')).toBeNull();
    store.close();
  });

  it('lists all or by status, newest first', () => {
    let t = 0;
    const store = new SqliteOrderStoreAdapter(':memory:', () => ++t);
    const a = store.create(input);
    const b = store.create(input);
    store.transition(a.id, ['open'], 'cancelled');
    expect(store.list().map((o) => o.id)).toEqual([b.id, a.id]);
    expect(store.list(['open']).map((o) => o.id)).toEqual([b.id]);
    expect(store.list([])).toHaveLength(2);
  });

  it('transitions only from allowed statuses and applies the patch', () => {
    const store = new SqliteOrderStoreAdapter(':memory:');
    const o = store.create(input);
    const t = store.transition(o.id, ['open'], 'triggered', { triggeredAtValue: 2900, attempts: 1, lastError: 'x' });
    expect(t).toMatchObject({ status: 'triggered', triggeredAtValue: 2900, attempts: 1, lastError: 'x' });
    expect(store.transition(o.id, ['open'], 'triggered')).toBeNull(); // already moved — CAS fails
    expect(store.transition('missing', ['open'], 'cancelled')).toBeNull();
  });
});
