/**
 * @file fomo-dom.ts
 * @description Finds and reads FOMO's trade panel. All knowledge of FOMO's page structure lives here,
 *              so a FOMO redesign only needs changes in this file. Verified against fomo.family 2026-09-26.
 * @author Reborn1987
 */

import type { OrderSide } from './types';

/** Label of the Buy/Sell tab buttons. */
const TAB_LABEL: Record<OrderSide, string> = { buy: 'Buy', sell: 'Sell' };
/** Last preset shown before the balance line on each tab. */
const LAST_PRESET: Record<OrderSide, string> = { buy: '$100', sell: '100%' };
/** Sell-tab percentage presets (they only fill the amount; they do not submit). */
export const SELL_PRESETS = [10, 25, 50, 100] as const;

/** Visible, trimmed text of an element. */
function text(el: Element): string {
  return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
}

/** Parses "$1,234.56" into 1234.56, or null. */
export function parseUsd(s: string): number | null {
  const m = /^\$([\d,]+(?:\.\d+)?)$/.exec(s.trim());
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
}

/** Returns the trade panel: the smallest element holding the Buy tab and the amount input. */
export function findPanel(doc: Document): HTMLElement | null {
  const buyTab = [...doc.querySelectorAll('button')].find((b) => text(b) === TAB_LABEL.buy);
  let el: HTMLElement | null = buyTab ?? null;
  while (el && !el.querySelector('input[placeholder="0"]')) el = el.parentElement;
  return el;
}

/** The Buy or Sell tab button inside the panel. */
export function findTab(panel: HTMLElement, side: OrderSide): HTMLButtonElement | null {
  return [...panel.querySelectorAll('button')].find((b) => text(b) === TAB_LABEL[side]) ?? null;
}

/** Which tab is selected. Inactive tabs carry the neutral `bg-bg-secondary` class. */
export function activeSide(panel: HTMLElement): OrderSide | null {
  for (const side of ['buy', 'sell'] as const) {
    const tab = findTab(panel, side);
    if (tab && !tab.classList.contains('bg-bg-secondary')) return side;
  }
  return null;
}

/** The amount input. */
export function findAmountInput(panel: HTMLElement): HTMLInputElement | null {
  return panel.querySelector('input[placeholder="0"]');
}

/** Sets a React-controlled input's value so React sees the change. */
export function setReactInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Cannot access the input value setter');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Reads the balance: cash on the Buy tab, position value on the Sell tab.
 * It is the first element after the last preset button whose whole text is "$x".
 */
export function readBalance(panel: HTMLElement, side: OrderSide): number | null {
  const all = [...panel.querySelectorAll('*')];
  const presetIdx = all.findIndex((el) => el.tagName === 'BUTTON' && (el.textContent ?? '').trim() === LAST_PRESET[side]);
  if (presetIdx < 0) return null;
  for (const el of all.slice(presetIdx + 1)) {
    if (el.tagName === 'BUTTON') continue; // skip nested preset content / Max
    const v = parseUsd(el.textContent ?? '');
    if (v !== null) return v;
  }
  return null;
}

/** The submit button ("Buy <symbol>" / "Sell <symbol>", or a status label like "Fetching quote..."). */
export function findSubmit(panel: HTMLElement): HTMLButtonElement | null {
  const tabs = new Set([findTab(panel, 'buy'), findTab(panel, 'sell')]);
  return [...panel.querySelectorAll('button')].find(
    (b) => !tabs.has(b) && b.classList.contains('py-2') && b.classList.contains('text-center'),
  ) ?? null;
}

/** True when the submit button is enabled and labelled for `side`. */
export function submitReady(panel: HTMLElement, side: OrderSide): boolean {
  const b = findSubmit(panel);
  return !!b && !b.disabled && text(b).startsWith(`${TAB_LABEL[side]} `);
}

/** The sell preset button for a percentage, if FOMO has one. */
export function findSellPreset(panel: HTMLElement, percent: number): HTMLButtonElement | null {
  return [...panel.querySelectorAll('button')].find((b) => text(b) === `${percent}%`) ?? null;
}

/** Visible status/warning text in the panel that explains why the submit is disabled. */
export function submitBlocker(panel: HTMLElement): string | null {
  const b = findSubmit(panel);
  if (!b) return 'Submit button not found';
  if (!b.disabled) return null;
  return text(b) || 'Submit button disabled';
}

/** Parses fomo's compact numbers: "999.9M" → 999_900_000, "12.5K", "1.02B". */
export function parseCompact(s: string): number | null {
  const m = /^([\d,]+(?:\.\d+)?)\s*([KMBT]?)$/i.exec(s.trim());
  if (!m) return null;
  const mult = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]!.toUpperCase() as '' | 'K' | 'M' | 'B' | 'T'];
  return Number(m[1]!.replace(/,/g, '')) * mult;
}

/**
 * The token supply fomo displays in "About" ("Supply 999.9M"). fomo computes market cap with it, and it can
 * differ from the on-chain mint supply (e.g. after burns), so MC orders use it to match what the user sees.
 */
export function readSupply(doc: Document): number | null {
  const label = [...doc.querySelectorAll('span')].find((e) => e.childElementCount === 0 && e.textContent?.trim() === 'Supply');
  const row = label?.parentElement;
  if (!row) return null;
  const value = (row.textContent ?? '').trim().replace(/^Supply/, '');
  const n = parseCompact(value);
  return n !== null && n > 0 ? n : null;
}

/** fomo usernames as they appear in profile links. Mirror of the server's check. */
export const FOMO_USERNAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;

/**
 * The logged-in user's own fomo username, from their profile link in the top bar (the avatar with the 24h PnL:
 * `ul > li > button > a[href="/profile/<name>"]`, observed 2026-09-27). Profile links elsewhere on the page (feed,
 * holders) aren't inside a button in a list, so they are ignored. Null when logged out or not rendered yet.
 */
export function readOwnFomoUsername(doc: Document): string | null {
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('ul li button a[href^="/profile/"]')) {
    const name = decodeURIComponent((a.getAttribute('href') ?? '').slice('/profile/'.length).split(/[/?#]/)[0] ?? '');
    if (FOMO_USERNAME_RE.test(name)) return name;
  }
  return null;
}

/** Texts of FOMO's trade notifications currently on screen ("Buying $3.00 X", "Selling 1.2M X", ...). */
export function notificationTexts(doc: Document): string[] {
  return [...doc.querySelectorAll('div.bg-bg-primary.rounded-xl.outline')].map((el) => text(el).replace(/\n/g, ' '));
}
