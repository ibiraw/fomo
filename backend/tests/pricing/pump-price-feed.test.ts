/**
 * @file pump-price-feed.test.ts
 * @description Tests for PumpPriceFeed: curve pricing, pool pricing, graduation, SOL moves, errors.
 * @author Reborn1987
 */

import type { Address } from '@solana/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FomoError, UnsupportedPoolError } from '../../src/core/errors.js';
import {
  deriveBondingCurve,
  deriveCanonicalPumpPool,
  PYTH_SOL_USD_ACCOUNT,
  USDC_MINT,
  WSOL_MINT,
} from '../../src/core/pricing/addresses.js';
import { PumpPriceFeed } from '../../src/core/pricing/pump-price-feed.js';
import type { PriceTick } from '../../src/ports/price-feed.js';
import { curveBytes, FakeAccounts, poolBytes, pythBytes, tokenAccountBytes } from '../helpers/fake-accounts.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump' as Address;
const BASE_TA = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' as Address; // stand-in vault address
const QUOTE_TA = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' as Address; // stand-in vault address

let accounts: FakeAccounts;
let errors: unknown[];
let feed: PumpPriceFeed;

beforeEach(async () => {
  accounts = new FakeAccounts();
  errors = [];
  accounts.data.set(PYTH_SOL_USD_ACCOUNT, pythBytes(10000n, -2)); // SOL = $100
  accounts.supplies.set(MINT, { amount: 1_000_000_000_000_000n, decimals: 6 }); // 1B tokens
  feed = new PumpPriceFeed(accounts, (e) => errors.push(e));
  await feed.start();
});

/** Sets up a graduated pool with given vault balances. */
async function setupPool(base: bigint, quote: bigint, quoteMint: Address = WSOL_MINT): Promise<void> {
  accounts.data.set(await deriveCanonicalPumpPool(MINT), poolBytes({ baseMint: MINT, quoteMint, baseTa: BASE_TA, quoteTa: QUOTE_TA }));
  accounts.data.set(BASE_TA, tokenAccountBytes(base));
  accounts.data.set(QUOTE_TA, tokenAccountBytes(quote));
}

describe('PumpPriceFeed', () => {
  it('requires start() before watch()', async () => {
    const f = new PumpPriceFeed(accounts, () => undefined);
    await expect(f.watch(MINT, () => undefined)).rejects.toThrow(FomoError);
  });

  it('fails fast when the Pyth account is missing', async () => {
    const empty = new FakeAccounts();
    await expect(new PumpPriceFeed(empty, () => undefined).start()).rejects.toThrow(/Pyth/);
  });

  it('prices a bonding-curve coin in USD with market cap', async () => {
    const curve = await deriveBondingCurve(MINT);
    // 30 SOL / 1,000,000,000 tokens => 3e-8 SOL => $3e-6; MC = $3000
    accounts.data.set(curve, curveBytes({ vToken: 1_000_000_000_000_000n, vQuote: 30_000_000_000n }));
    const ticks: PriceTick[] = [];
    await feed.watch(MINT, (t) => ticks.push(t));
    accounts.push(curve, curveBytes({ vToken: 1_000_000_000_000_000n, vQuote: 60_000_000_000n }));
    const last = ticks.at(-1)!;
    expect(last.source).toBe('pump-curve');
    expect(last.priceUsd).toBeCloseTo(6e-6, 12);
    expect(last.marketCapUsd).toBeCloseTo(6000, 6);
  });

  it('switches to the PumpSwap pool when the curve graduates', async () => {
    const curve = await deriveBondingCurve(MINT);
    accounts.data.set(curve, curveBytes({ vToken: 1_000_000_000_000_000n, vQuote: 30_000_000_000n }));
    const ticks: PriceTick[] = [];
    await feed.watch(MINT, (t) => ticks.push(t));
    await setupPool(500_000_000_000_000n, 100_000_000_000n); // 100 SOL / 500M => 2e-7 SOL => $2e-5
    accounts.push(curve, curveBytes({ vToken: 0n, vQuote: 0n, complete: true }));
    await vi.waitFor(() => expect(ticks.at(-1)?.source).toBe('pump-swap'));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(2e-5, 12);
    expect(accounts.subscriberCount(curve)).toBe(0);
  });

  it('prices a graduated coin from pool vaults and re-emits on SOL moves', async () => {
    await setupPool(500_000_000_000_000n, 100_000_000_000n);
    const ticks: PriceTick[] = [];
    await feed.watch(MINT, (t) => ticks.push(t));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(2e-5, 12);
    accounts.push(PYTH_SOL_USD_ACCOUNT, pythBytes(20000n, -2)); // SOL doubles
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(4e-5, 12);
  });

  it('does not emit a half-updated price between the two vault updates of one swap', async () => {
    await setupPool(500_000_000_000_000n, 100_000_000_000n);
    const ticks: PriceTick[] = [];
    await feed.watch(MINT, (t) => ticks.push(t));
    const before = ticks.length;
    accounts.push(QUOTE_TA, tokenAccountBytes(200_000_000_000n), 2n); // quote first, new slot
    expect(ticks.length).toBe(before); // held until the base vault catches up
    accounts.push(BASE_TA, tokenAccountBytes(250_000_000_000_000n), 2n);
    expect(ticks.length).toBe(before + 1);
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(8e-5, 12); // 200 SOL / 250M * $100
  });

  it('emits after a timeout when only one vault changes, and ignores stale slots', async () => {
    vi.useFakeTimers();
    try {
      await setupPool(500_000_000_000_000n, 100_000_000_000n);
      const ticks: PriceTick[] = [];
      await feed.watch(MINT, (t) => ticks.push(t));
      const before = ticks.length;
      accounts.push(QUOTE_TA, tokenAccountBytes(150_000_000_000n), 3n);
      accounts.push(QUOTE_TA, tokenAccountBytes(1n), 2n); // stale — ignored
      vi.advanceTimersByTime(400);
      expect(ticks.length).toBe(before + 1);
      expect(ticks.at(-1)!.priceUsd).toBeCloseTo(3e-5, 12);
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports USDC-quoted pools without SOL conversion', async () => {
    await setupPool(1_000_000_000_000n, 5_000_000n, USDC_MINT); // 5 USDC / 1M tokens
    const ticks: PriceTick[] = [];
    await feed.watch(MINT, (t) => ticks.push(t));
    expect(ticks.at(-1)!.priceUsd).toBeCloseTo(5e-6, 12);
  });

  it('rejects unsupported quote assets and non-pump tokens', async () => {
    await setupPool(1n, 1n, BASE_TA);
    await expect(feed.watch(MINT, () => undefined)).rejects.toThrow(UnsupportedPoolError);
    accounts.data.clear();
    await expect(feed.watch(MINT, () => undefined)).rejects.toThrow(/Only pump.fun tokens/);
  });

  it('shares subscriptions between listeners and cleans up on last stop', async () => {
    await setupPool(1_000n, 1_000n);
    const a = await feed.watch(MINT, () => undefined);
    const b = await feed.watch(MINT, () => undefined);
    expect(accounts.subscriberCount(BASE_TA)).toBe(1);
    a.stop();
    expect(accounts.subscriberCount(BASE_TA)).toBe(1);
    b.stop();
    expect(accounts.subscriberCount(BASE_TA)).toBe(0);
  });

  it('routes bad account data to onError without crashing', async () => {
    await setupPool(1_000n, 1_000n);
    await feed.watch(MINT, () => undefined);
    accounts.push(BASE_TA, new Uint8Array(3));
    expect(errors[0]).toBeInstanceOf(Error);
  });

  it('close() stops every subscription', async () => {
    await setupPool(1_000n, 1_000n);
    await feed.watch(MINT, () => undefined);
    await feed.close();
    expect(accounts.subscriberCount(BASE_TA)).toBe(0);
    expect(accounts.subscriberCount(PYTH_SOL_USD_ACCOUNT)).toBe(0);
  });
});

