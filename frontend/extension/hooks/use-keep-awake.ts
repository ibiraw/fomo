/**
 * @file use-keep-awake.ts
 * @description The "Keep computer awake" setting, stored in extension storage and followed by the background.
 * @author Reborn1987
 */

import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_KEEP_AWAKE, KEEP_AWAKE_KEY, loadKeepAwake, parseKeepAwake } from '@/lib/keep-awake';

/** Current setting and a saver. */
export function useKeepAwake(): [boolean, (on: boolean) => Promise<void>] {
  const [on, setOn] = useState(DEFAULT_KEEP_AWAKE);
  useEffect(() => {
    let alive = true;
    void loadKeepAwake().then((v) => { if (alive) setOn(v); });
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
      if (area === 'local' && KEEP_AWAKE_KEY in changes) setOn(parseKeepAwake(changes[KEEP_AWAKE_KEY]!.newValue));
    };
    browser.storage.onChanged.addListener(listener);
    return () => { alive = false; browser.storage.onChanged.removeListener(listener); };
  }, []);
  const save = useCallback(async (v: boolean) => {
    setOn(v);
    await browser.storage.local.set({ [KEEP_AWAKE_KEY]: v });
  }, []);
  return [on, save];
}
