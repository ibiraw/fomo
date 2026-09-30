/**
 * @file download-watcher.test.ts
 * @description Website download notices: which log lines count (GET 200 with bytes; not HEAD, ranges or errors),
 *              the country, "Nth today" in US Eastern (surviving restarts by a silent catch-up), and the file tail
 *              (first read = backlog, then only appended lines, partial lines, truncation, missing file).
 * @author Reborn1987
 */

import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileTailAdapter } from '../../src/adapters/logs/file-tail.adapter.js';
import { DownloadWatcher, ordinal, parseDownload } from '../../src/core/monitoring/download-watcher.js';
import { LineSourcePort } from '../../src/ports/line-source.js';

/** Lines handed out one batch per read. */
class Batches extends LineSourcePort {
  constructor(readonly batches: string[][]) { super(); }
  readNew(): string[] { return this.batches.shift() ?? []; }
}

describe('parseDownload', () => {
  it('counts completed GETs only, with a real country code', () => {
    expect(parseDownload('2026-09-29T01:00:00+00:00 GET 200 301234 US')).toEqual({ at: Date.parse('2026-09-29T01:00:00Z'), place: 'US' });
    expect(parseDownload('2026-09-29T01:00:00+00:00 GET 200 301234 XX')?.place).toBeNull(); // unknown
    expect(parseDownload('2026-09-29T01:00:00+00:00 GET 200 301234 -')?.place).toBeNull();
    // Newer lines: "|"-separated with Cloudflare's region and city (city names have spaces).
    expect(parseDownload('2026-09-29T01:00:00+00:00|GET|200|301234|CA|Ontario|Toronto')?.place).toBe('Toronto, Ontario, CA');
    expect(parseDownload('2026-09-29T01:00:00+00:00|GET|200|301234|US|New York|New York City')?.place).toBe('New York City, New York, US');
    expect(parseDownload('2026-09-29T01:00:00+00:00|GET|200|301234|SG|-|-')?.place).toBe('SG'); // headers off
    expect(parseDownload('2026-09-29T01:00:00+00:00|GET|200|301234|US||<script>')?.place).toBe('US');
    expect(parseDownload('2026-09-29T01:00:00+00:00|HEAD|200|0|US|Ohio|Columbus')).toBeNull();
    expect(parseDownload('2026-09-29T01:00:00+00:00 HEAD 200 0 US')).toBeNull();
    expect(parseDownload('2026-09-29T01:00:00+00:00 GET 206 1000 US')).toBeNull(); // a range request
    expect(parseDownload('2026-09-29T01:00:00+00:00 GET 404 153 US')).toBeNull();
    expect(parseDownload('garbage')).toBeNull();
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '111th']);
  });
});

describe('DownloadWatcher', () => {
  it("counts today's earlier downloads silently on start, then announces new ones with the running count", () => {
    const sent: string[] = [];
    const now = Date.parse('2026-09-29T03:00:00Z'); // 11 PM ET on the 28th
    const source = new Batches([
      ['2026-09-27T15:00:00+00:00 GET 200 9 US', '2026-09-28T15:00:00+00:00 GET 200 9 US'], // backlog: the 27th, then today (ET)
      ['2026-09-28T20:00:00+00:00 HEAD 200 0 US'],
      [], // caught up
    ]);
    const w = new DownloadWatcher(source, (t) => sent.push(t), () => undefined, () => now, 60_000);
    w.start();
    w.stop();
    expect(sent).toEqual([]);
    source.batches.push(['2026-09-29T02:59:00+00:00 GET 200 301234 DE', '2026-09-29T03:00:00+00:00 GET 200 301234 -']);
    w.check();
    expect(sent).toEqual(['limit.zip downloaded · from DE · 2nd today (ET)', 'limit.zip downloaded · 3rd today (ET)']);
    source.batches.push(['2026-09-29T05:00:00+00:00 GET 200 301234 US']); // 1 AM ET: a new day
    w.check();
    expect(sent.at(-1)).toBe('limit.zip downloaded · from US · 1st today (ET)');
  });

  it('counts the same place within 10 minutes once: a double fetch is silent, a later retry says "again" (2026-09-30)', () => {
    const sent: string[] = [];
    const source = new Batches([[]]);
    const w = new DownloadWatcher(source, (t) => sent.push(t), () => undefined, () => Date.parse('2026-09-30T19:00:00Z'), 60_000);
    w.start();
    w.stop();
    source.batches.push([
      '2026-09-30T19:23:29+00:00|GET|200|300475|PL|Mazovia|Warsaw',
      '2026-09-30T19:23:29+00:00|GET|200|300475|PL|Mazovia|Warsaw', // same second: browser/scanner double fetch
      '2026-09-30T19:29:20+00:00|GET|200|300475|FR|Grand Est|Villerupt',
      '2026-09-30T19:31:25+00:00|GET|200|300475|FR|Grand Est|Villerupt', // 2 min later: trying again
      '2026-09-30T19:45:00+00:00|GET|200|300475|FR|Grand Est|Villerupt', // 13.5 min later: counts again
      '2026-09-30T19:46:00+00:00|GET|200|300475|-|-|-', // no place: never grouped
      '2026-09-30T19:46:00+00:00|GET|200|300475|-|-|-',
    ]);
    w.check();
    expect(sent).toEqual([
      'limit.zip downloaded · from Warsaw, Mazovia, PL · 1st today (ET)',
      'limit.zip downloaded · from Villerupt, Grand Est, FR · 2nd today (ET)',
      'limit.zip downloaded again · from Villerupt, Grand Est, FR (same place within 10 min, not counted)',
      'limit.zip downloaded · from Villerupt, Grand Est, FR · 3rd today (ET)',
      'limit.zip downloaded · 4th today (ET)',
      'limit.zip downloaded · 5th today (ET)',
    ]);
  });

  it('applies the same grouping to the silent catch-up, so the count survives a restart', () => {
    const sent: string[] = [];
    const source = new Batches([
      ['2026-09-30T19:23:29+00:00|GET|200|1|PL|Mazovia|Warsaw', '2026-09-30T19:23:29+00:00|GET|200|1|PL|Mazovia|Warsaw'],
      [],
    ]);
    const w = new DownloadWatcher(source, (t) => sent.push(t), () => undefined, () => Date.parse('2026-09-30T20:00:00Z'), 60_000);
    w.start();
    w.stop();
    source.batches.push(['2026-09-30T20:00:00+00:00|GET|200|1|US|Florida|Tampa']);
    w.check();
    expect(sent).toEqual(['limit.zip downloaded · from Tampa, Florida, US · 2nd today (ET)']);
  });

  it('reports read errors and keeps going', () => {
    const errors: unknown[] = [];
    const source = new (class extends LineSourcePort { readNew(): string[] { throw new Error('EACCES'); } })();
    const w = new DownloadWatcher(source, () => undefined, (e) => errors.push(e));
    expect(w.check()).toBe(0);
    expect(errors).toHaveLength(1);
  });
});

describe('FileTailAdapter', () => {
  it('returns the backlog first, then appended complete lines, and starts over after truncation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tail-'));
    const file = join(dir, 'downloads.log');
    try {
      const tail = new FileTailAdapter(file);
      expect(tail.readNew()).toEqual([]); // missing
      writeFileSync(file, 'a\nb\n');
      expect(tail.readNew()).toEqual(['a', 'b']);
      appendFileSync(file, 'c\npart');
      expect(tail.readNew()).toEqual(['c']);
      appendFileSync(file, 'ial\n');
      expect(tail.readNew()).toEqual(['partial']);
      expect(tail.readNew()).toEqual([]);
      writeFileSync(file, 'new\n'); // replaced by a shorter file
      expect(tail.readNew()).toEqual(['new']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
