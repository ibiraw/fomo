/**
 * @file keep-awake.ts
 * @description Keeps the computer from going to sleep while the account has orders waiting, so they can still trade
 *              (chrome.power, "system" level: the screen may still turn off). A setting in popup Settings, on by
 *              default; released as soon as no order is waiting or the setting is turned off.
 *              Why: LM-SKFK2V's PC slept on a ~16 min timer (2026-10-01); his take profit triggered during a short
 *              wake-up and the frozen fomo tab never answered.
 * @author Reborn1987
 */

import type { Order, OrderStatus } from './types';

export const KEEP_AWAKE_KEY = 'keepAwake';
export const DEFAULT_KEEP_AWAKE = true;

/** Statuses of an order that can still trade. */
const WAITING: ReadonlySet<OrderStatus> = new Set(['open', 'triggered', 'executing']);

/** Normalizes a stored value (missing or malformed → on). */
export function parseKeepAwake(v: unknown): boolean {
  return typeof v === 'boolean' ? v : DEFAULT_KEEP_AWAKE;
}

/** Reads the stored setting. */
export async function loadKeepAwake(): Promise<boolean> {
  const s = await browser.storage.local.get(KEEP_AWAKE_KEY);
  return parseKeepAwake(s[KEEP_AWAKE_KEY]);
}

/** True when at least one order can still trade. */
export function hasWaitingOrders(orders: Iterable<Order>): boolean {
  for (const o of orders) if (WAITING.has(o.status)) return true;
  return false;
}

/** The part of chrome.power used here. */
export interface PowerApi {
  requestKeepAwake(level: 'system' | 'display'): void;
  releaseKeepAwake(): void;
}

/** Holds or releases the keep-awake request, calling the API only when the wish changes. */
export class KeepAwake {
  private held: boolean | null = null; // null: unknown (a fresh service worker), so the first sync always applies

  constructor(private readonly power: PowerApi | undefined) {}

  /** Applies the wish; returns whether the computer is now kept awake. */
  sync(want: boolean): boolean {
    if (!this.power || want === this.held) return this.held === true;
    if (want) this.power.requestKeepAwake('system');
    else this.power.releaseKeepAwake();
    this.held = want;
    return want;
  }
}
