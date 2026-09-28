/**
 * @file activity-relay.ts
 * @description Monitoring: records activity in the durable log and relays undelivered entries to the notifier
 *              (Telegram) in batches. Entries survive restarts and notifier outages; delivery backs off on failure.
 *              Error entries are rate-limited per source so a failing RPC can't flood the chat.
 * @author Reborn1987
 */

import { NotifierRateLimitError, type ActivityKind, type ActivityStorePort, type NotifierPort } from '../../ports/activity.js';

/** Telegram allows 4096 characters per message; stay below it. */
const MAX_MESSAGE_CHARS = 3_800;
const BATCH = 40;
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** At most one error message per source in this window. */
const ERROR_WINDOW_MS = 5 * 60_000;

const ICON: Record<ActivityKind, string> = {
  server: '🖥',
  account: '👤',
  order: '📈',
  payment: '💰',
  subscription: '⭐',
  error: '⚠️',
};

/** "9:44:15 PM ET" — US Eastern (EST/EDT follows the date), the owner's time zone. */
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
export const clock = (ms: number): string => `${ET.format(ms)} ET`;

/** Longest single entry (plain text) before formatting; longer ones are cut so markup is never split. */
const MAX_LINE_CHARS = 1_000;

/** Splits lines into messages under the size limit. */
export function packMessages(lines: readonly string[], max = MAX_MESSAGE_CHARS): string[] {
  const out: string[] = [];
  let cur = '';
  for (const raw of lines) {
    const line = raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
    if (cur && cur.length + 1 + line.length > max) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

export class ActivityRelay {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private backoffMs = 0;
  private resumeAt = 0;
  private readonly lastError = new Map<string, number>();

  /**
   * @param store durable log @param notifier where messages go (null: log only)
   * @param onError sink for delivery failures (never re-logged, to avoid loops) @param pollMs delivery interval
   */
  constructor(
    private readonly store: ActivityStorePort,
    private readonly notifier: NotifierPort | null,
    private readonly onError: (err: unknown) => void,
    private readonly pollMs = 3_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Logs an event (delivered on the next round). */
  record(kind: ActivityKind, text: string): void {
    this.store.add(this.now(), kind, text.replace(/\s*\n\s*/g, ' ')); // one line per entry (batching counts lines)
  }

  /** Logs an error from `source`, at most once per 5 minutes per source. */
  recordError(source: string, err: unknown): void {
    const now = this.now();
    if (now - (this.lastError.get(source) ?? -Infinity) < ERROR_WINDOW_MS) return;
    this.lastError.set(source, now);
    const msg = (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 200);
    this.record('error', `${source}: ${msg}`);
  }

  /** Starts delivery (no-op without a notifier). */
  start(): void {
    if (!this.notifier) return;
    this.timer = setInterval(() => void this.deliver(), this.pollMs);
  }

  /** Stops delivery. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sends one batch of undelivered entries. */
  async deliver(): Promise<void> {
    if (!this.notifier || this.running || this.now() < this.resumeAt) return;
    this.running = true;
    try {
      const entries = this.store.pending(BATCH);
      if (entries.length === 0) return;
      const lines = entries.map((e) => {
        const plain = `${ICON[e.kind]} ${clock(e.at)} ${e.text}`;
        return this.notifier!.format(plain.length > MAX_LINE_CHARS ? `${plain.slice(0, MAX_LINE_CHARS - 1)}…` : plain);
      });
      // Each message marks its own entries, so a failure part-way resends only what wasn't delivered.
      let offset = 0;
      for (const msg of packMessages(lines)) {
        const count = msg.split('\n').length;
        await this.notifier.send(msg);
        this.store.markSent(entries.slice(offset, offset + count).map((e) => e.id), this.now());
        offset += count;
      }
      this.backoffMs = 0;
    } catch (err) {
      this.backoffMs = err instanceof NotifierRateLimitError ? err.retryAfterMs : Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, this.backoffMs * 2));
      this.resumeAt = this.now() + this.backoffMs;
      this.onError(err);
    } finally {
      this.running = false;
    }
  }
}
