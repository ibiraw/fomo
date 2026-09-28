/**
 * @file layout-alerts.ts
 * @description Turns the extensions' fomo self-check reports into monitoring messages: fomo shipped a new version,
 *              an account's trades paused because fomo's layout wasn't recognised (with the saved layout snapshot), and
 *              trades resumed. De-duplicated so a fomo redesign seen by many users is one alert, not hundreds.
 * @author Reborn1987
 */

import type { LayoutReport } from './layout-report.js';

/** At most one "new version" message per this window. */
export const NEW_VERSION_WINDOW_MS = 30 * 60_000;
/** At most one "layout broken" alert per this window (later ones only count toward the next alert). */
export const BROKEN_WINDOW_MS = 10 * 60_000;

/** Monitoring sink ('alert' needs attention, 'server' is informational). */
export type LayoutAlertSink = (kind: 'alert' | 'server', text: string) => void;
/** Saves a snapshot; returns where (a file path) so the alert can point to it. */
export type SnapshotWriter = (label: string, snapshot: string) => string;

export class LayoutAlerts {
  private lastNewVersion = -Infinity;
  private lastBroken = -Infinity;
  /** Accounts that reported a broken layout since the last alert. */
  private readonly brokenSince = new Set<string>();

  /** @param sink monitoring @param saveSnapshot snapshot writer @param now clock */
  constructor(private readonly sink: LayoutAlertSink, private readonly saveSnapshot: SnapshotWriter, private readonly now: () => number = Date.now) {}

  /** Handles one report from an extension. */
  handle(r: LayoutReport): void {
    const now = this.now();
    const who = r.account.fomoUsername ? `${r.account.shortId} (@${r.account.fomoUsername})` : r.account.shortId;
    if (r.newVersion && now - this.lastNewVersion >= NEW_VERSION_WINDOW_MS) {
      this.lastNewVersion = now;
      this.sink('server', `🆕 fomo shipped a new version (seen by ${who}) — self-check running`);
    }
    if (r.ok === false) {
      this.brokenSince.add(r.account.id);
      if (now - this.lastBroken < BROKEN_WINDOW_MS) return;
      this.lastBroken = now;
      const where = r.snapshot ? ` · layout snapshot: ${this.saveSnapshot(r.account.shortId, r.snapshot)}` : '';
      const others = this.brokenSince.size > 1 ? ` (${this.brokenSince.size} accounts so far)` : '';
      this.brokenSince.clear();
      this.sink('alert', `🛠 fomo layout not recognised for ${who}${others}: missing ${r.missing.join(', ') || '?'}. `
        + `${r.paused ? 'Trades paused — nothing was clicked; they resume when fixed' : 'Nothing was clicked'} (fix: data/fomo-dom.json)${where}`);
      return;
    }
    if (r.paused === false) this.sink('server', `✅ fomo layout recognised again for ${who} — trades resumed`);
  }
}
