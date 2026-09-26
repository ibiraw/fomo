/**
 * @file metadata.ts
 * @description Decoders for token metadata: Token-2022 TokenMetadata extension (newer pump.fun coins)
 *              and Metaplex Token Metadata accounts (older coins). Verified on live pump coins 2026-09-26.
 * @author Reborn1987
 */

import { getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';

/** Metaplex Token Metadata program. */
export const METAPLEX_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s' as Address;
/** Token-2022 extension type id of TokenMetadata. */
const TOKEN_METADATA_EXTENSION = 19;
/** Token-2022 mints: base mint padded to 165 bytes, then 1 account-type byte, then TLV extensions. */
const TLV_START = 166;
const ACCOUNT_TYPE_MINT = 1;

/** Name, symbol and off-chain JSON URI. */
export interface TokenMetadata {
  readonly name: string;
  readonly symbol: string;
  readonly uri: string;
}

/** Reads a borsh string (u32 length + utf8) at `offset`; returns value and next offset, or null if out of bounds. */
function readString(b: Uint8Array, offset: number): { value: string; next: number } | null {
  if (offset + 4 > b.length) return null;
  const len = new DataView(b.buffer, b.byteOffset + offset, 4).getUint32(0, true);
  const end = offset + 4 + len;
  if (end > b.length) return null;
  return { value: new TextDecoder().decode(b.subarray(offset + 4, end)).replace(/\0+$/, '').trim(), next: end };
}

/** Reads name/symbol/uri as three consecutive borsh strings starting at `offset`. */
function readTriple(b: Uint8Array, offset: number): TokenMetadata | null {
  const name = readString(b, offset);
  const symbol = name && readString(b, name.next);
  const uri = symbol && readString(b, symbol.next);
  return name && symbol && uri ? { name: name.value, symbol: symbol.value, uri: uri.value } : null;
}

/**
 * Finds the TokenMetadata extension in a Token-2022 mint account.
 * Value layout: update_authority(32) | mint(32) | name | symbol | uri | additional_metadata.
 * Returns null for classic SPL mints or mints without the extension.
 */
export function decodeToken2022Metadata(mintData: Uint8Array): TokenMetadata | null {
  if (mintData.length <= TLV_START || mintData[TLV_START - 1] !== ACCOUNT_TYPE_MINT) return null;
  const dv = new DataView(mintData.buffer, mintData.byteOffset, mintData.byteLength);
  let o = TLV_START;
  while (o + 4 <= mintData.length) {
    const type = dv.getUint16(o, true);
    const len = dv.getUint16(o + 2, true);
    if (type === TOKEN_METADATA_EXTENSION) return readTriple(mintData.subarray(0, o + 4 + len), o + 4 + 64);
    if (type === 0 && len === 0) break; // uninitialized padding
    o += 4 + len;
  }
  return null;
}

/** Decodes a Metaplex metadata account: key(1) | update_authority(32) | mint(32) | name | symbol | uri. */
export function decodeMetaplexMetadata(data: Uint8Array): TokenMetadata | null {
  return data.length > 65 ? readTriple(data, 65) : null;
}

/** Metaplex metadata PDA: ["metadata", program, mint]. */
export async function deriveMetaplexMetadata(mint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: METAPLEX_PROGRAM,
    seeds: [new TextEncoder().encode('metadata'), enc.encode(METAPLEX_PROGRAM), enc.encode(mint)],
  });
  return pda;
}
