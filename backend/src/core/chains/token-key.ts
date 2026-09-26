/**
 * @file token-key.ts
 * @description Token identity across chains. Orders, watches and the extension protocol address a token by one
 *              string key: a bare base58 mint for Solana (kept for orders stored before EVM support) and
 *              `<chain>:<0xaddress>` (lowercase) for EVM chains. Chain names are fomo's URL slugs.
 * @author Reborn1987
 */

import { ValidationError } from '../errors.js';

/** EVM chains fomo trades on, named by fomo's URL slug (`fomo.family/tokens/<chain>/<address>`). */
export const EVM_CHAINS = ['ethereum', 'base', 'bnb', 'robinhood', 'arc'] as const;
export type EvmChain = (typeof EVM_CHAINS)[number];
export type Chain = 'solana' | EvmChain;

/** A token on a specific chain. */
export type TokenRef = { readonly chain: 'solana'; readonly address: string } | { readonly chain: EvmChain; readonly address: `0x${string}` };

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** True when `chain` is one of the supported EVM slugs. */
export function isEvmChain(chain: string): chain is EvmChain {
  return (EVM_CHAINS as readonly string[]).includes(chain);
}

/** Parses a token key; throws ValidationError when it is neither a Solana mint nor `<evm chain>:<0xaddress>`. */
export function parseTokenKey(key: string): TokenRef {
  if (SOLANA_ADDRESS.test(key)) return { chain: 'solana', address: key };
  const sep = key.indexOf(':');
  const chain = key.slice(0, sep);
  const address = key.slice(sep + 1);
  if (sep > 0 && isEvmChain(chain) && EVM_ADDRESS.test(address)) return { chain, address: address.toLowerCase() as `0x${string}` };
  throw new ValidationError(`Not a valid token: ${key}`);
}

/** Canonical key for a token (EVM addresses lowercased). */
export function tokenKey(ref: TokenRef): string {
  return ref.chain === 'solana' ? ref.address : `${ref.chain}:${ref.address.toLowerCase()}`;
}

/** Normalizes any accepted key to its canonical form (throws ValidationError when invalid). */
export function canonicalTokenKey(key: string): string {
  return tokenKey(parseTokenKey(key));
}

/** True when `key` parses as a token key. */
export function isTokenKey(key: string): boolean {
  try {
    parseTokenKey(key);
    return true;
  } catch {
    return false;
  }
}

/** DexScreener's chain id for a chain (fomo's `bnb` is DexScreener's `bsc`). */
export function dexScreenerChain(chain: Chain): string {
  return chain === 'bnb' ? 'bsc' : chain;
}
