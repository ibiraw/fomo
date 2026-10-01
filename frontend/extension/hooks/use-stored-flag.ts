/**
 * @file use-stored-flag.ts
 * @description An on/off setting in extension storage (storage.local), live across the popup and content scripts.
 * @author Reborn1987
 */

import { useCallback, useEffect, useState } from 'react';

/** Current value of `key` (parsed with `parse`) and a saver. */
export function useStoredFlag(key: string, parse: (v: unknown) => boolean, initial: boolean): [boolean, (on: boolean) => Promise<void>] {
  const [on, setOn] = useState(initial);
  useEffect(() => {
    let alive = true;
    void browser.storage.local.get(key).then((s) => { if (alive) setOn(parse(s[key])); });
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
      if (area === 'local' && key in changes) setOn(parse(changes[key]!.newValue));
    };
    browser.storage.onChanged.addListener(listener);
    return () => { alive = false; browser.storage.onChanged.removeListener(listener); };
  }, [key, parse]);
  const save = useCallback(async (v: boolean) => {
    setOn(v);
    await browser.storage.local.set({ [key]: v });
  }, [key]);
  return [on, save];
}
