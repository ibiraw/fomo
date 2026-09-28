/**
 * @file format.ts
 * @description Display formatting for prices, market caps, orders and statuses.
 * @author Reborn1987
 */

import { keyFromPath, tokenAddress } from './token-key';
import type { Order, OrderStatus, PriceTick } from './types';

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

/** Shortens a token key's address: "EcwF…Wpump", "0x95…db07". */
export function shortMint(mint: string): string {
  const a = tokenAddress(mint);
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-5)}` : a;
}

/** Human description of the order's kind, e.g. "Limit buy", "Take profit", "Stop loss", "Breakout buy", "Quick buy". */
export function orderKind(o: Pick<Order, 'side' | 'trigger' | 'kind'>): string {
  if (o.kind === 'market') return o.side === 'buy' ? 'Quick buy' : 'Quick sell';
  if (o.side === 'buy') return o.trigger.direction === 'below' ? 'Limit buy' : 'Breakout buy';
  return o.trigger.direction === 'above' ? 'Take profit' : 'Stop loss';
}

/** "MC ≤ $3.0K" / "Price ≥ $0.00001000"; "Right away" for a quick trade. */
export function triggerLabel(o: Pick<Order, 'trigger' | 'kind'>): string {
  if (o.kind === 'market') return 'Right away';
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

/** Market cap the way this order measures it: with its fomo supply when it has one. */
export function orderMarketCap(o: Pick<Order, 'trigger'>, tick: { readonly priceUsd: number; readonly marketCapUsd: number }): number {
  return o.trigger.supply ? tick.priceUsd * o.trigger.supply : tick.marketCapUsd;
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

/** Extracts the token key (Solana mint or `<chain>:<0xaddress>`) from a FOMO token URL, or null. */
export function mintFromFomoUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname === 'fomo.family' ? keyFromPath(u.pathname) : null;
  } catch {
    return null;
  }
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

/** Age at which a post counts as fully "old" (red). */
const OLD_POST_MINUTES = 24 * 60;

/**
 * Color for a post's age: green when fresh, through yellow/orange, to red at 24h+.
 * Uses a log scale so minutes-to-hours differences stay visible.
 */
export function ageColor(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'hsl(0 0% 60%)';
  const minutes = Math.max(0, (now - t) / 60_000);
  const x = Math.min(1, Math.log1p(minutes) / Math.log1p(OLD_POST_MINUTES));
  return `hsl(${Math.round(140 * (1 - x))} 80% 55%)`;
}

/** Short amount: "$5" / "$2.50" / "25%". */
export function amountShort(o: Pick<Order, 'amount'>): string {
  if (o.amount.kind === 'percent') return `${o.amount.value}%`;
  return Number.isInteger(o.amount.value) ? `$${o.amount.value}` : `$${o.amount.value.toFixed(2)}`;
}

/** Plain-language one-liners for stored order notes ("kind: detail"), keyed by kind. */
const NOTE_SHORT: Record<string, string> = {
  auto_cancelled: 'Auto-cancelled: token sold',
  slippage: 'Slippage — will retry',
  insufficient_funds: 'Not enough balance',
  not_logged_in: 'FOMO tab not logged in',
  ui_error: 'FOMO page problem',
  timeout: 'Unconfirmed — check FOMO',
  unknown: 'Unconfirmed — check FOMO',
};

/** Short, readable version of an order note; the full text stays available as a tooltip. */
export function shortNote(o: Pick<Order, 'lastError' | 'status'>): string | null {
  if (!o.lastError) return null;
  const kind = /^([a-z_]+):/.exec(o.lastError)?.[1];
  const short = kind ? NOTE_SHORT[kind] : undefined;
  if (kind === 'slippage' && o.status === 'failed') return 'Failed: slippage on every try';
  if (short) return short;
  if (/restarted/i.test(o.lastError)) return 'Unconfirmed — check FOMO';
  return o.lastError.length > 48 ? `${o.lastError.slice(0, 45)}…` : o.lastError;
}

/**
 * Whether a token is still on a launchpad's bonding curve, judged by where its live price comes from: a curve
 * (pump.fun, LaunchLab, Meteora DBC, four.meme, flap.sh) or a DEX pool it graduated to (PumpSwap, Raydium CPMM,
 * Meteora DAMM, Uniswap / PancakeSwap v2–v4). Null for the polled fallbacks (Jupiter, DexScreener), which don't say.
 */
export function curveStatusFromSource(source: PriceTick['source'] | null | undefined): 'curve' | 'graduated' | null {
  if (!source) return null;
  if (source === 'pump-curve' || source === 'raydium-launchlab' || source === 'meteora-dbc' || source === 'four-meme' || source === 'flap') return 'curve';
  if (source === 'jupiter' || source === 'dexscreener') return null;
  return 'graduated';
}
