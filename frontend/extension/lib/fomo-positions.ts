/**
 * @file fomo-positions.ts
 * @description Reads one token's row from fomo's "Your positions" list (observed 2026-09-28): the list's text runs
 *              SYMBOL / "717.3K SYMBOL" / "$87.45" / "▲"|"▼" / "11.71%". Used to describe a spot sell (how much was
 *              sold, for how much, up or down). Read-only; the header label comes from the layout data.
 * @author Reborn1987
 */

import { parseCompact, parseUsd } from './fomo-dom';
import { fomoDom } from './fomo-dom-config';

/** One held position as fomo shows it. */
export interface FomoPosition {
  /** Tokens held. */
  readonly amount: number;
  /** Current value in USD. */
  readonly valueUsd: number;
  /** Profit/loss in percent (negative when ▼). */
  readonly pnlPct: number;
}

/** Text lines of the "Your positions" box, or [] when it isn't on the page. */
function positionLines(doc: Document): string[] {
  const label = fomoDom().positionsHeader;
  const header = [...doc.querySelectorAll('div')].find((e) => e.childElementCount === 0 && (e.textContent ?? '').trim() === label);
  let box: Element | null = header ?? null;
  for (let i = 0; i < 3 && box; i++) box = box.parentElement; // header → title row → list container
  if (!box) return [];
  return ((box as HTMLElement).innerText ?? box.textContent ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/** The position row for `symbol` (case-insensitive), or null when it isn't listed or doesn't parse. */
export function readPosition(doc: Document, symbol: string): FomoPosition | null {
  const lines = positionLines(doc);
  const sym = symbol.toLowerCase();
  for (let i = 0; i < lines.length - 3; i++) {
    const m = /^([\d.,]+\s*[KMBT]?)\s+(\S+)$/i.exec(lines[i]!);
    if (!m || m[2]!.toLowerCase() !== sym) continue;
    const amount = parseCompact(m[1]!.replace(/\s+/g, ''));
    const valueUsd = parseUsd(lines[i + 1]!);
    const arrow = lines[i + 2]!;
    const pct = /^([\d.,]+)%$/.exec(lines[i + 3]!);
    if (amount === null || valueUsd === null || !pct || (arrow !== '▲' && arrow !== '▼')) return null;
    const p = Number(pct[1]!.replace(/,/g, ''));
    return { amount, valueUsd, pnlPct: arrow === '▼' ? -p : p };
  }
  return null;
}

/** What a sell toast ("Selling 211.3K QCAT") means against the position held just before it. */
export interface SellSummary {
  /** Sold everything (≥ 99% of the position). */
  readonly all: boolean;
  /** Share of the position sold, 0–100. */
  readonly soldPct: number;
  /** Approximate proceeds in USD. */
  readonly usd: number;
  readonly pnlPct: number;
}

/** Parses "Selling 211.3K QCAT" into the token amount and symbol. */
export function parseSellToast(text: string): { amount: number; symbol: string } | null {
  const m = /^\S+\s+([\d.,]+\s*[KMBT]?)\s+(\S+)/i.exec(text.trim());
  if (!m) return null;
  const amount = parseCompact(m[1]!.replace(/\s+/g, ''));
  return amount === null ? null : { amount, symbol: m[2]! };
}

/** Combines a sell toast with the position it sold from. Null when either is unreadable. */
export function summarizeSell(toast: string, position: FomoPosition | null): SellSummary | null {
  const sold = parseSellToast(toast);
  if (!sold || !position || position.amount <= 0) return null;
  const share = Math.min(1, sold.amount / position.amount);
  return { all: share >= 0.99, soldPct: Math.round(share * 100), usd: Math.round(position.valueUsd * share * 100) / 100, pnlPct: position.pnlPct };
}
