/**
 * @file solana-subs-repair.test.ts
 * @description A stuck Solana subscriptions client is rebuilt after 10 connect failures in a minute, at most once a
 *              minute, and the owner is told (2026-10-02: ~90 failures a minute for 5 hours until a restart).
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { KitSolanaAccountsAdapter } from '../../src/adapters/solana/kit-solana-accounts.adapter.js';

type Internals = { subs: unknown; noteConnectFailure(now: number): void };

describe('Solana subscriptions self-repair', () => {
  it('rebuilds the client after 10 failures within a minute, at most once a minute, and reports it', () => {
    const repairs: string[] = [];
    const a = new KitSolanaAccountsAdapter('https://rpc.invalid', 'wss://rpc.invalid', () => undefined, null, () => undefined, (m) => repairs.push(m));
    const x = a as unknown as Internals;
    const first = x.subs;
    for (let i = 0; i < 9; i++) x.noteConnectFailure(1_000_000 + i * 1000);
    expect(x.subs).toBe(first);
    x.noteConnectFailure(1_009_500);
    expect(x.subs).not.toBe(first);
    expect(repairs).toHaveLength(1);
    const second = x.subs;
    for (let i = 0; i < 12; i++) x.noteConnectFailure(1_020_000 + i * 1000); // within a minute of the rebuild
    expect(x.subs).toBe(second);
    for (let i = 0; i < 10; i++) x.noteConnectFailure(1_080_000 + i * 100); // a minute later, still failing
    expect(x.subs).not.toBe(second);
    expect(repairs).toHaveLength(2);
  });

  it('ignores scattered failures', () => {
    const a = new KitSolanaAccountsAdapter('https://rpc.invalid', 'wss://rpc.invalid', () => undefined);
    const x = a as unknown as Internals;
    const first = x.subs;
    for (let i = 0; i < 30; i++) x.noteConnectFailure(i * 61_000);
    expect(x.subs).toBe(first);
  });
});
