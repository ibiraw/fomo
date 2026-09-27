/**
 * @file error-log.ts
 * @description Console error logging with repeat suppression. A dropped RPC socket fails every open subscription
 *              at once (dozens of identical stack dumps per blip); the first occurrence of a context+message pair is
 *              dumped in full, repeats within the window log a single line.
 * @author Reborn1987
 */

/** Repeats of the same context+message within this window log one line instead of a full dump. */
export const LOG_REPEAT_MS = 60_000;

/** "Name: message", first line only. */
export function errorHeadline(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.split('\n')[0]!;
}

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
    this.lastDump.set(key, now);
    this.write(`${stamp} [${ctx}]`, err);
  }
}
