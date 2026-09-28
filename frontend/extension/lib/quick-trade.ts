/**
 * @file quick-trade.ts
 * @description v2.0.0 quick Buy/Sell buttons under posts in fomo's Feed and Alerts (side panel). Each item's token is
 *              read from its link to the token page (trades) or, for thesis posts that have no link, from its token
 *              logo, whose file name carries the network id and address (defined.fi "4663_0x…_small", fomo
 *              "logos/evm_4663_0x…", "logos/solana_solana_<mint>"). A tap places a quick (market) order through the
 *              server, which limit then trades right away in its background fomo tab. Amounts are the user's presets.
 *              Only the tabs in the layout data (Alerts, Feed) get buttons; Tokens and Leaderboard don't.
 * @author Reborn1987
 */

import { fomoDom } from './fomo-dom-config';
import { keyFromPath } from './token-key';

/** The three buttons: two $ buys and one % sell. */
export interface QuickPresets {
  readonly buyA: number;
  readonly buyB: number;
  readonly sellPct: number;
}

export const QUICK_PRESETS_KEY = 'quickPresets';
export const DEFAULT_QUICK_PRESETS: QuickPresets = { buyA: 50, buyB: 200, sellPct: 50 };

/** fomo's minimum trade, and a sanity cap on one tap. */
const MIN_BUY = 2;
const MAX_BUY = 100_000;

/** A stored value as presets; each invalid field falls back to its default. */
export function toQuickPresets(v: unknown): QuickPresets {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const buy = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) && x >= MIN_BUY && x <= MAX_BUY ? x : d);
  const pct = typeof o.sellPct === 'number' && Number.isFinite(o.sellPct) && o.sellPct > 0 && o.sellPct <= 100 ? o.sellPct : DEFAULT_QUICK_PRESETS.sellPct;
  return { buyA: buy(o.buyA, DEFAULT_QUICK_PRESETS.buyA), buyB: buy(o.buyB, DEFAULT_QUICK_PRESETS.buyB), sellPct: pct };
}

/** Network ids in token logo file names → limit's chain names (checked against each chain's RPC, 2026-09-28). */
const NETWORK_CHAINS: Readonly<Record<string, string>> = {
  '1399811149': 'solana',
  '1': 'ethereum',
  '8453': 'base',
  '56': 'bnb',
  '4663': 'robinhood',
  '5042': 'arc',
};

const EVM_ADDR = '0x[0-9a-fA-F]{40}';
const SOL_ADDR = '[1-9A-HJ-NP-Za-km-z]{32,44}';

/** The token key in a token logo address, or null ("…/4663_0xab…_small_x.png" → "robinhood:0xab…"). */
export function tokenKeyFromLogo(src: string): string | null {
  const file = src.split(/[?#]/)[0]!.split('/').pop() ?? '';
  const m = new RegExp(`^(?:evm_)?(\\d+)_(${EVM_ADDR}|${SOL_ADDR})(?:[_.]|$)`).exec(file)
    ?? new RegExp(`^solana_solana_(${SOL_ADDR})\\.`).exec(file);
  if (!m) return null;
  const [net, address] = m.length === 3 ? [m[1]!, m[2]!] : ['1399811149', m[1]!];
  const chain = NETWORK_CHAINS[net];
  if (!chain) return null;
  return keyFromPath(`/tokens/${chain}/${address}`);
}

/** The token a Feed / Alerts item is about: its token-page link, else its token logo. */
export function tokenKeyOfItem(item: Element): string | null {
  const link = item.querySelector<HTMLAnchorElement>('a[href^="/tokens/"]');
  if (link) {
    const key = keyFromPath((link.getAttribute('href') ?? '').split(/[?#]/)[0]!);
    if (key) return key;
  }
  for (const img of item.querySelectorAll('img')) {
    const key = tokenKeyFromLogo(img.getAttribute('src') ?? '');
    if (key) return key;
  }
  return null;
}

/** The items of the side panel's active tab when it is one that gets buttons (Alerts, Feed), else none. */
export function quickTradeItems(doc: Document): Element[] {
  const { quickTradeTabs, sideTabInactiveClass, feedItem } = fomoDom();
  const active = [...doc.querySelectorAll('button')].find(
    (b) => quickTradeTabs.includes(b.textContent?.trim() ?? '') && !b.classList.contains(sideTabInactiveClass),
  );
  if (!active) return [];
  // The panel: the nearest ancestor of the tab row that holds list items.
  let panel: Element | null = active;
  for (let i = 0; i < 10 && panel; i++) {
    panel = panel.parentElement;
    if (panel?.querySelector(feedItem)) break;
  }
  return panel ? [...panel.querySelectorAll(feedItem)] : [];
}

/** What a tap asks the background to do. */
export interface QuickTradeRequest {
  readonly type: 'fomo.quick';
  readonly mint: string;
  readonly side: 'buy' | 'sell';
  readonly amount: { readonly kind: 'usd' | 'percent'; readonly value: number };
}

/** The background's answer to a tap: placed (with the order id to follow) or refused. */
export type QuickTradeReply = { readonly ok: true; readonly orderId: string } | { readonly ok: false; readonly error: string };

/** Sent by the background when a quick order finishes. */
export interface QuickTradeResult {
  readonly type: 'quick.result';
  readonly orderId: string;
  readonly status: 'filled' | 'failed' | 'unknown' | 'cancelled';
  readonly error: string | null;
}

const ROW_ATTR = 'data-limit-quick';

/** Page access (injectable for tests). */
export interface QuickTradeEnv {
  readonly doc: Document;
  presets(): QuickPresets;
  send(req: QuickTradeRequest): Promise<QuickTradeReply>;
}

/** One button's look for a state. */
const LOOK: Record<'buy' | 'sell', { bg: string; fg: string; border: string }> = {
  buy: { bg: 'rgba(34,197,94,0.14)', fg: '#4ade80', border: 'rgba(34,197,94,0.45)' },
  sell: { bg: 'rgba(239,68,68,0.14)', fg: '#f87171', border: 'rgba(239,68,68,0.45)' },
};

/** Adds and keeps the quick buttons on the active Feed / Alerts items. */
export class QuickTradeButtons {
  /** Buttons waiting for their order's outcome, by order id. */
  private readonly waiting = new Map<string, { button: HTMLButtonElement; label: string; side: 'buy' | 'sell' }>();

  /** @param env page access */
  constructor(private readonly env: QuickTradeEnv) {}

  /** Adds buttons to items that don't have them (or whose token changed); safe to call on every DOM change. */
  scan(): void {
    for (const item of quickTradeItems(this.env.doc)) {
      const key = tokenKeyOfItem(item);
      const row = item.querySelector(`:scope > [${ROW_ATTR}]`);
      if (row?.getAttribute(ROW_ATTR) === key) continue;
      row?.remove();
      if (key) item.append(this.row(key));
    }
  }

  /** Removes every button (feature switched off). */
  clear(): void {
    this.env.doc.querySelectorAll(`[${ROW_ATTR}]`).forEach((r) => r.remove());
  }

  /** Shows a finished quick order on its button. */
  finish(r: QuickTradeResult): void {
    const w = this.waiting.get(r.orderId);
    if (!w) return;
    this.waiting.delete(r.orderId);
    const done = r.status === 'filled';
    this.settle(w.button, done ? `✓ ${w.side === 'buy' ? 'Bought' : 'Sold'}` : r.status === 'unknown' ? 'Check fomo' : '✗ Failed', w.label, r.error);
  }

  /** The button row for one token. */
  private row(key: string): HTMLElement {
    const p = this.env.presets();
    const row = this.env.doc.createElement('div');
    row.setAttribute(ROW_ATTR, key);
    row.style.cssText = 'display:flex;gap:6px;padding:0 12px 10px 52px;flex-wrap:wrap';
    row.append(
      this.button(key, 'buy', { kind: 'usd', value: p.buyA }, `Buy $${p.buyA}`),
      this.button(key, 'buy', { kind: 'usd', value: p.buyB }, `Buy $${p.buyB}`),
      this.button(key, 'sell', { kind: 'percent', value: p.sellPct }, `Sell ${p.sellPct}%`),
    );
    // Taps on the row must not open the post or the token page underneath.
    row.addEventListener('click', (e) => e.stopPropagation());
    return row;
  }

  /** One pill button: tap → quick order → "Buying…" → "✓ Bought" / "✗ Failed". */
  private button(mint: string, side: 'buy' | 'sell', amount: QuickTradeRequest['amount'], label: string): HTMLButtonElement {
    const b = this.env.doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = `limit: ${label.toLowerCase()} right away`;
    const look = LOOK[side];
    b.style.cssText = `cursor:pointer;border:1px solid ${look.border};background:${look.bg};color:${look.fg};border-radius:8px;padding:4px 10px;font-size:12px;font-weight:600;line-height:16px`;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      b.style.cursor = 'default';
      b.textContent = side === 'buy' ? 'Buying…' : 'Selling…';
      void this.env.send({ type: 'fomo.quick', mint, side, amount }).then(
        (reply) => {
          if (reply.ok) this.waiting.set(reply.orderId, { button: b, label, side });
          else this.settle(b, '✗ Failed', label, reply.error);
        },
        (err: unknown) => this.settle(b, '✗ Failed', label, err instanceof Error ? err.message : String(err)),
      );
    });
    return b;
  }

  /** Shows an outcome for a few seconds, then restores the button. */
  private settle(b: HTMLButtonElement, text: string, label: string, error: string | null): void {
    b.textContent = text;
    b.title = error ?? b.title;
    setTimeout(() => {
      b.textContent = label;
      b.disabled = false;
      b.style.cursor = 'pointer';
      b.title = `limit: ${label.toLowerCase()} right away`;
    }, error ? 6_000 : 3_000);
  }
}
