/**
 * @file target.ts
 * @description Converts between an absolute target (market cap or price) and a % change from the current
 *              value, and infers the trigger direction from where the target sits.
 * @author Reborn1987
 */

import type { TriggerDirection, TriggerMetric } from './types';

/** Target value for a % change from `current`. */
export function targetFromPercent(current: number, percent: number): number {
  return current * (1 + percent / 100);
}

/** % change from `current` to `target`, rounded to a whole percent. */
export function percentFromTarget(current: number, target: number): number {
  return current > 0 ? Math.round((target / current - 1) * 100) : 0;
}

/** A target below the current value waits for a drop; at or above waits for a rise. */
export function inferDirection(current: number, target: number): TriggerDirection {
  return target < current ? 'below' : 'above';
}

/** Input text for a target: whole dollars for market cap, 4 significant digits for price. */
export function formatTargetInput(metric: TriggerMetric, v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '';
  if (metric === 'marketCap') return String(Math.round(v));
  return v >= 1 ? v.toFixed(4) : Number(v.toPrecision(4)).toString();
}

/** Which value the user pinned: a % offset (target follows the live value) or an exact target (% follows). */
export type TargetAnchor = 'percent' | 'target';

/** Target text and % after the live value moves, keeping whichever one the user pinned. */
export function syncWithLive(
  anchor: TargetAnchor,
  metric: TriggerMetric,
  current: number,
  percent: number,
  target: string,
): { readonly target: string; readonly percent: number } {
  if (anchor === 'percent') {
    return { target: formatTargetInput(metric, targetFromPercent(current, percent)), percent };
  }
  // A typed target is left alone, even while empty mid-edit.
  return { target, percent: Number(target) > 0 ? percentFromTarget(current, Number(target)) : percent };
}
