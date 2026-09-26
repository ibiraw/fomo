/**
 * @file evm-pool-price-feed.ts
 * @description Live on-chain prices for EVM tokens that trade in AMM pools, on one chain:
 *              - v2 pairs (Uniswap v2, PancakeSwap v2 …): getReserves, then every Sync event.
 *              - v3 pools (Uniswap v3, PancakeSwap v3): slot0, then every Swap event (sqrtPriceX96).
 *              - Uniswap v4 pools (singleton PoolManager): StateView.getSlot0(poolId), then Swap events for the id.
 *              Pools are discovered via DexScreener (most liquid supported pool) and read on-chain from then on.
 *              USD = price in the pool's other token × that token's USD price (EvmUsdQuotes).
 * @author Reborn1987
 */

import { parseAbi, toEventSelector } from 'viem';

import { dexScreenerChain, parseTokenKey, type EvmChain } from '../chains/token-key.js';
import { UnsupportedPoolError } from '../errors.js';
import type { ListedPool, PoolDirectory } from '../pricing/pool-directory.js';
import type { EvmLog, EvmRpcPort, Hex, LogSubscription } from '../../ports/evm-rpc.js';
import { PriceFeedPort, type PriceListener, type PriceTick, type PriceWatch } from '../../ports/price-feed.js';
import { isRevert, readContract } from './contract.js';
import { NATIVE, type Erc20Reader } from './erc20.js';
import type { EvmUsdQuotes } from './evm-usd-quotes.js';
import { priceFromReserves, priceFromSqrtX96, toUnits } from './pool-math.js';

export const SYNC_TOPIC = toEventSelector('Sync(uint112,uint112)');
export const V3_SWAP_TOPIC = toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24)');
export const PANCAKE_V3_SWAP_TOPIC = toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)');
export const V4_SWAP_TOPIC = toEventSelector('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)');

export const POOL_ABI = parseAbi([
  'function token0() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
]);
/** Only the first word of slot0 (sqrtPriceX96) is read, so Uniswap's and PancakeSwap's layouts both fit. */
const SLOT0_SELECTOR = '0x3850c7bd';
export const STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
]);

/** Uniswap v4 deployment on a chain. */
export interface V4Deployment {
  readonly poolManager: Hex;
  readonly stateView: Hex;
}

type PoolKind = 'v2' | 'v3' | 'v4';

/** A pool being streamed for one token. */
interface Stream {
  readonly listeners: Set<PriceListener>;
  readonly kind: PoolKind;
  /** The pool's other currency (priced in USD through EvmUsdQuotes). */
  readonly other: string;
  /** Converts a price-bearing log/state into the token's price in `other`. */
  priceInOther: number;
  supply: number;
  sub: LogSubscription | null;
  unsubQuote: (() => void) | null;
  lastTick: PriceTick | null;
}

/** 32-byte word `i` of ABI data as bigint. */
function word(data: Hex, i: number): bigint {
  const hex = data.slice(2 + i * 64, 2 + (i + 1) * 64);
  return hex.length === 64 ? BigInt(`0x${hex}`) : 0n;
}

/** Classifies a DexScreener listing by its labels and address width; null when unsupported. */
export function poolKind(p: ListedPool): PoolKind | null {
  if (p.labels.includes('v4')) return /^0x[0-9a-fA-F]{64}$/.test(p.address) ? 'v4' : null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.address)) return null;
  if (p.labels.includes('v3')) return 'v3';
  if (p.labels.includes('v2') || p.labels.length === 0) return 'v2';
  return null;
}

/** Relative distance between two positive prices (0 = equal); Infinity when either is not positive. */
function mismatch(a: number, b: number): number {
  return a > 0 && b > 0 ? Math.abs(Math.log(a / b)) : Infinity;
}

export class EvmPoolPriceFeed extends PriceFeedPort {
  private readonly streams = new Map<string, Stream>();
  private readonly pending = new Map<string, Promise<Stream>>();

  /**
   * @param chain chain slug @param rpc chain access @param erc20 token reads @param directory pool discovery
   * @param quotes USD prices of quote tokens @param v4 Uniswap v4 deployment (null where v4 is absent)
   * @param onError sink for bad logs / transient errors
   */
  constructor(
    private readonly chain: EvmChain,
    private readonly rpc: EvmRpcPort,
    private readonly erc20: Erc20Reader,
    private readonly directory: PoolDirectory,
    private readonly quotes: EvmUsdQuotes,
    private readonly v4: V4Deployment | null,
    private readonly onError: (err: unknown) => void,
  ) {
    super();
  }

  /** Nothing to open up front. */
  async start(): Promise<void> {}

  /** Stops every stream. */
  async close(): Promise<void> {
    for (const s of this.streams.values()) this.teardown(s);
    this.streams.clear();
  }

  /**
   * Streams `key`'s price from its most liquid supported pool. Rejects with UnsupportedPoolError when the
   * token has no v2/v3/v4 pool whose quote token can be priced in USD.
   */
  async watch(key: string, listener: PriceListener): Promise<PriceWatch> {
    let stream = this.streams.get(key);
    if (!stream && this.quotes.onPath(parseTokenKey(key).address)) {
      throw new UnsupportedPoolError(`${key} is already being priced further up this lookup`);
    }
    if (!stream) {
      let p = this.pending.get(key);
      if (!p) {
        p = this.open(key).finally(() => this.pending.delete(key));
        this.pending.set(key, p);
      }
      stream = await p;
    }
    stream.listeners.add(listener);
    if (stream.lastTick) listener(stream.lastTick);
    const s = stream;
    return {
      mint: key,
      stop: () => {
        s.listeners.delete(listener);
        if (s.listeners.size === 0 && this.streams.get(key) === s) {
          this.teardown(s);
          this.streams.delete(key);
        }
      },
    };
  }

  /** Finds the pool, reads its state, subscribes to its price events. */
  private async open(key: string): Promise<Stream> {
    const token = parseTokenKey(key).address.toLowerCase();
    let listed = await this.directory.find(token, dexScreenerChain(this.chain));
    if (this.quotes.resolvingQuote()) {
      // Pricing a quote token: pools against stables / wrapped native first (short, loop-free routes).
      const anchored = (p: ListedPool) => this.quotes.isAnchor(p.baseAddress.toLowerCase() === token ? p.quoteAddress : p.baseAddress);
      listed = [...listed.filter(anchored), ...listed.filter((p) => !anchored(p))];
    }
    const reasons: string[] = [];
    for (const pool of listed) {
      const kind = poolKind(pool);
      if (!kind || (kind === 'v4' && !this.v4)) {
        reasons.push(`${pool.dexId} ${pool.labels.join('/') || 'pool'} not supported`);
        continue;
      }
      const tokenIsBase = pool.baseAddress.toLowerCase() === token;
      if (!tokenIsBase && pool.quoteAddress.toLowerCase() !== token) continue;
      const other = (tokenIsBase ? pool.quoteAddress : pool.baseAddress).toLowerCase();
      const expected = tokenIsBase ? pool.priceNative : pool.priceNative > 0 ? 1 / pool.priceNative : 0;
      try {
        await this.quotes.ensure(other, token);
      } catch (err) {
        if (err instanceof UnsupportedPoolError) { reasons.push(err.message); continue; }
        throw err;
      }
      try {
        return await this.startStream(key, token as Hex, pool.address as Hex, kind, other, expected);
      } catch (err) {
        // A listing whose contract doesn't answer like its type (e.g. an unlabeled non-v2 DEX) is skipped.
        if (!isRevert(err)) throw err;
        reasons.push(`${pool.dexId} pool ${pool.address} is not a ${kind} pool`);
      }
    }
    throw new UnsupportedPoolError(`No on-chain pool for ${key}${reasons.length ? ` (${reasons.join('; ')})` : ''}`);
  }

  /** Builds the stream: initial state read, event subscription, quote re-pricing. */
  private async startStream(key: string, token: Hex, pool: Hex, kind: PoolKind, other: string, expected: number): Promise<Stream> {
    const [tokenDecimals, otherDecimals, rawSupply] = await Promise.all([
      this.erc20.decimals(token),
      this.erc20.decimals(other as Hex),
      this.erc20.totalSupply(token),
    ]);
    const stream: Stream = { listeners: new Set(), kind, other, priceInOther: 0, supply: toUnits(rawSupply, tokenDecimals), sub: null, unsubQuote: null, lastTick: null };

    let fromLog: (log: EvmLog) => number;
    if (kind === 'v2') {
      const token0 = (await readContract<Hex>(this.rpc, pool, POOL_ABI, 'token0')).toLowerCase();
      const isToken0 = token0 === token;
      const fromReserves = (r0: bigint, r1: bigint): number =>
        isToken0 ? priceFromReserves(r0, r1, tokenDecimals, otherDecimals) : priceFromReserves(r1, r0, tokenDecimals, otherDecimals);
      const [r0, r1] = await readContract<readonly [bigint, bigint, number]>(this.rpc, pool, POOL_ABI, 'getReserves');
      stream.priceInOther = fromReserves(r0, r1);
      fromLog = (log) => fromReserves(word(log.data, 0), word(log.data, 1));
      stream.sub = this.rpc.subscribeLogs({ address: pool, topics: [SYNC_TOPIC] }, (log) => this.onLog(key, stream, log, fromLog));
    } else {
      // Orientation: v3 pools say token0. v4 orders currencies by address, and the other side may be native
      // currency (0x0, 18 decimals) even when DexScreener lists the wrapped/ERC-20 token — so both readings are
      // priced and the one matching DexScreener's price wins.
      let isToken0: boolean;
      let otherDec = otherDecimals;
      let sqrt: bigint;
      if (kind === 'v3') {
        isToken0 = (await readContract<Hex>(this.rpc, pool, POOL_ABI, 'token0')).toLowerCase() === token;
        sqrt = word(await this.rpc.call(pool, SLOT0_SELECTOR), 0);
      } else {
        [sqrt] = await readContract<readonly [bigint, number, number, number]>(this.rpc, this.v4!.stateView, STATE_VIEW_ABI, 'getSlot0', [pool]);
        const readings = [
          { t0: token < other && other !== NATIVE, dec: otherDecimals },
          { t0: false, dec: 18 }, // other side is native currency (address 0x0 sorts first)
        ].map((r) => ({ ...r, miss: mismatch(priceFromSqrtX96(sqrt, ...(r.t0 ? [tokenDecimals, r.dec] : [r.dec, tokenDecimals]) as [number, number], r.t0), expected) }));
        const best = readings[0]!.miss <= readings[1]!.miss ? readings[0]! : readings[1]!;
        isToken0 = best.t0;
        otherDec = best.dec;
      }
      const [dec0, dec1] = isToken0 ? [tokenDecimals, otherDec] : [otherDec, tokenDecimals];
      stream.priceInOther = priceFromSqrtX96(sqrt, dec0, dec1, isToken0);
      fromLog = (log) => priceFromSqrtX96(word(log.data, 2), dec0, dec1, isToken0);
      const filter = kind === 'v3'
        ? { address: pool, topics: [[V3_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC]] }
        : { address: this.v4!.poolManager, topics: [V4_SWAP_TOPIC, pool] };
      stream.sub = this.rpc.subscribeLogs(filter, (log) => this.onLog(key, stream, log, fromLog));
    }
    stream.unsubQuote = this.quotes.onChange((a) => { if (a === other) this.emit(key, stream); });
    this.streams.set(key, stream);
    this.emit(key, stream);
    return stream;
  }

  /** Applies a price-bearing log. */
  private onLog(key: string, stream: Stream, log: EvmLog, fromLog: (log: EvmLog) => number): void {
    try {
      const p = fromLog(log);
      if (p > 0) {
        stream.priceInOther = p;
        this.emit(key, stream);
      }
    } catch (err) {
      this.onError(err);
    }
  }

  /** Converts to USD and notifies listeners (skipped until the quote token has a price). */
  private emit(key: string, s: Stream): void {
    const quoteUsd = this.quotes.usd(s.other);
    if (quoteUsd === null || s.priceInOther <= 0) return;
    const priceUsd = s.priceInOther * quoteUsd;
    const tick: PriceTick = { mint: key, priceUsd, marketCapUsd: priceUsd * s.supply, source: `${s.kind}-pool`, receivedAt: Date.now() };
    s.lastTick = tick;
    for (const l of s.listeners) l(tick);
  }

  /** Stops the stream's subscriptions. */
  private teardown(s: Stream): void {
    s.sub?.stop();
    s.unsubQuote?.();
  }
}
