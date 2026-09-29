/**
 * @file fomo-dom-config.ts
 * @description Everything limit knows about fomo's page layout, as plain data: tab labels, CSS selectors, class
 *              names and words. The values below are built in (verified on fomo.family 2026-09-26/27); the server can
 *              override any of them (`fomoDom` in the welcome / pushed on change), so a fomo redesign is fixed by
 *              editing a file on the server instead of shipping a store update. Only data travels, never code:
 *              selectors go to querySelector, words are matched as plain substrings. Invalid values are ignored
 *              field by field and the built-in value stays.
 * @author Reborn1987
 */

import type { OrderSide } from './types';

/** fomo page-layout knowledge used by fomo-dom.ts, fomo-inject.ts and trade.ts. */
export interface FomoDomConfig {
  /** Text of the Buy / Sell tab buttons. */
  readonly tabLabels: Readonly<Record<OrderSide, string>>;
  /** The trade amount input (also identifies the trade panel). */
  readonly amountInput: string;
  /** Class present on the inactive Buy/Sell tab. */
  readonly inactiveTabClass: string;
  /** Text of the last preset button before the balance line, per tab. */
  readonly lastPreset: Readonly<Record<OrderSide, string>>;
  /** Sell-tab percentage presets fomo shows. */
  readonly sellPresets: readonly number[];
  /** Classes that together mark the submit button. */
  readonly submitClasses: readonly string[];
  /** A trade notification toast. */
  readonly notification: string;
  /** Words in a notification that mean the trade failed (case-insensitive). */
  readonly failureWords: readonly string[];
  /** Words in a failure notification that mean slippage (retried). */
  readonly slippageWords: readonly string[];
  /** Label of the About → Supply row. */
  readonly supplyLabel: string;
  /** The logged-in user's own profile link in the top bar. */
  readonly ownProfileLink: string;
  /** Path prefix of profile links. */
  readonly profilePathPrefix: string;
  /** fomo's tab classes, copied onto our Limit tab so it looks native. */
  readonly tabBaseClasses: string;
  readonly tabInactiveClasses: string;
  /** Label(s) of the button on fomo's "new version available" toast. */
  readonly reloadLabels: readonly string[];
  /** Words on that toast that tell it apart from other Reload buttons. */
  readonly newVersionWords: readonly string[];
  /** How fomo's trade toast starts for a buy / a sell ("Buying $3.00 KEK", "Selling 1.2M KEK"). */
  readonly spotBuyPrefixes: readonly string[];
  readonly spotSellPrefixes: readonly string[];
  /** Title of the "Your positions" list (amount, value and ▲/▼ PnL per token). */
  readonly positionsHeader: string;
  /** fomo's launchpad icons (the one right after the token's name says where it launched). */
  readonly launchpadIcon: string;
  /** Side-panel tabs whose items get quick Buy/Sell buttons (v2.0.0). */
  readonly quickTradeTabs: readonly string[];
  /** Class on the side-panel tabs that aren't selected. */
  readonly sideTabInactiveClass: string;
  /** One item (trade or post) in the side panel's lists. */
  readonly feedItem: string;
  /** Text of the token's X button in About ("Twitter"); only an x.com / twitter.com link with exactly this text counts. */
  readonly xLinkLabels: readonly string[];
}

/** Built-in values (what fomo.family looked like when this version shipped). */
export const DEFAULT_FOMO_DOM: FomoDomConfig = {
  tabLabels: { buy: 'Buy', sell: 'Sell' },
  amountInput: 'input[placeholder="0"]',
  inactiveTabClass: 'bg-bg-secondary',
  lastPreset: { buy: '$100', sell: '100%' },
  sellPresets: [10, 25, 50, 100],
  submitClasses: ['py-2', 'text-center'],
  notification: 'div.bg-bg-primary.rounded-xl.outline',
  failureWords: ['fail', 'error', 'slippage', 'revert', 'rejected', 'insufficient'],
  slippageWords: ['slippage'],
  supplyLabel: 'Supply',
  ownProfileLink: 'ul li button a[href^="/profile/"]',
  profilePathPrefix: '/profile/',
  tabBaseClasses: 'flex-1 p-2 rounded-lg text-base font-bold transition-colors',
  tabInactiveClasses: 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary',
  // Observed 2026-09-29 (detected live, self-check passed): a fixed pill at the bottom centre, "New version available" + a "Reload" button + ✕.
  reloadLabels: ['Reload', 'Refresh', 'Update'],
  newVersionWords: ['new version', 'update available', 'updated', 'new update'],
  spotBuyPrefixes: ['Buying'],
  spotSellPrefixes: ['Selling'],
  positionsHeader: 'Your positions',
  // Two icon hosts seen (2026-09-28): fomo's own ("…/launchpad/pons.png") and Mobula's ("…/logos/factory_stockereum.webp").
  launchpadIcon: 'img[src*="crypto-exchange-logos-production"], img[src*="/logos/factory_"]',
  quickTradeTabs: ['Alerts', 'Feed'],
  sideTabInactiveClass: 'text-text-secondary',
  feedItem: '.border-b.border-bg-secondary',
  xLinkLabels: ['Twitter'],
};

/** Checks that a string is a usable CSS selector (injectable; content scripts pass a DOM-backed check). */
export type SelectorCheck = (selector: string) => boolean;

/** DOM-backed selector check: querySelector throws on invalid syntax. Without a DOM, only the shape is checked. */
export const domSelectorCheck: SelectorCheck = (selector) => {
  if (typeof document === 'undefined') return true;
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
};

const MAX_TEXT = 300;
/** A non-empty, bounded, single-line string. */
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_TEXT && !/[\r\n]/.test(v);
/** A list of 1..20 such strings. */
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every(isText);
/** CSS class names only (no selector syntax). */
const isClassList = (v: unknown): v is string => isText(v) && /^[\w\-:./[\]% ]+$/.test(v);
/** {buy, sell} of texts. */
const isSidePair = (v: unknown): v is Record<OrderSide, string> => !!v && typeof v === 'object' && isText((v as Record<string, unknown>).buy) && isText((v as Record<string, unknown>).sell);

/**
 * Merges server overrides over the built-in values. Unknown keys and invalid values are ignored one by one, so a
 * typo in one field can never break the others. Non-objects give the built-ins.
 */
export function parseFomoDomConfig(raw: unknown, isSelector: SelectorCheck = domSelectorCheck): FomoDomConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_FOMO_DOM;
  const o = raw as Record<string, unknown>;
  const sel = (k: keyof FomoDomConfig): string | undefined => (isText(o[k]) && isSelector(o[k] as string) ? (o[k] as string) : undefined);
  const txt = (k: keyof FomoDomConfig): string | undefined => (isText(o[k]) ? (o[k] as string) : undefined);
  const cls = (k: keyof FomoDomConfig): string | undefined => (isClassList(o[k]) ? (o[k] as string) : undefined);
  const words = (k: keyof FomoDomConfig): string[] | undefined => (isTextList(o[k]) ? (o[k] as string[]) : undefined);
  const presets = Array.isArray(o.sellPresets) && o.sellPresets.length > 0 && o.sellPresets.length <= 10
    && o.sellPresets.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100) ? (o.sellPresets as number[]) : undefined;
  const submit = isTextList(o.submitClasses) && o.submitClasses.every((c) => /^[\w\-:./[\]%]+$/.test(c)) ? o.submitClasses : undefined;
  const d = DEFAULT_FOMO_DOM;
  return {
    tabLabels: isSidePair(o.tabLabels) ? { buy: o.tabLabels.buy, sell: o.tabLabels.sell } : d.tabLabels,
    amountInput: sel('amountInput') ?? d.amountInput,
    inactiveTabClass: cls('inactiveTabClass') ?? d.inactiveTabClass,
    lastPreset: isSidePair(o.lastPreset) ? { buy: o.lastPreset.buy, sell: o.lastPreset.sell } : d.lastPreset,
    sellPresets: presets ?? d.sellPresets,
    submitClasses: submit ?? d.submitClasses,
    notification: sel('notification') ?? d.notification,
    failureWords: words('failureWords') ?? d.failureWords,
    slippageWords: words('slippageWords') ?? d.slippageWords,
    supplyLabel: txt('supplyLabel') ?? d.supplyLabel,
    ownProfileLink: sel('ownProfileLink') ?? d.ownProfileLink,
    profilePathPrefix: txt('profilePathPrefix') ?? d.profilePathPrefix,
    tabBaseClasses: cls('tabBaseClasses') ?? d.tabBaseClasses,
    tabInactiveClasses: cls('tabInactiveClasses') ?? d.tabInactiveClasses,
    reloadLabels: words('reloadLabels') ?? d.reloadLabels,
    newVersionWords: words('newVersionWords') ?? d.newVersionWords,
    spotBuyPrefixes: words('spotBuyPrefixes') ?? d.spotBuyPrefixes,
    spotSellPrefixes: words('spotSellPrefixes') ?? d.spotSellPrefixes,
    positionsHeader: txt('positionsHeader') ?? d.positionsHeader,
    launchpadIcon: sel('launchpadIcon') ?? d.launchpadIcon,
    quickTradeTabs: words('quickTradeTabs') ?? d.quickTradeTabs,
    sideTabInactiveClass: cls('sideTabInactiveClass') ?? d.sideTabInactiveClass,
    feedItem: sel('feedItem') ?? d.feedItem,
    xLinkLabels: words('xLinkLabels') ?? d.xLinkLabels,
  };
}

let current: FomoDomConfig = DEFAULT_FOMO_DOM;

/** The layout knowledge in effect (built-ins until the server's overrides are loaded). */
export function fomoDom(): FomoDomConfig {
  return current;
}

/** Applies server overrides (null or invalid → built-ins). */
export function setFomoDom(raw: unknown, isSelector: SelectorCheck = domSelectorCheck): void {
  current = parseFomoDomConfig(raw, isSelector);
}

/** True when `text` contains any of `words` (case-insensitive, plain substring). */
export function containsAnyWord(text: string, words: readonly string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w.toLowerCase()));
}

/** storage.local key the background writes the server's overrides to. */
export const FOMO_DOM_STORAGE_KEY = 'fomoDom';

/** Content scripts: load the overrides the background saved and follow later changes (`onChange` after each). */
export async function followFomoDom(onChange: () => void = () => undefined): Promise<void> {
  try {
    const s = await browser.storage.local.get(FOMO_DOM_STORAGE_KEY);
    setFomoDom(s[FOMO_DOM_STORAGE_KEY] ?? null);
  } catch {
    // storage unavailable (extension reloading) — built-ins stay in effect
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && FOMO_DOM_STORAGE_KEY in changes) {
      setFomoDom(changes[FOMO_DOM_STORAGE_KEY]?.newValue ?? null);
      onChange();
    }
  });
}
