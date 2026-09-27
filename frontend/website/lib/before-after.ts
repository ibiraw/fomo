/**
 * @file before-after.ts
 * @description Timeline for the "fomo vs fomo + limit" comparison: one shared market-cap path (a night-time dip
 *              through the target, then a rebound) and the state of both panels at any loop time. Pure functions of
 *              the loop time, so the component only renders and tests can check any moment.
 * @author Reborn1987
 */

/** Loop length (ms). */
export const BA_LOOP_MS = 16_000;
/** Market cap when the loop starts. */
export const BA_START_MC = 203_600;
/** Limit buy target: 20% below the start. */
export const BA_TARGET_MC = BA_START_MC * 0.8;
/** When the price starts / stops moving (ms). */
export const BA_CHART_START = 4_400;
export const BA_CHART_END = 13_400;
/** How long the order shows "Buying…" before "Filled" (ms). */
const BUYING_MS = 900;

/** [position 0..1 along the chart, market cap] key points; smoothstep between them. */
const KEYS: readonly (readonly [number, number])[] = [
  [0, 203_600], [0.12, 206_000], [0.25, 199_500], [0.38, 188_000], [0.5, 171_000], [0.58, 158_400],
  [0.64, 166_000], [0.75, 196_000], [0.86, 214_000], [1, 234_500],
];

/** Market cap at chart position `x` (0..1). */
export function baMarketCapAt(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  for (let i = 1; i < KEYS.length; i++) {
    const [x1, y1] = KEYS[i]!;
    const [x0, y0] = KEYS[i - 1]!;
    if (c <= x1) {
      const f = (c - x0) / (x1 - x0);
      return y0 + (y1 - y0) * f * f * (3 - 2 * f);
    }
  }
  return KEYS.at(-1)![1];
}

/** Chart position (0..1) at loop time `t`. */
export function baChartX(t: number): number {
  return Math.max(0, Math.min(1, (t - BA_CHART_START) / (BA_CHART_END - BA_CHART_START)));
}

/** First chart position where the price reaches the target. */
export const BA_TRIGGER_X = ((): number => {
  for (let x = 0; x <= 1; x += 0.0005) if (baMarketCapAt(x) <= BA_TARGET_MC) return x;
  return 1;
})();

/** Loop time when the order triggers. */
export const BA_TRIGGER_T = BA_CHART_START + BA_TRIGGER_X * (BA_CHART_END - BA_CHART_START);

/** What the "with limit" panel shows. */
export interface LimitPanelState {
  /** The Limit tab exists (the extension is installed). */
  readonly hasLimitTab: boolean;
  /** Which tab is active. */
  readonly tab: 'buy' | 'limit';
  /** Amount typed so far. */
  readonly amount: string;
  /** The −20% chip is picked (target set). */
  readonly targetSet: boolean;
  /** The element being "tapped" right now (a short highlight). */
  readonly tap: 'limit-tab' | 'amount' | 'chip' | 'cta' | null;
  /** Order row status, or null before it is placed. */
  readonly order: 'waiting' | 'buying' | 'filled' | null;
}

/** State of the "with limit" panel at loop time `t`. */
export function limitPanelAt(t: number): LimitPanelState {
  const tap = t >= 1_300 && t < 1_650 ? 'limit-tab'
    : t >= 2_000 && t < 2_350 ? 'amount'
      : t >= 2_800 && t < 3_150 ? 'chip'
        : t >= 3_500 && t < 3_850 ? 'cta'
          : null;
  const order = t < 3_800 ? null : t < BA_TRIGGER_T ? 'waiting' : t < BA_TRIGGER_T + BUYING_MS ? 'buying' : 'filled';
  return {
    hasLimitTab: t >= 700,
    tab: t >= 1_500 ? 'limit' : 'buy',
    amount: t < 2_200 ? '' : t < 2_400 ? '5' : '50',
    targetSet: t >= 3_000,
    tap,
    order,
  };
}

/** "You're away" overlay between placing the order and the dip. */
export function awayAt(t: number): boolean {
  return t >= 4_600 && t < 7_000;
}

/** End-of-loop outcome banners are showing. */
export function outcomeAt(t: number): { missed: boolean; filled: boolean } {
  return { missed: t >= BA_CHART_END + 300, filled: limitPanelAt(t).order === 'filled' };
}

/** Clock shown above both panels: 11:00 PM → 4:00 AM across the chart. */
export function clockAt(t: number): string {
  const minutes = 23 * 60 + Math.round(baChartX(t) * 5 * 60);
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

/** One caption per side for loop time `t`. */
export function captionsAt(t: number): { before: string; after: string } {
  const p = limitPanelAt(t);
  if (p.order === 'filled') {
    return t >= BA_CHART_END + 300
      ? { before: 'Missed it. The dip came and went while you slept.', after: 'Bought the dip, now up +44%.' }
      : { before: 'The dip is happening, and nobody is there to buy.', after: 'Target hit. limit clicked Buy for you.' };
  }
  if (p.order === 'buying') return { before: 'The dip is happening, and nobody is there to buy.', after: 'Target hit. limit is clicking Buy…' };
  if (awayAt(t) || (p.order === 'waiting' && t >= 7_000)) {
    return { before: 'fomo can only buy at the price right now.', after: 'limit is watching the price for you.' };
  }
  if (p.order) return { before: 'You would have to watch the chart all night.', after: 'Set once: buy $50 if it drops 20%.' };
  if (p.hasLimitTab) return { before: "fomo's panel: Buy and Sell, at today's price.", after: 'Install limit and a Limit tab appears next to Buy and Sell.' };
  return { before: "fomo's panel: Buy and Sell, at today's price.", after: "The same fomo panel, before installing." };
}
