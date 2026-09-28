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

/**
 * An order-type entry laid out in lines separated by blank lines — icon + short id, the fomo handle, what happened,
 * the token address (tap-to-copy in Telegram) and an optional detail:
 *   "🛑 LM-JPHDZS\n\n(@ibiraw)\n\ncancelled Stop loss 100% ·\n\n6prL…pump"
 * The relay puts the time after the icon and shows the icon in place of the generic 📈.
 */
export function orderEntry(icon: string, who: string, action: string, mint: string | null, detail: string | null = null): string {
  const split = who.indexOf(' (');
  const [id, handle] = split < 0 ? [who, null] : [who.slice(0, split), who.slice(split + 1)];
  return [`${icon} ${id}`, handle, mint ? `${action} ·` : action, mint, detail].filter((part): part is string => !!part).join('\n\n');
}

/** Monitoring text for an order change (see orderEntry), or null when it isn't worth a message. */
export function describeOrder(o: Order, who: string): string | null {
  const amount = o.amount.kind === 'usd' ? `$${o.amount.value}` : `${o.amount.value}%`;
  const target = `${o.trigger.metric === 'marketCap' ? 'MC' : 'price'} ${o.trigger.direction === 'below' ? '≤' : '≥'} ${usdCompact(o.trigger.value)}`;
  const what = `${orderKind(o)} ${amount}`;
  const entry = (action: string, detail: string | null = null) => orderEntry(orderIcon(o), who, action, o.mint, detail);
  switch (o.status) {
    case 'open':
      return o.attempts === 0 ? entry(`placed ${what}`, target) : entry(`re-armed ${what} after slippage`, o.lastError);
    case 'filled':
      return entry(`FILLED ${what}`, o.triggeredAtValue ? `at ${usdCompact(o.triggeredAtValue)}` : null);
    case 'failed':
      return entry(`FAILED ${what}`, o.lastError ?? 'unknown error');
    case 'unknown':
      return entry(`outcome unknown ${what}`, o.lastError);
    case 'cancelled':
      return entry(`cancelled ${what}`, o.lastError);
    default:
      return null;
  }
}
