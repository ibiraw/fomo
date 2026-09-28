/**
 * @file use-fomo-launchpad.ts
 * @description The launchpad fomo shows next to the page token's name (its icon), for the Limit panel. Re-read every
 *              few seconds while mounted, because fomo draws the header after the page loads.
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { readLaunchpadName } from '@/lib/fomo-dom';
import { titleSymbol } from '@/lib/fomo-spot-watch';

/** fomo's launchpad name for the page's token ("pons", "stonkfun"), or null. */
export function useFomoLaunchpad(mint: string | null, everyMs = 3_000): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    const read = (): void => {
      const symbol = titleSymbol(document.title);
      setName(symbol ? readLaunchpadName(document, symbol) : null);
    };
    read();
    const t = setInterval(read, everyMs);
    return () => clearInterval(t);
  }, [mint, everyMs]);
  return name;
}
