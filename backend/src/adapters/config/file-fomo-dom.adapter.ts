/**
 * @file file-fomo-dom.adapter.ts
 * @description FomoDomSourcePort over a JSON file (DATA_DIR/fomo-dom.json). Checked every few seconds; a valid edit is
 *              pushed to every connected extension, an invalid one is reported and the last good version stays live.
 *              Deleting the file clears the overrides (extensions go back to their built-ins).
 * @author Reborn1987
 */

import { parseFomoDomOverrides, type FomoDomOverrides } from '../../core/fomo-dom/fomo-dom-overrides.js';
import { FomoDomSourcePort } from '../../ports/fomo-dom-source.js';
import { PolledFile, type Parsed } from './polled-file.js';

/** The overrides parser in PolledFile's shape. */
function parse(raw: string): Parsed<FomoDomOverrides | null> {
  const r = parseFomoDomOverrides(raw);
  return r.ok ? { ok: true, value: r.overrides } : r;
}

export class FileFomoDomAdapter extends FomoDomSourcePort {
  private readonly file: PolledFile<FomoDomOverrides | null>;

  /**
   * @param path the overrides file @param onError sink for invalid edits (the previous version stays)
   * @param pollMs how often the file is checked
   */
  constructor(path: string, onError: (err: unknown) => void, pollMs = 3_000) {
    super();
    this.file = new PolledFile(path, parse, null, onError, pollMs);
  }

  /** Current overrides. */
  current(): FomoDomOverrides | null {
    return this.file.current();
  }

  /** Polls the file; calls `onChange` after each valid change. */
  start(onChange: (overrides: FomoDomOverrides | null) => void): void {
    this.file.start(onChange);
  }

  /** Stops polling. */
  stop(): void {
    this.file.stop();
  }

  /** Re-reads the file when it changed. True when the live overrides changed. */
  reload(): boolean {
    return this.file.reload();
  }
}
