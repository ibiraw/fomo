/**
 * @file risk-ack.ts
 * @description Auto-tick fomo's risk warning (setting, off by default). Some coins show a red box above Buy —
 *              "Warning: 3 issues" / "I understand the risks of trading this token." — and Buy stays disabled until
 *              its checkbox is ticked, which costs seconds on a hyped launch. With the setting on, limit ticks it the
 *              moment it appears while fomo's Buy tab is selected. It only ever ticks (never unticks), never on the
 *              Sell tab, and never presses Buy.
 * @author Reborn1987
 */

import { activeSide, findPanel } from './fomo-dom';
import { containsAnyWord, fomoDom } from './fomo-dom-config';

export const AUTO_RISK_ACK_KEY = 'autoRiskAck';
export const DEFAULT_AUTO_RISK_ACK = false;

/** Normalizes a stored value (missing or malformed → off). */
export function parseAutoRiskAck(v: unknown): boolean {
  return typeof v === 'boolean' ? v : DEFAULT_AUTO_RISK_ACK;
}

/**
 * The warning's checkbox inside the trade panel: the button next to the "I understand the risks" label (the label sits
 * in a second button that expands the issue list; that one is never clicked). Null when no warning is shown.
 */
export function findRiskCheckbox(panel: HTMLElement): HTMLButtonElement | null {
  const words = fomoDom().riskAckWords;
  const label = [...panel.querySelectorAll('span, p, div')].find((e) => e.childElementCount === 0 && containsAnyWord(e.textContent ?? '', words));
  let row: HTMLElement | null = label?.parentElement ?? null;
  for (let i = 0; i < 5 && row; i++, row = row.parentElement) {
    const box = [...row.querySelectorAll('button')].find((b) => !b.contains(label!) && b.querySelector('svg'));
    if (box) return box;
    if (row === panel) break;
  }
  return null;
}

/**
 * True when the checkbox shows as ticked. fomo draws it as an SVG: unticked = one outlined square path; ticked = a
 * filled square plus a check-mark path (seen 2026-10-01). ARIA state wins when fomo provides it.
 */
export function riskAcknowledged(box: HTMLButtonElement): boolean {
  const aria = box.getAttribute('aria-checked') ?? box.getAttribute('aria-pressed');
  if (aria !== null) return aria === 'true';
  const state = box.getAttribute('data-state');
  if (state === 'checked' || state === 'unchecked') return state === 'checked';
  const paths = [...box.querySelectorAll('svg path')];
  return paths.length > 1 || paths.some((p) => { const f = p.getAttribute('fill'); return f !== null && f !== 'none'; });
}

/** How long to wait before clicking the same, still unticked checkbox again (fomo may re-render slowly). */
const RETRY_MS = 1_500;

/** Ticks the risk checkbox on fomo's Buy tab whenever it shows up unticked. */
export class RiskAckTicker {
  private last: { box: HTMLButtonElement; at: number } | null = null;

  constructor(private readonly doc: Document, private readonly now: () => number = () => Date.now()) {}

  /** One pass; returns true when it clicked. */
  scan(): boolean {
    const panel = findPanel(this.doc);
    if (!panel || activeSide(panel) !== 'buy') return false;
    const box = findRiskCheckbox(panel);
    if (!box || box.disabled || riskAcknowledged(box)) return false;
    if (this.last && this.last.box === box && this.now() - this.last.at < RETRY_MS) return false;
    box.click();
    this.last = { box, at: this.now() };
    return true;
  }
}
