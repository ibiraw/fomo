/**
 * @file fomo-spot-watch.ts
 * @description Notices trades the user makes with fomo's own Buy/Sell buttons: fomo shows a toast ("Buying $3.00 KEK",
 *              "Selling 1.2M KEK") for every trade. Each new toast is reported once to the background worker, which
 *              drops the ones caused by limit's own orders and forwards the rest to the server for monitoring.
 *              For sells it also reads the token's row in "Your positions" (all or partial, ~USD, PnL). Cheap: one
 *              querySelectorAll per second; the positions list (one text read) every 5 s, only on token pages.
 * @author Reborn1987
 */

import { fomoDom } from './fomo-dom-config';
import { readPosition, summarizeSell, type FomoPosition, type SellSummary } from './fomo-positions';

/** What the watcher reports to the background worker. */
export interface SpotTradeMessage {
  readonly type: 'fomo.spot';
  readonly side: 'buy' | 'sell';
  /** The toast text, e.g. "Buying $3.00 KEK". */
  readonly detail: string;
  /** Token key of the page, when on a token page. */
  readonly mint: string | null;
  /** For sells: all or partial, share sold, ~USD proceeds and PnL, from the position held just before. */
  readonly sell?: SellSummary | null;
}

/** Page access (injectable for tests). */
export interface SpotEnv {
  readonly doc: Document;
  /** Token key of the current page, or null. */
  mint(): string | null;
  /** Ticker of the current page's token (from fomo's title "$67K MC | QCAT | fomo"), or null. */
  symbol(): string | null;
  send(msg: SpotTradeMessage): void;
  now(): number;
}

/** The token ticker in fomo's page title ("$67.1K MC | QCAT | fomo" → "QCAT"). */
export function titleSymbol(title: string): string | null {
  const parts = title.split('|').map((p) => p.trim());
  return parts.length >= 3 && parts[1] ? parts[1] : null;
}

/** A toast's trade without fomo's relative time ("Selling 1.2M KEKJust now" → "Selling 1.2M KEK"). */
export function tradeText(text: string): string {
  return text.replace(/\s*(?:just now|\d+\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)\s*ago)$/i, '').trim();
}

/** How often the current token's position is snapshotted (a sell toast may appear after fomo already updated it). */
const POSITION_EVERY_MS = 5_000;

/** "buy" / "sell" when the toast text starts with one of fomo's trade prefixes, else null. */
export function spotSide(text: string): 'buy' | 'sell' | null {
  const { spotBuyPrefixes, spotSellPrefixes } = fomoDom();
  const t = text.toLowerCase();
  if (spotBuyPrefixes.some((p) => t.startsWith(p.toLowerCase()))) return 'buy';
  if (spotSellPrefixes.some((p) => t.startsWith(p.toLowerCase()))) return 'sell';
  return null;
}

export class SpotTradeWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * The trade each toast last showed (held weakly, so removed toasts are garbage-collected). fomo can reuse a toast
   * for the next trade, so a toast is reported again whenever its trade text changes.
   */
  private readonly seen = new WeakMap<Element, string>();
  /** Last position snapshot of the page's token (only one kept). */
  private snapshot: { symbol: string; position: FomoPosition } | null = null;
  private nextSnapshot = 0;

  /** @param env page access @param everyMs scan interval */
  constructor(private readonly env: SpotEnv, private readonly everyMs = 1_000) {}

  /** Starts scanning. */
  start(): void {
    this.timer = setInterval(() => this.scan(), this.everyMs);
  }

  /** Stops scanning. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Reports every trade toast not seen before; keeps a light position snapshot for sells. */
  scan(): void {
    const symbol = this.env.symbol();
    if (symbol && this.env.now() >= this.nextSnapshot) {
      this.nextSnapshot = this.env.now() + POSITION_EVERY_MS;
      const position = readPosition(this.env.doc, symbol);
      this.snapshot = position ? { symbol, position } : this.snapshot?.symbol === symbol ? this.snapshot : null;
    }
    for (const el of this.env.doc.querySelectorAll(fomoDom().notification)) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue; // still rendering — look again next scan
      const trade = tradeText(text);
      if (this.seen.get(el) === trade) continue; // same trade (only its "2m ago" changed)
      this.seen.set(el, trade);
      const side = spotSide(text);
      if (!side) continue;
      this.env.send({ type: 'fomo.spot', side, detail: text.slice(0, 200), mint: this.env.mint(), sell: side === 'sell' ? this.sellSummary(text, symbol) : null });
    }
  }

  /** The sell measured against the position held just before it: the larger of now and the last snapshot. */
  private sellSummary(text: string, symbol: string | null): SellSummary | null {
    if (!symbol) return null;
    const now = readPosition(this.env.doc, symbol);
    const before = this.snapshot?.symbol === symbol ? this.snapshot.position : null;
    const position = now && before ? (before.amount >= now.amount ? before : now) : (now ?? before);
    return summarizeSell(text, position);
  }
}
