/**
 * @file evm-usd-quotes.ts
 * @description USD prices for the quote side of EVM pools, per chain: stablecoins at $1, everything else
 *              (WETH, WBNB, tokenized stocks, other tokens) priced live through the chain's own on-chain feed,
 *              e.g. TOKEN/WETH → WETH/USDC. Native currency (0x0 in Uniswap v4) is priced as its wrapped token.
 *
 *              Each resolution carries its path (AsyncLocalStorage), so A → B → A loops are rejected instead of
 *              waiting on themselves, independent lookups don't block each other, and quote lookups prefer pools
 *              against anchors (stables / wrapped native).
 * @author Reborn1987
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { EvmChain } from '../chains/token-key.js';
import { UnsupportedPoolError } from '../errors.js';
import type { PriceFeedPort, PriceWatch } from '../../ports/price-feed.js';
import { NATIVE } from './erc20.js';

/** Most tokens on one resolution path (bounds chains like A → B → WETH → USDC). */
const MAX_CHAIN = 4;
/** A quote lookup that takes longer than this is treated as unsupported (guards against cross-lookup waits). */
const RESOLVE_TIMEOUT_MS = 20_000;

export type EvmQuoteListener = (address: string) => void;

export class EvmUsdQuotes {
  private readonly prices = new Map<string, number>();
  private readonly watches = new Map<string, PriceWatch>();
  private readonly listeners = new Set<EvmQuoteListener>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly path = new AsyncLocalStorage<ReadonlySet<string>>();
  private feed: PriceFeedPort | null = null;

  /**
   * @param chain chain slug @param stables lowercase addresses priced at $1
   * @param wrappedNative lowercase wrapped native token (WETH / WBNB …) used to price native currency
   * @param timeoutMs give-up time for one quote lookup
   */
  constructor(
    private readonly chain: EvmChain,
    private readonly stables: ReadonlySet<string>,
    private readonly wrappedNative: string,
    private readonly timeoutMs = RESOLVE_TIMEOUT_MS,
  ) {}

  /** Lets quotes be priced by the chain's on-chain feed (set once the feed exists; it depends on this class). */
  setFeed(feed: PriceFeedPort): void {
    this.feed = feed;
  }

  /** Current USD price of a quote token, or null when not resolved yet. */
  usd(address: string): number | null {
    const a = this.normalize(address);
    return this.stables.has(a) ? 1 : (this.prices.get(a) ?? null);
  }

  /** Stablecoins and the wrapped native token: the preferred other side when pricing a quote token. */
  isAnchor(address: string): boolean {
    const a = this.normalize(address);
    return this.stables.has(a) || a === this.wrappedNative;
  }

  /** True while the caller runs inside a quote lookup (feeds then prefer anchor pools). */
  resolvingQuote(): boolean {
    return (this.path.getStore()?.size ?? 0) > 0;
  }

  /** True when `address` is already on the current lookup path (watching it now would wait on itself). */
  onPath(address: string): boolean {
    return this.path.getStore()?.has(this.normalize(address)) ?? false;
  }

  /** Subscribes to quote price changes; returns an unsubscribe function. */
  onChange(listener: EvmQuoteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Makes sure `address` has a live USD price. `from` is the token being priced against it (part of the path).
   * Rejects with UnsupportedPoolError when no on-chain route exists, the path loops or gets too deep.
   */
  ensure(address: string, from?: string): Promise<void> {
    const a = this.normalize(address);
    if (this.stables.has(a) || this.watches.has(a)) return Promise.resolve();
    const path = new Set(this.path.getStore() ?? []);
    if (from) path.add(this.normalize(from));
    if (path.has(a)) return Promise.reject(new UnsupportedPoolError(`Quote token ${a} on ${this.chain} loops back to itself`));
    if (path.size >= MAX_CHAIN) return Promise.reject(new UnsupportedPoolError(`Quote token ${a} on ${this.chain} has no USD route within ${MAX_CHAIN} hops`));
    let p = this.inflight.get(a);
    if (!p) {
      // The path holds the tokens waiting on `a` (not `a` itself: watching `a` is exactly what we do next).
      p = this.path.run(path, () => this.withTimeout(this.resolve(a), a)).finally(() => this.inflight.delete(a));
      this.inflight.set(a, p);
    }
    return p;
  }

  /** Stops every quote watch. */
  close(): void {
    for (const w of this.watches.values()) w.stop();
    this.watches.clear();
  }

  /** Watches the quote token through the chain feed. */
  private async resolve(a: string): Promise<void> {
    if (!this.feed) throw new UnsupportedPoolError(`No ${this.chain} feed to price quote token ${a}`);
    const watch = await this.feed.watch(`${this.chain}:${a}`, (tick) => {
      if (tick.priceUsd > 0 && tick.priceUsd !== this.prices.get(a)) {
        this.prices.set(a, tick.priceUsd);
        for (const l of this.listeners) l(a);
      }
    });
    this.watches.set(a, watch);
  }

  /** Rejects with UnsupportedPoolError when `p` takes longer than the timeout. */
  private withTimeout(p: Promise<void>, a: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new UnsupportedPoolError(`Timed out pricing quote token ${a} on ${this.chain}`)), this.timeoutMs);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }

  /** Lowercases and maps native currency to its wrapped token. */
  private normalize(address: string): string {
    const a = address.toLowerCase();
    return a === NATIVE ? this.wrappedNative : a;
  }
}
