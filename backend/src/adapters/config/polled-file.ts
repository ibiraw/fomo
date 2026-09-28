/**
 * @file polled-file.ts
 * @description A config file on the server that is re-read every few seconds. A valid edit replaces the live value;
 *              an invalid one is reported and the last good value stays; deleting the file restores the fallback.
 *              Shared by the fomo page-layout overrides and the access file.
 * @author Reborn1987
 */

import { existsSync, readFileSync, statSync } from 'node:fs';

/** Result of parsing the file's text. */
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export class PolledFile<T> {
  private value: T;
  /** mtime + size of the last read, to skip unchanged files. */
  private stamp = '';
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param path the file @param parse validates its text @param fallback value while the file is missing
   * @param onError sink for invalid edits and read errors @param pollMs how often the file is checked
   */
  constructor(
    private readonly path: string,
    private readonly parse: (raw: string) => Parsed<T>,
    private readonly fallback: T,
    private readonly onError: (err: unknown) => void,
    private readonly pollMs = 3_000,
  ) {
    this.value = fallback;
    this.reload();
  }

  /** Current value. */
  current(): T {
    return this.value;
  }

  /** Polls the file; calls `onChange` after each change that went live. */
  start(onChange: (value: T) => void): void {
    this.timer = setInterval(() => {
      if (this.reload()) onChange(this.value);
    }, this.pollMs);
  }

  /** Stops polling. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Re-reads the file when it changed. True when the live value changed. */
  reload(): boolean {
    let stamp = 'missing';
    try {
      if (existsSync(this.path)) {
        const st = statSync(this.path);
        stamp = `${st.mtimeMs}:${st.size}`;
      }
    } catch (err) {
      this.onError(err);
      return false;
    }
    if (stamp === this.stamp) return false;
    this.stamp = stamp;
    if (stamp === 'missing') {
      const had = this.value !== this.fallback;
      this.value = this.fallback;
      return had;
    }
    const parsed = this.parse(readFileSync(this.path, 'utf8'));
    if (!parsed.ok) {
      this.onError(new Error(`${this.path} not applied (${parsed.error}); the previous version stays live`));
      return false;
    }
    this.value = parsed.value;
    return true;
  }
}
