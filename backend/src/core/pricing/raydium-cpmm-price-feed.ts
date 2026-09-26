/**
 * @file raydium-cpmm-price-feed.ts
 * @description On-chain PriceFeedPort for tokens trading in Raydium CPMM pools. Reserves are the vault
 *              balances minus accrued protocol/fund/creator fees; quote tokens are converted to USD via
 *              UsdQuotes (SOL live, stables $1, others polled).
 * @author Reborn1987
 */

import { UnsupportedPoolError } from '../errors.js';
import { PriceFeedPort, type PriceListener, type PriceWatch } from '../../ports/price-feed.js';
import type { AccountSubscription, SolanaAccountsPort } from '../../ports/solana-accounts.js';
import { decodeTokenAccountAmount } from './decoders.js';
import { marketCapUsd, priceFromReserves } from './math.js';
import type { PoolDirectory } from './pool-directory.js';
import { decodeCpmmPool, type CpmmPoolState } from './raydium-cpmm.js';
import type { UsdQuotes } from './usd-quotes.js';
import { VaultPair } from './vault-pair.js';

/** Per-mint state. */
interface Watched {
  readonly listeners: Set<PriceListener>;
  readonly stops: (() => void)[];
  lastTick: Parameters<PriceListener>[0] | null;
}

/** Which vault/decimals/fees belong to the token vs. the quote. */
interface Sides {
  readonly baseVault: string;
  readonly quoteVault: string;
  readonly quoteMint: string;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
  baseFees: bigint;
  quoteFees: bigint;
}

/** Splits a pool into token side and quote side, or throws when the mint is not in the pool. */
export function sidesFor(pool: CpmmPoolState, mint: string): Sides {
  if (pool.mint0 === mint) {
    return { baseVault: pool.vault0, quoteVault: pool.vault1, quoteMint: pool.mint1, baseDecimals: pool.decimals0, quoteDecimals: pool.decimals1, baseFees: pool.fees0, quoteFees: pool.fees1 };
  }
  if (pool.mint1 === mint) {
    return { baseVault: pool.vault1, quoteVault: pool.vault0, quoteMint: pool.mint0, baseDecimals: pool.decimals1, quoteDecimals: pool.decimals0, baseFees: pool.fees1, quoteFees: pool.fees0 };
  }
  throw new UnsupportedPoolError(`Pool does not contain token ${mint}`);
}

export class RaydiumCpmmPriceFeed extends PriceFeedPort {
  private readonly watched = new Map<string, Watched>();

  /**
   * @param accounts RPC @param directory pool discovery @param quotes USD conversion for quote tokens
   * @param onError sink for stream decode errors
   */
  constructor(
    private readonly accounts: SolanaAccountsPort,
    private readonly directory: PoolDirectory,
    private readonly quotes: UsdQuotes,
    private readonly onError: (err: unknown) => void,
  ) {
    super();
  }

  /** UsdQuotes is started by the composition root (shared). */
  async start(): Promise<void> {}

  /** Stops every stream. */
  async close(): Promise<void> {
    for (const w of this.watched.values()) w.stops.forEach((s) => s());
    this.watched.clear();
  }

  /** Streams the token's most liquid Raydium CPMM pool; UnsupportedPoolError if it has none. */
  async watch(mint: string, listener: PriceListener): Promise<PriceWatch> {
    let w = this.watched.get(mint);
    if (!w) {
      w = await this.open(mint);
      this.watched.set(mint, w);
    }
    w.listeners.add(listener);
    if (w.lastTick) listener(w.lastTick);
    const state = w;
    return {
      mint,
      stop: () => {
        state.listeners.delete(listener);
        if (state.listeners.size === 0) {
          state.stops.forEach((s) => s());
          this.watched.delete(mint);
        }
      },
    };
  }

  /** Finds and verifies the pool, then subscribes to pool state and both vaults. */
  private async open(mint: string): Promise<Watched> {
    const listed = (await this.directory.find(mint)).find((p) => p.dexId === 'raydium' && p.labels.includes('CPMM'));
    if (!listed) throw new UnsupportedPoolError(`No Raydium CPMM pool for ${mint}`);
    const raw = await this.accounts.getAccount(listed.address);
    if (!raw) throw new UnsupportedPoolError(`Raydium CPMM pool ${listed.address} not found on-chain`);
    const sides = sidesFor(decodeCpmmPool(raw), mint);
    await this.quotes.track(sides.quoteMint);
    const supply = await this.accounts.getMintSupply(mint);

    const w: Watched = { listeners: new Set(), stops: [], lastTick: null };
    const emit = (baseVault: bigint, quoteVault: bigint): void => {
      const quoteUsd = this.quotes.usd(sides.quoteMint);
      if (quoteUsd === null) return;
      const quotePrice = priceFromReserves(baseVault - sides.baseFees, sides.baseDecimals, quoteVault - sides.quoteFees, sides.quoteDecimals);
      const priceUsd = quotePrice * quoteUsd;
      const tick = { mint, priceUsd, marketCapUsd: marketCapUsd(priceUsd, supply.amount, supply.decimals), source: 'raydium-cpmm' as const, receivedAt: Date.now() };
      w.lastTick = tick;
      for (const l of w.listeners) l(tick);
    };
    const pair = new VaultPair((b, q) => this.guard(() => emit(b, q)));
    const subs: AccountSubscription[] = [
      this.accounts.subscribe(listed.address, (d) => this.guard(() => {
        const s = sidesFor(decodeCpmmPool(d), mint);
        sides.baseFees = s.baseFees;
        sides.quoteFees = s.quoteFees;
      })),
      this.accounts.subscribe(sides.baseVault, (d, slot) => this.guard(() => pair.updateA(decodeTokenAccountAmount(d), slot))),
      this.accounts.subscribe(sides.quoteVault, (d, slot) => this.guard(() => pair.updateB(decodeTokenAccountAmount(d), slot))),
    ];
    const offQuote = this.quotes.onChange((q) => { if (q === sides.quoteMint) pair.refresh(); });
    w.stops.push(...subs.map((s) => () => s.stop()), () => pair.stop(), offQuote);
    return w;
  }

  /** Routes stream errors to onError instead of crashing the stream. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.onError(err);
    }
  }
}
