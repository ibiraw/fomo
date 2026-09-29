/**
 * @file token-metrics.ts
 * @description v1.9 token metrics: the share of supply held by the 10 largest real holders, and how much the dev
 *              (creator) wallet holds right now. Pools, bonding curves, lockers and burn addresses are not holders:
 *                Solana — every token account of the mint (owner + amount); owners that are program addresses (off
 *                         the ed25519 curve) or the incinerator are left out, accounts of one owner are added up. The dev
 *                         is the creator the launchpad records (pump.fun, LaunchLab, Meteora DBC); fomo launches its own
 *                         coins, so for those the dev is fomo's wallet.
 *                EVM    — a token has no holder list, so its Transfer logs are replayed from its creation (found by
 *                         scanning back from the newest block, in 10k-block chunks, up to a budget — fresh tokens fit,
 *                         old ones are "too old"), then kept up to date incrementally. Contracts are left out; the dev
 *                         is the wallet that sent the creation transaction.
 * @author Reborn1987
 */

import { isOffCurveAddress, type Address } from '@solana/kit';

import { parseTokenKey, type Chain, type EvmChain } from '../chains/token-key.js';
import { TRANSFER_TOPIC, type Erc20Reader } from '../evm/erc20.js';
import type { EvmLog, EvmRpcPort, Hex } from '../../ports/evm-rpc.js';
import type { SolanaAccountsPort } from '../../ports/solana-accounts.js';
import type { Dev } from './launchpad-service.js';

/** What the metrics say about one token. */
export interface TokenMetrics {
  /** % of supply held by the 10 largest real holders; null when unknown. */
  readonly topTenPct: number | null;
  /** The 5 largest real holders' shares (%), biggest first (empty when unknown). */
  readonly topHoldersPct: readonly number[];
  /** The dev (creator) wallet, when known. */
  readonly devWallet: string | null;
  /** The dev's name when it is a platform's own wallet ("fomo"), else null. */
  readonly devName: string | null;
  /** % of supply the dev holds right now; null when the dev is unknown. */
  readonly devHoldsPct: number | null;
  /**
   * Why something is missing: the EVM token is older than the scan window, the launchpad doesn't record its dev, or
   * its first count is still running (a busy token's history takes a while; ask again shortly).
   */
  readonly note: 'too-old' | 'dev-unknown' | 'counting' | null;
}

/** Metrics for tokens of one chain. */
export interface TokenMetricsSource {
  metrics(address: string): Promise<TokenMetrics>;
}

/** raw / supply as a percentage with 2 decimals of precision. */
export function pctOf(raw: bigint, supply: bigint): number {
  if (supply <= 0n) return 0;
  return Number((raw * 1_000_000n) / supply) / 10_000;
}

/** Solana's burn address (tokens sent here are gone). */
const INCINERATOR = '1nc1nerator11111111111111111111111111111111';

/** Solana: largest token accounts → real holders; dev from the launchpad record. */
export class SolanaTokenMetrics implements TokenMetricsSource {
  /** @param accounts RPC @param devOf the token's dev, or null when its launchpad isn't known */
  constructor(private readonly accounts: SolanaAccountsPort, private readonly devOf: (mint: string) => Promise<Dev | null>) {}

  /** Top-10 share and dev holdings. */
  async metrics(mint: string): Promise<TokenMetrics> {
    const [supply, holders, dev] = await Promise.all([this.accounts.getMintSupply(mint), this.accounts.getTokenHolders(mint), this.devOf(mint)]);
    const byOwner = new Map<string, bigint>();
    for (const { owner, amount } of holders) {
      if (amount === 0n || owner === INCINERATOR || isOffCurveAddress(owner as Address)) continue; // empty, burned, or a program (pool, curve, locker)
      byOwner.set(owner, (byOwner.get(owner) ?? 0n) + amount);
    }
    const top = [...byOwner.values()].sort((x, y) => (y > x ? 1 : y < x ? -1 : 0)).slice(0, 10);
    const topTen = top.reduce((s, v) => s + v, 0n);
    const devHolds = dev ? (byOwner.get(dev.wallet) ?? 0n) : null;
    return {
      topTenPct: pctOf(topTen, supply.amount),
      topHoldersPct: top.slice(0, 5).map((v) => pctOf(v, supply.amount)),
      devWallet: dev?.wallet ?? null,
      devName: dev?.name ?? null,
      devHoldsPct: devHolds === null ? null : pctOf(devHolds, supply.amount),
      note: dev ? null : 'dev-unknown',
    };
  }
}

/** Tuning for the EVM transfer replay. */
export interface EvmIndexOptions {
  /** Blocks per eth_getLogs request (the provider's limit). */
  readonly chunkBlocks: bigint;
  /** Most chunks scanned back looking for the token's creation (the "fresh token" window). */
  readonly maxChunks: number;
  /** Requests in flight at once. */
  readonly concurrency: number;
  /** Tokens kept indexed (least recently asked dropped first). */
  readonly maxTokens: number;
  /** An index younger than this is answered without fetching new blocks. */
  readonly freshMs: number;
  /** Longest wait for a first count before answering "counting" (it carries on in the background). */
  readonly answerWithinMs: number;
  /** A token with more holders than this while scanning is no fresh coin: answered "too old" (bounds memory). */
  readonly maxHolders?: number;
}

/** Default `maxHolders`. */
const MAX_HOLDERS = 200_000;

export const DEFAULT_EVM_INDEX: EvmIndexOptions = { chunkBlocks: 10_000n, maxChunks: 60, concurrency: 6, maxTokens: 40, freshMs: 15_000, answerWithinMs: 8_000 };

/**
 * History budget per chain, in 10k-block requests (the provider's cap), sized from measured block times (2026-09-28):
 * Ethereum 12 s → ~2 weeks, Base 2 s → 2 weeks, BNB 0.45 s → 7 days, Arc 0.5 s → 7 days, Robinhood 0.1 s → 7 days
 * (3 days left a 4-day-old pons coin with 2K holders "too old"; counting it from scratch over 7 days took 13 s, answered
 * as "counting" first, 2026-09-28).
 */
export const EVM_SCAN_CHUNKS: Readonly<Record<EvmChain, number>> = { ethereum: 12, base: 61, bnb: 135, arc: 121, robinhood: 605 };

/** The provider refused a range, or timed out on it, because it holds too many logs for one answer. */
function isTooManyLogs(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (/exceed|too many|too large|size limit|response size|took too long|timed? ?out/i.test(e.message)) return true;
  }
  return false;
}

const ZERO_TOPIC_ADDRESS = '0x0000000000000000000000000000000000000000';
/** Common burn addresses (not holders). */
const BURN = new Set([ZERO_TOPIC_ADDRESS, '0x000000000000000000000000000000000000dead']);

/** One token's replayed balances. */
interface Indexed {
  readonly balances: Map<string, bigint>;
  /** Last block included. */
  scannedTo: bigint;
  /** Transaction that minted the supply (creation). */
  readonly creationTx: Hex;
  dev: Hex | null;
  updatedAt: number;
}

/** "0x…" address from an indexed topic. */
const topicAddress = (topic: Hex): string => `0x${topic.slice(26).toLowerCase()}`;

/** EVM: replays a token's Transfer logs from its creation and keeps them current. */
export class EvmHolderIndex implements TokenMetricsSource {
  private readonly tokens = new Map<string, Indexed | 'too-old'>();
  private readonly contracts = new Map<string, boolean>();
  private readonly inflight = new Map<string, Promise<Indexed | 'too-old'>>();

  /** @param rpc chain RPC @param erc20 token reads @param opts replay tuning @param now clock */
  constructor(
    private readonly rpc: EvmRpcPort,
    private readonly erc20: Erc20Reader,
    private readonly opts: EvmIndexOptions = DEFAULT_EVM_INDEX,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Top-10 share and dev holdings; "too old" when the creation is beyond the scan window, "counting" when the first
   * count takes longer than `answerWithinMs` (it keeps running, and the next ask gets the numbers).
   */
  async metrics(address: string): Promise<TokenMetrics> {
    const token = address.toLowerCase() as Hex;
    const pending = this.index(token);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), this.opts.answerWithinMs); });
    const idx = await Promise.race([pending, late]).finally(() => clearTimeout(timer));
    if (idx === 'late') {
      pending.catch(() => undefined); // still counting; a failure surfaces on the next ask
      return { topTenPct: null, topHoldersPct: [], devWallet: null, devName: null, devHoldsPct: null, note: 'counting' };
    }
    if (idx === 'too-old') return { topTenPct: null, topHoldersPct: [], devWallet: null, devName: null, devHoldsPct: null, note: 'too-old' };
    const supply = await this.erc20.totalSupply(token);
    const ranked = [...idx.balances.entries()].filter(([a, v]) => v > 0n && !BURN.has(a)).sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
    const top: bigint[] = [];
    // Walk down the ranking until 10 wallets are found (pools, curves and other contracts are skipped).
    for (let i = 0; i < ranked.length && top.length < 10; i += this.opts.concurrency) {
      const batch = ranked.slice(i, i + this.opts.concurrency);
      const flags = await Promise.all(batch.map(([a]) => this.isContract(a as Hex)));
      batch.forEach(([, v], j) => {
        if (!flags[j] && top.length < 10) top.push(v);
      });
    }
    const topTen = top.reduce((s, v) => s + v, 0n);
    const dev = (idx.dev ??= (await this.rpc.transactionSender(idx.creationTx)).toLowerCase() as Hex);
    return {
      topTenPct: pctOf(topTen, supply),
      topHoldersPct: top.slice(0, 5).map((v) => pctOf(v, supply)),
      devWallet: dev,
      devName: null,
      devHoldsPct: pctOf(idx.balances.get(dev) ?? 0n, supply),
      note: null,
    };
  }

  /** Cached contract check per address. */
  private async isContract(a: Hex): Promise<boolean> {
    const hit = this.contracts.get(a);
    if (hit !== undefined) return hit;
    const is = await this.rpc.isContract(a);
    this.contracts.set(a, is);
    if (this.contracts.size > 20_000) this.contracts.delete(this.contracts.keys().next().value!);
    return is;
  }

  /** The token's index: built on first ask, then extended with new blocks when older than `freshMs`. */
  private index(token: Hex): Promise<Indexed | 'too-old'> {
    const running = this.inflight.get(token);
    if (running) return running;
    const p = this.refresh(token).finally(() => this.inflight.delete(token));
    this.inflight.set(token, p);
    return p;
  }

  /** Builds or extends the index. */
  private async refresh(token: Hex): Promise<Indexed | 'too-old'> {
    const current = this.tokens.get(token);
    this.tokens.delete(token); // re-inserted below: most recently asked last
    if (current === 'too-old') return this.keep(token, current);
    if (current && this.now() - current.updatedAt < this.opts.freshMs) return this.keep(token, current);
    const head = await this.rpc.blockNumber();
    if (current && head - current.scannedTo <= this.opts.chunkBlocks * BigInt(this.opts.maxChunks)) {
      apply(current.balances, await this.fetchRange(token, current.scannedTo + 1n, head));
      current.scannedTo = head;
      current.updatedAt = this.now();
      return this.keep(token, current);
    }
    return this.keep(token, await this.build(token, head));
  }

  /** Stores the index (dropping the least recently asked token past the cap). */
  private keep(token: Hex, value: Indexed | 'too-old'): Indexed | 'too-old' {
    this.tokens.set(token, value);
    if (this.tokens.size > this.opts.maxTokens) this.tokens.delete(this.tokens.keys().next().value!);
    return value;
  }

  /**
   * Scans back from `head` until the mint (creation) is found or the budget runs out. Each batch of logs is added to
   * the balances straight away and dropped: keeping every log of a busy token until its creation turned up filled the
   * server's memory (over 1 GB, then a crash, 2026-09-29) — only to answer "too old".
   */
  private async build(token: Hex, head: bigint): Promise<Indexed | 'too-old'> {
    const { chunkBlocks, maxChunks, concurrency } = this.opts;
    const maxHolders = this.opts.maxHolders ?? MAX_HOLDERS;
    const balances = new Map<string, bigint>();
    let creation: EvmLog | null = null;
    for (let start = 0; start < maxChunks && !creation; start += concurrency) {
      const ranges: [bigint, bigint][] = [];
      for (let i = start; i < Math.min(start + concurrency, maxChunks); i++) {
        const to = head - BigInt(i) * chunkBlocks;
        if (to < 0n) break;
        const from = to - chunkBlocks + 1n;
        ranges.push([from < 0n ? 0n : from, to]);
      }
      if (ranges.length === 0) break;
      const batches = await Promise.all(ranges.map(([from, to]) => this.logs(token, from, to)));
      for (const b of batches) {
        apply(balances, b);
        const mint = earliestMint(b);
        if (mint) creation = creation ? earliestMint([creation, mint]) : mint;
      }
      if (balances.size > maxHolders) return 'too-old'; // an established token, not a fresh coin
      if (ranges[ranges.length - 1]![0] === 0n) break; // reached the chain's first block
    }
    if (!creation) return 'too-old';
    return { balances, scannedTo: head, creationTx: creation.transactionHash, dev: null, updatedAt: this.now() };
  }

  /** Transfer logs in [from, to]; a range with too many logs for one answer is split in halves. */
  private async logs(token: Hex, from: bigint, to: bigint): Promise<EvmLog[]> {
    try {
      return await this.rpc.getLogs({ address: token, topics: [TRANSFER_TOPIC] }, from, to);
    } catch (err) {
      if (!isTooManyLogs(err) || to <= from) throw err;
      const mid = from + (to - from) / 2n;
      const [a, b] = await Promise.all([this.logs(token, from, mid), this.logs(token, mid + 1n, to)]);
      return [...a, ...b];
    }
  }

  /** All Transfer logs in [from, to], in chunk-sized requests. */
  private async fetchRange(token: Hex, from: bigint, to: bigint): Promise<EvmLog[]> {
    const ranges: [bigint, bigint][] = [];
    for (let f = from; f <= to; f += this.opts.chunkBlocks) ranges.push([f, f + this.opts.chunkBlocks - 1n > to ? to : f + this.opts.chunkBlocks - 1n]);
    const out: EvmLog[] = [];
    for (let i = 0; i < ranges.length; i += this.opts.concurrency) {
      const batches = await Promise.all(ranges.slice(i, i + this.opts.concurrency).map(([f, t]) => this.logs(token, f, t)));
      for (const b of batches) out.push(...b);
    }
    return out;
  }
}

/** Is this log a Transfer we can read (from, to indexed; value in data)? */
const isTransfer = (l: EvmLog): boolean => l.topics[0] === TRANSFER_TOPIC && l.topics.length === 3 && l.data.length >= 66;

/** The first mint (Transfer from 0x0) among the logs, or null. */
function earliestMint(logs: readonly EvmLog[]): EvmLog | null {
  let first: EvmLog | null = null;
  for (const l of logs) {
    if (!isTransfer(l) || topicAddress(l.topics[1]!) !== ZERO_TOPIC_ADDRESS) continue;
    if (!first || l.blockNumber < first.blockNumber || (l.blockNumber === first.blockNumber && l.logIndex < first.logIndex)) first = l;
  }
  return first;
}

/** Adds the logs' transfers to the balances (order doesn't matter: the result is a sum). */
function apply(balances: Map<string, bigint>, logs: readonly EvmLog[]): void {
  for (const l of logs) {
    if (!isTransfer(l)) continue;
    const value = BigInt(`0x${l.data.slice(2, 66)}`);
    const from = topicAddress(l.topics[1]!);
    const to = topicAddress(l.topics[2]!);
    if (from !== ZERO_TOPIC_ADDRESS) {
      const left = (balances.get(from) ?? 0n) - value;
      if (left === 0n) balances.delete(from);
      else balances.set(from, left);
    }
    balances.set(to, (balances.get(to) ?? 0n) + value);
  }
}

const METRICS_TTL_MS = 20_000;
const MAX_CACHED = 2_000;

/** Routes a token key to its chain's source, with a short cache and shared in-flight lookups. */
export class TokenMetricsService {
  private readonly cache = new Map<string, { at: number; value: TokenMetrics }>();
  private readonly inflight = new Map<string, Promise<TokenMetrics>>();

  /** @param sources each chain's source (none: not available there) @param now clock */
  constructor(private readonly sources: (chain: Chain) => TokenMetricsSource | null, private readonly now: () => number = Date.now) {}

  /** Metrics for a token key (Solana mint or `<chain>:<0x…>`). */
  async get(key: string): Promise<TokenMetrics> {
    const ref = parseTokenKey(key);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < METRICS_TTL_MS) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const source = this.sources(ref.chain);
    if (!source) throw new Error(`Token metrics aren't available on ${ref.chain} yet`);
    const p = source.metrics(ref.address).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    const value = await p;
    if (value.note === 'counting') return value; // not an answer yet: ask the source again next time
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), value });
    if (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
}
