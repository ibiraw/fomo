/**
 * @file use-release.ts
 * @description The account's version and features (from the server, via storage), live in the popup and Limit panel.
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { BASE_RELEASE, loadRelease, onReleaseChange, type ReleaseView } from '@/lib/release';

/** Current release; the base release (v1.0) until it has loaded. */
export function useRelease(): ReleaseView {
  const [release, setRelease] = useState<ReleaseView>(BASE_RELEASE);
  useEffect(() => {
    let alive = true;
    void loadRelease().then((r) => { if (alive) setRelease(r); });
    const off = onReleaseChange(setRelease);
    return () => { alive = false; off(); };
  }, []);
  return release;
}
