/**
 * @file pool-math.ts
 * @description Spot price formulas for EVM AMMs. Prices are "units of the other token per 1 token", decimals applied.
 * @author Reborn1987
 */

const Q96 = 2 ** 96;

/** Constant-product (v2) spot price of the token given both reserves and decimals. */
export function priceFromReserves(tokenReserve: bigint, quoteReserve: bigint, tokenDecimals: number, quoteDecimals: number): number {
  if (tokenReserve <= 0n || quoteReserve <= 0n) return 0;
  return (Number(quoteReserve) / 10 ** quoteDecimals) / (Number(tokenReserve) / 10 ** tokenDecimals);
}

/**
 * Concentrated-liquidity (v3/v4) spot price from sqrtPriceX96 = sqrt(token1/token0) * 2^96 in raw units.
 * Returns the price of `token` in the other currency, where `tokenIsCurrency0` says which side it is.
 */
export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number, tokenIsCurrency0: boolean): number {
  if (sqrtPriceX96 <= 0n) return 0;
  const ratio = Number(sqrtPriceX96) / Q96;
  const price0In1 = ratio * ratio * 10 ** (decimals0 - decimals1);
  if (price0In1 === 0 || !Number.isFinite(price0In1)) return 0;
  return tokenIsCurrency0 ? price0In1 : 1 / price0In1;
}

/** Raw supply → whole tokens. */
export function toUnits(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}
