/**
 * @file x-latest.ts
 * @description Opens an X page in a minimized background window, scrapes the newest post, closes the
 *              window. Results are cached and concurrent requests for one URL share a single scrape.
 * @author Reborn1987
 */

import type { XScrapeResult } from './x-scraper';

/** Browser APIs used (injectable for tests). */
export interface XBrowserApi {
  openWindow(url: string): Promise<{ windowId: number; tabId: number }>;
  closeWindow(windowId: number): Promise<void>;
  tabStatus(tabId: number): Promise<string | undefined>;
  scrape(tabId: number, timeoutMs: number): Promise<XScrapeResult>;
}

/** Tuning (ms). */
export interface XTimings {
  readonly loadMs: number;
  readonly scrapeMs: number;
  readonly pollMs: number;
  readonly cacheMs: number;
}

export const DEFAULT_X_TIMINGS: XTimings = { loadMs: 20_000, scrapeMs: 15_000, pollMs: 250, cacheMs: 3 * 60_000 };

/** A cached scrape with when it was taken. */
export interface XLatest {
  readonly result: XScrapeResult;
  readonly checkedAt: number;
}

export class XLatestService {
  private readonly cache = new Map<string, XLatest>();
  private readonly inflight = new Map<string, Promise<XLatest>>();

  /** @param api browser access @param t timings @param now clock */
  constructor(private readonly api: XBrowserApi, private readonly t: XTimings = DEFAULT_X_TIMINGS, private readonly now: () => number = Date.now) {}

  /** Latest post for an X profile/community URL (cached; `force` bypasses the cache). */
  async get(url: string, force = false): Promise<XLatest> {
    const hit = this.cache.get(url);
    if (!force && hit && this.now() - hit.checkedAt < this.t.cacheMs) return hit;
    let p = this.inflight.get(url);
    if (!p) {
      p = this.scrape(url).finally(() => this.inflight.delete(url));
      this.inflight.set(url, p);
    }
    return p;
  }

  /** Opens, waits for load, scrapes and always closes the window. */
  private async scrape(url: string): Promise<XLatest> {
    const { windowId, tabId } = await this.api.openWindow(url);
    try {
      const deadline = this.now() + this.t.loadMs;
      while ((await this.api.tabStatus(tabId)) !== 'complete') {
        if (this.now() > deadline) {
          return this.store(url, { ok: false, reason: 'timeout', message: 'X did not load in time' });
        }
        await new Promise((r) => setTimeout(r, this.t.pollMs));
      }
      return this.store(url, await this.api.scrape(tabId, this.t.scrapeMs));
    } finally {
      await this.api.closeWindow(windowId).catch(() => undefined);
    }
  }

  /** Caches successes and definite answers; timeouts are not cached so the next view retries. */
  private store(url: string, result: XScrapeResult): XLatest {
    const entry = { result, checkedAt: this.now() };
    if (result.ok || result.reason !== 'timeout') this.cache.set(url, entry);
    return entry;
  }
}
