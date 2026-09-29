/**
 * @file meteora-damm-v2-price-feed.ts
 * @description On-chain PriceFeedPort for Meteora DAMM v2 pools (where fomo-launched and other tokens
 *              trade, often against another token such as VBUCKS). Price comes from the pool's sqrt price;
 *              the other token is converted to USD via UsdQuotes.
 * @author Reborn1987
 */

import { UnsupportedPoolError } from '../errors.js';
import { PriceFeedPort, type PriceListener, type PriceTick, type PriceWatch } from '../../ports/price-feed.js';
import type { SolanaAccountsPort } from '../../ports/solana-accounts.js';
import { decodeTokenAccountAmount } from './decoders.js';
import { marketCapUsd } from './math.js';
import { dammV2PriceBPerA, decodeDammV2Pool, type DammV2Pool } from './meteora-damm-v2.js';
import type { PoolDirectory } from './pool-directory.js';
import type { UsdQuotes } from './usd-quotes.js';

/** Per-mint state. */
interface Watched {
  readonly listeners: Set<PriceListener>;
  readonly stops: (() => void)[];
  lastTick: PriceTick | null;
}

/** Listed pools compared on-chain at most. */
const MAX_CANDIDATES = 8;

export class MeteoraDammV2PriceFeed extends PriceFeedPort {
  private readonly watched = new Map<string, Watched>();

  /** @param accounts RPC @param directory pool discovery @param quotes USD conversion @param onError stream errors */
  constructor(
    private readonly accounts: SolanaAccountsPort,
    private readonly directory: PoolDirectory,
    private readonly quotes: UsdQuotes,
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

  /** Streams the DAMM v2 pool holding the most of the token; UnsupportedPoolError if it has none. */
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

  /**
   * The listed DAMM v2 pool that holds the most of the token, read on-chain. DexScreener's liquidity can't be trusted
   * for this: a pool quoted in a token it can't price shows none (FISHING's real pool, quoted in "BITCOIN", 2026-09-28)
   * while $1 dust pools at wrong prices rank above it.
   */
  private async pick(mint: string): Promise<{ address: string; pool: DammV2Pool }> {
    const listed = (await this.directory.find(mint)).filter((p) => p.dexId === 'meteora' && p.labels.includes('DYN2')).slice(0, MAX_CANDIDATES);
    if (listed.length === 0) throw new UnsupportedPoolError(`No Meteora DAMM v2 pool for ${mint}`);
    const read = await Promise.all(listed.map(async (l) => {
      try {
        const raw = await this.accounts.getAccount(l.address);
        if (!raw) return null;
        const pool = decodeDammV2Pool(raw);
        if (pool.tokenAMint !== mint && pool.tokenBMint !== mint) return null;
        const vault = await this.accounts.getAccount(pool.tokenAMint === mint ? pool.tokenAVault : pool.tokenBVault);
        return vault ? { address: l.address, pool, held: decodeTokenAccountAmount(vault) } : null;
      } catch {
        return null; // not a DAMM v2 pool after all, or unreadable: skip it
      }
    }));
    const best = read.filter((r) => r !== null).sort((x, y) => (y.held > x.held ? 1 : y.held < x.held ? -1 : 0))[0];
    if (!best) throw new UnsupportedPoolError(`No readable Meteora DAMM v2 pool for ${mint}`);
    return best;
  }

  /** Finds and verifies the pool, then subscribes to it. */
  private async open(mint: string): Promise<Watched> {
    const { address, pool } = await this.pick(mint);
    const listed = { address };
    const isA = pool.tokenAMint === mint;
    const quoteMint = isA ? pool.tokenBMint : pool.tokenAMint;
    await this.quotes.track(quoteMint);
    const [supply, a, b] = await Promise.all([
      this.accounts.getMintSupply(mint),
      this.accounts.getMintSupply(pool.tokenAMint),
      this.accounts.getMintSupply(pool.tokenBMint),
    ]);

    const w: Watched = { listeners: new Set(), stops: [], lastTick: null };
    let sqrtPrice = pool.sqrtPrice;
    const price = (): void => {
      const quoteUsd = this.quotes.usd(quoteMint);
      if (quoteUsd === null) return;
      const bPerA = dammV2PriceBPerA(sqrtPrice, a.decimals, b.decimals);
      if (!(bPerA > 0)) return;
      const quotePerToken = isA ? bPerA : 1 / bPerA;
      const priceUsd = quotePerToken * quoteUsd;
      const tick: PriceTick = { mint, priceUsd, marketCapUsd: marketCapUsd(priceUsd, supply.amount, supply.decimals), source: 'meteora-damm2', receivedAt: Date.now() };
      w.lastTick = tick;
      for (const l of w.listeners) l(tick);
    };
    const sub = this.accounts.subscribe(listed.address, (d) => {
      try {
        sqrtPrice = decodeDammV2Pool(d).sqrtPrice;
        price();
      } catch (err) {
        this.onError(err);
      }
    });
    const offQuote = this.quotes.onChange((q) => { if (q === quoteMint) { try { price(); } catch (err) { this.onError(err); } } });
    w.stops.push(() => sub.stop(), offQuote);
    return w;
  }
}
