/**
 * @file token-metrics.test.ts
 * @description v1.9 token metrics: Solana (programs, burn and empty accounts left out, one owner's accounts added up,
 *              pump.fun's creator as dev), the EVM transfer replay (creation found by scanning back, "too old" past
 *              the budget, incremental updates, contracts skipped, crowded ranges split, token cap) and the service's
 *              routing and cache.
 * @author Reborn1987
 */

import { generateKeyPairSigner, getAddressEncoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { ERC20_ABI, Erc20Reader, TRANSFER_TOPIC } from '../../src/core/evm/erc20.js';
import { deriveBondingCurve } from '../../src/core/pricing/addresses.js';
import { FOMO_LAUNCH_WALLET, pumpCreator, solanaDev } from '../../src/core/tokens/launchpad-service.js';
import type { PoolDirectory } from '../../src/core/pricing/pool-directory.js';
import { LAUNCHLAB_POOL_DISCRIMINATOR } from '../../src/core/pricing/raydium-launchlab.js';
import { EvmHolderIndex, pctOf, SolanaTokenMetrics, TokenMetricsService, type TokenMetrics } from '../../src/core/tokens/token-metrics.js';
import type { EvmLog, Hex } from '../../src/ports/evm-rpc.js';
import { curveBytes, FakeAccounts } from '../helpers/fake-accounts.js';
import { FakeEvmRpc } from '../helpers/fake-evm.js';

const MINT = 'BQYSLwLtTGArYi89xqgsTxFcYLfLJerfwM1TsgZKzray';

/** n fresh wallet addresses (on the ed25519 curve, like real wallets). */
async function wallets(n: number): Promise<string[]> {
  return Promise.all(Array.from({ length: n }, async () => (await generateKeyPairSigner()).address as string));
}

/** Minimal Meteora DBC VirtualPool bytes: discriminator, creator, base mint. */
async function meteoraPoolBytes(baseMint: string, creator: string): Promise<Uint8Array> {
  const enc = getAddressEncoder();
  const b = new Uint8Array(424);
  b.set([213, 224, 5, 209, 98, 69, 119, 92], 0);
  b.set(enc.encode(creator as Address), 104);
  b.set(enc.encode(baseMint as Address), 136);
  return b;
}

describe('pctOf', () => {
  it('is a percentage of supply with 4 significant decimals, 0 for an empty supply', () => {
    expect(pctOf(25n, 100n)).toBe(25);
    expect(pctOf(1n, 3n)).toBe(33.3333);
    expect(pctOf(5n, 0n)).toBe(0);
  });
});

describe('SolanaTokenMetrics', () => {
  it('sums the 10 largest real holders, leaving out programs, the incinerator and empty accounts', async () => {
    const accounts = new FakeAccounts();
    accounts.supplies.set(MINT, { amount: 1_000n, decimals: 6 });
    const w = await wallets(12);
    const curve = await deriveBondingCurve(MINT as Address); // a program address: the bonding curve
    accounts.holders.set(MINT, [
      { owner: curve, amount: 500n },
      { owner: '1nc1nerator11111111111111111111111111111111', amount: 100n },
      { owner: w[11]!, amount: 0n },
      ...w.slice(0, 11).map((owner, i) => ({ owner, amount: BigInt(30 - i) })), // 30, 29, …, 20
      { owner: w[0]!, amount: 5n }, // a second account of the biggest wallet
    ]);
    const m = await new SolanaTokenMetrics(accounts, async () => null).metrics(MINT);
    // top 10 of 35, 29..21 → 35 + 225 = 260 of 1000
    expect(m).toEqual({ topTenPct: 26, topHoldersPct: [3.5, 2.9, 2.8, 2.7, 2.6], devWallet: null, devName: null, devHoldsPct: null, note: 'dev-unknown' });
  });

  it("takes pump.fun's recorded creator as the dev and reports what it holds", async () => {
    const accounts = new FakeAccounts();
    accounts.supplies.set(MINT, { amount: 1_000n, decimals: 6 });
    const [dev] = await wallets(1);
    const curve = curveBytes({ vToken: 1n, vQuote: 1n });
    curve.set((await import('@solana/kit')).getAddressEncoder().encode(dev as Address), 49);
    accounts.data.set(await deriveBondingCurve(MINT as Address), curve);
    accounts.holders.set(MINT, [{ owner: dev!, amount: 40n }]);
    expect(await pumpCreator(accounts)(MINT)).toBe(dev);
    expect(await pumpCreator(accounts)('Hx4U8tVw9vT3kJ3ZqA4W5uJ9i1YV2HhT8f1rXz7Cq1Pd')).toBeNull();
    const noPools = { find: async () => [] } as unknown as PoolDirectory;
    const m = await new SolanaTokenMetrics(accounts, solanaDev(accounts, noPools)).metrics(MINT);
    expect(m).toEqual({ topTenPct: 4, topHoldersPct: [4], devWallet: dev, devName: null, devHoldsPct: 4, note: null });
  });

  it("takes a LaunchLab pool's creator (stonkfun) and a Meteora DBC pool's creator, naming fomo's own wallet", async () => {
    const accounts = new FakeAccounts();
    const enc = getAddressEncoder();
    const [labDev] = await wallets(1);
    const lab = new Uint8Array(429);
    lab.set(LAUNCHLAB_POOL_DISCRIMINATOR, 0);
    lab.set(enc.encode(MINT as Address), 205);
    lab.set(enc.encode(labDev as Address), 333);
    accounts.data.set('3Vc5zM8nzPuvjxXXrTXbY6K1XCxGRB6WFojxQDLddCjN', lab);
    const noPools = { find: async () => [] } as unknown as PoolDirectory;
    expect(await solanaDev(accounts, noPools)(MINT)).toEqual({ wallet: labDev, name: null });

    const OTHER = 'ZrueWB1YvjruJpTGiJSYYfyuL71FZeeSUwJY1ZPeyes';
    const dbc = await meteoraPoolBytes(OTHER, FOMO_LAUNCH_WALLET);
    accounts.data.set('DbcPool111111111111111111111111111111111111', dbc);
    const listed = { find: async () => [{ dexId: 'meteoradbc', address: 'DbcPool111111111111111111111111111111111111' }] } as unknown as PoolDirectory;
    expect(await solanaDev(accounts, listed)(OTHER)).toEqual({ wallet: FOMO_LAUNCH_WALLET, name: 'fomo' });
    expect(await solanaDev(accounts, noPools)('Hx4U8tVw9vT3kJ3ZqA4W5uJ9i1YV2HhT8f1rXz7Cq1Pd')).toBeNull();
  });
});

const TOKEN = '0x' + 'ab'.repeat(20);
const word = (v: bigint): string => v.toString(16).padStart(64, '0');
const topic = (addr: string): Hex => `0x${'0'.repeat(24)}${addr.slice(2)}`;
const ZERO = '0x' + '0'.repeat(40);
const addr = (n: number): string => '0x' + n.toString(16).padStart(40, '0');

/** A Transfer log of `value` from → to at a block. */
function transfer(from: string, to: string, value: bigint, block: bigint, tx: Hex = '0x01', logIndex = 0): EvmLog {
  return { address: TOKEN as Hex, topics: [TRANSFER_TOPIC, topic(from), topic(to)], data: `0x${word(value)}`, blockNumber: block, logIndex, transactionHash: tx };
}

/** A chain with the token's supply answer, and an index over it with a small chunk and budget. */
function evmSetup(opts: { maxChunks?: number; freshMs?: number; maxTokens?: number; answerWithinMs?: number; maxHolders?: number } = {}) {
  let t = 0;
  const rpc = new FakeEvmRpc('base');
  rpc.on(TOKEN, ERC20_ABI, 'totalSupply', 1_000n);
  const index = new EvmHolderIndex(rpc, new Erc20Reader(rpc), { chunkBlocks: 100n, maxChunks: opts.maxChunks ?? 5, concurrency: 2, maxTokens: opts.maxTokens ?? 40, freshMs: opts.freshMs ?? 1_000, answerWithinMs: opts.answerWithinMs ?? 5_000, ...(opts.maxHolders ? { maxHolders: opts.maxHolders } : {}) }, () => t);
  return { rpc, index, advance: (ms: number) => { t += ms; } };
}

describe('EvmHolderIndex', () => {
  it('replays transfers from the creation, skipping contracts, burns and the zero address, with the creator as dev', async () => {
    const { rpc, index } = evmSetup();
    rpc.head = 450n;
    const DEV = addr(0xde);
    const POOL = addr(0x9001);
    rpc.contracts.add(POOL);
    rpc.senders.set('0xc0', DEV as Hex);
    rpc.history = [
      transfer(ZERO, POOL, 1_000n, 120n, '0xc0'), // creation: the whole supply into the curve / pool
      transfer(POOL, DEV, 100n, 120n, '0xc0', 1),
      transfer(POOL, addr(1), 300n, 200n),
      transfer(POOL, addr(2), 50n, 300n),
      transfer(DEV, addr(0xdead), 40n, 400n), // dev burns part of theirs
      transfer(addr(1), addr(2), 100n, 440n),
    ];
    const m = await index.metrics(TOKEN);
    // wallets: 1 → 200, 2 → 150, dev → 60 ; pool (contract) and 0x…dead left out
    expect(m).toEqual({ topTenPct: 41, topHoldersPct: [20, 15, 6], devWallet: DEV, devName: null, devHoldsPct: 6, note: null });
    expect(rpc.getLogsCalls.length).toBeLessThanOrEqual(5);
  });

  it('stops scanning a token with more holders than the cap (an established token, not a fresh coin)', async () => {
    const { rpc, index } = evmSetup({ maxChunks: 5, maxHolders: 3 });
    rpc.head = 450n;
    rpc.history = [
      transfer(ZERO, addr(1), 1_000n, 10n), // the creation is in the last chunk; the cap stops the scan before it
      ...[2, 3, 4, 5].map((n, i) => transfer(addr(1), addr(n), 1n, 440n - BigInt(i))),
    ];
    expect((await index.metrics(TOKEN)).note).toBe('too-old');
    expect(rpc.getLogsCalls.length).toBeLessThan(5);
  });

  it('says "too old" when the creation is beyond the scan budget', async () => {
    const { rpc, index } = evmSetup({ maxChunks: 2 });
    rpc.head = 1_000n;
    rpc.history = [transfer(ZERO, addr(1), 1_000n, 10n), transfer(addr(1), addr(2), 5n, 950n)];
    expect(await index.metrics(TOKEN)).toEqual({ topTenPct: null, topHoldersPct: [], devWallet: null, devName: null, devHoldsPct: null, note: 'too-old' });
    expect(rpc.getLogsCalls).toHaveLength(2);
  });

  it('adds only new blocks once built, and not at all while fresh', async () => {
    const { rpc, index, advance } = evmSetup();
    rpc.head = 150n;
    rpc.senders.set('0xc0', addr(1) as Hex);
    rpc.history = [transfer(ZERO, addr(1), 1_000n, 100n, '0xc0')];
    expect((await index.metrics(TOKEN)).topTenPct).toBe(100);
    const calls = rpc.getLogsCalls.length;
    rpc.history.push(transfer(addr(1), addr(2), 400n, 180n));
    rpc.head = 200n;
    await index.metrics(TOKEN);
    expect(rpc.getLogsCalls.length).toBe(calls); // still fresh
    advance(1_000);
    const m = await index.metrics(TOKEN);
    expect(rpc.getLogsCalls.slice(calls)).toEqual([[151n, 200n]]);
    expect(m).toMatchObject({ topTenPct: 100, devHoldsPct: 60 });
  });

  it('answers "counting" when the first count is slow, then the numbers once it has finished', async () => {
    const { rpc, index } = evmSetup({ answerWithinMs: 20 });
    rpc.head = 150n;
    rpc.senders.set('0xc0', addr(1) as Hex);
    rpc.history = [transfer(ZERO, addr(1), 1_000n, 100n, '0xc0')];
    const real = rpc.getLogs.bind(rpc);
    rpc.getLogs = async (f, from, to) => { await new Promise((r) => setTimeout(r, 60)); return real(f, from, to); };
    expect(await index.metrics(TOKEN)).toMatchObject({ topTenPct: null, note: 'counting' });
    await new Promise((r) => setTimeout(r, 150)); // the count carried on in the background
    const calls = rpc.getLogsCalls.length;
    expect(await index.metrics(TOKEN)).toMatchObject({ topTenPct: 100, note: null });
    expect(rpc.getLogsCalls.length).toBe(calls); // no second count
  });

  it('splits a range the provider finds too big, and rethrows other errors', async () => {
    const { rpc, index } = evmSetup();
    rpc.head = 99n;
    rpc.senders.set('0xc0', addr(1) as Hex);
    rpc.history = [transfer(ZERO, addr(1), 1_000n, 10n, '0xc0'), transfer(addr(1), addr(2), 1n, 90n)];
    const real = rpc.getLogs.bind(rpc);
    rpc.getLogs = async (f, from, to) => {
      if (to - from > 30n) throw new Error('Request exceeds defined limit.');
      return real(f, from, to);
    };
    expect((await index.metrics(TOKEN)).topTenPct).toBe(100);
    const other = evmSetup();
    other.rpc.getLogs = async () => { throw new Error('connection reset'); };
    await expect(other.index.metrics(TOKEN)).rejects.toThrow('connection reset');
  });
});

describe('TokenMetricsService', () => {
  it('routes by chain, caches for 20 s, shares lookups in flight, and says when a chain has no metrics', async () => {
    let t = 0;
    let calls = 0;
    const value: TokenMetrics = { topTenPct: 12, topHoldersPct: [5], devWallet: null, devName: null, devHoldsPct: null, note: 'dev-unknown' };
    const svc = new TokenMetricsService((chain) => (chain === 'solana' ? { metrics: async () => { calls++; return value; } } : null), () => t);
    await Promise.all([svc.get(MINT), svc.get(MINT)]);
    expect(calls).toBe(1);
    t += 19_000;
    await svc.get(MINT);
    expect(calls).toBe(1);
    t += 2_000;
    await svc.get(MINT);
    expect(calls).toBe(2);
    await expect(svc.get(`base:${TOKEN}`)).rejects.toThrow(/aren't available on base/);
    let answer: TokenMetrics = { ...value, note: 'counting' };
    const counting = new TokenMetricsService(() => ({ metrics: async () => answer }), () => t);
    await counting.get(MINT);
    answer = value;
    expect((await counting.get(MINT)).note).toBe('dev-unknown'); // "counting" was not cached
  });
});
