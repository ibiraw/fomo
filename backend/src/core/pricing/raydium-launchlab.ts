/**
 * @file raydium-launchlab.ts
 * @description Raydium LaunchLab (bonk.fun, stonkfun and others) bonding-curve decoding, PDA derivation, and finding
 *              a token's pool whatever it is paired with.
 *              Layout from raydium-io/raydium-idl raydium_launchpad.json, offsets verified on live pools
 *              2026-09-26 (VestingSchedule is 40 bytes, so global_config sits at 141).
 * @author Reborn1987
 */

import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';

import { AccountDecodeError } from '../errors.js';
import type { SolanaAccountsPort } from '../../ports/solana-accounts.js';
import { WSOL_MINT } from './addresses.js';

export const RAYDIUM_LAUNCHLAB_PROGRAM = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj' as Address;
/** Anchor "PoolState" discriminator (same name, and so same bytes, as CPMM — tell them apart by owner/PDA). */
export const LAUNCHLAB_POOL_DISCRIMINATOR = Uint8Array.from([247, 237, 227, 245, 215, 195, 222, 70]);
/** Pool status: 0 = trading on the curve; anything else = migrating/migrated. */
export const LAUNCHLAB_TRADING = 0;
/** GlobalConfig.curve_type: 0 = constant product (the only kind priced here). */
export const CURVE_CONSTANT_PRODUCT = 0;

const MIN_LEN = 365; // through the creator field
const dec = getAddressDecoder();

/** Fields needed for pricing. */
export interface LaunchLabPool {
  readonly status: number;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
  readonly virtualBase: bigint;
  readonly virtualQuote: bigint;
  readonly realBase: bigint;
  readonly realQuote: bigint;
  readonly globalConfig: Address;
  /** The launch platform built on LaunchLab (bonk.fun, stonkfun, …). */
  readonly platformConfig: Address;
  /** Who launched it (matches the launch transaction's signer, checked on live launches 2026-09-28). */
  readonly creator: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
}

/** Decodes a LaunchLab PoolState account. */
export function decodeLaunchLabPool(data: Uint8Array): LaunchLabPool {
  if (data.length < MIN_LEN) throw new AccountDecodeError(`LaunchLabPool: expected >= ${MIN_LEN} bytes, got ${data.length}`);
  for (let i = 0; i < 8; i++) {
    if (data[i] !== LAUNCHLAB_POOL_DISCRIMINATOR[i]) throw new AccountDecodeError('LaunchLabPool: discriminator mismatch');
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (o: number): bigint => dv.getBigUint64(o, true);
  return {
    status: data[17]!,
    baseDecimals: data[18]!,
    quoteDecimals: data[19]!,
    virtualBase: u64(37),
    virtualQuote: u64(45),
    realBase: u64(53),
    realQuote: u64(61),
    globalConfig: dec.decode(data.subarray(141, 173)),
    platformConfig: dec.decode(data.subarray(173, 205)),
    creator: dec.decode(data.subarray(333, 365)),
    baseMint: dec.decode(data.subarray(205, 237)),
    quoteMint: dec.decode(data.subarray(237, 269)),
  };
}

/** Reads GlobalConfig.curve_type (byte 16). */
export function decodeCurveType(globalConfig: Uint8Array): number {
  if (globalConfig.length < 17) throw new AccountDecodeError('LaunchLab GlobalConfig too short');
  return globalConfig[16]!;
}

/** Constant-product curve reserves as (base, quote): virtual + real quote vs virtual − real base. */
export function launchLabReserves(p: LaunchLabPool): { readonly base: bigint; readonly quote: bigint } {
  return { base: p.virtualBase - p.realBase, quote: p.virtualQuote + p.realQuote };
}

/** Quote tokens most LaunchLab curves are created against (SOL, USD1): their pools are found by address. */
export const LAUNCHLAB_QUOTES = [WSOL_MINT, 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB'] as const;

/** PoolState account size and where it stores the token (base mint): the search filter for other quotes. */
const POOL_SIZE = 429;
const BASE_MINT_OFFSET = 205;

/** Decodes a pool, or null when the account is missing, empty (dusted SOL) or not a LaunchLab pool of `mint`. */
function poolOf(raw: Uint8Array | null, mint: string): LaunchLabPool | null {
  if (!raw || raw.length === 0) return null;
  try {
    const pool = decodeLaunchLabPool(raw);
    return pool.baseMint === mint ? pool : null;
  } catch (err) {
    if (err instanceof AccountDecodeError) return null;
    throw err;
  }
}

/**
 * The token's LaunchLab pool: by address for a SOL or USD1 quote (cheap), else by searching LaunchLab's pools for the
 * token — platforms like stonkfun pair with other tokens (tokenized stocks). Null when it has none.
 */
export async function findLaunchLabPool(accounts: SolanaAccountsPort, mint: string): Promise<{ readonly address: string; readonly pool: LaunchLabPool } | null> {
  for (const quote of LAUNCHLAB_QUOTES) {
    const address = await deriveLaunchLabPool(mint as Address, quote as Address);
    const pool = poolOf(await accounts.getAccount(address), mint);
    if (pool) return { address, pool };
  }
  const [address] = await accounts.findProgramAccounts(RAYDIUM_LAUNCHLAB_PROGRAM, POOL_SIZE, { offset: BASE_MINT_OFFSET, bytes: mint });
  const pool = address ? poolOf(await accounts.getAccount(address), mint) : null;
  return address && pool ? { address, pool } : null;
}

/** Pool PDA: ["pool", base_mint, quote_mint]. */
export async function deriveLaunchLabPool(baseMint: Address, quoteMint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: RAYDIUM_LAUNCHLAB_PROGRAM,
    seeds: [new TextEncoder().encode('pool'), enc.encode(baseMint), enc.encode(quoteMint)],
  });
  return pda;
}
