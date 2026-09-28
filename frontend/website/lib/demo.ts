/**
 * @file demo.ts
 * @description Deterministic timeline for the animated walkthrough: which step is showing, the simulated
 *              market cap, slider position and order status at any moment of the loop.
 * @author Reborn1987
 */

/** One loop of the walkthrough, in ms. */
export const LOOP_MS = 15_000;
/** Market cap when the loop starts. */
export const START_MC = 42_000;
/** Slider target, % from the start MC. */
export const TARGET_PCT = -30;
export const TARGET_MC = START_MC * (1 + TARGET_PCT / 100);

/** Walkthrough steps with the time (ms) each starts. */
export const STEPS = [
  { at: 0, title: 'Open the Limit tab', body: "It sits right next to fomo's own Buy and Sell." },
  { at: 2_000, title: 'Drag to your target', body: '−30% from the live market cap. The order type is worked out for you.' },
  { at: 4_600, title: 'Place it and walk away', body: 'The order waits on the limit server, watching the price on-chain. Just keep fomo open.' },
  { at: 6_000, title: 'Price hits the target', body: 'Market cap drops to $29.4K — the order triggers the same second.' },
  { at: 10_800, title: 'limit clicks Buy', body: "It uses fomo's own Buy button, in your own logged-in tab." },
  { at: 12_800, title: 'Confirmed on-chain', body: 'Your wallet balance changed — filled in about 2.6 seconds.' },
] as const;

export type DemoStatus = 'none' | 'open' | 'triggered' | 'trading' | 'filled';

/** Time within the loop. */
export function loopTime(ms: number): number {
  return ((ms % LOOP_MS) + LOOP_MS) % LOOP_MS;
}

/** Index of the step showing at loop time `t`. */
export function stepAt(t: number): number {
  let i = 0;
  STEPS.forEach((s, j) => { if (t >= s.at) i = j; });
  return i;
}

/** Smooth 0→1 easing. */
function ease(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** Slider % at time `t` (animates from 0 to the target during step 2). */
export function sliderAt(t: number): number {
  return Math.round(TARGET_PCT * ease((t - 2_400) / 1_800));
}

/** Small deterministic wiggle so the chart looks alive. */
function wiggle(t: number): number {
  return Math.sin(t / 310) * 380 + Math.sin(t / 97) * 160;
}

/** Simulated market cap at time `t`: flat, falls to the target, triggers, then rebounds a little. */
export function marketCapAt(t: number): number {
  const fallStart = 6_000;
  const fallEnd = 10_200;
  if (t < fallStart) return START_MC + wiggle(t);
  if (t < fallEnd) {
    const k = ease((t - fallStart) / (fallEnd - fallStart));
    return START_MC + (TARGET_MC - START_MC) * k + wiggle(t) * (1 - k);
  }
  return TARGET_MC * (1 + 0.06 * ease((t - fallEnd) / 3_500)) + wiggle(t) * 0.3;
}

/** Order status at time `t`. */
export function statusAt(t: number): DemoStatus {
  if (t < 5_000) return 'none';
  if (t < 10_200) return 'open';
  if (t < 10_800) return 'triggered';
  if (t < 12_800) return 'trading';
  return 'filled';
}

/** Chart samples from the loop start to `t` (for the SVG line), `n` points across the full loop. */
export function chartSeries(t: number, n = 120): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const ti = (i / n) * LOOP_MS;
    if (ti > t) break;
    out.push(marketCapAt(ti));
  }
  return out;
}

/** "$42.0K" style. */
export function usdK(v: number): string {
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${(v / 1_000).toFixed(1)}K`;
}
