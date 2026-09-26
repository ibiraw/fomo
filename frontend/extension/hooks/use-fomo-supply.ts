/**
 * @file use-fomo-supply.ts
 * @description Keeps the token supply shown on the fomo page (used to compute market cap exactly like fomo).
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { readSupply } from '@/lib/fomo-dom';

/** fomo's displayed supply for the current page, re-read when the page changes. */
export function useFomoSupply(mint: string | null): number | null {
  const [supply, setSupply] = useState<number | null>(() => readSupply(document));
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const update = (): void => { pending = null; setSupply(readSupply(document)); };
    update();
    const obs = new MutationObserver(() => { if (!pending) pending = setTimeout(update, 500); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { obs.disconnect(); if (pending) clearTimeout(pending); };
  }, [mint]);
  return supply;
}
