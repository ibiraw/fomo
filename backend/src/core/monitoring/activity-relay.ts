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
  order: '⏰',
  payment: '💰',
  subscription: '⭐',
  error: '⚠️',
};

/** "9:44:15 PM ET" — US Eastern (EST/EDT follows the date), the owner's time zone. */
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
export const clock = (ms: number): string => `${ET.format(ms)} ET`;

/** Longest single entry (plain text) before formatting; longer ones are cut so markup is never split. */
const MAX_LINE_CHARS = 1_000;

/** Between two entries of one message. Order entries span several lines, so a divider keeps them apart. */
export const ENTRY_SEPARATOR = '\n\n────────\n\n';

/** One message: its text and how many entries it holds (for marking them sent). */
export interface PackedMessage {
  readonly text: string;
  readonly count: number;
}

/** Groups entries (possibly multi-line) into messages under the size limit, never splitting an entry. */
export function packMessages(entries: readonly string[], max = MAX_MESSAGE_CHARS, sep = ENTRY_SEPARATOR): PackedMessage[] {
  const out: PackedMessage[] = [];
  let cur = '';
  let count = 0;
  for (const raw of entries) {
    const entry = raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
    if (cur && cur.length + sep.length + entry.length > max) {
      out.push({ text: cur, count });
      cur = '';
      count = 0;
    }
    cur = cur ? `${cur}${sep}${entry}` : entry;
    count++;
  }
  if (cur) out.push({ text: cur, count });
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
    private readonly pollMs = 1_000, // alerts leave within ~1 s; batching still groups bursts
    private readonly now: () => number = Date.now,
  ) {}

  /** Logs an event (delivered on the next round). */
  record(kind: ActivityKind, text: string): void {
    // Order entries are laid out in lines separated by blank lines; everything else is one line.
    const clean = kind === 'order'
      ? text.split(/\n\s*\n/).map((part) => part.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n\n')
      : text.replace(/\s*\n\s*/g, ' ');
    this.store.add(this.now(), kind, clean);
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
      const blocks = entries.map((e) => {
        const plain = `${ICON[e.kind]} ${clock(e.at)} ${e.text}`;
        return this.notifier!.format(plain.length > MAX_LINE_CHARS ? `${plain.slice(0, MAX_LINE_CHARS - 1)}…` : plain);
      });
      // Each message marks its own entries, so a failure part-way resends only what wasn't delivered.
      let offset = 0;
      for (const msg of packMessages(blocks)) {
        await this.notifier.send(msg.text);
        this.store.markSent(entries.slice(offset, offset + msg.count).map((e) => e.id), this.now());
        offset += msg.count;
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
