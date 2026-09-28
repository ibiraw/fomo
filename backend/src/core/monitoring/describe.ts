/**
 * @file describe.ts
 * @description One-line monitoring texts for order events ("🎯 LM-7K3Q2P placed Take profit 50% · base:0x9500…
 *              (full address) · MC ≥ $120K"). The leading icon is the order type; the relay uses it as the line's icon.
 *              Intermediate states (triggered, executing) return null — only placements and outcomes are worth a message.
 * @author Reborn1987
 */

import type { Order } from '../orders/order.js';

/** "$1.2K", "$3.4M", "$0.00042". */
export function usdCompact(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(3)}`;
}

/** "EcwF…pump" / "base:0x9500…db07". */
export function tokenLabel(key: string): string {
  const [chain, addr] = key.includes(':') ? key.split(':') as [string, string] : ['', key];
  const short = addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
  return chain ? `${chain}:${short}` : short;
}

/** "Limit buy", "Breakout buy", "Take profit", "Stop loss". */
export function orderKind(o: Pick<Order, 'side' | 'trigger'>): string {
  if (o.side === 'buy') return o.trigger.direction === 'below' ? 'Limit buy' : 'Breakout buy';
  return o.trigger.direction === 'above' ? 'Take profit' : 'Stop loss';
}

/** The order type's icon: 🟢 limit buy, 🚀 breakout buy, 🎯 take profit, 🛑 stop loss. */
export function orderIcon(o: Pick<Order, 'side' | 'trigger'>): string {
  if (o.side === 'buy') return o.trigger.direction === 'below' ? '🟢' : '🚀';
  return o.trigger.direction === 'above' ? '🎯' : '🛑';
}

/** Network heart shown before a token address (the colour is the chain): Solana 💜, Base 💙, Ethereum 🩵, BNB 💛, Robinhood 💚, Arc 🩶. */
const NETWORK_ICON: Record<string, string> = { solana: '💜', base: '💙', ethereum: '🩵', bnb: '💛', robinhood: '💚', arc: '🩶' };

/** The network heart for a token key ("base:0x…" → 💙; a bare mint is Solana → 💜). */
export function networkIcon(key: string): string {
  const chain = key.includes(':') ? key.slice(0, key.indexOf(':')) : 'solana';
  return NETWORK_ICON[chain] ?? '🤍';
}

/** An optional last line: market info (📊 target, fill) or a reason (ℹ️ error, cancel reason). */
export interface EntryDetail {
  readonly kind: 'market' | 'reason';
  readonly text: string;
}

/**
 * An order-type entry laid out in lines separated by blank lines:
 *   "LM-JPHDZS" (the relay prefixes "⏰ <time> ")
 *   "🧍LM-JPHDZS (@ibiraw)"
 *   "🟢 placed Limit buy $50"
 *   "💜 6prL…pump" (network heart + tap-to-copy address; no chain name — the colour says it)
 *   "📊 MC ≤ $162.9K"
 */
export function orderEntry(icon: string, who: string, action: string, mint: string | null, detail: EntryDetail | null = null): string {
  const id = who.includes(' (') ? who.slice(0, who.indexOf(' (')) : who;
  return [
    id,
    `🧍${who}`,
    `${icon} ${action}`,
    mint ? `${networkIcon(mint)} ${mint.includes(':') ? mint.slice(mint.indexOf(':') + 1) : mint}` : null,
    detail ? `${detail.kind === 'market' ? '📊' : 'ℹ️'} ${detail.text}` : null,
  ].filter((part): part is string => !!part).join('\n\n');
}

/** Monitoring text for an order change (see orderEntry), or null when it isn't worth a message. */
export function describeOrder(o: Order, who: string): string | null {
  const amount = o.amount.kind === 'usd' ? `$${o.amount.value}` : `${o.amount.value}%`;
  const target = `${o.trigger.metric === 'marketCap' ? 'MC' : 'price'} ${o.trigger.direction === 'below' ? '≤' : '≥'} ${usdCompact(o.trigger.value)}`;
  const what = `${orderKind(o)} ${amount}`;
  const entry = (action: string, detail: EntryDetail | null = null) => orderEntry(orderIcon(o), who, action, o.mint, detail);
  const market = (text: string): EntryDetail => ({ kind: 'market', text });
  const reason = (text: string | null): EntryDetail | null => (text ? { kind: 'reason', text } : null);
  switch (o.status) {
    case 'open':
      return o.attempts === 0 ? entry(`placed ${what}`, market(target)) : entry(`re-armed ${what} after slippage`, reason(o.lastError));
    case 'filled':
      return entry(`FILLED ${what}`, o.triggeredAtValue ? market(`at ${usdCompact(o.triggeredAtValue)}`) : null);
    case 'failed':
      return entry(`FAILED ${what}`, reason(o.lastError ?? 'unknown error'));
    case 'unknown':
      return entry(`outcome unknown ${what}`, reason(o.lastError));
    case 'cancelled':
      return entry(`cancelled ${what}`, reason(o.lastError));
    default:
      return null;
  }
}
