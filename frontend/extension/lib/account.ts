/**
 * @file account.ts
 * @description Anonymous account helpers: the account key (random, made on install, doubles as the backup code), the
 *              wallets the account knows, and reading the user's fomo wallet addresses from fomo.family's own storage —
 *              silently, without opening anything on the page.
 * @author Reborn1987
 */

/** Public wallet addresses of the fomo account (mirror of the server's UserWallets). */
export interface Wallets {
  readonly solana: string | null;
  readonly evm: string | null;
}

/** What the server says about the logged-in account. */
export interface AccountView {
  readonly id: string;
  /** Short readable id ("AF-7K3Q2P") to quote to support. */
  readonly shortId: string;
  readonly wallets: Wallets;
}

const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/** New account key: 32 random bytes as base64url (43 characters). */
export function generateAccountKey(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** True for a well-formed account key / backup code (surrounding whitespace ignored). */
export function isAccountKey(s: string): boolean {
  return KEY_RE.test(s.trim());
}

/** Minimal read-only view of a Storage (lets tests pass a plain map). */
export interface StorageLike {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
}

/** Parses JSON, or null. */
function json(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The user's fomo wallets from fomo.family's localStorage (verified 2026-09-26):
 * - `privy:connections` — Privy login connections; the embedded wallet's `address` is the EVM address.
 * - `ph_<project>_posthog` → `$stored_person_properties.solanaAddress` / `.evmAddress` — fomo's own labels.
 * Anything missing or malformed comes back as null.
 */
export function readFomoWallets(storage: StorageLike): Wallets {
  let solana: string | null = null;
  let evm: string | null = null;

  const conns = json(storage.getItem('privy:connections'));
  if (Array.isArray(conns)) {
    const list = conns as { address?: unknown; walletClientType?: unknown }[];
    const pick = list.find((c) => c.walletClientType === 'privy') ?? list[0];
    if (typeof pick?.address === 'string' && EVM_RE.test(pick.address)) evm = pick.address.toLowerCase();
  }

  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k || !/^ph_.+_posthog$/.test(k)) continue;
    const props = (json(storage.getItem(k)) as { $stored_person_properties?: { solanaAddress?: unknown; evmAddress?: unknown } } | null)?.$stored_person_properties;
    if (!solana && typeof props?.solanaAddress === 'string' && SOLANA_RE.test(props.solanaAddress)) solana = props.solanaAddress;
    if (!evm && typeof props?.evmAddress === 'string' && EVM_RE.test(props.evmAddress)) evm = props.evmAddress.toLowerCase();
  }
  return { solana, evm };
}

/**
 * Wallets to send to the server after a detection, or null when nothing changes. Detected addresses replace the
 * account's; an address that wasn't detected is kept (never erased by a partial read).
 */
export function walletsUpdate(current: Wallets, detected: Wallets): Wallets | null {
  const next: Wallets = { solana: detected.solana ?? current.solana, evm: detected.evm ?? current.evm };
  return next.solana === current.solana && next.evm === current.evm ? null : next;
}

/** "JDY8…KQDg" style short form. */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}
