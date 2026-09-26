/**
 * @file format.ts
 * @description Display formatting for prices, market caps, orders and statuses.
 * @author Reborn1987
 */

import type { Order, OrderStatus } from './types';

/** "$4.2K", "$1.35M", "$12.50". */
export function formatUsdCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

/** Tiny token prices: "$0.0000043988" → "$0.0₅43988" style is hard to read in inputs; use 4 significant digits. */
export function formatPrice(v: number): string {
  if (v >= 1) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(4)}`;
}

/** Shortens a mint: "EcwF…Wpump". */
export function shortMint(mint: string): string {
  return mint.length > 10 ? `${mint.slice(0, 4)}…${mint.slice(-5)}` : mint;
}

/** Human description of the order's kind, e.g. "Limit buy", "Take profit", "Stop loss", "Breakout buy". */
export function orderKind(o: Pick<Order, 'side' | 'trigger'>): string {
  if (o.side === 'buy') return o.trigger.direction === 'below' ? 'Limit buy' : 'Breakout buy';
  return o.trigger.direction === 'above' ? 'Take profit' : 'Stop loss';
}

/** "MC ≤ $3.0K" / "Price ≥ $0.00001000". */
export function triggerLabel(o: Pick<Order, 'trigger'>): string {
  const op = o.trigger.direction === 'below' ? '≤' : '≥';
  return o.trigger.metric === 'marketCap'
    ? `MC ${op} ${formatUsdCompact(o.trigger.value)}`
    : `Price ${op} ${formatPrice(o.trigger.value)}`;
}

/** "$5.00" or "25%". */
export function amountLabel(o: Pick<Order, 'amount' | 'side'>): string {
  if (o.amount.kind === 'usd') return `$${o.amount.value.toFixed(2)}`;
  return `${o.amount.value}% of ${o.side === 'buy' ? 'cash' : 'position'}`;
}

/** Plain-language status. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  open: 'Waiting',
  triggered: 'Triggered',
  executing: 'Trading…',
  filled: 'Filled',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Check FOMO',
};

/** Statuses that can still be cancelled. */
export function isCancellable(status: OrderStatus): boolean {
  return status === 'open' || status === 'triggered';
}

/** Extracts a Solana mint from a FOMO token URL, or null. */
export function mintFromFomoUrl(url: string | undefined): string | null {
  const m = url ? /^https:\/\/fomo\.family\/tokens\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(url) : null;
  return m ? m[1]! : null;
}

/** "just now", "45s ago", "12m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown time';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
