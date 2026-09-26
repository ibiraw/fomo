/**
 * @file addresses.ts
 * @description Well-known program/mint addresses and PDA derivations for pump.fun and PumpSwap.
 *              Seeds verified against pump-fun/pump-public-docs IDLs (2026-09-26).
 * @author Reborn1987
 */

import { getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' as Address;
export const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' as Address;
export const WSOL_MINT = 'So11111111111111111111111111111111111111112' as Address;
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as Address;
/** Pyth SOL/USD sponsored push-oracle PriceUpdateV2 account (shard 0). */
export const PYTH_SOL_USD_ACCOUNT = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE' as Address;

const encoder = getAddressEncoder();
const text = new TextEncoder();

/** Derives the pump.fun bonding curve PDA: ["bonding-curve", mint]. */
export async function deriveBondingCurve(mint: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PUMP_PROGRAM,
    seeds: [text.encode('bonding-curve'), encoder.encode(mint)],
  });
  return pda;
}

/**
 * Derives the canonical PumpSwap pool a graduated pump.fun coin migrates to:
 * pool = PDA(pump_amm, ["pool", u16 0, pool_authority, mint, wsol]),
 * pool_authority = PDA(pump, ["pool-authority", mint]).
 */
export async function deriveCanonicalPumpPool(mint: Address): Promise<Address> {
  const [poolAuthority] = await getProgramDerivedAddress({
    programAddress: PUMP_PROGRAM,
    seeds: [text.encode('pool-authority'), encoder.encode(mint)],
  });
  const [pool] = await getProgramDerivedAddress({
    programAddress: PUMP_AMM_PROGRAM,
    seeds: [
      text.encode('pool'),
      Uint8Array.from([0, 0]),
      encoder.encode(poolAuthority),
      encoder.encode(mint),
      encoder.encode(WSOL_MINT),
    ],
  });
  return pool;
}
