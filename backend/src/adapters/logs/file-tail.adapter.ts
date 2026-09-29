/**
 * @file file-tail.adapter.ts
 * @description Reads lines appended to a file since the last read, like `tail -f`: the first read returns what is
 *              already there, later reads only what was added; keeps a partial last line for next time, and starts
 *              over when the file is truncated or replaced. A missing file reads as nothing.
 * @author Reborn1987
 */

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

import { LineSourcePort } from '../../ports/line-source.js';

/** Most bytes read per call, so a huge burst can't stall the server. */
const MAX_READ = 1 << 20;

export class FileTailAdapter extends LineSourcePort {
  private offset = 0;
  private partial = '';

  /** @param path the log file */
  constructor(private readonly path: string) {
    super();
  }

  /** Complete lines appended since the last call. */
  readNew(): string[] {
    const size = this.size();
    if (size < this.offset) { this.offset = 0; this.partial = ''; } // truncated or replaced
    if (size === this.offset) return [];
    const length = Math.min(size - this.offset, MAX_READ);
    const buf = Buffer.alloc(length);
    const fd = openSync(this.path, 'r');
    try {
      readSync(fd, buf, 0, length, this.offset);
    } finally {
      closeSync(fd);
    }
    this.offset += length;
    const lines = (this.partial + buf.toString('utf8')).split('\n');
    this.partial = lines.pop() ?? '';
    return lines.filter((l) => l.trim() !== '');
  }

  /** Current file size (0 when missing). */
  private size(): number {
    return existsSync(this.path) ? statSync(this.path).size : 0;
  }
}
