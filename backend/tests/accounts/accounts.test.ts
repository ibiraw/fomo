/**
 * @file accounts.test.ts
 * @description Accounts: storage, login/creation, wallets, legacy migration, per-account confirmers, and the
 *              order store / engine / holdings guard behaving per account.
 * @author Reborn1987
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteAccountStoreAdapter } from '../../src/adapters/storage/sqlite-account-store.adapter.js';
import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { AccountService, hashSecret } from '../../src/core/accounts/account-service.js';
import { WalletConfirmers } from '../../src/core/accounts/wallet-confirmers.js';
import { AuthError, LimitError, OrderStateError, ValidationError } from '../../src/core/errors.js';
import { HoldingsGuard, SOLD_OUT_REASON } from '../../src/core/orders/holdings-guard.js';
import { CreateOrderSchema } from '../../src/core/orders/order.js';
import { OrderEngine } from '../../src/core/orders/order-engine.js';
import { TradeConfirmerPort, type BalanceChange } from '../../src/ports/trade-confirmer.js';
import { FakeExecutor, FakePriceFeed } from '../helpers/fakes.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const SECRET_A = 'a'.repeat(43);
const SECRET_B = 'b'.repeat(43);
const SOL = 'JDY8BeQUPmcRZnYJGVBiU7x71SMbdUECW6NMUdGGKQDg';
const EVM = '0x59a1b6CC4Cfc711ce0fa70f48Fef4e4b7Dd2B103';
const buy = { mint: MINT, side: 'buy', trigger: { metric: 'price', direction: 'below', value: 1 }, amount: { kind: 'usd', value: 5 } };
const sell = { mint: MINT, side: 'sell', trigger: { metric: 'price', direction: 'above', value: 9 }, amount: { kind: 'percent', value: 100 } };

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('AccountService', () => {
  it('creates on first login when asked, finds it again, and rejects bad or unknown keys', () => {
    const store = new SqliteAccountStoreAdapter(':memory:', () => 5);
    const svc = new AccountService(store);
    expect(() => svc.login('short', true)).toThrow(AuthError);
    expect(() => svc.login(SECRET_A, false)).toThrow(/Unknown account key/);
    const first = svc.login(SECRET_A, true);
    expect(first.created).toBe(true);
    expect(first.account).toMatchObject({ wallets: { solana: null, evm: null }, createdAt: 5 });
    const again = svc.login(SECRET_A, true);
    expect(again).toEqual({ account: first.account, created: false });
    expect(store.findBySecretHash(hashSecret(SECRET_A))?.id).toBe(first.account.id);
    expect(svc.login(SECRET_B, true).account.id).not.toBe(first.account.id);
  });

  it('validates and saves wallets (EVM lowercased)', () => {
    const svc = new AccountService(new SqliteAccountStoreAdapter(':memory:'));
    const { account } = svc.login(SECRET_A, true);
    expect(svc.setWallets(account.id, { solana: SOL, evm: EVM }).wallets).toEqual({ solana: SOL, evm: EVM.toLowerCase() });
    expect(svc.wallets(account.id)).toEqual({ solana: SOL, evm: EVM.toLowerCase() });
    expect(svc.setWallets(account.id, { solana: null, evm: null }).wallets).toEqual({ solana: null, evm: null });
    expect(() => svc.setWallets(account.id, { solana: '0x1', evm: null })).toThrow(ValidationError);
    expect(() => svc.setWallets(account.id, { solana: SOL })).toThrow(ValidationError);
    expect(() => svc.setWallets('gone', { solana: null, evm: null })).toThrow(AuthError);
    expect(svc.wallets('gone')).toEqual({ solana: null, evm: null });
    expect(svc.delete(account.id)).toBe(true);
    expect(svc.delete(account.id)).toBe(false);
  });

  it('keeps the pre-accounts owner working: their pairing code logs into the legacy account and owns old orders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fomo-acc-'));
    dirs.push(dir);
    const path = join(dir, 'orders.db');
    // An old database: orders without an owner column.
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE orders (id TEXT PRIMARY KEY, mint TEXT NOT NULL, side TEXT NOT NULL, trigger_metric TEXT NOT NULL,
      trigger_direction TEXT NOT NULL, trigger_value REAL NOT NULL, amount_kind TEXT NOT NULL, amount_value REAL NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL, last_error TEXT,
      triggered_at_value REAL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    old.exec(`INSERT INTO orders VALUES ('o1', '${MINT}', 'buy', 'price', 'below', 1, 'usd', 5, 'open', 0, 3, NULL, NULL, 1, 1)`);
    old.close();

    const orders = new SqliteOrderStoreAdapter(path, Date.now, 'legacy');
    expect(orders.get('o1')?.userId).toBe('legacy');
    const accounts = new SqliteAccountStoreAdapter(path);
    const svc = new AccountService(accounts);
    const pairing = 'p'.repeat(32);
    svc.ensureLegacy('legacy', pairing, { solana: SOL, evm: null });
    svc.ensureLegacy('legacy', 'ignored-second-time-xxxxxxxxxxxxxxx', { solana: null, evm: null });
    expect(svc.login(pairing, false).account).toMatchObject({ id: 'legacy', wallets: { solana: SOL, evm: null } });
    orders.close();
    accounts.close();
  });
});

describe('SqliteOrderStoreAdapter per account', () => {
  it('filters by owner and deletes one owner\'s orders', () => {
    const store = new SqliteOrderStoreAdapter(':memory:');
    const input = CreateOrderSchema.parse(buy);
    const a = store.create(input, 'u1');
    store.create(input, 'u2');
    expect(store.list(undefined, 'u1').map((o) => o.id)).toEqual([a.id]);
    expect(store.list(['open'], 'u2')).toHaveLength(1);
    expect(store.deleteForUser('u2')).toBe(1);
    expect(store.list()).toHaveLength(1);
  });
});

/** Balance per mint, shared by whoever asks. */
class Wallet extends TradeConfirmerPort {
  balance = 0n;
  covers(): boolean { return true; }
  async snapshot(): Promise<bigint> { return this.balance; }
  async waitForChange(): Promise<BalanceChange | null> { return null; }
}

describe('WalletConfirmers', () => {
  it('builds once per account, only when it has wallets, and rebuilds after invalidate', () => {
    const wallets = new Map([['u1', { solana: SOL, evm: null }], ['u2', { solana: null, evm: null }]]);
    let builds = 0;
    const c = new WalletConfirmers((id) => wallets.get(id) ?? { solana: null, evm: null }, () => { builds++; return new Wallet(); });
    const first = c.for('u1');
    expect(first).not.toBeNull();
    expect(c.for('u1')).toBe(first);
    expect(c.for('u2')).toBeNull();
    c.invalidate('u1');
    expect(c.for('u1')).not.toBe(first);
    expect(builds).toBe(2);
  });
});

describe('OrderEngine per account', () => {
  const setup = (max = 25) => {
    const store = new SqliteOrderStoreAdapter(':memory:');
    const feed = new FakePriceFeed();
    const exec = new FakeExecutor();
    const wallets = new Map<string, Wallet>();
    const engine = new OrderEngine(store, feed, exec, () => undefined, () => undefined, (id) => wallets.get(id) ?? null, 20_000, Date.now, max);
    return { store, feed, exec, engine, wallets };
  };

  it('keeps accounts apart: listing, cancelling and wallets', async () => {
    const { engine, wallets } = setup();
    const a = await engine.createOrder('u1', buy);
    await engine.createOrder('u2', buy);
    expect(engine.listOrders('u1').map((o) => o.id)).toEqual([a.id]);
    expect(engine.listOrders()).toHaveLength(2);
    expect(() => engine.cancelOrder(a.id, undefined, 'u2')).toThrow(OrderStateError);
    expect(engine.cancelOrder(a.id, undefined, 'u1').status).toBe('cancelled');

    const w = new Wallet();
    wallets.set('u1', w);
    await expect(engine.createOrder('u1', sell)).rejects.toThrow(/don't hold this token/);
    await expect(engine.createOrder('u2', sell)).resolves.toMatchObject({ userId: 'u2' }); // no wallet on record: not checked
    w.balance = 5n;
    expect(await engine.holds('u1', MINT)).toBe(true);
    expect(await engine.holds('u2', MINT)).toBeNull();
  });

  it('caps open orders per account', async () => {
    const { engine } = setup(2);
    await engine.createOrder('u1', buy);
    await engine.createOrder('u1', buy);
    await expect(engine.createOrder('u1', buy)).rejects.toThrow(LimitError);
    await expect(engine.createOrder('u2', buy)).resolves.toBeTruthy();
  });

  it("runs each account's trades on its own queue", async () => {
    const { engine, feed, exec } = setup();
    let release: () => void = () => undefined;
    exec.gate = new Promise<void>((r) => { release = r; });
    await engine.createOrder('u1', buy);
    await engine.createOrder('u2', buy);
    feed.tick(MINT, 0.5);
    await new Promise((r) => setTimeout(r, 10));
    expect(exec.executed.map((o) => o.userId).sort()).toEqual(['u1', 'u2']); // both started, neither waits for the other
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.listOrders().every((o) => o.status === 'filled')).toBe(true);
  });

  it('deletes an account\'s orders and stops watching tokens nobody needs', async () => {
    const { engine, feed } = setup();
    await engine.createOrder('u1', buy);
    await engine.createOrder('u1', sell);
    expect(feed.listeners.has(MINT)).toBe(true);
    expect(engine.deleteUserOrders('u1')).toBe(2);
    expect(engine.listOrders('u1')).toEqual([]);
    expect(feed.listeners.has(MINT)).toBe(false);
  });
});

describe('HoldingsGuard per account', () => {
  it("cancels only the sold-out account's sells", async () => {
    const store = new SqliteOrderStoreAdapter(':memory:');
    const engine = new OrderEngine(store, new FakePriceFeed(), new FakeExecutor(), () => undefined, () => undefined);
    const w1 = new Wallet();
    const w2 = new Wallet();
    const lookup = (id: string) => (id === 'u1' ? w1 : id === 'u2' ? w2 : null);
    const guard = new HoldingsGuard(engine, lookup, 60_000, () => undefined);
    const s1 = await engine.createOrder('u1', sell);
    const s2 = await engine.createOrder('u2', sell);
    await engine.createOrder('u3', sell); // no wallet: never checked
    w1.balance = 1n;
    w2.balance = 1n;
    await guard.sweep();
    w1.balance = 0n;
    await guard.sweep();
    expect(store.get(s1.id)).toMatchObject({ status: 'cancelled', lastError: SOLD_OUT_REASON });
    expect(store.get(s2.id)?.status).toBe('open');
  });
});
