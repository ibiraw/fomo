/**
 * @file fomo-health.ts
 * @description Notices when fomo changes under us. Three pieces, all read-only:
 *              - `findNewVersionPrompt`: fomo's "new version → Reload" toast (labels come from fomo-dom-config).
 *              - `checkLayout`: on a token page of a logged-in user, can we still find everything a trade needs?
 *              - `layoutSnapshot`: a size-capped outline of the trade area (tags, classes, button labels, input
 *                attributes; digits in plain text masked, so balances never leave the browser) sent with a failure so
 *                the settings file can be fixed quickly.
 * @author Reborn1987
 */

import { activeSide, findAmountInput, findPanel, findSubmit, findTab, readBalance } from './fomo-dom';
import { containsAnyWord, fomoDom } from './fomo-dom-config';

/** Result of a layout self-check (Service Result pattern). */
export interface LayoutCheck {
  readonly ok: boolean;
  /** What could not be found, e.g. ["amount input", "submit button"]. Empty when ok. */
  readonly missing: readonly string[];
}

/** Visible, trimmed text of an element. */
function text(el: Element): string {
  return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
}

/** Raw text without forcing a layout (unlike innerText) — for checks that run every few seconds. */
function rawText(el: Element): string {
  return (el.textContent ?? '').trim();
}

/**
 * fomo's "a new version is available — Reload" toast: a button labelled like `reloadLabels` whose surrounding
 * box (up to 4 levels up) mentions one of `newVersionWords`. Null when not showing. Runs every few seconds, so it
 * only reads textContent (no layout) and stops at the first matching button.
 */
export function findNewVersionPrompt(doc: Document): HTMLButtonElement | null {
  const { reloadLabels, newVersionWords } = fomoDom();
  const labels = reloadLabels.map((l) => l.toLowerCase());
  for (const b of doc.getElementsByTagName('button')) {
    const label = rawText(b);
    if (label.length > 20 || !labels.includes(label.toLowerCase())) continue;
    let box: Element | null = b;
    for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
      if (containsAnyWord(rawText(box), newVersionWords)) return b;
    }
  }
  return null;
}

/**
 * Checks that every element a trade needs can be found on this token page. Only meaningful for a logged-in user on
 * a token page with fomo's panel rendered — callers check that first. A balance of $0 still counts as readable.
 */
export function checkLayout(doc: Document): LayoutCheck {
  const missing: string[] = [];
  const panel = findPanel(doc);
  if (!panel) return { ok: false, missing: ['trade panel (Buy tab + amount input)'] };
  if (!findTab(panel, 'buy')) missing.push('Buy tab');
  if (!findTab(panel, 'sell')) missing.push('Sell tab');
  const side = activeSide(panel);
  if (!side) missing.push('active tab marker');
  if (!findAmountInput(panel)) missing.push('amount input');
  if (!findSubmit(panel)) missing.push('submit button');
  if (side && readBalance(panel, side) === null) missing.push(`${side} balance (after the last preset)`);
  return { ok: missing.length === 0, missing };
}

/** Max characters of a snapshot (the whole WebSocket message must stay under the server's 64 KB). */
const SNAPSHOT_MAX = 12_000;

/** Masks digits in page text (balances, positions, PnL); structure and button labels stay readable. */
const mask = (s: string): string => s.replace(/\d/g, '#');

/**
 * An indented outline of the trade area — the panel if found, else the smallest element holding an input and a
 * "Buy"-ish button, else the page body — for diagnosing a fomo redesign. Only tags, ids, classes, button labels and
 * input attributes (placeholder, type, name, inputmode) — the facts selectors are built from — plus leaf text with its
 * digits masked (that is where balances are); capped at SNAPSHOT_MAX characters.
 */
export function layoutSnapshot(doc: Document): string {
  const root = findPanel(doc) ?? nearestTradeArea(doc) ?? doc.body;
  const lines: string[] = [];
  let size = 0;
  const walk = (el: Element, depth: number): void => {
    if (size > SNAPSHOT_MAX || depth > 14) return;
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.trim().replace(/\s+/g, '.') : '';
    let line = `${'  '.repeat(depth)}${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`;
    if (el.tagName === 'BUTTON' || el.tagName === 'A') line += ` "${text(el).slice(0, 40)}"`;
    if (el.tagName === 'INPUT') {
      for (const a of ['type', 'name', 'placeholder', 'inputmode']) {
        const v = el.getAttribute(a);
        if (v !== null) line += ` ${a}="${v.slice(0, 40)}"`;
      }
    }
    if (el.children.length === 0 && el.tagName !== 'BUTTON' && el.tagName !== 'INPUT') {
      const t = text(el);
      if (t) line += ` "${mask(t.slice(0, 30))}"`;
    }
    const out = line;
    lines.push(out);
    size += out.length + 1;
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(root, 0);
  const snap = lines.join('\n');
  return snap.length > SNAPSHOT_MAX ? `${snap.slice(0, SNAPSHOT_MAX)}\n…(truncated)` : snap;
}

/** Smallest element containing both an input and a button whose label starts like the Buy tab. */
function nearestTradeArea(doc: Document): Element | null {
  const buy = fomoDom().tabLabels.buy.toLowerCase();
  const button = [...doc.querySelectorAll('button')].find((b) => text(b).toLowerCase().startsWith(buy));
  let el: Element | null = button ?? null;
  while (el && !el.querySelector('input')) el = el.parentElement;
  return el;
}
