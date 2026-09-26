/**
 * @file token-key.ts
 * @description Token keys shared with the server: a bare Solana mint, or `<chain>:<0xaddress>` (lowercase) for
 *              fomo's EVM chains. Maps keys to and from fomo's token page paths (`/tokens/<chain>/<address>`).
 *              Mirror of backend/src/core/chains/token-key.ts — keep in sync.
 * @author Reborn1987
 */

export const EVM_CHAINS = ['ethereum', 'base', 'bnb', 'robinhood', 'arc'] as const;
export type EvmChain = (typeof EVM_CHAINS)[number];

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** True when `chain` is one of fomo's supported EVM slugs. */
function isEvmChain(chain: string): chain is EvmChain {
  return (EVM_CHAINS as readonly string[]).includes(chain);
}

/** Splits a key into chain and address, or null when it is not a valid key. */
export function parseTokenKey(key: string): { chain: 'solana' | EvmChain; address: string } | null {
  if (SOLANA_ADDRESS.test(key)) return { chain: 'solana', address: key };
  const sep = key.indexOf(':');
  const chain = key.slice(0, sep);
  const address = key.slice(sep + 1);
  return sep > 0 && isEvmChain(chain) && EVM_ADDRESS.test(address) ? { chain, address: address.toLowerCase() } : null;
}

/** fomo page path for a token key (`/tokens/solana/<mint>`, `/tokens/base/0x…`). */
export function tokenPath(key: string): string {
  const ref = parseTokenKey(key);
  return ref ? `/tokens/${ref.chain}/${ref.address}` : `/tokens/solana/${key}`;
}

/** Token key for a fomo path like `/tokens/bnb/0xABC…` (query/trailing slash ignored), or null. */
export function keyFromPath(pathname: string): string | null {
  const m = /^\/tokens\/([a-z]+)\/([^/?#]+)\/?$/.exec(pathname);
  if (!m) return null;
  const [, chain, address] = m as unknown as [string, string, string];
  if (chain === 'solana') return SOLANA_ADDRESS.test(address) ? address : null;
  return isEvmChain(chain) && EVM_ADDRESS.test(address) ? `${chain}:${address.toLowerCase()}` : null;
}

/** Token address without the chain prefix. */
export function tokenAddress(key: string): string {
  return parseTokenKey(key)?.address ?? key;
}
