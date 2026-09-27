/**
 * @file fomo-health-watch.ts
 * @description Runs in every fomo tab. Every couple of seconds it looks for fomo's "new version → Reload" prompt, and
 *              on a token page of a logged-in user it runs the layout self-check once the page has settled (again after
 *              navigating, and whenever the layout settings change). A failing check is confirmed a few seconds later
 *              before it is reported, so a slow render isn't mistaken for a redesign.
 * @author Reborn1987
 */

import { checkLayout, findNewVersionPrompt, layoutSnapshot } from './fomo-health';

/** What the watcher reports to the background worker. */
export type FomoHealthMessage =
  | { readonly type: 'fomo.newVersion' }
  | { readonly type: 'fomo.layout'; readonly ok: boolean; readonly missing: readonly string[]; readonly snapshot?: string };

/** Page access (injectable for tests). */
export interface HealthEnv {
  readonly doc: Document;
  /** Current path (location.pathname). */
  path(): string;
  /** True on a token page. */
  isTokenPage(path: string): boolean;
  /** True when fomo's storage has a logged-in user. */
  loggedIn(): boolean;
  send(msg: FomoHealthMessage): void;
  now(): number;
}

/** Timings (ms). */
export interface HealthTimings {
  /** Navigation / check-due polling (cheap: compares a string and a number). */
  readonly tickMs: number;
  /** How often to scan the page for the new-version prompt (walks the buttons). */
  readonly promptEveryMs: number;
  /** Wait after a page load / navigation before checking (fomo renders the panel late). */
  readonly settleMs: number;
  /** Re-check a failure after this long before reporting it. */
  readonly confirmMs: number;
}

export const DEFAULT_HEALTH_TIMINGS: HealthTimings = { tickMs: 2_000, promptEveryMs: 6_000, settleMs: 8_000, confirmMs: 5_000 };

export class FomoHealthWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private promptSent = false;
  private lastPath = '';
  private checkAt = 0;
  private checked = false;
  private confirming = false;
  private lastReportedOk: boolean | null = null;
  private nextPromptScan = 0;

  /** @param env page access @param t timings */
  constructor(private readonly env: HealthEnv, private readonly t: HealthTimings = DEFAULT_HEALTH_TIMINGS) {}

  /** Starts ticking. */
  start(): void {
    this.lastPath = this.env.path();
    this.checkAt = this.env.now() + this.t.settleMs;
    this.timer = setInterval(() => this.tick(), this.t.tickMs);
  }

  /** Stops ticking. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Layout settings changed: check again shortly (a fix should resume trading quickly). */
  recheck(): void {
    this.checked = false;
    this.confirming = false;
    this.checkAt = this.env.now() + this.t.tickMs;
  }

  /** One round: new-version prompt, navigation, layout check. */
  tick(): void {
    const { doc, now } = this.env;
    // The prompt scan walks the buttons, so it runs less often than the tick and stops once reported for this page
    // load (fomo reloads the page after its update, which starts a fresh watcher).
    if (!this.promptSent && now() >= this.nextPromptScan) {
      this.nextPromptScan = now() + this.t.promptEveryMs;
      if (findNewVersionPrompt(doc)) {
        this.promptSent = true;
        this.env.send({ type: 'fomo.newVersion' });
      }
    }
    const path = this.env.path();
    if (path !== this.lastPath) {
      this.lastPath = path;
      this.checked = false;
      this.confirming = false;
      this.checkAt = now() + this.t.settleMs;
    }
    if (this.checked || now() < this.checkAt || !this.env.isTokenPage(path) || !this.env.loggedIn()) return;
    const result = checkLayout(doc);
    if (!result.ok && !this.confirming) {
      this.confirming = true; // maybe still rendering — look again before reporting
      this.checkAt = now() + this.t.confirmMs;
      return;
    }
    this.checked = true;
    this.confirming = false;
    if (result.ok) {
      if (this.lastReportedOk !== true) this.env.send({ type: 'fomo.layout', ok: true, missing: [] });
      this.lastReportedOk = true;
      return;
    }
    this.lastReportedOk = false;
    this.env.send({ type: 'fomo.layout', ok: false, missing: result.missing, snapshot: layoutSnapshot(doc) });
  }
}
