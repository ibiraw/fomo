/**
 * @file usd-quotes.ts
 * @description USD prices for AMM quote tokens: SOL live from Pyth, USD stablecoins at $1, anything else
 *              (e.g. BONK) polled from Jupiter. Quote tokens are majors that move far less than the
 *              memecoins priced against them, so a few seconds of lag on them is acceptable.
 * @author Reborn1987
 */

import { AccountNotFoundError, UnsupportedPoolError } from '../errors.js';
import type { HttpJsonPort } from '../../ports/http-json.js';
import type { AccountSubscription, SolanaAccountsPort } from '../../ports/solana-accounts.js';
import { PYTH_SOL_USD_ACCOUNT, USDC_MINT, WSOL_MINT } from './addresses.js';
import { decodePythPrice } from './decoders.js';
import { parseJupiterPrices } from './jupiter-price-feed.js';
import { pythToNumber } from './math.js';

/** USD-pegged quote tokens priced at $1: USDC, USDT, USD1. */
export const USD_STABLES = new Set<string>([
  USDC_MINT,
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
]);

/** Called with the quote mint whose USD price changed. */
export type QuoteChangeListener = (mint: string) => void;

export class UsdQuotes {
  private readonly prices = new Map<string, number>();
  private readonly polled = new Set<string>();
  private readonly listeners = new Set<QuoteChangeListener>();
  private pythSub: AccountSubscription | null = null;
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param accounts RPC (Pyth) @param http JSON fetcher (Jupiter) @param jupiterUrl price endpoint
   * @param pollMs poll interval for non-SOL, non-stable quotes @param onError sink for transient errors
   */
  constructor(
    private readonly accounts: SolanaAccountsPort,
    private readonly http: HttpJsonPort,
    private readonly jupiterUrl: string,
    private readonly pollMs: number,
    private readonly onError: (err: unknown) => void,
  ) {}

  /** Loads SOL/USD (fail fast) and streams it. */
  async start(): Promise<void> {
    const raw = await this.accounts.getAccount(PYTH_SOL_USD_ACCOUNT);
    if (!raw) throw new AccountNotFoundError('Pyth SOL/USD account not found');
    this.applySol(raw);
    this.pythSub = this.accounts.subscribe(PYTH_SOL_USD_ACCOUNT, (d) => {
      try { this.applySol(d); } catch (err) { this.onError(err); }
    });
  }

  /** Stops streams and polling. */
  close(): void {
    this.pythSub?.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Current USD price of a quote token, or null if not tracked yet. */
  usd(mint: string): number | null {
    if (USD_STABLES.has(mint)) return 1;
    if (mint === WSOL_MINT) return this.prices.get(WSOL_MINT) ?? null;
    return this.prices.get(mint) ?? null;
  }

  /** Ensures `mint` has a USD price; rejects with UnsupportedPoolError if none can be found. */
  async track(mint: string): Promise<void> {
    if (USD_STABLES.has(mint) || mint === WSOL_MINT || this.polled.has(mint)) return;
    const prices = parseJupiterPrices(await this.http.getJson(`${this.jupiterUrl}?ids=${mint}`, 5_000));
    const p = prices.get(mint);
    if (p === undefined) throw new UnsupportedPoolError(`No USD price for quote token ${mint}`);
    this.prices.set(mint, p);
    this.polled.add(mint);
    if (!this.timer) this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  /** Subscribes to quote price changes; returns an unsubscribe function. */
  onChange(listener: QuoteChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Refreshes every polled quote token (exposed for tests). */
  async poll(): Promise<void> {
    if (this.polled.size === 0) return;
    try {
      const prices = parseJupiterPrices(await this.http.getJson(`${this.jupiterUrl}?ids=${[...this.polled].join(',')}`, 5_000));
      for (const [mint, p] of prices) this.set(mint, p);
    } catch (err) {
      this.onError(err);
    }
  }

  /** Applies a Pyth update to SOL/USD. */
  private applySol(data: Uint8Array): void {
    const p = decodePythPrice(data);
    this.set(WSOL_MINT, pythToNumber(p.price, p.exponent));
  }

  /** Stores a price and notifies listeners when it changed. */
  private set(mint: string, price: number): void {
    if (this.prices.get(mint) === price) return;
    this.prices.set(mint, price);
    for (const l of this.listeners) l(mint);
  }
}
