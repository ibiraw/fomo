/**
 * @file holdings-guard.test.ts
 * @description Tests for HoldingsGuard: cancels open sells after a sell-out, never before the token was held.
 * @author Reborn1987
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { HoldingsGuard, SOLD_OUT_REASON } from '../../src/core/orders/holdings-guard.js';
import { OrderEngine } from '../../src/core/orders/order-engine.js';
import { TradeConfirmerPort, type BalanceChange } from '../../src/ports/trade-confirmer.js';
import { FakeExecutor, FakePriceFeed } from '../helpers/fakes.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';

/** Wallet with a settable balance per mint. */
class FakeWallet extends TradeConfirmerPort {
  balances = new Map<string, bigint>();
  fail = false;
  covered = true;
  covers(): boolean { return this.covered; }
  async snapshot(mint: string): Promise<bigint> {
    if (this.fail) throw new Error('rpc down');
    return this.balances.get(mint) ?? 0n;
  }
  async waitForChange(): Promise<BalanceChange | null> { return null; }
}

const sell = (value: number) => ({ mint: MINT, side: 'sell', trigger: { metric: 'price', direction: 'above', value }, amount: { kind: 'percent', value: 100 } });
const buy = { mint: MINT, side: 'buy', trigger: { metric: 'price', direction: 'below', value: 0.1 }, amount: { kind: 'usd', value: 5 } };

let store: SqliteOrderStoreAdapter;
let engine: OrderEngine;
let wallet: FakeWallet;
let guard: HoldingsGuard;
let errors: unknown[];

beforeEach(async () => {
  store = new SqliteOrderStoreAdapter(':memory:');
  engine = new OrderEngine(store, new FakePriceFeed(), new FakeExecutor(), () => undefined, () => undefined);
  await engine.start();
  wallet = new FakeWallet();
  errors = [];
  guard = new HoldingsGuard(engine, () => wallet, 60_000, (e) => errors.push(e), 5);
});

describe('HoldingsGuard', () => {
  it('cancels open sells (not buys) after two zero-balance reads in a row', async () => {
    wallet.balances.set(MINT, 1000n);
    const tp = await engine.createOrder('u1', sell(10));
    const sl = await engine.createOrder('u1', { ...sell(0.5), trigger: { metric: 'price', direction: 'below', value: 0.5 } });
    const b = await engine.createOrder('u1', buy);
    await guard.sweep();
    expect(store.get(tp.id)?.status).toBe('open');
    wallet.balances.set(MINT, 0n);
    await guard.sweep(); // first zero: not yet
    expect(store.get(tp.id)?.status).toBe('open');
    await vi.waitFor(() => expect(store.get(tp.id)).toMatchObject({ status: 'cancelled', lastError: SOLD_OUT_REASON })); // confirmed a moment later
    expect(store.get(sl.id)?.status).toBe('cancelled');
    expect(store.get(b.id)?.status).toBe('open');
  });

  it('ignores a single glitchy zero read', async () => {
    wallet.balances.set(MINT, 1000n);
    const tp = await engine.createOrder('u1', sell(10));
    wallet.balances.set(MINT, 0n);
    await guard.sweep();
    wallet.balances.set(MINT, 1000n); // back before the confirming read
    await new Promise((r) => setTimeout(r, 20));
    await guard.sweep();
    expect(store.get(tp.id)?.status).toBe('open');
    guard.stop();
  });

  it('cancels sells placed without a balance check once wallets show none (no "seen held" needed after restarts)', async () => {
    const tp = await engine.createOrder('u1', sell(10)); // the wallet reads 0 but the fake is created after the order check
    await guard.sweep();
    await guard.sweep();
    expect(store.get(tp.id)?.status).toBe('cancelled');
  });

  it('re-checks when an order on the mint changes (e.g. a sell filled)', async () => {
    wallet.balances.set(MINT, 5n);
    const tp = await engine.createOrder('u1', sell(10));
    await guard.check('u1', MINT);
    wallet.balances.set(MINT, 0n);
    guard.onOrderChanged(tp);
    await vi.waitFor(() => expect(store.get(tp.id)?.status).toBe('cancelled'));
    guard.onOrderChanged({ ...tp, mint: 'other' }); // no open sells there: ignored
  });

  it('reports RPC errors and orders that can no longer be cancelled', async () => {
    wallet.fail = true;
    await engine.createOrder('u1', sell(10));
    await guard.sweep();
    expect(errors).toHaveLength(1);
    wallet.fail = false;
    wallet.balances.set(MINT, 5n);
    const tp = await engine.createOrder('u1', sell(11));
    await guard.check('u1', MINT);
    wallet.balances.set(MINT, 0n);
    const real = engine.cancelOrder.bind(engine);
    engine.cancelOrder = (id: string) => { if (id === tp.id) throw new Error('already executing'); return real(id); };
    await guard.check('u1', MINT);
    await guard.check('u1', MINT);
    expect(errors.at(-1)).toBeInstanceOf(Error);
  });

  it('starts and stops its timer', () => {
    guard.start();
    guard.stop();
    guard.stop();
  });
});
