/**
 * @file auto-exit-store.ts
 * @description AutoExitStorePort: each account's auto take profit / stop loss settings (v2.1.0).
 * @author Reborn1987
 */

import type { AutoExitSettings } from '../core/orders/auto-exit.js';

/** Abstract settings storage. Adapter: SqliteAutoExitStoreAdapter. */
export abstract class AutoExitStorePort {
  /** The account's saved settings, or null when it never saved any. */
  abstract get(userId: string): AutoExitSettings | null;

  /** Saves the account's settings. */
  abstract set(userId: string, settings: AutoExitSettings): void;
}
