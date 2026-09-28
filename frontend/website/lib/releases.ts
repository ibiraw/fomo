/**
 * @file releases.ts
 * @description The public version the site describes, and the "What's new" list. Sections for later features
 *              (themes, sounds, the X post checker…) only show once SITE_VERSION reaches their version — raise it
 *              together with `publicVersion` in the server's access.json, and add a CHANGELOG entry dated that day.
 *              Roadmap (mirror of backend/src/core/releases/releases.ts): 1.0 limit orders on every chain ·
 *              1.2 themes + sounds · 1.7 the token's latest X post · 1.8 launchpad · 1.9 token metrics.
 * @author Reborn1987
 */

/** The version the public has. */
export const SITE_VERSION = '1.0';

/** Numeric compare of "major.minor" versions. */
function compare(a: string, b: string): number {
  const [a1 = 0, a2 = 0] = a.split('.').map(Number);
  const [b1 = 0, b2 = 0] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
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
    version: '1.0',
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
