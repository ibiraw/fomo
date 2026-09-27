/**
 * @file outage-tracker.ts
 * @description Turns connection drops into alerts only when they last. RPC sockets drop and self-heal about hourly;
 *              a drop is reported once it has stayed down for `stayDownMs`, and then a recovery line follows when
 *              it comes back. Blips that recover in time are never reported.
 * @author Reborn1987
 */

import type { ConnectionHealth } from '../../ports/connection-health.js';

import { errorHeadline } from './error-log.js';

/** How long a connection must stay down before it is reported. */
export const STAY_DOWN_MS = 2 * 60_000;

/** Where alerts go (the activity relay in production). */
export type OutageSink = (kind: 'error' | 'server', text: string) => void;

/** One open outage. */
interface Outage {
  readonly since: number;
  lastError: unknown;
  timer: NodeJS.Timeout | null;
  alerted: boolean;
}

/** "3 min" / "45 s". */
function duration(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;
}

/** Tracks outages per source ("rpc", "rpc:robinhood", …) and reports the lasting ones. */
export class OutageTracker {
  private readonly open = new Map<string, Outage>();

  /** @param sink alert sink @param stayDownMs report threshold @param now clock (injectable for tests) */
  constructor(
    private readonly sink: OutageSink,
    private readonly stayDownMs: number = STAY_DOWN_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Health sink for one source, to hand to an adapter. */
  for(source: string): ConnectionHealth {
    return { down: (err) => this.down(source, err), up: () => this.up(source) };
  }

  /** Marks `source` down; starts the stay-down timer on the first failure of an outage. */
  down(source: string, err: unknown): void {
    const cur = this.open.get(source);
    if (cur) {
      cur.lastError = err;
      return;
    }
    const outage: Outage = { since: this.now(), lastError: err, timer: null, alerted: false };
    outage.timer = setTimeout(() => {
      outage.timer = null;
      outage.alerted = true;
      this.sink('error', `${source} down for ${duration(this.now() - outage.since)} (still retrying): ${errorHeadline(outage.lastError).slice(0, 200)}`);
    }, this.stayDownMs);
    this.open.set(source, outage);
  }

  /** Marks `source` up; reports the recovery if its outage had been alerted. */
  up(source: string): void {
    const cur = this.open.get(source);
    if (!cur) return;
    this.open.delete(source);
    if (cur.timer) clearTimeout(cur.timer);
    if (cur.alerted) this.sink('server', `${source} back up after ${duration(this.now() - cur.since)}`);
  }

  /** Cancels pending timers (shutdown). */
  stop(): void {
    for (const o of this.open.values()) if (o.timer) clearTimeout(o.timer);
    this.open.clear();
  }
}
