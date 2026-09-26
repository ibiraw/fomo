/**
 * @file chain-confirmation.test.ts
 * @description Tests for WalletTradeConfirmer and the engine's on-chain confirmation path.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { OrderEngine } from '../../src/core/orders/order-engine.js';
import { WalletTradeConfirmer } from '../../src/core/orders/wallet-trade-confirmer.js';
import { FakeAccounts } from '../helpers/fake-accounts.js';
import { FakeExecutor, FakePriceFeed } from '../helpers/fakes.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const WALLET = 'JDY8BeQUPmcRZnYJGVBiU7x71SMbdUECW6NMUdGGKQDg';
const KEY = `${WALLET}|${MINT}`;
const BUY = { mint: MINT, side: 'buy', trigger: { metric: 'price', direction: 'below', value: 1 }, amount: { kind: 'usd', value: 3 } };

const settle = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Engine with a confirmer on FakeAccounts. */
async function setup(graceMs = 200) {
  const accounts = new FakeAccounts();
  const store = new SqliteOrderStoreAdapter(':memory:');
  const feed = new FakePriceFeed();
  const exec = new FakeExecutor();
  const errors: unknown[] = [];
  const confirmer = new WalletTradeConfirmer(accounts, WALLET, 5, (e) => errors.push(e));
  const engine = new OrderEngine(store, feed, exec, () => undefined, (e) => errors.push(e), confirmer, graceMs);
  await engine.start();
  return { accounts, store, feed, exec, engine, confirmer, errors };
}

describe('WalletTradeConfirmer', () => {
  it('detects buys (balance up) and sells (balance down), and stops on abort', async () => {
    const { accounts, confirmer } = await setup();
    accounts.balances.set(KEY, 100n);
    const ab = new AbortController();
    const buy = confirmer.waitForChange(MINT, 100n, 'buy', ab.signal);
    accounts.balances.set(KEY, 150n);
    expect(await buy).toEqual({ before: 100n, after: 150n });
    const sell = confirmer.waitForChange(MINT, 150n, 'sell', ab.signal);
    accounts.balances.set(KEY, 0n);
    expect(await sell).toEqual({ before: 150n, after: 0n });
    const never = confirmer.waitForChange(MINT, 0n, 'sell', ab.signal);
    ab.abort();
    expect(await never).toBeNull();
  });

  it('keeps polling through RPC errors', async () => {
    const { accounts, confirmer, errors } = await setup();
    let calls = 0;
    accounts.getTokenBalance = async () => { if (calls++ === 0) throw new Error('rpc down'); return 5n; };
    expect(await confirmer.waitForChange(MINT, 0n, 'buy', new AbortController().signal)).toEqual({ before: 0n, after: 5n });
    expect(errors).toHaveLength(1);
  });
});

describe('OrderEngine sell orders need a balance', () => {
  const SELL = { mint: MINT, side: 'sell', trigger: { metric: 'price', direction: 'above', value: 9 }, amount: { kind: 'percent', value: 50 } };

  it('refuses a take profit / stop loss on a token the wallet does not hold', async () => {
    const { engine, store } = await setup();
    await expect(engine.createOrder(SELL)).rejects.toThrow(/don't hold this token/);
    expect(store.list()).toHaveLength(0);
  });

  it('accepts it once the wallet holds the token, and never checks buys', async () => {
    const { accounts, engine } = await setup();
    await expect(engine.createOrder(BUY)).resolves.toMatchObject({ side: 'buy' });
    accounts.balances.set(KEY, 5n);
    await expect(engine.createOrder(SELL)).resolves.toMatchObject({ side: 'sell' });
  });

  it('reports whether the wallet holds a token (null without a wallet)', async () => {
    const { accounts, engine } = await setup();
    expect(await engine.holds(MINT)).toBe(false);
    accounts.balances.set(KEY, 1n);
    expect(await engine.holds(MINT)).toBe(true);
    const bare = new OrderEngine(new SqliteOrderStoreAdapter(':memory:'), new FakePriceFeed(), new FakeExecutor(), () => undefined, () => undefined);
    expect(await bare.holds(MINT)).toBeNull();
  });

  it('explains when the balance cannot be checked', async () => {
    const { accounts, engine } = await setup();
    accounts.getTokenBalance = async () => { throw new Error('rpc down'); };
    await expect(engine.createOrder(SELL)).rejects.toThrow(/Couldn't check your balance.*rpc down/);
  });
});

describe('OrderEngine on-chain confirmation', () => {
  it('rescues a UI "unknown" result when the wallet balance moved', async () => {
    const { accounts, store, feed, exec, engine } = await setup();
    let release!: () => void;
    exec.gate = new Promise((r) => (release = r));
    exec.results.push({ ok: false, kind: 'unknown', message: 'could not confirm' });
    const o = await engine.createOrder(BUY);
    feed.tick(MINT, 1);
    await settle(10);
    accounts.balances.set(KEY, 713_788n); // the buy landed on-chain
    await settle(30);
    expect(store.get(o.id)?.status).toBe('filled'); // marked filled before the UI even answered
    release();
    await settle(10);
    expect(store.get(o.id)?.status).toBe('filled');
  });

  it('keeps unknown when the chain shows nothing within the grace period', async () => {
    const { store, feed, exec, engine } = await setup(30);
    exec.results.push({ ok: false, kind: 'timeout', message: 'no answer' });
    const o = await engine.createOrder(BUY);
    feed.tick(MINT, 1);
    await settle(80);
    expect(store.get(o.id)?.status).toBe('unknown');
  });

  it('trusts definite UI failures and UI successes', async () => {
    const { store, feed, exec, engine } = await setup();
    exec.results.push({ ok: false, kind: 'insufficient_funds', message: 'no cash' });
    const o = await engine.createOrder(BUY);
    feed.tick(MINT, 1);
    await settle(20);
    expect(store.get(o.id)?.status).toBe('failed');
    const p = await engine.createOrder(BUY);
    feed.tick(MINT, 1);
    await settle(20);
    expect(store.get(p.id)?.status).toBe('filled');
  });

  it('falls back to UI-only confirmation when the snapshot fails', async () => {
    const { accounts, store, feed, engine, errors } = await setup();
    accounts.getTokenBalance = async () => { throw new Error('rpc down'); };
    const o = await engine.createOrder(BUY);
    feed.tick(MINT, 1);
    await settle(20);
    expect(store.get(o.id)?.status).toBe('filled');
    expect(errors.length).toBeGreaterThan(0);
  });
});
