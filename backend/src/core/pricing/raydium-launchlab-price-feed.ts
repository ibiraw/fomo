/**
 * @file raydium-launchlab-price-feed.ts
 * @description On-chain PriceFeedPort for tokens still on a Raydium LaunchLab bonding curve (bonk.fun etc.).
 *              When the curve graduates, hands the same listeners over to a fallback feed (Raydium CPMM),
 *              mirroring how the pump.fun feed switches from curve to PumpSwap.
 * @author Reborn1987
 */

import type { Address } from '@solana/kit';

import { UnsupportedPoolError } from '../errors.js';
import { PriceFeedPort, type PriceListener, type PriceTick, type PriceWatch } from '../../ports/price-feed.js';
import type { SolanaAccountsPort } from '../../ports/solana-accounts.js';
import { WSOL_MINT } from './addresses.js';
import { marketCapUsd, priceFromReserves } from './math.js';
import {
  CURVE_CONSTANT_PRODUCT,
  decodeCurveType,
  decodeLaunchLabPool,
  deriveLaunchLabPool,
  LAUNCHLAB_TRADING,
  launchLabReserves,
  type LaunchLabPool,
} from './raydium-launchlab.js';
import type { UsdQuotes } from './usd-quotes.js';

/** Quote tokens LaunchLab curves are created against (SOL, USD1). */
export const LAUNCHLAB_QUOTES = [WSOL_MINT, 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB'] as const;

/** Per-mint state. */
interface Watched {
  readonly listeners: Set<PriceListener>;
  stops: (() => void)[];
  lastTick: PriceTick | null;
}

export class RaydiumLaunchLabPriceFeed extends PriceFeedPort {
  private readonly watched = new Map<string, Watched>();

  /**
   * @param accounts RPC @param quotes USD conversion @param graduated feed used after migration (CPMM)
   * @param onError sink for stream errors
   */
  constructor(
    private readonly accounts: SolanaAccountsPort,
    private readonly quotes: UsdQuotes,
    private readonly graduated: PriceFeedPort,
    private readonly onError: (err: unknown) => void,
  ) {
    super();
  }

  /** Nothing to open up front. */
  async start(): Promise<void> {}

  /** Stops every stream. */
  async close(): Promise<void> {
    for (const w of this.watched.values()) w.stops.forEach((s) => s());
    this.watched.clear();
  }

  /** Streams the token's LaunchLab curve; UnsupportedPoolError if it has none that is still trading. */
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

  /** Finds a trading constant-product curve for `mint` and subscribes to it. */
  private async open(mint: string): Promise<Watched> {
    let poolAddr: string | null = null;
    let pool: LaunchLabPool | null = null;
    for (const quote of LAUNCHLAB_QUOTES) {
      const addr = await deriveLaunchLabPool(mint as Address, quote as Address);
      const raw = await this.accounts.getAccount(addr);
      // An empty account here is just SOL someone sent to the address, not a pool.
      if (raw && raw.length > 0) { poolAddr = addr; pool = decodeLaunchLabPool(raw); break; }
    }
    if (!pool || !poolAddr) throw new UnsupportedPoolError(`No Raydium LaunchLab curve for ${mint}`);
    if (pool.status !== LAUNCHLAB_TRADING) throw new UnsupportedPoolError(`LaunchLab curve for ${mint} has graduated`);
    const cfg = await this.accounts.getAccount(pool.globalConfig);
    if (!cfg || decodeCurveType(cfg) !== CURVE_CONSTANT_PRODUCT) {
      throw new UnsupportedPoolError(`LaunchLab curve for ${mint} uses an unsupported curve type`);
    }
    await this.quotes.track(pool.quoteMint);
    const supply = await this.accounts.getMintSupply(mint);

    const w: Watched = { listeners: new Set(), stops: [], lastTick: null };
    let latest = pool;
    const emit = (p: PriceTick): void => { w.lastTick = p; for (const l of w.listeners) l(p); };
    const price = (): void => {
      const quoteUsd = this.quotes.usd(latest.quoteMint);
      if (quoteUsd === null) return;
      const r = launchLabReserves(latest);
      const priceUsd = priceFromReserves(r.base, latest.baseDecimals, r.quote, latest.quoteDecimals) * quoteUsd;
      emit({ mint, priceUsd, marketCapUsd: marketCapUsd(priceUsd, supply.amount, supply.decimals), source: 'raydium-launchlab', receivedAt: Date.now() });
    };
    const graduate = (): void => {
      w.stops.forEach((s) => s());
      w.stops = [];
      this.graduated.watch(mint, emit)
        .then((handoff) => { w.stops.push(() => handoff.stop()); })
        .catch((err: unknown) => this.onError(err));
    };
    const sub = this.accounts.subscribe(poolAddr, (d) => this.guard(() => {
      latest = decodeLaunchLabPool(d);
      if (latest.status !== LAUNCHLAB_TRADING) graduate();
      else price();
    }));
    const offQuote = this.quotes.onChange((q) => { if (q === latest.quoteMint) this.guard(price); });
    w.stops.push(() => sub.stop(), offQuote);
    return w;
  }

  /** Routes stream errors to onError. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.onError(err);
    }
  }
}
