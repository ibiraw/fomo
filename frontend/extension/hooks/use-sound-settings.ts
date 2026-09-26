/**
 * @file use-sound-settings.ts
 * @description Order sounds on/off + volume, stored in extension storage and shared by the popup and background.
 * @author Reborn1987
 */

import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_SOUND_SETTINGS, loadSoundSettings, parseSoundSettings, SOUND_SETTINGS_KEY, type SoundSettings } from '@/lib/sounds';

/** Current setting and a saver (merges partial changes). */
export function useSoundSettings(): [SoundSettings, (patch: Partial<SoundSettings>) => Promise<void>] {
  const [settings, setSettings] = useState<SoundSettings>(DEFAULT_SOUND_SETTINGS);
  useEffect(() => {
    let alive = true;
    void loadSoundSettings().then((s) => { if (alive) setSettings(s); });
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
      if (area === 'local' && SOUND_SETTINGS_KEY in changes) setSettings(parseSoundSettings(changes[SOUND_SETTINGS_KEY]!.newValue));
    };
    browser.storage.onChanged.addListener(listener);
    return () => { alive = false; browser.storage.onChanged.removeListener(listener); };
  }, []);
  const save = useCallback(async (patch: Partial<SoundSettings>) => {
    const next = parseSoundSettings({ ...(await loadSoundSettings()), ...patch });
    setSettings(next);
    await browser.storage.local.set({ [SOUND_SETTINGS_KEY]: next });
  }, []);
  return [settings, save];
}
