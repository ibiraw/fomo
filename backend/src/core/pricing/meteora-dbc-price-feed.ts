/**
 * @file meteora-dbc-price-feed.ts
 * @description On-chain PriceFeedPort for Meteora Dynamic Bonding Curve pools (fomo's launchpad). The pool
 *              account's sqrt price updates with every trade. After migration, listeners are handed to a
 *              fallback feed.
 * @author Reborn1987
 */

import { UnsupportedPoolError } from '../errors.js';
import { PriceFeedPort, type PriceListener, type PriceTick, type PriceWatch } from '../../ports/price-feed.js';
import type { SolanaAccountsPort } from '../../ports/solana-accounts.js';
import { marketCapUsd } from './math.js';
import { dbcPrice, decodeDbcPool, decodeDbcQuoteMint, type DbcPool } from './meteora-dbc.js';
import type { PoolDirectory } from './pool-directory.js';
import type { UsdQuotes } from './usd-quotes.js';
import { followGraduation, GRADUATION_RETRY_MS } from './graduation.js';

/** Per-mint state. */
interface Watched {
  readonly listeners: Set<PriceListener>;
  stops: (() => void)[];
  lastTick: PriceTick | null;
}

export class MeteoraDbcPriceFeed extends PriceFeedPort {
  private readonly watched = new Map<string, Watched>();

  /**
   * @param accounts RPC @param directory pool discovery @param quotes USD for the quote token
   * @param graduated feed used after the curve migrates @param onError sink for stream errors
   * @param retryMs wait between tries to find the graduated pool
   */
  constructor(
    private readonly accounts: SolanaAccountsPort,
    private readonly directory: PoolDirectory,
    private readonly quotes: UsdQuotes,
    private readonly graduated: PriceFeedPort,
    private readonly onError: (err: unknown) => void,
    private readonly retryMs = GRADUATION_RETRY_MS,
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

  /** Streams the token's DBC curve; UnsupportedPoolError if it has none still trading. */
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

  /** Finds and verifies the curve, then subscribes to it. */
  private async open(mint: string): Promise<Watched> {
    const listed = (await this.directory.find(mint)).find((p) => p.dexId === 'meteoradbc');
    if (!listed) throw new UnsupportedPoolError(`No Meteora bonding curve for ${mint}`);
    const raw = await this.accounts.getAccount(listed.address);
    if (!raw) throw new UnsupportedPoolError(`Meteora bonding curve ${listed.address} not found on-chain`);
    const pool = decodeDbcPool(raw);
    if (pool.baseMint !== mint) throw new UnsupportedPoolError(`Meteora pool ${listed.address} is not for ${mint}`);
    if (pool.isMigrated) throw new UnsupportedPoolError(`Meteora bonding curve for ${mint} has graduated`);
    const cfg = await this.accounts.getAccount(pool.config);
    if (!cfg) throw new UnsupportedPoolError(`Meteora pool config ${pool.config} not found`);
    const quoteMint = decodeDbcQuoteMint(cfg);
    await this.quotes.track(quoteMint);
    const [supply, quoteSupply] = await Promise.all([this.accounts.getMintSupply(mint), this.accounts.getMintSupply(quoteMint)]);

    const w: Watched = { listeners: new Set(), stops: [], lastTick: null };
    let latest: DbcPool = pool;
    const emit = (t: PriceTick): void => { w.lastTick = t; for (const l of w.listeners) l(t); };
    const price = (): void => {
      const quoteUsd = this.quotes.usd(quoteMint);
      if (quoteUsd === null) return;
      const priceUsd = dbcPrice(latest.sqrtPrice, supply.decimals, quoteSupply.decimals) * quoteUsd;
      emit({ mint, priceUsd, marketCapUsd: marketCapUsd(priceUsd, supply.amount, supply.decimals), source: 'meteora-dbc', receivedAt: Date.now() });
    };
    const graduate = (): void => {
      w.stops.forEach((s) => s());
      w.stops = [followGraduation(this.graduated, mint, emit, this.onError, this.retryMs)];
    };
    const sub = this.accounts.subscribe(listed.address, (d) => {
      try {
        latest = decodeDbcPool(d);
        if (latest.isMigrated) graduate();
        else price();
      } catch (err) {
        this.onError(err);
      }
    });
    const offQuote = this.quotes.onChange((q) => { if (q === quoteMint) { try { price(); } catch (err) { this.onError(err); } } });
    w.stops.push(() => sub.stop(), offQuote);
    return w;
  }
}
