/**
 * @file use-theme.ts
 * @description The user's chosen theme, stored in extension storage and shared live between the popup,
 *              the Limit panel and every fomo tab.
 * @author Reborn1987
 */

import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_THEME, themeById, type Theme } from '@/lib/themes';

export const THEME_KEY = 'theme';

/** Reads the stored theme id. */
export async function loadTheme(): Promise<Theme> {
  const s = await browser.storage.local.get(THEME_KEY);
  return themeById(s[THEME_KEY]);
}

/** Calls `cb` whenever the stored theme changes (in any tab or the popup); returns an unsubscribe. */
export function onThemeChange(cb: (t: Theme) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area === 'local' && THEME_KEY in changes) cb(themeById(changes[THEME_KEY]!.newValue));
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
