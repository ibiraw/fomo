/**
 * @file decoders.ts
 * @description Byte-level decoders for the on-chain accounts used to price tokens:
 *              pump.fun BondingCurve, PumpSwap Pool, SPL token accounts and Pyth PriceUpdateV2.
 *              Layouts verified against pump-fun/pump-public-docs IDLs (2026-09-26).
 * @author Reborn1987
 */

import { getAddressDecoder, type Address } from '@solana/kit';

import { AccountDecodeError } from '../errors.js';

const addressDecoder = getAddressDecoder();

/** Anchor discriminator of the pump.fun BondingCurve account. */
export const BONDING_CURVE_DISCRIMINATOR = Uint8Array.from([23, 183, 248, 55, 96, 216, 172, 96]);
/** Anchor discriminator of the PumpSwap Pool account. */
export const PUMP_POOL_DISCRIMINATOR = Uint8Array.from([241, 154, 109, 4, 17, 177, 109, 188]);
/** Anchor discriminator of the Pyth receiver PriceUpdateV2 account. */
export const PYTH_PRICE_UPDATE_DISCRIMINATOR = Uint8Array.from([34, 241, 35, 99, 157, 126, 244, 205]);

/** The all-zero pubkey pump.fun stores in `quote_mint` for SOL-paired coins. */
export const DEFAULT_PUBKEY = '11111111111111111111111111111111' as Address;

/** Decoded pump.fun bonding curve state. */
export interface BondingCurveState {
  readonly virtualTokenReserves: bigint;
  readonly virtualQuoteReserves: bigint;
  readonly tokenTotalSupply: bigint;
  readonly complete: boolean;
  /** The coin's creator (pump.fun pays creator rewards here); null on accounts too old to have the field. */
  readonly creator: Address | null;
  /** Quote asset mint; DEFAULT_PUBKEY means SOL. Older accounts without the field are SOL-paired. */
  readonly quoteMint: Address;
}

/** Decoded PumpSwap pool state (only the fields needed for pricing). */
export interface PumpPoolState {
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly poolBaseTokenAccount: Address;
  readonly poolQuoteTokenAccount: Address;
  readonly virtualQuoteReserves: bigint;
}

/** Decoded Pyth price message. */
export interface PythPriceState {
  readonly price: bigint;
  readonly exponent: number;
  readonly publishTime: bigint;
}

/**
 * Throws AccountDecodeError unless `data` starts with `discriminator` and is at least `minLength` bytes.
 */
function assertAccount(data: Uint8Array, discriminator: Uint8Array, minLength: number, kind: string): void {
  if (data.length < minLength) {
    throw new AccountDecodeError(`${kind}: expected >= ${minLength} bytes, got ${data.length}`);
  }
  for (let i = 0; i < discriminator.length; i++) {
    if (data[i] !== discriminator[i]) {
      throw new AccountDecodeError(`${kind}: discriminator mismatch — not a ${kind} account`);
    }
  }
}

/** Returns a DataView over the given bytes (respecting the underlying buffer offset). */
function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/** Reads a 32-byte pubkey at `offset`. */
function readAddress(data: Uint8Array, offset: number): Address {
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}

/**
 * Decodes a pump.fun BondingCurve account.
 * Layout: disc(8) vtr u64 | vqr u64 | rtr u64 | rqr u64 | supply u64 | complete bool(48) |
 *         creator(49..81) | mayhem bool(81) | cashback bool(82) | quote_mint(83..115) | ...
 */
export function decodeBondingCurve(data: Uint8Array): BondingCurveState {
  assertAccount(data, BONDING_CURVE_DISCRIMINATOR, 49, 'BondingCurve');
  const dv = view(data);
  const quoteMint = data.length >= 115 ? readAddress(data, 83) : DEFAULT_PUBKEY;
  return {
    virtualTokenReserves: dv.getBigUint64(8, true),
    virtualQuoteReserves: dv.getBigUint64(16, true),
    tokenTotalSupply: dv.getBigUint64(40, true),
    complete: data[48] === 1,
    creator: data.length >= 81 ? readAddress(data, 49) : null,
    quoteMint,
  };
}

/**
 * Decodes a PumpSwap Pool account.
 * Layout: disc(8) bump u8(8) | index u16(9) | creator(11) | base_mint(43) | quote_mint(75) | lp_mint(107) |
 *         pool_base_ta(139) | pool_quote_ta(171) | lp_supply u64(203) | coin_creator(211) |
 *         mayhem bool(243) | cashback bool(244) | virtual_quote_reserves i128(245) | ...
 */
export function decodePumpPool(data: Uint8Array): PumpPoolState {
  assertAccount(data, PUMP_POOL_DISCRIMINATOR, 203, 'PumpPool');
  let virtualQuoteReserves = 0n;
  if (data.length >= 261) {
    const dv = view(data);
    const lo = dv.getBigUint64(245, true);
    const hi = dv.getBigInt64(253, true);
    virtualQuoteReserves = (hi << 64n) + lo;
  }
  return {
    baseMint: readAddress(data, 43),
    quoteMint: readAddress(data, 75),
    poolBaseTokenAccount: readAddress(data, 139),
    poolQuoteTokenAccount: readAddress(data, 171),
    virtualQuoteReserves,
  };
}

/** Reads the `amount` field (u64 at offset 64) of an SPL Token / Token-2022 account. */
export function decodeTokenAccountAmount(data: Uint8Array): bigint {
  if (data.length < 72) {
    throw new AccountDecodeError(`TokenAccount: expected >= 72 bytes, got ${data.length}`);
  }
  return view(data).getBigUint64(64, true);
}

/**
 * Decodes a Pyth PriceUpdateV2 account.
 * Layout: disc(8) | write_authority(32) | verification_level enum (Partial = 2 bytes, Full = 1 byte) |
 *         feed_id(32) | price i64 | conf u64 | exponent i32 | publish_time i64 | ...
 */
export function decodePythPrice(data: Uint8Array): PythPriceState {
  assertAccount(data, PYTH_PRICE_UPDATE_DISCRIMINATOR, 41, 'PythPriceUpdate');
  const levelTag = data[40];
  let offset: number;
  if (levelTag === 0) offset = 42;
  else if (levelTag === 1) offset = 41;
  else throw new AccountDecodeError(`PythPriceUpdate: unknown verification level tag ${levelTag}`);
  offset += 32; // feed_id
  if (data.length < offset + 28) {
    throw new AccountDecodeError('PythPriceUpdate: account too short for price message');
  }
  const dv = view(data);
  return {
    price: dv.getBigInt64(offset, true),
    exponent: dv.getInt32(offset + 16, true),
    publishTime: dv.getBigInt64(offset + 20, true),
  };
}
