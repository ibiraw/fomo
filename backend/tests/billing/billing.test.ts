/**
 * @file billing.test.ts
 * @description Paywall: trial gate, quotes, matching payments (sender wallet / payment code), token discount,
 *              unlocks, duplicates, and the EVM + Solana payment watchers.
 * @author Reborn1987
 */

import { describe, expect, it, vi } from 'vitest';

import { transferFrom } from '../../src/adapters/solana/kit-solana-transfers.adapter.js';
import { SqliteAccountStoreAdapter } from '../../src/adapters/storage/sqlite-account-store.adapter.js';
import { SqliteBillingStoreAdapter } from '../../src/adapters/storage/sqlite-billing-store.adapter.js';
import { BillingService, INVOICE_TTL_MS, PaymentRequiredError, transactionIdIn, type IncomingTransfer } from '../../src/core/billing/billing-service.js';
import { EvmPaymentWatcher, TRANSFER_TOPIC } from '../../src/core/billing/evm-payment-watcher.js';
import { STABLE_ASSETS, type PaymentAsset } from '../../src/core/billing/payment-assets.js';
import { slotCursor, SolanaPaymentWatcher } from '../../src/core/billing/solana-payment-watcher.js';
import type { EvmLog, Hex } from '../../src/ports/evm-rpc.js';
import { SolanaTransfersPort, type SolanaIncoming, type SolanaTransfer } from '../../src/ports/solana-transfers.js';
import { FakeEvmRpc } from '../helpers/fake-evm.js';

const SOL_TREASURY = 'TreasuryXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1';
const EVM_TREASURY = '0x' + 't'.repeat(0) + 'a'.repeat(40);
const USER_SOL = 'JDY8BeQUPmcRZnYJGVBiU7x71SMbdUECW6NMUdGGKQDg';
const USER_EVM = '0x59a1b6cc4cfc711ce0fa70f48fef4e4b7dd2b103';
const STRANGER = '0x' + '9'.repeat(40);
const asset = (chain: string, symbol = 'USDC') => STABLE_ASSETS.find((a) => a.chain === chain && a.symbol === symbol)!;
const TOKEN: PaymentAsset = { chain: 'base', address: '0x' + '7'.repeat(40), symbol: 'AUTO', decimals: 18, kind: 'token' };
const PLAN = { priceUsd: 50, tokenPriceUsd: 35, freeOrders: 3, periodDays: 30 };
const DAY = 86_400_000;

/** USD amount → raw units. */
const raw = (amount: number, decimals: number): bigint => BigInt(Math.round(amount * 1e6)) * 10n ** BigInt(decimals) / 1_000_000n;

function setup(opts: { token?: boolean; tokenPrice?: number | null } = {}) {
  let t = 1_000;
  const accounts = new SqliteAccountStoreAdapter(':memory:', () => t);
  const store = new SqliteBillingStoreAdapter(':memory:');
  const used = new Map<string, { filled: number; waiting: number }>();
  const changed: string[] = [];
  const free = new Map<string, number>();
  let price: number | null = opts.tokenPrice === undefined ? 0.01 : opts.tokenPrice;
  const svc = new BillingService(
    store, accounts, PLAN, { solana: SOL_TREASURY, evm: EVM_TREASURY }, STABLE_ASSETS, opts.token ? TOKEN : null,
    () => price, (id) => used.get(id) ?? { filled: 0, waiting: 0 }, (id) => changed.push(id), () => t, (id) => free.get(id) ?? null,
  );
  const alice = accounts.create('h1', { solana: USER_SOL, evm: USER_EVM });
  const bob = accounts.create('h2', { solana: null, evm: null });
  const pay = (p: Partial<IncomingTransfer> & { amount: number; asset: PaymentAsset }): string | null =>
    svc.receive({ chain: p.asset.chain, txId: p.txId ?? `tx${Math.random()}`, from: p.from ?? STRANGER, asset: p.asset, amountRaw: raw(p.amount, p.asset.decimals) }).userId;
  return { svc, store, accounts, used, changed, free, alice, bob, pay, advance: (ms: number) => { t += ms; }, setPrice: (v: number | null) => { price = v; } };
}

describe('BillingService free periods (friends)', () => {
  it('is active until the free date without counting as paid, then falls back to the trial', () => {
    const { svc, used, free, alice, advance } = setup();
    used.set(alice.id, { filled: 3, waiting: 0 });
    expect(() => svc.assertCanPlaceOrder(alice.id)).toThrow(PaymentRequiredError);
    free.set(alice.id, 1_000 + 10 * DAY);
    expect(() => svc.assertCanPlaceOrder(alice.id)).not.toThrow();
    expect(svc.status(alice.id)).toMatchObject({ unlocked: true, everPaid: false, paidUntil: 1_000 + 10 * DAY });
    advance(10 * DAY);
    expect(svc.status(alice.id)).toMatchObject({ unlocked: false, everPaid: false, paidUntil: 1_000 + 10 * DAY });
    expect(() => svc.assertCanPlaceOrder(alice.id)).toThrow(/free orders/);
  });

  it('adds a payment made during a free period after it ends, so no days are lost', () => {
    const { svc, free, alice, pay } = setup();
    free.set(alice.id, 1_000 + 10 * DAY);
    expect(pay({ amount: 50, asset: asset('base'), from: USER_EVM })).toBe(alice.id);
    expect(svc.status(alice.id)).toMatchObject({ unlocked: true, everPaid: true, paidUntil: 1_000 + 40 * DAY });
  });
});

describe('BillingService trial', () => {
  it('uses a free order per fill, holds one per waiting order, then asks for payment; unlocked accounts are never blocked', () => {
    const { svc, used, alice } = setup();
    expect(svc.status(alice.id)).toEqual({
      unlocked: false, permanent: false, paidUntil: null, everPaid: false, periodDays: 30,
      freeOrdersLeft: 3, freeOrdersWaiting: 0, creditUsd: 0, priceUsd: 50, tokenPriceUsd: 35,
    });
    used.set(alice.id, { filled: 1, waiting: 1 });
    expect(svc.status(alice.id)).toMatchObject({ freeOrdersLeft: 2, freeOrdersWaiting: 1 });
    expect(() => svc.assertCanPlaceOrder(alice.id)).not.toThrow();
    used.set(alice.id, { filled: 1, waiting: 2 }); // the two free orders left are both waiting
    expect(() => svc.assertCanPlaceOrder(alice.id)).toThrow(/2 free orders are waiting to fill/);
    used.set(alice.id, { filled: 2, waiting: 1 });
    expect(() => svc.assertCanPlaceOrder(alice.id)).toThrow(/1 free order is waiting/);
    used.set(alice.id, { filled: 3, waiting: 0 });
    expect(() => svc.assertCanPlaceOrder(alice.id)).toThrow(PaymentRequiredError);
    expect(() => svc.assertCanPlaceOrder(alice.id)).toThrow(/used your 3 free orders/);
    svc.grant(alice.id);
    expect(() => svc.assertCanPlaceOrder(alice.id)).not.toThrow();
    expect(svc.status(alice.id)).toMatchObject({ unlocked: true, permanent: true, paidUntil: null, freeOrdersLeft: 0 });
  });
});

describe('BillingService monthly access', () => {
  it('buys one period per price, stacks early renewals, lapses, and then asks to renew (no second trial)', () => {
    const { svc, pay, alice, advance, used } = setup();
    pay({ asset: asset('solana'), amount: 50, from: USER_SOL });
    const first = svc.status(alice.id);
    expect(first).toMatchObject({ unlocked: true, permanent: false, everPaid: true, creditUsd: 0, freeOrdersLeft: 0 });
    expect(first.paidUntil).toBe(1_000 + 30 * DAY);
    advance(20 * DAY);
    pay({ asset: asset('base'), amount: 50, from: USER_EVM }); // renew early: adds after the current end
    expect(svc.status(alice.id).paidUntil).toBe(1_000 + 60 * DAY);
    advance(41 * DAY);
    expect(svc.status(alice.id)).toMatchObject({ unlocked: false, everPaid: true, freeOrdersLeft: 0 });
    used.set(alice.id, { filled: 0, waiting: 0 });
    expect(() => svc.assertCanPlaceOrder(alice.id)).toThrow(/month ended/);
    pay({ asset: asset('solana'), amount: 30, from: USER_SOL });
    expect(svc.status(alice.id)).toMatchObject({ unlocked: false, creditUsd: 30 }); // partial: adds up
    pay({ asset: asset('solana'), amount: 19.5, from: USER_SOL }); // within 2%
    const renewed = svc.status(alice.id);
    expect(renewed.unlocked).toBe(true);
    expect(renewed.paidUntil).toBe(1_000 + 61 * DAY + 30 * DAY);
  });

  it('treats overpayment beyond whole months as a tip, and still adds up partial payments', () => {
    const { svc, store, pay, alice } = setup();
    pay({ asset: asset('solana'), amount: 30, from: USER_SOL }); // partial: counts
    expect(svc.status(alice.id)).toMatchObject({ unlocked: false, creditUsd: 30 });
    pay({ asset: asset('solana'), amount: 38, from: USER_SOL }); // $68 total: one month, $18 tip
    expect(svc.status(alice.id)).toMatchObject({ unlocked: true, creditUsd: 0 });
    expect(store.creditUsd(alice.id)).toBe(68); // still on the books
  });

  it('pays for several periods at once and settles payments recorded before a restart', () => {
    const { svc, store, pay, alice, changed } = setup();
    pay({ asset: asset('solana'), amount: 120, from: USER_SOL }); // two months + $20 tip
    expect(svc.status(alice.id).paidUntil).toBe(1_000 + 60 * DAY);
    store.setAccess(alice.id, { paidUntil: 0, spentUsd: 0 }); // as if the credit had never been settled
    changed.length = 0;
    svc.settleAll();
    expect(changed).toEqual([alice.id]);
    expect(svc.status(alice.id).paidUntil).toBe(1_000 + 60 * DAY);
    svc.settleAll(); // nothing new
    expect(changed).toEqual([alice.id]);
  });
});

describe('BillingService quotes', () => {
  it('gives one method per chain with the payment code, and keeps the code while valid', () => {
    const { svc, bob, advance } = setup();
    const q = svc.quote(bob.id);
    expect(q.code).toBeGreaterThanOrEqual(1);
    expect(q.code).toBeLessThanOrEqual(9999);
    expect(q.methods.map((m) => `${m.chain}:${m.symbol}`)).toEqual(['solana:USDC', 'ethereum:USDC', 'base:USDC', 'bnb:USDC', 'robinhood:USDG', 'arc:USDC']);
    expect(q.methods[0]).toMatchObject({ payTo: SOL_TREASURY, amount: (50 + q.code / 1e6).toFixed(6), kind: 'stable' });
    expect(q.methods[1]!.payTo).toBe(EVM_TREASURY);
    advance(1000);
    expect(svc.quote(bob.id).code).toBe(q.code);
    advance(INVOICE_TTL_MS + 1);
    expect(svc.quote(bob.id).expiresAt).toBeGreaterThan(q.expiresAt);
  });

  it('adds the discounted token method once the token has a price', () => {
    const { svc, bob, setPrice } = setup({ token: true, tokenPrice: null });
    expect(svc.quote(bob.id).methods.some((m) => m.kind === 'token')).toBe(false);
    setPrice(0.01);
    const q = svc.quote(bob.id);
    const token = q.methods.find((m) => m.kind === 'token')!;
    expect(token).toMatchObject({ chain: 'base', symbol: 'AUTO', payTo: EVM_TREASURY });
    expect(token.amount).toBe((3500 + q.code / 1e4).toFixed(4)); // $35 at $0.01
  });
});

describe('BillingService payments', () => {
  it('reports a payment seen again as not recorded, without crediting it twice', () => {
    const { svc, alice } = setup();
    const t = { chain: 'solana' as const, txId: 'sigA', from: USER_SOL, asset: asset('solana'), amountRaw: raw(20, asset('solana').decimals) };
    expect(svc.receive(t)).toEqual({ recorded: true, userId: alice.id });
    expect(svc.receive(t)).toEqual({ recorded: false, userId: null });
    expect(svc.status(alice.id).creditUsd).toBe(20);
    expect(svc.receive({ ...t, txId: 'sigB', from: STRANGER })).toEqual({ recorded: true, userId: null }); // unmatched
  });

  it("credits payments from a user's fomo wallet on any chain and unlocks at the price", () => {
    const { svc, pay, alice, changed } = setup();
    expect(pay({ asset: asset('solana'), amount: 20, from: USER_SOL })).toBe(alice.id);
    expect(svc.status(alice.id)).toMatchObject({ unlocked: false, creditUsd: 20 });
    expect(pay({ asset: asset('bnb'), amount: 30, from: USER_EVM.toUpperCase().replace('0X', '0x') })).toBe(alice.id); // 18-decimal USDC
    expect(svc.status(alice.id).unlocked).toBe(true);
    expect(changed).toEqual([alice.id, alice.id]);
  });

  it('credits a still-locked account when several share the same fomo wallet', () => {
    const { svc, accounts, pay, alice, advance } = setup();
    svc.grant(alice.id); // e.g. the owner's main browser
    advance(10);
    const second = accounts.create('h3', { solana: USER_SOL, evm: USER_EVM });
    advance(10);
    accounts.touch(alice.id); // the unlocked account was seen most recently
    expect(pay({ asset: asset('solana'), amount: 2.73, from: USER_SOL })).toBe(second.id);
    const third = accounts.create('h4', { solana: USER_SOL, evm: null });
    svc.quote(third.id); // the one that opened the payment screen wins among locked accounts
    expect(pay({ asset: asset('solana'), amount: 1, from: USER_SOL })).toBe(third.id);
  });

  it('matches other wallets by the payment code in the amount', () => {
    const { svc, pay, bob } = setup();
    const { code } = svc.quote(bob.id);
    expect(pay({ asset: asset('base'), amount: 50 + code / 1e6 })).toBe(bob.id);
    expect(svc.status(bob.id).unlocked).toBe(true);
  });

  it('keeps unmatched payments for review and credits a transaction once', () => {
    const { svc, store, pay, alice } = setup();
    expect(pay({ asset: asset('base'), amount: 50 })).toBeNull();
    expect(pay({ asset: asset('base'), amount: 50.123456 })).toBeNull(); // code not issued
    expect(store.unmatched()).toHaveLength(2);
    expect(pay({ asset: asset('arc'), amount: 10, from: USER_EVM, txId: 'same' })).toBe(alice.id);
    // Arc logs the same USDC transfer twice (ERC-20 + system log): only one credit.
    expect(pay({ asset: STABLE_ASSETS.find((a) => a.address.startsWith('0xffff'))!, amount: 10, from: USER_EVM, txId: 'same' })).toBeNull();
    expect(svc.status(alice.id).creditUsd).toBe(10);
  });

  it('counts token payments with the discount, at the price locked in the quote', () => {
    const { svc, store, pay, bob, setPrice } = setup({ token: true, tokenPrice: 0.01 });
    const { code } = svc.quote(bob.id);
    setPrice(0.008); // price dropped after the quote: the quoted price still applies
    expect(pay({ asset: TOKEN, amount: 3500 + code / 1e4 })).toBe(bob.id);
    expect(store.creditUsd(bob.id)).toBeCloseTo(50, 1); // $35 of token counts as $50
    expect(svc.status(bob.id).creditUsd).toBeCloseTo(0, 1); // all of it bought the month
    expect(svc.status(bob.id).unlocked).toBe(true);
  });

  it('leaves token payments unassigned when there is no price', () => {
    const { store, pay, alice } = setup({ token: true, tokenPrice: null });
    expect(pay({ asset: TOKEN, amount: 1000, from: USER_EVM })).toBeNull();
    expect(store.unmatched()[0]).toMatchObject({ from: USER_EVM, creditUsd: 0 });
    expect(store.creditUsd(alice.id)).toBe(0);
  });

  it('forgets a deleted account but keeps its payments on the books', () => {
    const { svc, store, pay, alice } = setup();
    pay({ asset: asset('solana'), amount: 50, from: USER_SOL });
    svc.forget(alice.id);
    expect(svc.status(alice.id).unlocked).toBe(false);
    expect(store.unmatched()).toHaveLength(1);
  });
});

describe('BillingService claims (exchange withdrawals)', () => {
  const HASH = '0x' + 'ab'.repeat(32);
  const SIG = '5amakyYoQ1Hbe63wguvHR7DpoN2xHJmycSt6VFC1qoziZjqbZStRyihLW7Nf3uW39xAEUBWtQfADxZj5V5ZpMDnJ';

  it('reads the transaction id from ids and explorer links', () => {
    expect(transactionIdIn(`https://basescan.org/tx/${HASH.toUpperCase().replace('0X', '0x')}`)).toBe(HASH);
    expect(transactionIdIn(`https://solscan.io/tx/${SIG}?cluster=mainnet`)).toBe(SIG);
    expect(transactionIdIn(`  ${SIG}  `)).toBe(SIG);
    expect(transactionIdIn('hello')).toBeNull();
  });

  it('credits an unmatched exchange payment to the account that claims it, once', () => {
    const { svc, store, pay, bob, alice } = setup();
    expect(pay({ asset: asset('base'), amount: 49.2, txId: HASH })).toBeNull(); // exchange wallet, no code: unmatched
    expect(() => svc.claim(bob.id, 'nonsense')).toThrow(/transaction ID/);
    expect(() => svc.claim(bob.id, '0x' + 'cd'.repeat(32))).toThrow(/haven't seen that payment/);
    const status = svc.claim(bob.id, `https://basescan.org/tx/${HASH}`);
    expect(status).toMatchObject({ unlocked: true }); // $49.20 is within 2% of $50
    expect(store.unmatched()).toHaveLength(0);
    expect(() => svc.claim(bob.id, HASH)).toThrow(/already on your account/);
    expect(() => svc.claim(alice.id, HASH)).toThrow(/already credited/);
  });

  it('adds up a short exchange payment and prices unassigned token payments when claimed', () => {
    const { svc, pay, bob, setPrice } = setup({ token: true, tokenPrice: null });
    pay({ asset: asset('solana'), amount: 20, txId: SIG, from: 'ExchangeHotWallet111111111111111111111111111' });
    expect(svc.claim(bob.id, SIG)).toMatchObject({ unlocked: false, creditUsd: 20 });
    pay({ asset: TOKEN, amount: 2100, txId: HASH, from: STRANGER });
    expect(() => svc.claim(bob.id, HASH)).toThrow(/can't be priced/);
    setPrice(0.01); // 2100 tokens = $21 → counts as $30 toward $50
    expect(svc.claim(bob.id, HASH)).toMatchObject({ unlocked: true });
  });
});

describe('EvmPaymentWatcher', () => {
  const topic = (a: string): Hex => `0x${a.slice(2).padStart(64, '0')}` as Hex;
  const log = (block: bigint, token: string, to: string, amount: bigint, tx = 'tx'): EvmLog => ({
    address: token as Hex, topics: [TRANSFER_TOPIC, topic(USER_EVM), topic(to)], data: `0x${amount.toString(16).padStart(64, '0')}` as Hex, blockNumber: block, logIndex: 0, transactionHash: tx as Hex,
  });

  it('starts at the head, then reads settled blocks in chunks and keeps a cursor', async () => {
    const rpc = new FakeEvmRpc('base');
    const store = new SqliteBillingStoreAdapter(':memory:');
    const got: IncomingTransfer[] = [];
    const usdc = asset('base');
    const w = new EvmPaymentWatcher('base', rpc, [usdc], EVM_TREASURY, store, (t) => got.push(t), () => undefined, 60_000);
    rpc.head = 1000n;
    await w.poll();
    expect(store.cursor('evm:base')).toBe('998');
    rpc.head = 5000n;
    rpc.history = [log(1500n, usdc.address, EVM_TREASURY, 50_000_000n), log(1600n, usdc.address, STRANGER, 1n), log(4999n, usdc.address, EVM_TREASURY, 1n)];
    await w.poll();
    expect(rpc.getLogsCalls.slice(-2)).toEqual([[999n, 2998n], [2999n, 4998n]]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ chain: 'base', from: USER_EVM, amountRaw: 50_000_000n, txId: 'tx' });
    expect(store.cursor('evm:base')).toBe('4998');
  });

  it('reports RPC errors and polls on a timer', async () => {
    vi.useFakeTimers();
    const rpc = new FakeEvmRpc('base');
    rpc.blockNumber = async () => { throw new Error('rpc down'); };
    const errors: unknown[] = [];
    const w = new EvmPaymentWatcher('base', rpc, [asset('base')], EVM_TREASURY, new SqliteBillingStoreAdapter(':memory:'), () => undefined, (e) => errors.push(e), 1_000);
    w.start();
    await vi.advanceTimersByTimeAsync(2_500);
    w.stop();
    vi.useRealTimers();
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

class FakeTransfers extends SolanaTransfersPort {
  latest: bigint | null = 100n;
  queue: SolanaTransfer[] = [];
  /** Newest slot the next scan reports (defaults to the newest queued transfer). */
  newest: bigint | null = null;
  afters: bigint[] = [];
  async latestSlot(): Promise<bigint | null> { return this.latest; }
  async incoming(_o: string, _m: string, after: bigint): Promise<SolanaIncoming> {
    this.afters.push(after);
    const transfers = this.queue.splice(0);
    const newestSlot = this.newest ?? transfers.at(-1)?.slot ?? null;
    this.newest = null;
    return { transfers, newestSlot };
  }
}

describe('SolanaPaymentWatcher', () => {
  const key = () => `solana:${asset('solana').address}`;

  it('starts from the newest slot, then passes new transfers on in order and advances by slot', async () => {
    const port = new FakeTransfers();
    const store = new SqliteBillingStoreAdapter(':memory:');
    const got: IncomingTransfer[] = [];
    const w = new SolanaPaymentWatcher(port, [asset('solana')], SOL_TREASURY, store, (t) => got.push(t), () => undefined, 60_000);
    await w.poll();
    expect(store.cursor(key())).toBe('100');
    port.queue = [
      { signature: 'sig1', slot: 105n, from: USER_SOL, amountRaw: 50_000_000n },
      { signature: 'sig2', slot: 107n, from: USER_SOL, amountRaw: 1n },
    ];
    await w.poll();
    expect(port.afters).toEqual([100n]);
    expect(got.map((t) => t.txId)).toEqual(['sig1', 'sig2']);
    expect(got[0]).toMatchObject({ chain: 'solana', txId: 'sig1', from: USER_SOL, amountRaw: 50_000_000n });
    expect(store.cursor(key())).toBe('107');
    await w.poll();
    expect(port.afters).toEqual([100n, 107n]);
  });

  it('reads an empty wallet from its first transfer (slot 0)', async () => {
    const port = new FakeTransfers();
    port.latest = null;
    const store = new SqliteBillingStoreAdapter(':memory:');
    const w = new SolanaPaymentWatcher(port, [asset('solana')], SOL_TREASURY, store, () => undefined, () => undefined);
    await w.poll();
    await w.poll();
    expect(port.afters).toEqual([0n]);
  });

  it('rescans once from slot 0 when an old signature cursor is stored (it may have expired on the RPC)', async () => {
    const port = new FakeTransfers();
    const store = new SqliteBillingStoreAdapter(':memory:');
    store.setCursor(key(), 'ntJJEe5gYmHTjmHnTmCjpNZ351mdKC3r9dBAruFP1sSMdtmRgHmfTTwNXgTzvbKctCY5T7sKJZMut27ECzvb4vK');
    const w = new SolanaPaymentWatcher(port, [asset('solana')], SOL_TREASURY, store, () => undefined, () => undefined);
    port.queue = [{ signature: 'sig9', slot: 900n, from: USER_SOL, amountRaw: 1n }];
    await w.poll();
    expect(port.afters).toEqual([0n]);
    expect(store.cursor(key())).toBe('900');
    expect(slotCursor('123')).toBe(123n);
  });

  it('moves the cursor past scanned transactions that are not payments', async () => {
    const port = new FakeTransfers();
    const store = new SqliteBillingStoreAdapter(':memory:');
    store.setCursor(key(), 'an-old-signature-the-rpc-no-longer-has');
    const w = new SolanaPaymentWatcher(port, [asset('solana')], SOL_TREASURY, store, () => undefined, () => undefined);
    port.newest = 5_000n; // only fees / pruned txs in the scan
    await w.poll();
    expect(store.cursor(key())).toBe('5000');
    await w.poll();
    expect(port.afters).toEqual([0n, 5_000n]);
  });
});

describe('Solana transfer parsing', () => {
  const MINT = asset('solana').address;
  const bal = (accountIndex: number, owner: string, amount: string, mint = MINT) => ({ accountIndex, mint, owner, uiTokenAmount: { amount } });
  it('reads the amount received and the sender', () => {
    expect(transferFrom([bal(1, USER_SOL, '80000000'), bal(2, SOL_TREASURY, '0')], [bal(1, USER_SOL, '30000000'), bal(2, SOL_TREASURY, '50000000')], SOL_TREASURY, MINT))
      .toEqual({ from: USER_SOL, amountRaw: 50_000_000n });
    expect(transferFrom([bal(2, SOL_TREASURY, '5')], [bal(2, SOL_TREASURY, '1')], SOL_TREASURY, MINT)).toBeNull();
    expect(transferFrom([], [bal(2, SOL_TREASURY, '7', 'other')], SOL_TREASURY, MINT)).toBeNull();
  });
});
