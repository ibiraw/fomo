/**
 * @file file-access-config.adapter.ts
 * @description AccessConfigSourcePort over a JSON file (DATA_DIR/access.json):
 *                { "publicVersion": "1.0", "earlyAccess": ["LM-7K3Q2P"], "freeUntil": { "LM-7K3Q2P": "2026-11-01" } }
 *              Checked every few seconds; a valid edit goes live for every connected extension, an invalid one is
 *              reported and the last good version stays. Deleting the file goes back to v1.0 for everyone.
 * @author Reborn1987
 */

import { DEFAULT_ACCESS, parseAccessConfig, type AccessConfig } from '../../core/releases/releases.js';
import { AccessConfigSourcePort } from '../../ports/access-config-source.js';
import { PolledFile, type Parsed } from './polled-file.js';

/** The access parser in PolledFile's shape. */
function parse(raw: string): Parsed<AccessConfig> {
  const r = parseAccessConfig(raw);
  return r.ok ? { ok: true, value: r.config } : r;
}

export class FileAccessConfigAdapter extends AccessConfigSourcePort {
  private readonly file: PolledFile<AccessConfig>;

  /** @param path the access file @param onError sink for invalid edits @param pollMs how often the file is checked */
  constructor(path: string, onError: (err: unknown) => void, pollMs = 3_000) {
    super();
    this.file = new PolledFile(path, parse, DEFAULT_ACCESS, onError, pollMs);
  }

  /** Current config. */
  current(): AccessConfig {
    return this.file.current();
  }

  /** Polls the file; calls `onChange` after each valid change. */
  start(onChange: (config: AccessConfig) => void): void {
    this.file.start(onChange);
  }

  /** Stops polling. */
  stop(): void {
    this.file.stop();
  }

  /** Re-reads the file when it changed. True when the live config changed. */
  reload(): boolean {
    return this.file.reload();
  }
}
