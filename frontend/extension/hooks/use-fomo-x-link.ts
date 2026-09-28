/**
 * @file use-fomo-x-link.ts
 * @description The X link fomo shows for the page's token (its "Twitter" button), for the Limit panel: fomo knows
 *              links the server can't find (no on-chain metadata or DexScreener listing, e.g. fresh pons coins).
 *              Re-read every few seconds while mounted, because fomo draws the token details after the page loads.
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { readTokenXLink } from '@/lib/fomo-dom';
import { parseXLink, type XLink } from '@/lib/x-link';

/** The page token's X account / community per fomo, or null. */
export function useFomoXLink(mint: string | null, everyMs = 3_000): XLink | null {
  const [link, setLink] = useState<XLink | null>(null);
  useEffect(() => {
    const read = (): void => {
      const href = readTokenXLink(document);
      const next = href ? parseXLink(href) : null;
      setLink((prev) => (prev?.url === next?.url && prev?.kind === next?.kind ? prev : next));
    };
    read();
    const t = setInterval(read, everyMs);
    return () => clearInterval(t);
  }, [mint, everyMs]);
  return link;
}
