/**
 * @file release.test.ts
 * @description Staged releases in the extension: reading the stored release safely, feature checks, and the theme
 *              only applying once the release has themes.
 * @author Reborn1987
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadTheme, THEME_KEY } from '../hooks/use-theme';
import { BASE_RELEASE, hasFeature, loadRelease, onReleaseChange, RELEASE_STORAGE_KEY, toRelease, updateAvailable, type ReleaseView } from '../lib/release';
import { DEFAULT_THEME } from '../lib/themes';

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

/** In-memory browser.storage.local with change events (only what these modules use). */
function fakeStorage() {
  const data: Record<string, unknown> = {};
  const listeners = new Set<Listener>();
  return {
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (items: Record<string, unknown>) => {
          Object.assign(data, items);
          const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
          listeners.forEach((l) => l(changes, 'local'));
        },
      },
      onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
  };
}

beforeEach(() => vi.stubGlobal('browser', fakeStorage()));

describe('toRelease', () => {
  it('keeps known features and falls back to v1.0.0 for anything malformed', () => {
    expect(toRelease({ version: '1.2.0', features: ['themes', 'sounds', 'xPost', 'bogus'], early: true }))
      .toEqual({ version: '1.2.0', features: ['themes', 'sounds', 'xPost'], early: true, latestExtension: null });
    for (const bad of [null, undefined, 'x', { version: 1, features: [] }, { version: '1.1.0' }, { version: '1.1', features: [] }, { version: 'v1', features: [] }]) {
      expect(toRelease(bad)).toBe(BASE_RELEASE);
    }
  });

  it('checks features', () => {
    expect(hasFeature(BASE_RELEASE, 'themes')).toBe(false);
    expect(hasFeature(toRelease({ version: '1.1.0', features: ['themes'] }), 'themes')).toBe(true);
  });
});

describe('stored release', () => {
  it('loads v1.0.0 until the server said otherwise, then follows changes', async () => {
    expect(await loadRelease()).toBe(BASE_RELEASE);
    const seen: ReleaseView[] = [];
    const off = onReleaseChange((r) => seen.push(r));
    await browser.storage.local.set({ [RELEASE_STORAGE_KEY]: { version: '1.1.0', features: ['themes', 'sounds'], early: false } });
    expect(seen.at(-1)).toEqual({ version: '1.1.0', features: ['themes', 'sounds'], early: false, latestExtension: null });
    off();
  });

  it('applies the chosen theme only once the release has themes', async () => {
    await browser.storage.local.set({ [THEME_KEY]: 'gold' });
    expect(await loadTheme()).toBe(DEFAULT_THEME);
    await browser.storage.local.set({ [RELEASE_STORAGE_KEY]: { version: '1.1.0', features: ['themes', 'sounds'], early: false } });
    expect((await loadTheme()).id).toBe('gold');
  });
});

describe('update available', () => {
  const r = (latestExtension: string | null) => ({ ...BASE_RELEASE, latestExtension });
  it('offers a newer build only', () => {
    expect(updateAvailable(r('1.0.3'), '1.0.2')).toBe('1.0.3');
    expect(updateAvailable(r('1.0.3'), '1.0.3')).toBeNull();
    expect(updateAvailable(r('1.0.3'), '1.1.0')).toBeNull();
    expect(updateAvailable(r('1.10.0'), '1.9.9')).toBe('1.10.0');
    expect(updateAvailable(r(null), '1.0.0')).toBeNull();
  });
  it('reads latestExtension from the server, ignoring junk', () => {
    expect(toRelease({ version: '1.0.2', features: [], latestExtension: '1.0.3' }).latestExtension).toBe('1.0.3');
    expect(toRelease({ version: '1.0.2', features: [], latestExtension: 'soon' }).latestExtension).toBeNull();
  });
});
