/**
 * @file use-default-tab.ts
 * @description Which trade tab a fomo token page opens on: fomo's own Buy tab, or the Limit tab.
 * @author Reborn1987
 */

import { useCallback, useEffect, useState } from 'react';

export type DefaultTab = 'buy' | 'limit';
export const DEFAULT_TAB_KEY = 'defaultTab';

/** Normalizes a stored value (anything unknown means fomo's default, Buy). */
export function parseDefaultTab(v: unknown): DefaultTab {
  return v === 'limit' ? 'limit' : 'buy';
}

/** Reads the stored choice. */
export async function loadDefaultTab(): Promise<DefaultTab> {
  const s = await browser.storage.local.get(DEFAULT_TAB_KEY);
  return parseDefaultTab(s[DEFAULT_TAB_KEY]);
}

/** Calls `cb` when the choice changes anywhere; returns an unsubscribe. */
export function onDefaultTabChange(cb: (t: DefaultTab) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area === 'local' && DEFAULT_TAB_KEY in changes) cb(parseDefaultTab(changes[DEFAULT_TAB_KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Current choice and a setter that saves it. */
export function useDefaultTab(): [DefaultTab, (t: DefaultTab) => Promise<void>] {
  const [tab, setTab] = useState<DefaultTab>('buy');
  useEffect(() => {
    let alive = true;
    void loadDefaultTab().then((t) => { if (alive) setTab(t); });
    const off = onDefaultTabChange(setTab);
    return () => { alive = false; off(); };
  }, []);
  const choose = useCallback(async (t: DefaultTab) => {
    await browser.storage.local.set({ [DEFAULT_TAB_KEY]: t });
  }, []);
  return [tab, choose];
}
