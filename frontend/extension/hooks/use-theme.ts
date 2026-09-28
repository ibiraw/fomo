/**
 * @file use-theme.ts
 * @description The user's chosen theme, stored in extension storage and shared live between the popup,
 *              the Limit panel and every fomo tab. Applies only once the account's release has themes (v1.2);
 *              before that everything uses the default theme (the choice is kept for later).
 * @author Reborn1987
 */

import { useCallback, useEffect, useState } from 'react';

import { hasFeature, RELEASE_STORAGE_KEY, toRelease } from '@/lib/release';
import { DEFAULT_THEME, themeById, type Theme } from '@/lib/themes';

export const THEME_KEY = 'theme';

/** The theme in effect: the stored choice when the release has themes, else the default. */
export async function loadTheme(): Promise<Theme> {
  const s = await browser.storage.local.get([THEME_KEY, RELEASE_STORAGE_KEY]);
  return hasFeature(toRelease(s[RELEASE_STORAGE_KEY]), 'themes') ? themeById(s[THEME_KEY]) : DEFAULT_THEME;
}

/**
 * Calls `cb` with the theme in effect whenever the stored theme or the release changes (in any tab or the popup);
 * returns an unsubscribe.
 */
export function onThemeChange(cb: (t: Theme) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area === 'local' && (THEME_KEY in changes || RELEASE_STORAGE_KEY in changes)) void loadTheme().then(cb);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Current theme and a setter that saves it. */
export function useTheme(): [Theme, (id: string) => Promise<void>] {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  useEffect(() => {
    let alive = true;
    void loadTheme().then((t) => { if (alive) setTheme(t); });
    const off = onThemeChange(setTheme);
    return () => { alive = false; off(); };
  }, []);
  const choose = useCallback(async (id: string) => {
    await browser.storage.local.set({ [THEME_KEY]: id });
  }, []);
  return [theme, choose];
}
