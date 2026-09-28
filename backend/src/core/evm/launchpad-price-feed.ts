/**
 * @file launchpad-price-feed.ts
 * @description Live prices for EVM launchpad tokens still on their bonding curve (not on a DEX yet):
 *              four.meme (BNB) and flap.sh (BNB, Base, Robinhood): one log subscription per launchpad carries every
 *              trade, and each trade event includes the post-trade price, so ticks need no extra calls.
 *              pons (Robinhood): each token has its own curve contract; any log from it (a trade) triggers a re-read
 *              of its reserves.
 *              When a token graduates to a DEX, its watchers are handed to the pool feed.
 * @author Reborn1987
 */

import { toEventSelector } from 'viem';

import { parseTokenKey } from '../chains/token-key.js';
import { UnsupportedPoolError } from '../errors.js';
import type { EvmLog, EvmRpcPort, Hex, LogSubscription } from '../../ports/evm-rpc.js';
import { PriceFeedPort, type PriceListener, type PriceSource, type PriceTick, type PriceWatch } from '../../ports/price-feed.js';
import { isRevert } from './contract.js';
import type { Erc20Reader } from './erc20.js';
import type { EvmUsdQuotes } from './evm-usd-quotes.js';
import { toUnits } from './pool-math.js';

/** Curve state of one token. */
export interface CurveState {
  /** Price in quote units per token (decimals applied). */
  readonly price: number;
  /** Quote token (0x0 = native). */
  readonly quote: string;
  readonly graduated: boolean;
  /** Launchpads with a contract per token (pons): the token's curve, whose logs are its trades. */
  readonly emitter?: Hex;
}

/** What a trade/graduation log says about a token. */
export type CurveEvent = { readonly kind: 'trade'; readonly token: string; readonly price: number } | { readonly kind: 'graduated'; readonly token: string };

/** One launchpad: where its events come from, how to read a token's state, how to parse its logs. */
export interface LaunchpadProtocol {
  readonly name: Extract<PriceSource, 'four-meme' | 'flap' | 'pons'>;
  /** Contract emitting trade and graduation events; null when each token has its own (`CurveState.emitter`). */
  readonly emitter: Hex | null;
  readonly topics: readonly Hex[];
  /** Current state, or null when the token was not launched here. */
  read(rpc: EvmRpcPort, token: Hex): Promise<CurveState | null>;
  /** Interprets one log from `emitter` (null for unrelated logs). */
  parse(log: EvmLog): CurveEvent | null;
}

/** 32-byte word `i` of ABI data. */
function word(data: Hex, i: number): bigint {
  const hex = data.slice(2 + i * 64, 2 + (i + 1) * 64);
  return hex.length === 64 ? BigInt(`0x${hex}`) : 0n;
}

/** Address in word `i` of ABI data (lowercase). */
function addressWord(data: Hex, i: number): string {
  return `0x${data.slice(2 + i * 64 + 24, 2 + (i + 1) * 64)}`.toLowerCase();
}

/** Left-pads an address as a call argument. */
function arg(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, '0');
}

const WAD = 1e18;

const FOUR_PURCHASE = toEventSelector('TokenPurchase(address,address,uint256,uint256,uint256,uint256,uint256,uint256)');
const FOUR_SALE = toEventSelector('TokenSale(address,address,uint256,uint256,uint256,uint256,uint256,uint256)');
const FOUR_LIQUIDITY_ADDED = toEventSelector('LiquidityAdded(address,uint256,address,uint256)');
/** TokenManagerHelper3.getTokenInfo(address). */
const FOUR_GET_TOKEN_INFO = '0x1f69565f';

/**
 * four.meme (BNB). getTokenInfo → (version, tokenManager, quote, lastPrice, …, liquidityAdded); price is 1e18-scaled
 * quote per token. Trade events (nothing indexed): token = word 0, price = word 2. LiquidityAdded: base token = word 0.
 */
export function fourMeme(manager: Hex, helper: Hex): LaunchpadProtocol {
  return {
    name: 'four-meme',
    emitter: manager,
    topics: [FOUR_PURCHASE, FOUR_SALE, FOUR_LIQUIDITY_ADDED],
    async read(rpc, token) {
      const data = await rpc.call(helper, `${FOUR_GET_TOKEN_INFO}${arg(token)}` as Hex);
      if (word(data, 1) === 0n) return null; // no token manager: not a four.meme token
      return { price: Number(word(data, 3)) / WAD, quote: addressWord(data, 2), graduated: word(data, 11) !== 0n };
    },
    parse(log) {
      const topic = log.topics[0];
      if (topic === FOUR_LIQUIDITY_ADDED) return { kind: 'graduated', token: addressWord(log.data, 0) };
      if (topic === FOUR_PURCHASE || topic === FOUR_SALE) return { kind: 'trade', token: addressWord(log.data, 0), price: Number(word(log.data, 2)) / WAD };
      return null;
    },
  };
}

const FLAP_BOUGHT = toEventSelector('TokenBought(uint256,address,address,uint256,uint256,uint256,uint256)');
const FLAP_SOLD = toEventSelector('TokenSold(uint256,address,address,uint256,uint256,uint256,uint256)');
const FLAP_LAUNCHED = toEventSelector('LaunchedToDEX(address,address,uint256,uint256)');
/** Portal.getTokenV7(address). */
const FLAP_GET_TOKEN = '0xf99abb9e';
const FLAP_STATUS_DEX = 4n;

/**
 * flap.sh Portal. getTokenV7 → (status, reserve, circulatingSupply, price, …, quoteTokenAddress @9, …); status 1 =
 * trading on the curve, 4 = on a DEX; price is 1e18-scaled quote per token. Trade events: token = word 1,
 * postPrice = word 6. LaunchedToDEX: token = word 0.
 */
export function flap(portal: Hex): LaunchpadProtocol {
  return {
    name: 'flap',
    emitter: portal,
    topics: [FLAP_BOUGHT, FLAP_SOLD, FLAP_LAUNCHED],
    async read(rpc, token) {
      const data = await rpc.call(portal, `${FLAP_GET_TOKEN}${arg(token)}` as Hex);
      const status = word(data, 0);
      if (status === 0n) return null; // unknown to the portal
      return { price: Number(word(data, 3)) / WAD, quote: addressWord(data, 9), graduated: status >= FLAP_STATUS_DEX };
    },
    parse(log) {
      const topic = log.topics[0];
      if (topic === FLAP_LAUNCHED) return { kind: 'graduated', token: addressWord(log.data, 0) };
      if (topic === FLAP_BOUGHT || topic === FLAP_SOLD) return { kind: 'trade', token: addressWord(log.data, 1), price: Number(word(log.data, 6)) / WAD };
      return null;
    },
  };
}

const PONS_CURVE = '0x7165485d'; // token.curve()
const PONS_FACTORY = '0xc45a0155'; // curve.factory()
const PONS_RESERVES = '0x0902f1ac'; // curve.getReserves() → (quote reserve incl. virtual, token reserve)
const PONS_QUOTE = '0x3de35b79'; // curve's quote token (0x0 = native ETH)
const PONS_GRADUATED = '0xe7c2b772'; // 1 once the curve has moved its liquidity to a DEX
const ERC20_DECIMALS = '0x313ce567';
const NATIVE = '0x0000000000000000000000000000000000000000';

/**
 * pons (Robinhood; selectors read off live curves, 2026-09-28). The token names its curve (`curve()`); the curve
 * must report `factory` as its factory. Price = quote reserve ÷ token reserve (constant product on virtual reserves;
 * matches the amounts of its trades). Quotes seen: USDG and native ETH. Graduated when the flag is set or the token
 * reserve is empty (the liquidity went to Uniswap v4). Trades are re-read from the curve, so `parse` is unused.
 */
export function pons(factory: Hex): LaunchpadProtocol {
  const decimals = new Map<string, number>();
  const decimalsOf = async (rpc: EvmRpcPort, token: string): Promise<number> => {
    if (token === NATIVE) return 18;
    let d = decimals.get(token);
    if (d === undefined) {
      d = Number(word(await rpc.call(token as Hex, ERC20_DECIMALS), 0));
      if (decimals.size > 1_000) decimals.clear();
      decimals.set(token, d);
    }
    return d;
  };
  return {
    name: 'pons',
    emitter: null,
    topics: [],
    async read(rpc, token) {
      const pointer = await rpc.call(token, PONS_CURVE);
      if (pointer.length < 66) return null; // no curve(): not a pons token
      const curve = addressWord(pointer, 0) as Hex;
      if (curve === NATIVE) return null;
      const [owner, reserves, quoteWord, graduated] = await Promise.all([
        rpc.call(curve, PONS_FACTORY), rpc.call(curve, PONS_RESERVES), rpc.call(curve, PONS_QUOTE), rpc.call(curve, PONS_GRADUATED),
      ]);
      if (addressWord(owner, 0) !== factory.toLowerCase()) return null; // someone else's curve()
      const quote = addressWord(quoteWord, 0);
      const [quoteReserve, tokenReserve] = [word(reserves, 0), word(reserves, 1)];
      const [qd, td] = await Promise.all([decimalsOf(rpc, quote), decimalsOf(rpc, token.toLowerCase())]);
      const price = tokenReserve === 0n ? 0 : toUnits(quoteReserve, qd) / toUnits(tokenReserve, td);
      return { price, quote, graduated: word(graduated, 0) !== 0n || tokenReserve === 0n, emitter: curve };
    },
    parse: () => null,
  };
}

interface Curve {
  readonly key: string;
  readonly listeners: Set<PriceListener>;
  readonly quote: string;
  readonly supply: number;
  price: number;
  lastTick: PriceTick | null;
  unsubQuote: () => void;
  /** Set once handed to the pool feed after graduation. */
  handoff: PriceWatch | null;
  retry: NodeJS.Timeout | null;
  /** Per-token launchpads: the curve's own log stream, and a re-read in flight / wanted again. */
  sub: LogSubscription | null;
  reading: boolean;
  again: boolean;
}

export class LaunchpadPriceFeed extends PriceFeedPort {
  /** Token address (lowercase) → curve. */
  private readonly curves = new Map<string, Curve>();
  private readonly pending = new Map<string, Promise<Curve>>();
  private sub: LogSubscription | null = null;

  /**
   * @param rpc chain access @param erc20 supply reads @param quotes USD for quote tokens
   * @param protocol the launchpad @param graduated feed that takes over once a token is on a DEX
   * @param onError sink for bad logs / hand-off failures @param retryMs wait between hand-off attempts
   */
  constructor(
    private readonly rpc: EvmRpcPort,
    private readonly erc20: Erc20Reader,
    private readonly quotes: EvmUsdQuotes,
    private readonly protocol: LaunchpadProtocol,
    private readonly graduated: PriceFeedPort,
    private readonly onError: (err: unknown) => void,
    private readonly retryMs = 5_000,
  ) {
    super();
  }

  /** Nothing to open up front; the event subscription starts with the first watch. */
  async start(): Promise<void> {}

  /** Stops everything. */
  async close(): Promise<void> {
    for (const c of this.curves.values()) this.dispose(c);
    this.curves.clear();
    this.sub?.stop();
    this.sub = null;
  }

  /** Streams a curve token. Rejects with UnsupportedPoolError when the token isn't on this launchpad's curve. */
  async watch(key: string, listener: PriceListener): Promise<PriceWatch> {
    const token = parseTokenKey(key).address.toLowerCase();
    let curve = this.curves.get(token);
    if (!curve) {
      let p = this.pending.get(token);
      if (!p) {
        p = this.open(key, token).finally(() => this.pending.delete(token));
        this.pending.set(token, p);
      }
      curve = await p;
    }
    curve.listeners.add(listener);
    if (curve.lastTick) listener(curve.lastTick);
    const c = curve;
    return {
      mint: key,
      stop: () => {
        c.listeners.delete(listener);
        if (c.listeners.size === 0 && this.curves.get(token) === c) {
          this.dispose(c);
          this.curves.delete(token);
          if (this.curves.size === 0) { this.sub?.stop(); this.sub = null; }
        }
      },
    };
  }

  /** Reads the curve and joins the shared event stream. */
  private async open(key: string, token: string): Promise<Curve> {
    let state: CurveState | null;
    try {
      state = await this.protocol.read(this.rpc, token as Hex);
    } catch (err) {
      if (!isRevert(err)) throw err;
      state = null; // the launchpad rejects tokens it didn't launch
    }
    if (!state) throw new UnsupportedPoolError(`${key} is not a ${this.protocol.name} token`);
    if (state.graduated) throw new UnsupportedPoolError(`${key} has left the ${this.protocol.name} curve`);
    await this.quotes.ensure(state.quote, token);
    const [raw, decimals] = await Promise.all([this.erc20.totalSupply(token as Hex), this.erc20.decimals(token as Hex)]);
    const curve: Curve = {
      key, listeners: new Set(), quote: state.quote, supply: toUnits(raw, decimals), price: state.price,
      lastTick: null, handoff: null, retry: null, sub: null, reading: false, again: false,
      unsubQuote: this.quotes.onChange(() => this.emit(curve)),
    };
    this.curves.set(token, curve);
    if (this.protocol.emitter) {
      const emitter = this.protocol.emitter;
      this.sub ??= this.rpc.subscribeLogs({ address: emitter, topics: [this.protocol.topics] }, (log) => this.onLog(log));
    } else if (state.emitter) {
      curve.sub = this.rpc.subscribeLogs({ address: state.emitter }, () => this.reread(curve, token));
    }
    this.emit(curve);
    return curve;
  }

  /** Routes a launchpad log to the watched token it concerns. */
  private onLog(log: EvmLog): void {
    try {
      const ev = this.protocol.parse(log);
      const curve = ev ? this.curves.get(ev.token) : undefined;
      if (!ev || !curve || curve.handoff) return;
      if (ev.kind === 'graduated') this.handOff(curve);
      else if (ev.price > 0) {
        curve.price = ev.price;
        this.emit(curve);
      }
    } catch (err) {
      this.onError(err);
    }
  }

  /** Per-token launchpads: re-reads the curve after one of its logs (one read at a time; a burst ends in one more). */
  private reread(curve: Curve, token: string): void {
    if (curve.handoff) return;
    if (curve.reading) { curve.again = true; return; }
    curve.reading = true;
    this.protocol.read(this.rpc, token as Hex)
      .then((state) => {
        if (!state || this.curves.get(token) !== curve || curve.handoff) return;
        if (state.graduated) this.handOff(curve);
        else if (state.price > 0) {
          curve.price = state.price;
          this.emit(curve);
        }
      })
      .catch((err: unknown) => this.onError(err))
      .finally(() => {
        curve.reading = false;
        if (curve.again) { curve.again = false; this.reread(curve, token); }
      });
  }

  /** Moves a graduated token's watchers to the pool feed, retrying until its pool is listed. */
  private handOff(curve: Curve): void {
    curve.unsubQuote();
    curve.sub?.stop();
    curve.sub = null;
    const attempt = (): void => {
      curve.retry = null;
      this.graduated
        .watch(curve.key, (tick) => { for (const l of curve.listeners) l(tick); })
        .then((w) => {
          if (this.curves.get(parseTokenKey(curve.key).address) === curve) curve.handoff = w;
          else w.stop();
        })
        .catch((err: unknown) => {
          this.onError(err);
          if (this.curves.get(parseTokenKey(curve.key).address) === curve) curve.retry = setTimeout(attempt, this.retryMs);
        });
    };
    curve.handoff = { mint: curve.key, stop: () => undefined }; // stop curve ticks while the pool is being found
    attempt();
  }

  /** Converts to USD and notifies listeners (skipped until the quote token has a price). */
  private emit(curve: Curve): void {
    const quoteUsd = this.quotes.usd(curve.quote);
    if (quoteUsd === null || curve.price <= 0 || curve.handoff) return;
    const priceUsd = curve.price * quoteUsd;
    const tick: PriceTick = { mint: curve.key, priceUsd, marketCapUsd: priceUsd * curve.supply, source: this.protocol.name, receivedAt: Date.now() };
    curve.lastTick = tick;
    for (const l of curve.listeners) l(tick);
  }

  /** Releases a curve's quote listener, hand-off watch and retry timer. */
  private dispose(c: Curve): void {
    c.unsubQuote();
    c.handoff?.stop();
    c.sub?.stop();
    if (c.retry) clearTimeout(c.retry);
  }
}
