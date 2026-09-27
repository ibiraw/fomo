/**
 * @file file-fomo-dom.adapter.ts
 * @description FomoDomSourcePort over a JSON file (DATA_DIR/fomo-dom.json). Checked every few seconds; a valid edit is
 *              pushed to every connected extension, an invalid one is reported and the last good version stays live.
 *              Deleting the file clears the overrides (extensions go back to their built-ins).
 * @author Reborn1987
 */

import { existsSync, readFileSync, statSync } from 'node:fs';

import { parseFomoDomOverrides, type FomoDomOverrides } from '../../core/fomo-dom/fomo-dom-overrides.js';
import { FomoDomSourcePort } from '../../ports/fomo-dom-source.js';

export class FileFomoDomAdapter extends FomoDomSourcePort {
  private overrides: FomoDomOverrides | null = null;
  /** mtime + size of the last read, to skip unchanged files. */
  private stamp = '';
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param path the overrides file @param onError sink for invalid edits (the previous version stays)
   * @param pollMs how often the file is checked
   */
  constructor(private readonly path: string, private readonly onError: (err: unknown) => void, private readonly pollMs = 3_000) {
    super();
    this.reload();
  }

  /** Current overrides. */
  current(): FomoDomOverrides | null {
    return this.overrides;
  }

  /** Polls the file; calls `onChange` after each valid change. */
  start(onChange: (overrides: FomoDomOverrides | null) => void): void {
    this.timer = setInterval(() => {
      if (this.reload()) onChange(this.overrides);
    }, this.pollMs);
  }

  /** Stops polling. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Re-reads the file when it changed. True when the live overrides changed. */
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
      const had = this.overrides !== null;
      this.overrides = null;
      return had;
    }
    const parsed = parseFomoDomOverrides(readFileSync(this.path, 'utf8'));
    if (!parsed.ok) {
      this.onError(new Error(`${this.path} not applied (${parsed.error}); the previous version stays live`));
      return false;
    }
    this.overrides = parsed.overrides;
    return true;
  }
}
