/**
 * @file layout-report.ts
 * @description A fomo self-check report from an account's extension (layout recognised or not, fomo's "new version"
 *              prompt seen), as passed from the gateway to monitoring.
 * @author Reborn1987
 */

import type { Account } from '../../ports/account-store.js';

export interface LayoutReport {
  readonly account: Account;
  /** Self-check passed / failed; null when the report only says fomo showed its "new version" prompt. */
  readonly ok: boolean | null;
  readonly missing: readonly string[];
  readonly newVersion: boolean;
  readonly snapshot: string | null;
  /** The account's trades were paused (true) / resumed (false) by this report; null when unchanged. */
  readonly paused: boolean | null;
}
