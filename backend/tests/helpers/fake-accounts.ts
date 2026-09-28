/**
 * @file fake-accounts.ts
 * @description In-memory SolanaAccountsPort plus byte builders for test accounts.
 * @author Reborn1987
 */

import { getAddressEncoder, type Address } from '@solana/kit';

import {
  BONDING_CURVE_DISCRIMINATOR,
  PUMP_POOL_DISCRIMINATOR,
  PYTH_PRICE_UPDATE_DISCRIMINATOR,
} from '../../src/core/pricing/decoders.js';
import {
  SolanaAccountsPort,
  type AccountListener,
  type AccountSubscription,
  type MintSupply,
} from '../../src/ports/solana-accounts.js';

const enc = getAddressEncoder();

/** Fake account store; push() delivers new data to subscribers like a websocket notification. */
export class FakeAccounts extends SolanaAccountsPort {
  readonly data = new Map<string, Uint8Array>();
  readonly supplies = new Map<string, MintSupply>();
  readonly listeners = new Map<string, Set<AccountListener>>();
  /** owner|mint -> balance for getTokenBalance. */
  readonly balances = new Map<string, bigint>();
  /** Slot stamped on every delivery; tests bump it to simulate new blocks. */
  slot = 1n;

  /** Returns stored bytes or null. */
  async getAccount(address: string): Promise<Uint8Array | null> {
    return this.data.get(address) ?? null;
  }

  /** Returns stored supply or throws. */
  async getMintSupply(mint: string): Promise<MintSupply> {
    const s = this.supplies.get(mint);
    if (!s) throw new Error(`no supply for ${mint}`);
    return s;
  }

  /** Returns the stored owner/mint balance (0 if unset). */
  async getTokenBalance(owner: string, mint: string): Promise<bigint> {
    return this.balances.get(`${owner}|${mint}`) ?? 0n;
  }

  /** Stored accounts of `dataSize` bytes holding the address `bytes` at `offset` (the program isn't modelled). */
  async findProgramAccounts(_program: string, dataSize: number, match: { readonly offset: number; readonly bytes: string }): Promise<string[]> {
    const want = enc.encode(match.bytes as Address);
    return [...this.data].filter(([, d]) => d.length === dataSize && want.every((b, i) => d[match.offset + i] === b)).map(([a]) => a);
  }

  /** mint → its token accounts (owner + amount). */
  readonly holders = new Map<string, { owner: string; amount: bigint }[]>();

  /** Returns the stored token accounts (none if unset). */
  async getTokenHolders(mint: string): Promise<readonly { readonly owner: string; readonly amount: bigint }[]> {
    return this.holders.get(mint) ?? [];
  }

  /** Registers listener and immediately delivers current state (mirrors the real adapter). */
  subscribe(address: string, listener: AccountListener): AccountSubscription {
    let set = this.listeners.get(address);
    if (!set) this.listeners.set(address, (set = new Set()));
    set.add(listener);
    const current = this.data.get(address);
    if (current) listener(current, this.slot);
    return { stop: () => set.delete(listener) };
  }

  /** Stores new bytes and notifies subscribers at `slot` (defaults to the current slot). */
  push(address: string, bytes: Uint8Array, slot: bigint = this.slot): void {
    this.data.set(address, bytes);
    this.listeners.get(address)?.forEach((l) => l(bytes, slot));
  }

  /** Number of active subscribers on an address. */
  subscriberCount(address: string): number {
    return this.listeners.get(address)?.size ?? 0;
  }
}

/** Builds BondingCurve bytes (full modern layout, 151 bytes). */
export function curveBytes(opts: {
  vToken: bigint; vQuote: bigint; supply?: bigint; complete?: boolean; quoteMint?: Address; short?: boolean;
}): Uint8Array {
  const b = new Uint8Array(opts.short ? 49 : 151);
  b.set(BONDING_CURVE_DISCRIMINATOR, 0);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(8, opts.vToken, true);
  dv.setBigUint64(16, opts.vQuote, true);
  dv.setBigUint64(40, opts.supply ?? 1_000_000_000_000_000n, true);
  b[48] = opts.complete ? 1 : 0;
  if (!opts.short && opts.quoteMint) b.set(enc.encode(opts.quoteMint), 83);
  return b;
}

/** Builds PumpSwap Pool bytes. */
export function poolBytes(opts: {
  baseMint: Address; quoteMint: Address; baseTa: Address; quoteTa: Address; virtualQuote?: bigint; short?: boolean;
}): Uint8Array {
  const b = new Uint8Array(opts.short ? 203 : 300);
  b.set(PUMP_POOL_DISCRIMINATOR, 0);
  b.set(enc.encode(opts.baseMint), 43);
  b.set(enc.encode(opts.quoteMint), 75);
  b.set(enc.encode(opts.baseTa), 139);
  b.set(enc.encode(opts.quoteTa), 171);
  if (!opts.short) {
    const dv = new DataView(b.buffer);
    const v = opts.virtualQuote ?? 0n;
    dv.setBigUint64(245, v & 0xffffffffffffffffn, true);
    dv.setBigInt64(253, v >> 64n, true);
  }
  return b;
}

/** Builds an SPL token account with the given amount. */
export function tokenAccountBytes(amount: bigint): Uint8Array {
  const b = new Uint8Array(165);
  new DataView(b.buffer).setBigUint64(64, amount, true);
  return b;
}

/** Builds a Pyth PriceUpdateV2 account (Full verification level). */
export function pythBytes(price: bigint, exponent: number, level: 'full' | 'partial' = 'full'): Uint8Array {
  const b = new Uint8Array(134);
  b.set(PYTH_PRICE_UPDATE_DISCRIMINATOR, 0);
  let o = 40;
  if (level === 'full') b[o++] = 1;
  else { b[o++] = 0; b[o++] = 3; }
  o += 32;
  const dv = new DataView(b.buffer);
  dv.setBigInt64(o, price, true);
  dv.setInt32(o + 16, exponent, true);
  dv.setBigInt64(o + 20, 1_700_000_000n, true);
  return b;
}
