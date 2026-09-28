/**
 * @file activity.ts
 * @description Monitoring ports: ActivityStorePort (durable activity log / outbox) and NotifierPort (where monitoring
 *              messages go, e.g. Telegram).
 * @author Reborn1987
 */

export type ActivityKind = 'server' | 'account' | 'order' | 'payment' | 'subscription' | 'error';

/** One logged event. */
export interface ActivityEntry {
  readonly id: number;
  readonly at: number;
  readonly kind: ActivityKind;
  readonly text: string;
}

/** Durable activity log that doubles as the notification outbox. */
export abstract class ActivityStorePort {
  /** Appends an entry. */
  abstract add(at: number, kind: ActivityKind, text: string): void;

  /** Oldest entries not yet delivered. */
  abstract pending(limit: number): ActivityEntry[];

  /** Marks entries delivered. */
  abstract markSent(ids: readonly number[], at: number): void;
}

/** Sends a monitoring message. Rejects on failure; `retryAfterMs` on the error asks callers to wait. */
export abstract class NotifierPort {
  abstract send(text: string): Promise<void>;

  /** Formats one plain line for this channel (default: unchanged). Applied before lines are packed into messages. */
  format(line: string): string {
    return line;
  }
}

/** A notifier failure that says how long to wait before trying again. */
export class NotifierRateLimitError extends Error {
  /** @param retryAfterMs wait requested by the service */
  constructor(readonly retryAfterMs: number) {
    super(`Rate limited — retry in ${retryAfterMs} ms`);
  }
}
