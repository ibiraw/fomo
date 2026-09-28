/**
 * @file describe.ts
 * @description One-line monitoring texts for order events ("LM-7K3Q2P placed 🎯 Take profit 50% · base:0x9500…
 *              (full address) · MC ≥ $120K"). Intermediate states (triggered, executing) return null — only
 *              placements and outcomes are worth a message.
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

/** "🟢 Limit buy", "🚀 Breakout buy", "🎯 Take profit", "🛑 Stop loss" — the icon makes the type obvious at a glance. */
export function orderKind(o: Pick<Order, 'side' | 'trigger'>): string {
  if (o.side === 'buy') return o.trigger.direction === 'below' ? '🟢 Limit buy' : '🚀 Breakout buy';
  return o.trigger.direction === 'above' ? '🎯 Take profit' : '🛑 Stop loss';
}

/** Monitoring text for an order change, or null when it isn't worth a message. */
export function describeOrder(o: Order, who: string): string | null {
  const amount = o.amount.kind === 'usd' ? `$${o.amount.value}` : `${o.amount.value}%`;
  const target = `${o.trigger.metric === 'marketCap' ? 'MC' : 'price'} ${o.trigger.direction === 'below' ? '≤' : '≥'} ${usdCompact(o.trigger.value)}`;
  const what = `${orderKind(o)} ${amount} · ${o.mint}`; // full address: copyable in Telegram
  switch (o.status) {
    case 'open':
      return o.attempts === 0 ? `${who} placed ${what} · ${target}` : `${who} ${what} re-armed after slippage (${o.lastError ?? ''})`;
    case 'filled':
      return `${who} FILLED ${what}${o.triggeredAtValue ? ` at ${usdCompact(o.triggeredAtValue)}` : ''}`;
    case 'failed':
      return `${who} FAILED ${what}: ${o.lastError ?? 'unknown error'}`;
    case 'unknown':
      return `${who} outcome unknown ${what}: ${o.lastError ?? ''}`;
    case 'cancelled':
      return `${who} cancelled ${what}${o.lastError ? ` (${o.lastError})` : ''}`;
    default:
      return null;
  }
}
