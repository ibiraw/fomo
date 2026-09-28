/**
 * @file release.ts
 * @description Staged releases: the server tells each account which version it is on and which features that version
 *              has (`release` in the welcome, pushed when it changes). The background stores it (storage.local.release)
 *              so the popup, the Limit panel and fomo tabs all follow it live. Until the server has said otherwise,
 *              only v1.0 (limit orders) shows — a feature never flashes up for someone who doesn't have it.
 * @author Reborn1987
 */

/** A feature switched on by a release (mirror of backend/src/core/releases/releases.ts). */
export type Feature = 'themes' | 'sounds' | 'xPost' | 'launchpad' | 'tokenMetrics';

/** What this account sees. */
export interface ReleaseView {
  readonly version: string;
  readonly features: readonly Feature[];
  /** Early access (friends): every feature built so far. */
  readonly early: boolean;
}

export const RELEASE_STORAGE_KEY = 'release';

/** Shown before the server has told us anything: the first version, no extras. */
export const BASE_RELEASE: ReleaseView = { version: '1.0', features: [], early: false };

const FEATURES: readonly Feature[] = ['themes', 'sounds', 'xPost', 'launchpad', 'tokenMetrics'];

/** The stored value as a release view (anything malformed → the base release). */
export function toRelease(value: unknown): ReleaseView {
  if (!value || typeof value !== 'object') return BASE_RELEASE;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== 'string' || !/^\d+\.\d+$/.test(v.version) || !Array.isArray(v.features)) return BASE_RELEASE;
  return {
    version: v.version,
    features: v.features.filter((f): f is Feature => FEATURES.includes(f as Feature)),
    early: v.early === true,
  };
}

/** True when the release includes the feature. */
export function hasFeature(release: ReleaseView, feature: Feature): boolean {
  return release.features.includes(feature);
}

/** Reads the stored release. */
export async function loadRelease(): Promise<ReleaseView> {
  const s = await browser.storage.local.get(RELEASE_STORAGE_KEY);
  return toRelease(s[RELEASE_STORAGE_KEY]);
}

/** Calls `cb` whenever the stored release changes; returns an unsubscribe. */
export function onReleaseChange(cb: (r: ReleaseView) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area === 'local' && RELEASE_STORAGE_KEY in changes) cb(toRelease(changes[RELEASE_STORAGE_KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
