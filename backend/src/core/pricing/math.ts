/**
 * @file math.ts
 * @description Pure price math: reserves -> token price in quote units, and quote -> USD.
 * @author Reborn1987
 */

import { AccountDecodeError } from '../errors.js';

/** Decimals of native SOL / wSOL. */
export const SOL_DECIMALS = 9;

/**
 * Price of one whole base token in whole quote units, from constant-product reserves.
 * Throws when base reserves are zero (a drained/closed pool has no price).
 */
export function priceFromReserves(
  baseReserves: bigint,
  baseDecimals: number,
  quoteReserves: bigint,
  quoteDecimals: number,
): number {
  if (baseReserves <= 0n) {
    throw new AccountDecodeError('Cannot price: base reserves are zero');
  }
  const base = Number(baseReserves) / 10 ** baseDecimals;
  const quote = Number(quoteReserves) / 10 ** quoteDecimals;
  return quote / base;
}

/** Converts a Pyth fixed-point price (price * 10^exponent) to a float. */
export function pythToNumber(price: bigint, exponent: number): number {
  return Number(price) * 10 ** exponent;
}

/** Market cap in USD = price USD * circulating supply (raw units scaled by decimals). */
export function marketCapUsd(priceUsd: number, supplyRaw: bigint, decimals: number): number {
  return priceUsd * (Number(supplyRaw) / 10 ** decimals);
}
