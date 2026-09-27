/**
 * @file fomo-inject.ts
 * @description Adds a "Limit" tab next to FOMO's Buy/Sell tabs and toggles FOMO's panel between its own
 *              trade form and our limit-order view. Uses FOMO's own tab classes so it looks native.
 * @author Reborn1987
 */

import { findPanel, findTab } from './fomo-dom';
import { fomoDom } from './fomo-dom-config';

export const LIMIT_TAB_ID = 'fomo-limit-tab';
export const LIMIT_HOST_TAG = 'fomo-limit-orders';
/** Our wrapper around the shadow host. The host's own :host !important styles beat page CSS, so
 * visibility is controlled on this plain wrapper instead. */
export const VIEW_ATTR = 'data-fomo-limit-view';
/** Attribute set on FOMO's panel while the Limit view is active. */
export const ACTIVE_ATTR = 'data-fomo-limit';
const STYLE_ID = 'fomo-limit-style';

/** FOMO's tab classes come from fomo-dom-config (tabBaseClasses / tabInactiveClasses). The active look is a tint
 * (like FOMO's green Buy / red Sell), applied via PAGE_CSS on [data-active]. */

/**
 * Page-level CSS: while active, hide every panel child except the tab row and our view, and render
 * FOMO's Buy/Sell tabs as inactive so only "Limit" looks selected.
 */
const PAGE_CSS = `
[${ACTIVE_ATTR}] > :not([data-fomo-limit-keep]):not([${VIEW_ATTR}]) { display: none !important; }
:not([${ACTIVE_ATTR}]) > [${VIEW_ATTR}] { display: none !important; }
#${LIMIT_TAB_ID}[data-active] {
  background: color-mix(in srgb, var(--fomo-limit-brand, var(--color-yellow, #ffbf17)) 20%, transparent) !important;
  color: var(--fomo-limit-brand, var(--color-yellow, #ffbf17)) !important;
}
[${ACTIVE_ATTR}] [data-fomo-limit-keep] > button:not(#${LIMIT_TAB_ID}) {
  background: var(--color-bg-secondary, rgba(255,255,255,0.06)) !important;
  color: var(--color-text-secondary, rgba(255,255,255,0.6)) !important;
}
`;

/** Applies FOMO's tab classes and our active marker. */
function styleTab(tab: HTMLButtonElement, active: boolean): void {
  const { tabBaseClasses, tabInactiveClasses } = fomoDom();
  tab.className = `${tabBaseClasses} ${active ? '' : tabInactiveClasses}`.trim();
  tab.toggleAttribute('data-active', active);
}

/** The panel's direct child containing the Buy/Sell tabs, or null. */
export function findTabRow(panel: HTMLElement): HTMLElement | null {
  const sell = findTab(panel, 'sell');
  let row = sell?.parentElement ?? null;
  while (row && row.parentElement !== panel) row = row.parentElement;
  return row;
}

/** Adds the page stylesheet once. */
export function ensurePageStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PAGE_CSS;
  doc.head.appendChild(style);
}

/** True when the Limit view is showing. */
export function isLimitActive(panel: HTMLElement): boolean {
  return panel.hasAttribute(ACTIVE_ATTR);
}

/** Shows/hides the Limit view and updates the tab look. */
export function setLimitActive(panel: HTMLElement, active: boolean): void {
  panel.toggleAttribute(ACTIVE_ATTR, active);
  const tab = panel.querySelector<HTMLButtonElement>(`#${LIMIT_TAB_ID}`);
  if (tab) styleTab(tab, active);
}

/**
 * Ensures the Limit tab exists in the current panel. Returns the panel and tab row it was placed in,
 * or null when no FOMO trade panel is on the page. Idempotent — safe to call on every DOM change.
 */
export function ensureLimitTab(doc: Document): { panel: HTMLElement; tabRow: HTMLElement } | null {
  const panel = findPanel(doc);
  if (!panel) return null;
  const tabRow = findTabRow(panel);
  if (!tabRow) return null;
  tabRow.setAttribute('data-fomo-limit-keep', '');
  if (!tabRow.querySelector(`#${LIMIT_TAB_ID}`)) {
    const tab = doc.createElement('button');
    tab.id = LIMIT_TAB_ID;
    tab.type = 'button';
    tab.textContent = 'Limit';
    // FOMO may re-render just the tab row while the view stays active; keep the look in sync.
    styleTab(tab, isLimitActive(panel));
    tab.addEventListener('click', () => setLimitActive(panel, true));
    // Clicking FOMO's own Buy/Sell tabs leaves the Limit view.
    for (const side of ['buy', 'sell'] as const) {
      findTab(panel, side)?.addEventListener('click', () => setLimitActive(panel, false));
    }
    const sell = findTab(panel, 'sell');
    if (sell) sell.after(tab);
    else tabRow.appendChild(tab);
  }
  return { panel, tabRow };
}

const THEME_STYLE_ID = 'fomo-limit-theme';

/** Installs (or clears, for an empty string) the page-wide theme override stylesheet. */
export function setPageTheme(doc: Document, css: string): void {
  let style = doc.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!css) { style?.remove(); return; }
  if (!style) {
    style = doc.createElement('style');
    style.id = THEME_STYLE_ID;
    doc.head.appendChild(style); // last in <head>, so it wins over fomo's own :root variables
  }
  style.textContent = css;
}

/** Inserts the shadow host inside our wrapper, right after FOMO's tab row. */
export function appendViewAfter(tabRow: Element, host: Element): void {
  const wrapper = tabRow.ownerDocument.createElement('div');
  wrapper.setAttribute(VIEW_ATTR, '');
  wrapper.append(host);
  tabRow.after(wrapper);
}
