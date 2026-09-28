/**
 * @file use-fomo-position.ts
 * @description Tokens of the current token the user holds, read from fomo's "Your positions" list on the page (the
 *              Limit panel only; the popup can't see the page). Re-read every few seconds, only while mounted.
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { readPosition } from '@/lib/fomo-positions';
import { titleSymbol } from '@/lib/fomo-spot-watch';

/** Held tokens of the page's token, or null when fomo doesn't show a position for it. */
export function useFomoPosition(mint: string | null, everyMs = 3_000): number | null {
  const [held, setHeld] = useState<number | null>(null);
  useEffect(() => {
    const read = (): void => {
      const symbol = titleSymbol(document.title);
      setHeld(symbol ? (readPosition(document, symbol)?.amount ?? null) : null);
    };
    read();
    const t = setInterval(read, everyMs);
    return () => clearInterval(t);
  }, [mint, everyMs]);
  return held;
}
