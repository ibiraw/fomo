/**
 * @file sqlite-order-store.test.ts
 * @description Tests for SqliteOrderStoreAdapter: create/get/list (status, user, mint filters) and compare-and-set transitions.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { CreateOrderSchema } from '../../src/core/orders/order.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const RAW = { mint: MINT, side: 'buy', trigger: { metric: 'marketCap', direction: 'below', value: 3000 }, amount: { kind: 'usd', value: 5 } };
const input = CreateOrderSchema.parse(RAW);

describe('SqliteOrderStoreAdapter', () => {
  it('creates and reads back an open order', () => {
    const store = new SqliteOrderStoreAdapter(':memory:', () => 1000);
    const o = store.create(input, 'u1');
    expect(o).toMatchObject({
      mint: MINT, side: 'buy', status: 'open', attempts: 0, maxAttempts: 5, lastError: null, triggeredAtValue: null,
      trigger: { metric: 'marketCap', direction: 'below', value: 3000 }, amount: { kind: 'usd', value: 5 }, createdAt: 1000,
    });
    expect(store.get(o.id)).toEqual(o);
    expect(store.get('nope')).toBeNull();
    store.close();
  });

  it('lists all or by status, newest first', () => {
    let t = 0;
    const store = new SqliteOrderStoreAdapter(':memory:', () => ++t);
    const a = store.create(input, 'u1');
    const b = store.create(input, 'u1');
    store.transition(a.id, ['open'], 'cancelled');
    expect(store.list().map((o) => o.id)).toEqual([b.id, a.id]);
    expect(store.list(['open']).map((o) => o.id)).toEqual([b.id]);
    expect(store.list([])).toHaveLength(2);
  });

  it('filters by mint (with status and user) for per-tick lookups', () => {
    const store = new SqliteOrderStoreAdapter(':memory:');
    const other = { ...input, mint: CreateOrderSchema.parse({ ...RAW, mint: 'base:0x0cbf291ba052174879d90bf781df1a5f2bc5bb07' }).mint };
    const a = store.create(input, 'u1');
    const b = store.create(other, 'u1');
    const c = store.create(input, 'u2');
    store.transition(c.id, ['open'], 'cancelled');
    expect(store.list(['open'], undefined, MINT).map((o) => o.id)).toEqual([a.id]);
    expect(store.list(undefined, undefined, other.mint).map((o) => o.id)).toEqual([b.id]);
    expect(store.list(undefined, 'u2', MINT).map((o) => o.id)).toEqual([c.id]);
    expect(store.list(['open'], undefined, 'nothing')).toEqual([]);
  });

  it('transitions only from allowed statuses and applies the patch', () => {
    const store = new SqliteOrderStoreAdapter(':memory:');
    const o = store.create(input, 'u1');
    const t = store.transition(o.id, ['open'], 'triggered', { triggeredAtValue: 2900, attempts: 1, lastError: 'x' });
    expect(t).toMatchObject({ status: 'triggered', triggeredAtValue: 2900, attempts: 1, lastError: 'x' });
    expect(store.transition(o.id, ['open'], 'triggered')).toBeNull(); // already moved — CAS fails
    expect(store.transition('missing', ['open'], 'cancelled')).toBeNull();
  });

  it('stores a trailing stop as a limit row and reads it back as trailing; raises only higher highs while open', () => {
    const store = new SqliteOrderStoreAdapter(':memory:');
    const t = store.create(CreateOrderSchema.parse({
      kind: 'trailing', mint: MINT, side: 'sell', metric: 'price', trailPct: 20, reference: 10, amount: { kind: 'percent', value: 100 },
    }), 'u1', 'auto');
    expect(t).toMatchObject({ kind: 'trailing', trailPct: 20, peak: 10, source: 'auto', trigger: { direction: 'below', value: 8 } });
    expect(store.raisePeak(t.id, 9, 7.2)).toBeNull(); // lower high
    expect(store.raisePeak(t.id, 20, 16)).toMatchObject({ peak: 20, trigger: { value: 16 } });
    store.transition(t.id, ['open'], 'triggered');
    expect(store.raisePeak(t.id, 30, 24)).toBeNull(); // not open
    expect(store.create(input, 'u1')).toMatchObject({ kind: 'limit', trailPct: null, peak: null, source: 'user' });
  });
});
