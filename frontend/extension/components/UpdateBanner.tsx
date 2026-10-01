/**
 * @file UpdateBanner.tsx
 * @description "Update available" at the top of the popup when limit.family has a newer build than this copy (the
 *              server's `release.latestExtension`). Unpacked extensions can't update themselves, so it spells out the
 *              three steps: download, replace the folder, reload.
 * @author Reborn1987
 */

import { Download } from 'lucide-react';

import { updateAvailable, type ReleaseView } from '@/lib/release';

/** The download section of the site. */
const DOWNLOAD_URL = 'https://limit.family/#get';

/** Banner with the steps; renders nothing when this copy is up to date. */
export function UpdateBanner({ release }: { release: ReleaseView }) {
  const current = browser.runtime.getManifest().version;
  const newer = updateAvailable(release, current);
  if (!newer) return null;
  return (
    <div className="space-y-2 rounded-md border border-[#516af6]/50 bg-[#516af6]/10 p-3 text-xs">
      <p className="text-sm font-semibold">limit {newer} is out <span className="font-normal text-muted-foreground">· you have {current}</span></p>
      <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
        <li>Download the new zip from limit.family and unzip it.</li>
        <li>Replace your current limit folder with the new one (same place, same name).</li>
        <li>Open your extensions page (<code>chrome://extensions</code> or <code>brave://extensions</code>) and click reload on limit.</li>
      </ol>
      <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-[#516af6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#516af6]/90">
        <Download className="size-3.5" aria-hidden /> Download {newer}
      </a>
      <p className="text-[11px] text-muted-foreground">Keep the folder in the same place and use reload (not "Load unpacked" again): that way limit keeps your account, orders and settings.</p>
    </div>
  );
}
