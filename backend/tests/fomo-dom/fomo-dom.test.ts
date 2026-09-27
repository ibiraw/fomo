/**
 * @file fomo-dom.test.ts
 * @description fomo page-layout overrides: schema (data only, strict, bounded), the watched JSON file (valid edits go
 *              live, invalid ones are reported and the last good version stays, deleting clears), and polling.
 * @author Reborn1987
 */

import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileFomoDomAdapter } from '../../src/adapters/config/file-fomo-dom.adapter.js';
import { parseFomoDomOverrides } from '../../src/core/fomo-dom/fomo-dom-overrides.js';

describe('parseFomoDomOverrides', () => {
  it('accepts partial overrides and treats {} as none', () => {
    expect(parseFomoDomOverrides('{"amountInput":"input[name=amount]","tabLabels":{"buy":"Acheter","sell":"Vendre"}}'))
      .toEqual({ ok: true, overrides: { amountInput: 'input[name=amount]', tabLabels: { buy: 'Acheter', sell: 'Vendre' } } });
    expect(parseFomoDomOverrides('{}')).toEqual({ ok: true, overrides: null });
  });

  it('rejects bad JSON, unknown fields, code-like class names, multi-line and out-of-range values', () => {
    for (const bad of [
      'not json',
      '{"amountInpt":"x"}', // typo → reported, not ignored
      '{"tabBaseClasses":"x\\" onclick=\\"alert(1)"}',
      '{"supplyLabel":"a\\nb"}',
      '{"sellPresets":[150]}',
      '{"failureWords":[]}',
      '{"submitClasses":["two classes"]}',
      '{"tabLabels":{"buy":"Buy"}}',
      '[]',
    ]) {
      const r = parseFomoDomOverrides(bad);
      expect(r.ok, bad).toBe(false);
    }
  });
});

describe('FileFomoDomAdapter', () => {
  let dir: string;
  let file: string;
  let errors: unknown[];
  /** Writes the file and bumps its mtime so the change is always seen. */
  const write = (json: string, t: number): void => {
    writeFileSync(file, json);
    utimesSync(file, t, t);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'limit-fomo-dom-'));
    file = join(dir, 'fomo-dom.json');
    errors = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty without a file, goes live on a valid edit, keeps the last good version on a bad one, clears on delete', () => {
    const src = new FileFomoDomAdapter(file, (e) => errors.push(e));
    expect(src.current()).toBeNull();
    expect(src.reload()).toBe(false);

    write('{"notification":"div.toast"}', 1_000);
    expect(src.reload()).toBe(true);
    expect(src.current()).toEqual({ notification: 'div.toast' });
    expect(src.reload()).toBe(false); // unchanged

    write('{"notification": ', 2_000);
    expect(src.reload()).toBe(false);
    expect(src.current()).toEqual({ notification: 'div.toast' });
    expect(String(errors[0])).toMatch(/not applied .*previous version stays live/);

    unlinkSync(file);
    expect(src.reload()).toBe(true);
    expect(src.current()).toBeNull();
  });

  it('reads an existing file at start and polls for changes', () => {
    write('{"supplyLabel":"Offre"}', 1_000);
    vi.useFakeTimers();
    const src = new FileFomoDomAdapter(file, (e) => errors.push(e), 1_000);
    expect(src.current()).toEqual({ supplyLabel: 'Offre' });
    const seen: unknown[] = [];
    src.start((o) => seen.push(o));
    write('{"supplyLabel":"Supply2"}', 5_000);
    vi.advanceTimersByTime(1_000);
    expect(seen).toEqual([{ supplyLabel: 'Supply2' }]);
    src.stop();
    write('{"supplyLabel":"Later"}', 9_000);
    vi.advanceTimersByTime(5_000);
    expect(seen).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});
