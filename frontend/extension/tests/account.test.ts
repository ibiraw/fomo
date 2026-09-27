/**
 * @file account.test.ts
 * @description Account key generation/validation, reading wallets from fomo's storage, and wallet update rules.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { generateAccountKey, isAccountKey, readFomoUserId, readFomoWallets, shortAddress, walletsUpdate, type StorageLike } from '../lib/account';

const SOL = 'JDY8BeQUPmcRZnYJGVBiU7x71SMbdUECW6NMUdGGKQDg';
const EVM = '0x59a1b6CC4Cfc711ce0fa70f48Fef4e4b7Dd2B103';

/** Storage backed by a plain object. */
function storage(items: Record<string, string>): StorageLike {
  const keys = Object.keys(items);
  return { length: keys.length, key: (i) => keys[i] ?? null, getItem: (k) => items[k] ?? null };
}

describe('account key', () => {
  it('is 43 base64url characters and validates', () => {
    const key = generateAccountKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isAccountKey(key)).toBe(true);
    expect(isAccountKey(`  ${key}\n`)).toBe(true);
    expect(isAccountKey('short')).toBe(false);
    expect(isAccountKey('has spaces in the middle of it xxxxxxxxxxxxx')).toBe(false);
    expect(generateAccountKey((b) => b.fill(255))).toBe('_'.repeat(42) + '8');
  });
});

describe('readFomoWallets', () => {
  it("reads the EVM address from Privy and both from fomo's analytics profile", () => {
    const s = storage({
      'privy:connections': JSON.stringify([{ address: '0x' + '1'.repeat(40), walletClientType: 'metamask' }, { address: EVM, walletClientType: 'privy' }]),
      ph_phc_abc_posthog: JSON.stringify({ $stored_person_properties: { solanaAddress: SOL, evmAddress: '0x' + '2'.repeat(40) } }),
      unrelated: 'x',
    });
    expect(readFomoWallets(s)).toEqual({ solana: SOL, evm: EVM.toLowerCase() }); // Privy wins for EVM
  });

  it('falls back to the analytics profile and ignores junk', () => {
    expect(readFomoWallets(storage({ ph_x_posthog: JSON.stringify({ $stored_person_properties: { solanaAddress: SOL, evmAddress: EVM } }) })))
      .toEqual({ solana: SOL, evm: EVM.toLowerCase() });
    expect(readFomoWallets(storage({ 'privy:connections': 'not json', ph_x_posthog: JSON.stringify({ $stored_person_properties: { solanaAddress: '0xnope' } }) })))
      .toEqual({ solana: null, evm: null });
    expect(readFomoWallets(storage({ 'privy:connections': JSON.stringify([{ address: 'bad' }]) }))).toEqual({ solana: null, evm: null });
    expect(readFomoWallets(storage({}))).toEqual({ solana: null, evm: null });
  });
});

describe('walletsUpdate', () => {
  it('fills in and replaces detected addresses, never erases, and skips no-ops', () => {
    expect(walletsUpdate({ solana: null, evm: null }, { solana: SOL, evm: null })).toEqual({ solana: SOL, evm: null });
    expect(walletsUpdate({ solana: SOL, evm: EVM }, { solana: null, evm: null })).toBeNull();
    expect(walletsUpdate({ solana: SOL, evm: null }, { solana: SOL, evm: null })).toBeNull();
    expect(walletsUpdate({ solana: 'old', evm: null }, { solana: SOL, evm: EVM })).toEqual({ solana: SOL, evm: EVM });
    expect(shortAddress(SOL)).toBe('JDY8…KQDg');
    expect(shortAddress('short')).toBe('short');
  });
});

describe('readFomoUserId', () => {
  it("reads fomo's Privy user id from its analytics storage and rejects anything else", () => {
    const DID = 'did:privy:cmabc123def456ghi789jkl0m';
    const ph = (privyId: unknown) => storage({ ph_phc_x_posthog: JSON.stringify({ $stored_person_properties: { privyId } }) });
    expect(readFomoUserId(ph(DID))).toBe(DID);
    for (const bad of ['did:other:abc123def456', "did:privy:x' OR 1=1", 'did:privy:', 42, null]) expect(readFomoUserId(ph(bad))).toBeNull();
    expect(readFomoUserId(storage({}))).toBeNull();
    expect(readFomoUserId(storage({ ph_phc_x_posthog: 'not json' }))).toBeNull();
  });
});
