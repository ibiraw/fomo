/**
 * @file pump-price-feed.ts
 * @description PriceFeedPort implementation for pump.fun coins: prices from the bonding curve
 *              before graduation and from the canonical PumpSwap pool after. USD via Pyth SOL/USD.
 * @author Reborn1987
 */

import type { Address } from '@solana/kit';

import { AccountNotFoundError, FomoError, UnsupportedPoolError } from '../errors.js';
import {
  PriceFeedPort,
  type PriceListener,
  type PriceTick,
  type PriceWatch,
} from '../../ports/price-feed.js';
import type { AccountSubscription, SolanaAccountsPort } from '../../ports/solana-accounts.js';
import {
  deriveBondingCurve,
  deriveCanonicalPumpPool,
  PYTH_SOL_USD_ACCOUNT,
  USDC_MINT,
  WSOL_MINT,
} from './addresses.js';
import {
  decodeBondingCurve,
  decodePumpPool,
  decodePythPrice,
  decodeTokenAccountAmount,
  DEFAULT_PUBKEY,
} from './decoders.js';
import { marketCapUsd, priceFromReserves, pythToNumber, SOL_DECIMALS } from './math.js';
import { VaultPair } from './vault-pair.js';

const USDC_DECIMALS = 6;

/** How a quote asset converts to USD. */
interface QuoteAsset {
  readonly decimals: number;
  readonly isSol: boolean;
}

/** Maps a quote mint to its decimals / USD conversion, or throws UnsupportedPoolError. */
function quoteAssetFor(quoteMint: string): QuoteAsset {
  if (quoteMint === DEFAULT_PUBKEY || quoteMint === WSOL_MINT) return { decimals: SOL_DECIMALS, isSol: true };
  if (quoteMint === USDC_MINT) return { decimals: USDC_DECIMALS, isSol: false };
  throw new UnsupportedPoolError(`Quote asset ${quoteMint} is not supported (only SOL and USDC)`);
}

/** Mutable per-mint tracking state. */
interface WatchState {
  readonly mint: string;
  readonly listeners: Set<PriceListener>;
  subs: AccountSubscription[];
  supply: bigint;
  decimals: number;
  source: PriceTick['source'];
  quote: QuoteAsset;
  /** Latest quote-per-token price, re-emitted when SOL/USD moves. */
  lastQuotePrice: number | null;
}

export class PumpPriceFeed extends PriceFeedPort {
  private solUsd: number | null = null;
  private solSub: AccountSubscription | null = null;
  private readonly watches = new Map<string, WatchState>();

  /** @param accounts Solana account access. @param onError sink for non-fatal stream errors. */
  constructor(
    private readonly accounts: SolanaAccountsPort,
    private readonly onError: (err: unknown) => void,
  ) {
    super();
  }

  /** Loads SOL/USD once (fail fast if unavailable), then streams it. */
  async start(): Promise<void> {
    const raw = await this.accounts.getAccount(PYTH_SOL_USD_ACCOUNT);
    if (!raw) throw new AccountNotFoundError('Pyth SOL/USD account not found');
    this.applySolPrice(raw);
    this.solSub = this.accounts.subscribe(PYTH_SOL_USD_ACCOUNT, (data) => this.guard(() => this.applySolPrice(data)));
  }

  /** Stops every subscription. */
  async close(): Promise<void> {
    this.solSub?.stop();
    this.solSub = null;
    for (const w of this.watches.values()) w.subs.forEach((s) => s.stop());
    this.watches.clear();
  }

  /** Watches `mint`; multiple listeners on one mint share a single set of subscriptions. */
  async watch(mint: string, listener: PriceListener): Promise<PriceWatch> {
    if (this.solUsd === null) throw new FomoError('PumpPriceFeed.start() must be called before watch()');
    let state = this.watches.get(mint);
    if (!state) {
      state = await this.createWatch(mint);
      this.watches.set(mint, state);
    }
    state.listeners.add(listener);
    // Deliver the latest known price immediately so a tick that arrived before attaching is not lost.
    if (state.lastQuotePrice !== null) listener(this.buildTick(state, state.lastQuotePrice));
    const s = state;
    return {
      mint,
      stop: () => {
        s.listeners.delete(listener);
        if (s.listeners.size === 0) {
          s.subs.forEach((x) => x.stop());
          this.watches.delete(mint);
        }
      },
    };
  }

  /** Resolves the token's pool and opens the matching subscriptions. */
  private async createWatch(mint: string): Promise<WatchState> {
    const { amount, decimals } = await this.accounts.getMintSupply(mint);
    const state: WatchState = {
      mint,
      listeners: new Set(),
      subs: [],
      supply: amount,
      decimals,
      source: 'pump-curve',
      quote: { decimals: SOL_DECIMALS, isSol: true },
      lastQuotePrice: null,
    };
    const curveAddr = await deriveBondingCurve(mint as Address);
    // Anyone can send SOL to a curve address, leaving an empty system account there; only pump.fun writes curve data.
    const curveRaw = await this.accounts.getAccount(curveAddr);
    if (curveRaw && curveRaw.length > 0 && !decodeBondingCurve(curveRaw).complete) {
      this.watchCurve(state, curveAddr, curveRaw);
    } else {
      await this.watchPool(state);
    }
    return state;
  }

  /** Streams the bonding curve; switches to the pool once the curve completes (graduates). */
  private watchCurve(state: WatchState, curveAddr: string, initial: Uint8Array): void {
    state.source = 'pump-curve';
    state.quote = quoteAssetFor(decodeBondingCurve(initial).quoteMint);
    const onData = (data: Uint8Array): void => {
      const curve = decodeBondingCurve(data);
      if (curve.complete) {
        state.subs.forEach((s) => s.stop());
        state.subs = [];
        this.watchPool(state).catch((err: unknown) => this.onError(err));
        return;
      }
      this.emit(state, priceFromReserves(curve.virtualTokenReserves, state.decimals, curve.virtualQuoteReserves, state.quote.decimals));
    };
    state.subs.push(this.accounts.subscribe(curveAddr, (d) => this.guard(() => onData(d))));
  }

  /** Streams the canonical PumpSwap pool's two vaults. */
  private async watchPool(state: WatchState): Promise<void> {
    const poolAddr = await deriveCanonicalPumpPool(state.mint as Address);
    const poolRaw = await this.accounts.getAccount(poolAddr);
    if (!poolRaw || poolRaw.length === 0) {
      throw new UnsupportedPoolError(
        `No pump.fun bonding curve or PumpSwap pool for ${state.mint}`,
      );
    }
    const pool = decodePumpPool(poolRaw);
    state.source = 'pump-swap';
    state.quote = quoteAssetFor(pool.quoteMint);
    // Vault updates of one swap arrive separately; VaultPair only prices consistent pairs.
    const pair = new VaultPair((base, quote) =>
      this.guard(() => this.emit(state, priceFromReserves(base, state.decimals, quote + pool.virtualQuoteReserves, state.quote.decimals))));
    state.subs.push(
      this.accounts.subscribe(pool.poolBaseTokenAccount, (d, slot) => this.guard(() => pair.updateA(decodeTokenAccountAmount(d), slot))),
      this.accounts.subscribe(pool.poolQuoteTokenAccount, (d, slot) => this.guard(() => pair.updateB(decodeTokenAccountAmount(d), slot))),
      { stop: () => pair.stop() },
    );
  }

  /** Updates SOL/USD and re-emits every SOL-quoted token at the new rate. */
  private applySolPrice(data: Uint8Array): void {
    const p = decodePythPrice(data);
    this.solUsd = pythToNumber(p.price, p.exponent);
    for (const w of this.watches.values()) {
      if (w.quote.isSol && w.lastQuotePrice !== null) this.emit(w, w.lastQuotePrice);
    }
  }

  /** Converts a quote-denominated price to a USD tick and notifies listeners. */
  private emit(state: WatchState, quotePrice: number): void {
    state.lastQuotePrice = quotePrice;
    const tick = this.buildTick(state, quotePrice);
    for (const l of state.listeners) l(tick);
  }

  /** Builds a USD tick from a quote-denominated price. solUsd is guaranteed set by start(). */
  private buildTick(state: WatchState, quotePrice: number): PriceTick {
    const usdPerQuote = state.quote.isSol ? (this.solUsd as number) : 1;
    const priceUsd = quotePrice * usdPerQuote;
    return {
      mint: state.mint,
      priceUsd,
      marketCapUsd: marketCapUsd(priceUsd, state.supply, state.decimals),
      source: state.source,
      receivedAt: Date.now(),
    };
  }

  /** Runs a stream handler, routing decode errors to onError instead of killing the stream. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.onError(err);
    }
  }
}
