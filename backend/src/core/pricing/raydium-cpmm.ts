/**
 * @file raydium-cpmm.ts
 * @description Raydium CPMM (CP-Swap) pool decoding. Layout from raydium-io/raydium-idl
 *              raydium_cpmm/raydium_cp_swap.json (verified 2026-09-26).
 * @author Reborn1987
 */

import { getAddressDecoder, type Address } from '@solana/kit';

import { AccountDecodeError } from '../errors.js';

export const RAYDIUM_CPMM_PROGRAM = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C' as Address;
export const CPMM_POOL_DISCRIMINATOR = Uint8Array.from([247, 237, 227, 245, 215, 195, 222, 70]);
/** Size up to and including creator_fees_token_1 (older pools without creator fees are shorter). */
const MIN_LEN = 373;
const CREATOR_FEES_END = 413;

const addr = getAddressDecoder();

/** Fields needed for pricing. */
export interface CpmmPoolState {
  readonly vault0: Address;
  readonly vault1: Address;
  readonly mint0: Address;
  readonly mint1: Address;
  readonly decimals0: number;
  readonly decimals1: number;
  /** Protocol + fund + creator fees held in each vault that are not part of the swap reserves. */
  readonly fees0: bigint;
  readonly fees1: bigint;
}

/** Decodes a CPMM PoolState account. */
export function decodeCpmmPool(data: Uint8Array): CpmmPoolState {
  if (data.length < MIN_LEN) throw new AccountDecodeError(`CpmmPool: expected >= ${MIN_LEN} bytes, got ${data.length}`);
  for (let i = 0; i < 8; i++) {
    if (data[i] !== CPMM_POOL_DISCRIMINATOR[i]) throw new AccountDecodeError('CpmmPool: discriminator mismatch — not a Raydium CPMM pool');
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (o: number): bigint => dv.getBigUint64(o, true);
  const hasCreatorFees = data.length >= CREATOR_FEES_END;
  return {
    vault0: addr.decode(data.subarray(72, 104)),
    vault1: addr.decode(data.subarray(104, 136)),
    mint0: addr.decode(data.subarray(168, 200)),
    mint1: addr.decode(data.subarray(200, 232)),
    decimals0: data[331]!,
    decimals1: data[332]!,
    fees0: u64(341) + u64(357) + (hasCreatorFees ? u64(397) : 0n),
    fees1: u64(349) + u64(365) + (hasCreatorFees ? u64(405) : 0n),
  };
}
