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
export const SITE_VERSION = '2.0.0';

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
    version: '2.0.0',
    date: '2026-10-03',
    title: 'Quick Buy and Sell',
    items: [
      "Buy and Sell buttons right under every post in fomo's Feed and Alerts: one tap and the trade goes through",
      'Set your own amounts in Settings: two buy sizes in $ and one sell size in %',
      "Trades with fomo's own Buy and Sell, in a new tab, and the button shows when it's done. Nothing to download: it switches on in the version you already have",
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-02',
    title: 'Who holds the token',
    items: [
      "Top 10 holders' share of the supply (red at 50%+, yellow at 30%+), with the 5 biggest wallets broken out",
      'How much the dev still holds (red at 15%+, yellow at 5%+), so you can spot a coin one wallet can dump',
      'In the Limit panel and the popup, refreshed every 30 seconds. Nothing to download: it switches on in the version you already have',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-01',
    title: 'Where a token launched',
    items: [
      'See which launchpad a token came from (pump.fun, Raydium LaunchLab and its platforms, Meteora DBC, four.meme, flap.sh, pons and more) right in the Limit panel and the popup',
      "And whether it's still on its bonding curve or has graduated, before you set an order",
      'Nothing to download: it switches on in the version you already have',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-01',
    title: "The token's latest X post",
    items: [
      "See the token's latest post from its own X account right in the Limit panel and the popup, so you know what the dev just said before you set an order",
      "It's read with your own x.com login in a background tab; nothing from X is sent to our server",
      'Nothing to download: it switches on in the version you already have',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-01',
    title: 'Themes and order sounds',
    items: [
      'Themes: 8 new looks (Mono, Midnight Gold, Signal Blue, Deep Teal, Royal Lavender, Ice, Solar Flare, Neon Tokyo) that recolor fomo.family and your Limit panel in every open tab — Settings → Theme',
      'Order sounds: hear when a buy fills, a take profit or stop loss hits, or an order fails. 6 sound themes (Arcade, Chime, Cash register, Soft pop, Degen, Sonar) with volume — Settings → Order sounds',
      'Nothing to download: it switches on in the version you already have',
    ],
  },
  {
    version: '1.0.3',
    date: '2026-10-01',
    title: 'limit tells you when to update',
    items: [
      'From this version on, a NEW badge on the limit icon and a note in the popup tell you when a newer version is out, with the download link and the steps',
      "This is the last update you have to spot yourself: download the new zip, replace your limit folder with it (same place), then click reload on limit in your browser's extensions page",
    ],
  },
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
