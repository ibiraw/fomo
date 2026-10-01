/**
 * @file releases.test.ts
 * @description Staged releases: features per version, the access file's schema, what each account sees (public,
 *              early access by limit ID, the owner), free-until dates, and the watched access file.
 * @author Reborn1987
 */

import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileAccessConfigAdapter } from '../../src/adapters/config/file-access-config.adapter.js';
import {
  DEFAULT_ACCESS, featuresOf, LATEST_VERSION, parseAccessConfig, ReleaseService, type AccessConfig,
} from '../../src/core/releases/releases.js';

describe('featuresOf', () => {
  it('adds each version on top of the earlier ones', () => {
    expect(featuresOf('1.0.0')).toEqual([]);
    expect(featuresOf('1.1.0')).toEqual(['themes', 'sounds']);
    expect(featuresOf('1.2.0')).toEqual(['themes', 'sounds', 'xPost']);
    expect(featuresOf(LATEST_VERSION)).toEqual(['themes', 'sounds', 'xPost', 'launchpad', 'tokenMetrics', 'quickTrade']);
    expect(() => featuresOf('1.5.0')).toThrow(/Unknown version/);
  });
});

describe('parseAccessConfig', () => {
  it('accepts a full file and fills in the optional lists', () => {
    expect(parseAccessConfig('{"publicVersion":"1.1.0","earlyAccess":["LM-7K3Q2P"],"freeUntil":{"LM-7K3Q2P":"2026-11-01"}}'))
      .toEqual({ ok: true, config: { publicVersion: '1.1.0', earlyAccess: ['LM-7K3Q2P'], freeUntil: { 'LM-7K3Q2P': '2026-11-01' } } });
    expect(parseAccessConfig('{"publicVersion":"1.0.0"}')).toEqual({ ok: true, config: DEFAULT_ACCESS });
  });

  it('rejects bad JSON, unknown versions or fields, malformed ids and impossible dates', () => {
    for (const bad of [
      'nope',
      '{}',
      '{"publicVersion":"1.5.0"}',
      '{"publicVersion":"1.0.0","earlyAcess":[]}', // typo → reported, not ignored
      '{"publicVersion":"1.0.0","earlyAccess":["lm-7k3q2p"]}',
      '{"publicVersion":"1.0.0","freeUntil":{"LM-7K3Q2P":"next week"}}',
      '{"publicVersion":"1.0.0","freeUntil":{"LM-7K3Q2P":"2026-13-45"}}',
    ]) {
      expect(parseAccessConfig(bad).ok, bad).toBe(false);
    }
  });
});

describe('ReleaseService', () => {
  const config: AccessConfig = { publicVersion: '1.1.0', earlyAccess: ['LM-FR1END'], freeUntil: { 'LM-FR1END': '2026-11-01' } };
  const releases = new ReleaseService(() => config, new Set(['legacy']));

  it('gives the public version to everyone, and every feature to early access and the owner', () => {
    expect(releases.viewFor({ id: 'u1', shortId: 'LM-ABC123' })).toEqual({ version: '1.1.0', features: ['themes', 'sounds'], early: false, latestExtension: null });
    expect(releases.viewFor({ id: 'u2', shortId: 'LM-FR1END' })).toEqual({ version: LATEST_VERSION, features: featuresOf(LATEST_VERSION), early: true, latestExtension: null });
    expect(releases.viewFor({ id: 'legacy', shortId: 'LM-WFA346' }).early).toBe(true);
  });

  it('passes the newest extension build on to everyone, and rejects a malformed one', () => {
    const withLatest = new ReleaseService(() => ({ ...config, latestExtension: '1.0.3' }));
    expect(withLatest.viewFor({ id: 'u1', shortId: 'LM-ABC123' }).latestExtension).toBe('1.0.3');
    expect(parseAccessConfig('{"publicVersion":"1.0.0","latestExtension":"1.0.3"}')).toMatchObject({ ok: true, config: { latestExtension: '1.0.3' } });
    expect(parseAccessConfig('{"publicVersion":"1.0.0","latestExtension":"v1"}')).toMatchObject({ ok: false });
  });

  it('makes a free-until day last through its end (UTC)', () => {
    expect(releases.freeUntil('LM-FR1END')).toBe(Date.parse('2026-11-02T00:00:00Z'));
    expect(releases.freeUntil('LM-ABC123')).toBeNull();
  });
});

describe('FileAccessConfigAdapter', () => {
  let dir: string;
  let file: string;
  let errors: unknown[];
  let stamp = 1_700_000_000;
  /** Writes the file with a new mtime (so the change is noticed even within the same second). */
  const write = (text: string): void => {
    writeFileSync(file, text);
    stamp += 10;
    utimesSync(file, stamp, stamp);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'access-'));
    file = join(dir, 'access.json');
    errors = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('uses the defaults without a file, goes live on valid edits, keeps the last good one, and resets on delete', () => {
    const a = new FileAccessConfigAdapter(file, (e) => errors.push(e));
    expect(a.current()).toBe(DEFAULT_ACCESS);
    const changes: AccessConfig[] = [];
    a.start((c) => changes.push(c));
    a.stop();

    write('{"publicVersion":"1.2.0","earlyAccess":["LM-7K3Q2P"]}');
    const b = new FileAccessConfigAdapter(file, (e) => errors.push(e));
    expect(b.current()).toMatchObject({ publicVersion: '1.2.0', earlyAccess: ['LM-7K3Q2P'] });

    write('{"publicVersion":"9.9"}');
    expect(b.reload()).toBe(false);
    expect(b.current().publicVersion).toBe('1.2.0');
    expect(String(errors[0])).toMatch(/not applied/);

    unlinkSync(file);
    expect(b.reload()).toBe(true);
    expect(b.current()).toBe(DEFAULT_ACCESS);
    expect(changes).toEqual([]);
  });
});
