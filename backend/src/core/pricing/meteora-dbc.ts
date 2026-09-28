/**
 * @file meteora-dbc.ts
 * @description Meteora Dynamic Bonding Curve (DBC) decoding — the curve fomo's own launchpad uses.
 *              VirtualPool layout from MeteoraAg/dynamic-bonding-curve scripts/idl/release_0.1.6.json,
 *              checked against a live pool 2026-09-26. Live pools carry a newer account discriminator than
 *              that IDL, so both are accepted; the base mint is always checked too.
 * @author Reborn1987
 */

import { getAddressDecoder, type Address } from '@solana/kit';

import { AccountDecodeError } from '../errors.js';

export const METEORA_DBC_PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN' as Address;
/** VirtualPool discriminators: IDL release 0.1.6, and the one seen on live pools (newer program version). */
const POOL_DISCRIMINATORS = ['213,224,5,209,98,69,119,92', '237,219,184,23,42,189,169,35'];
const POOL_LEN = 424;
const CONFIG_MIN_LEN = 40;
const dec = getAddressDecoder();

/** Fields needed for pricing. */
export interface DbcPool {
  readonly config: Address;
  /** Who launched it (the launch transaction's signer; fomo's own launches record fomo's wallet). */
  readonly creator: Address;
  readonly baseMint: Address;
  /** Q64.64 square root of the price (quote per base, in raw units). */
  readonly sqrtPrice: bigint;
  readonly isMigrated: boolean;
}

/** Decodes a DBC VirtualPool account. */
export function decodeDbcPool(data: Uint8Array): DbcPool {
  if (data.length < POOL_LEN) throw new AccountDecodeError(`DbcPool: expected >= ${POOL_LEN} bytes, got ${data.length}`);
  if (!POOL_DISCRIMINATORS.includes([...data.subarray(0, 8)].join(','))) {
    throw new AccountDecodeError('DbcPool: unknown account discriminator — not a Meteora DBC pool');
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lo = dv.getBigUint64(280, true);
  const hi = dv.getBigUint64(288, true);
  return {
    config: dec.decode(data.subarray(72, 104)),
    creator: dec.decode(data.subarray(104, 136)),
    baseMint: dec.decode(data.subarray(136, 168)),
    sqrtPrice: (hi << 64n) + lo,
    isMigrated: data[305] === 1,
  };
}

/** Reads the quote mint from a DBC PoolConfig account (first field after the discriminator). */
export function decodeDbcQuoteMint(config: Uint8Array): Address {
  if (config.length < CONFIG_MIN_LEN) throw new AccountDecodeError('DbcConfig: account too short');
  return dec.decode(config.subarray(8, 40));
}

/** Price of one whole base token in whole quote units, from the Q64.64 sqrt price. */
export function dbcPrice(sqrtPrice: bigint, baseDecimals: number, quoteDecimals: number): number {
  const s = Number(sqrtPrice) / 2 ** 64;
  return s * s * 10 ** (baseDecimals - quoteDecimals);
}
