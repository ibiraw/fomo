/**
 * @file releases.ts
 * @description The public version the site describes, and the "What's new" list. Sections for later features
 *              (themes, sounds, the X post checker…) only show once SITE_VERSION reaches their version — raise it
 *              together with `publicVersion` in the server's access.json, and add a CHANGELOG entry dated that day.
 *              Roadmap (mirror of backend/src/core/releases/releases.ts): 1.0.0 limit orders on every chain ·
 *              1.1.0 themes + sounds · 1.2.0 the token's latest X post · 1.3.0 launchpad · 1.4.0 token metrics ·
 *              2.0.0 quick Buy/Sell buttons in fomo's Feed and Alerts.
 * @author Reborn1987
 */

/** The version the public has. */
export const SITE_VERSION = '1.0.2';

/** Numeric compare of "major.minor.patch" versions. */
function compare(a: string, b: string): number {
  const [a1 = 0, a2 = 0, a3 = 0] = a.split('.').map(Number);
  const [b1 = 0, b2 = 0, b3 = 0] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

/** True when the public version includes `version`. */
export const isReleased = (version: string): boolean => compare(version, SITE_VERSION) <= 0;

/** One release in "What's new". */
export interface ChangelogEntry {
  readonly version: string;
  /** Release day, "2026-09-28". */
  readonly date: string;
  readonly title: string;
  readonly items: readonly string[];
}

/** Newest first; only released versions are shown. */
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '1.0.2',
    date: '2026-10-01',
    title: 'Works with your own fomo presets',
    items: [
      "If you changed fomo's quick amounts (say $300 instead of $100), limit could lose track of your balance and pause your trades. It now finds it whatever your presets are, on Buy and Sell",
      "To update: download the new zip, replace your limit folder with it, then click reload on limit in your browser's extensions page",
    ],
  },
  {
    version: '1.0.1',
    date: '2026-10-01',
    title: "Orders that don't sleep",
    items: [
      'Keeps your computer awake while you have orders waiting, so they can still trade (the screen can still turn off) — Settings → Keep computer awake',
      "Take profits and stop losses that get no answer from fomo are checked on your wallet on-chain and tried again while the price is still at your target, up to 5 tries",
      "New setting: auto-tick fomo's \"I understand the risks\" warning on the Buy tab, so a hyped launch isn't slowed down (off by default)",
      "To update: download the new zip, replace your limit folder with it, then click reload on limit in your browser's extensions page",
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-28',
    title: 'Limit orders for fomo',
    items: [
      'Limit buys, breakout buys, take profits and stop losses — set by market cap',
      'Solana, Base, Ethereum, BNB, Robinhood and Arc',
      'Live on-chain prices, re-checked right before every trade',
      'Fills confirmed from your wallet; leftover take profits and stop losses cancel when you sell out',
    ],
  },
];
