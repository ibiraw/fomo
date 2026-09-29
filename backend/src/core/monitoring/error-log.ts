/**
 * @file error-log.ts
 * @description Console error logging with repeat suppression. A dropped RPC socket fails every open subscription
 *              at once (dozens of identical stack dumps per blip); the first occurrence of a context+message pair is
 *              dumped in full, repeats within the window log a single line.
 * @author Reborn1987
 */

/** Repeats of the same context+message within this window log one line instead of a full dump. */
export const LOG_REPEAT_MS = 60_000;

/**
 * "Name: message", first line only. WebSocket error events aren't Errors: they are named and described by their
 * error, message or type (plain String() gave "[object ErrorEvent]", which said nothing).
 */
export function errorHeadline(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.split('\n')[0]!;
  if (err && typeof err === 'object') {
    const e = err as { error?: unknown; message?: unknown; type?: unknown };
    if (e.error instanceof Error) return errorHeadline(e.error);
    const detail = typeof e.message === 'string' && e.message ? e.message : typeof e.type === 'string' && e.type ? e.type : null;
    if (detail) return `${err.constructor?.name || 'Object'}: ${detail}`.split('\n')[0]!;
  }
  return String(err).split('\n')[0]!;
}

/** Above this many remembered messages, entries past their window are dropped (messages can carry addresses). */
const PRUNE_AT = 500;

/** Writes errors to a sink, dumping each distinct context+message once per window. */
export class ErrorLog {
  private readonly lastDump = new Map<string, number>();

  /**
   * @param write sink (console.error in production) @param now clock (injectable for tests)
   * @param repeatMs suppression window
   */
  constructor(
    private readonly write: (...parts: unknown[]) => void,
    private readonly now: () => number = Date.now,
    private readonly repeatMs: number = LOG_REPEAT_MS,
  ) {}

  /** Logs `err` under `ctx`: full dump the first time, one line for repeats inside the window. */
  log(ctx: string, err: unknown): void {
    const now = this.now();
    const headline = errorHeadline(err);
    const key = `${ctx}|${headline}`;
    const stamp = new Date(now).toISOString();
    if (now - (this.lastDump.get(key) ?? -Infinity) < this.repeatMs) {
      this.write(`${stamp} [${ctx}] (repeat) ${headline}`);
      return;
    }
    if (this.lastDump.size >= PRUNE_AT) {
      for (const [k, at] of this.lastDump) if (now - at >= this.repeatMs) this.lastDump.delete(k);
    }
    this.lastDump.set(key, now);
    this.write(`${stamp} [${ctx}]`, err);
  }

  /** How many distinct messages are remembered (tests / diagnostics). */
  tracked(): number {
    return this.lastDump.size;
  }
}
