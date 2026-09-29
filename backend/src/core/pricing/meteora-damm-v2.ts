/**
 * @file meteora-damm-v2.ts
 * @description Meteora DAMM v2 (CP-AMM) pool decoding. Layout from MeteoraAg/dynamic-bonding-curve
 *              idls/damm_v2.json, checked against a live pool 2026-09-26 (1112 bytes).
 * @author Reborn1987
 */

import { getAddressDecoder, type Address } from '@solana/kit';

import { AccountDecodeError } from '../errors.js';

export const METEORA_DAMM_V2_PROGRAM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG' as Address;
/** Anchor "Pool" discriminator (same bytes as PumpSwap's Pool — pools are found via DexScreener + mint check). */
export const DAMM_V2_POOL_DISCRIMINATOR = Uint8Array.from([241, 154, 109, 4, 17, 177, 109, 188]);
const MIN_LEN = 482;
const dec = getAddressDecoder();

/** Fields needed for pricing. */
export interface DammV2Pool {
  readonly tokenAMint: Address;
  readonly tokenBMint: Address;
  /** Token accounts holding each side's reserve. */
  readonly tokenAVault: Address;
  readonly tokenBVault: Address;
  /** Q64.64 square root of price (token B per token A, raw units). */
  readonly sqrtPrice: bigint;
  readonly status: number;
}

/** Decodes a DAMM v2 Pool account. */
export function decodeDammV2Pool(data: Uint8Array): DammV2Pool {
  if (data.length < MIN_LEN) throw new AccountDecodeError(`DammV2Pool: expected >= ${MIN_LEN} bytes, got ${data.length}`);
  for (let i = 0; i < 8; i++) {
    if (data[i] !== DAMM_V2_POOL_DISCRIMINATOR[i]) throw new AccountDecodeError('DammV2Pool: discriminator mismatch');
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    tokenAMint: dec.decode(data.subarray(168, 200)),
    tokenBMint: dec.decode(data.subarray(200, 232)),
    tokenAVault: dec.decode(data.subarray(232, 264)),
    tokenBVault: dec.decode(data.subarray(264, 296)),
    sqrtPrice: dv.getBigUint64(456, true) + (dv.getBigUint64(464, true) << 64n),
    status: data[481]!,
  };
}

/** Whole token B per whole token A from the Q64.64 sqrt price. */
export function dammV2PriceBPerA(sqrtPrice: bigint, decimalsA: number, decimalsB: number): number {
  const s = Number(sqrtPrice) / 2 ** 64;
  return s * s * 10 ** (decimalsA - decimalsB);
}
