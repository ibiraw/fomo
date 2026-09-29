/**
 * @file download-watcher.ts
 * @description Tells the owner when someone downloads the extension from the website. nginx writes one line per
 *              request for /limit.zip ("<ISO time>|<method>|<status>|<body bytes>|<country>|<region>|<city>", from
 *              Cloudflare's location headers, see deploy/nginx.conf; older lines are space-separated without region
 *              and city); completed downloads (GET, 200, bytes sent) become
 *              "limit.zip downloaded · from Toronto, Ontario, CA · 2nd today (ET)".
 *              HEAD checks, partial/ranged requests and errors are skipped. "Today" is US Eastern, the owner's day, by
 *              each line's own time; on start the existing log is read silently so the count survives restarts.
 * @author Reborn1987
 */

import type { LineSourcePort } from '../../ports/line-source.js';

/** One completed download read from the log, or null for anything else. */
export function parseDownload(line: string): { readonly at: number | null; readonly place: string | null } | null {
  const raw = line.trim();
  const [time, method, status, bytes, country, region, city] = raw.includes('|') ? raw.split('|') : raw.split(/\s+/);
  if (method !== 'GET' || status !== '200' || !(Number(bytes) > 0)) return null;
  const at = Date.parse(time ?? '');
  const known = (s: string | undefined): string | null => {
    const v = (s ?? '').trim();
    return v && v !== '-' && v.length <= 60 && !/[<>|]/.test(v) ? v : null;
  };
  const cc = country && /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'T1' ? country : null;
  const parts = [known(city), known(region), cc].filter((p): p is string => p !== null);
  return { at: Number.isFinite(at) ? at : null, place: parts.length ? parts.join(', ') : null };
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export class DownloadWatcher {
  private timer: NodeJS.Timeout | null = null;
  private day = '';
  private count = 0;

  /**
   * @param source the download log @param notify sends one message to the owner @param onError sink for read errors
   * @param now clock @param pollMs how often the log is checked
   */
  constructor(
    private readonly source: LineSourcePort,
    private readonly notify: (text: string) => void,
    private readonly onError: (err: unknown) => void,
    private readonly now: () => number = Date.now,
    private readonly pollMs = 10_000,
  ) {}

  /** Counts today's downloads already in the log (no messages), then starts checking it. */
  start(): void {
    while (this.check(false) > 0); // the whole backlog, however many reads it takes
    this.timer = setInterval(() => this.check(), this.pollMs);
    this.timer.unref?.();
  }

  /** Stops checking. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Reads new log lines and counts (and, unless `announce` is false, announces) each completed download.
   * Returns how many lines were read.
   */
  check(announce = true): number {
    let lines: string[];
    try {
      lines = this.source.readNew();
    } catch (err) {
      this.onError(err);
      return 0;
    }
    for (const line of lines) {
      const d = parseDownload(line);
      if (!d) continue;
      const day = ET_DAY.format(d.at ?? this.now());
      if (day < this.day) continue; // an older day's line (only while catching up)
      if (day !== this.day) { this.day = day; this.count = 0; }
      this.count++;
      if (announce) this.notify(`limit.zip downloaded${d.place ? ` · from ${d.place}` : ''} · ${ordinal(this.count)} today (ET)`);
    }
    return lines.length;
  }
}
