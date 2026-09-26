/**
 * @file decoders.test.ts
 * @description Tests for on-chain account decoders and price math.
 * @author Reborn1987
 */

import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { AccountDecodeError } from '../../src/core/errors.js';
import {
  decodeBondingCurve,
  decodePumpPool,
  decodePythPrice,
  decodeTokenAccountAmount,
  DEFAULT_PUBKEY,
} from '../../src/core/pricing/decoders.js';
import { marketCapUsd, priceFromReserves, pythToNumber } from '../../src/core/pricing/math.js';
import { USDC_MINT, WSOL_MINT } from '../../src/core/pricing/addresses.js';
import { curveBytes, poolBytes, pythBytes, tokenAccountBytes } from '../helpers/fake-accounts.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump' as Address;

describe('decodeBondingCurve', () => {
  it('reads reserves, supply, complete flag and quote mint', () => {
    const c = decodeBondingCurve(curveBytes({ vToken: 5n, vQuote: 7n, complete: true, quoteMint: USDC_MINT }));
    expect(c).toMatchObject({ virtualTokenReserves: 5n, virtualQuoteReserves: 7n, complete: true, quoteMint: USDC_MINT });
    expect(c.tokenTotalSupply).toBe(1_000_000_000_000_000n);
  });

  it('treats legacy short accounts as SOL-paired', () => {
    expect(decodeBondingCurve(curveBytes({ vToken: 1n, vQuote: 1n, short: true })).quoteMint).toBe(DEFAULT_PUBKEY);
  });

  it('rejects wrong discriminator and short data', () => {
    const b = curveBytes({ vToken: 1n, vQuote: 1n });
    b[0] = 0;
    expect(() => decodeBondingCurve(b)).toThrow(AccountDecodeError);
    expect(() => decodeBondingCurve(new Uint8Array(10))).toThrow(AccountDecodeError);
  });
});

describe('decodePumpPool', () => {
  const args = { baseMint: MINT, quoteMint: WSOL_MINT, baseTa: USDC_MINT, quoteTa: WSOL_MINT };

  it('reads mints, vaults and virtual quote reserves', () => {
    const p = decodePumpPool(poolBytes({ ...args, virtualQuote: 123n }));
    expect(p).toMatchObject({ baseMint: MINT, quoteMint: WSOL_MINT, poolBaseTokenAccount: USDC_MINT, virtualQuoteReserves: 123n });
  });

  it('defaults virtual quote reserves to 0 on legacy layout', () => {
    expect(decodePumpPool(poolBytes({ ...args, short: true })).virtualQuoteReserves).toBe(0n);
  });
});

describe('decodeTokenAccountAmount', () => {
  it('reads amount and rejects short data', () => {
    expect(decodeTokenAccountAmount(tokenAccountBytes(42n))).toBe(42n);
    expect(() => decodeTokenAccountAmount(new Uint8Array(10))).toThrow(AccountDecodeError);
  });
});

describe('decodePythPrice', () => {
  it('handles Full and Partial verification levels', () => {
    expect(decodePythPrice(pythBytes(12044n, -2)).price).toBe(12044n);
    const partial = decodePythPrice(pythBytes(15000n, -2, 'partial'));
    expect(partial).toMatchObject({ price: 15000n, exponent: -2 });
  });

  it('rejects unknown verification tag and truncated data', () => {
    const b = pythBytes(1n, 0);
    b[40] = 9;
    expect(() => decodePythPrice(b)).toThrow(/verification level/);
    expect(() => decodePythPrice(pythBytes(1n, 0).subarray(0, 60))).toThrow(/too short/);
  });
});

describe('math', () => {
  it('computes price, USD conversion and market cap', () => {
    expect(priceFromReserves(1_000_000n, 6, 2_000_000_000n, 9)).toBe(2);
    expect(pythToNumber(12044n, -2)).toBeCloseTo(120.44);
    expect(marketCapUsd(0.5, 2_000_000n, 6)).toBe(1);
  });

  it('refuses to price an empty pool', () => {
    expect(() => priceFromReserves(0n, 6, 1n, 9)).toThrow(AccountDecodeError);
  });
});
