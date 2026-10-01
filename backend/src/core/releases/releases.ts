/**
 * @file releases.ts
 * @description Staged releases: everyone runs the same extension, and the server tells each account which version it
 *              is on and which features that version has. The public version is raised by editing the access file
 *              (DATA_DIR/access.json); early-access accounts (friends, testers) always get every feature built so far.
 *
 *              v1.0.0  limit orders (limit, breakout, take profit, stop loss) on every chain
 *              v1.0.1  extension update: keep the computer awake while orders wait, auto-tick fomo's risk warning
 *                      (setting), sells re-armed when the wallet shows they never sold, 5 tries (no gated features)
 *              v1.0.2  fix: the balance is found with custom fomo presets (e.g. $300 instead of $100)
 *              v1.1.0  themes and order sounds
 *              v1.2.0  the token's latest X post
 *              v1.3.0  which launchpad a token came from
 *              v1.4.0  token metrics (top 10 holders' share, dev holdings)
 *              v2.0.0  quick Buy/Sell buttons in fomo's Feed and Alerts (trade right away)
 *              Fixes between releases would be 1.0.1, 1.0.2 … (same features).
 * @author Reborn1987
 */

import { z } from 'zod';

/** A feature that can be switched on by a release. */
export type Feature = 'themes' | 'sounds' | 'xPost' | 'launchpad' | 'tokenMetrics' | 'quickTrade';

/** Every version in order, with the features it adds. */
export const RELEASES: readonly { readonly version: string; readonly adds: readonly Feature[] }[] = [
  { version: '1.0.0', adds: [] },
  { version: '1.0.1', adds: [] },
  { version: '1.0.2', adds: [] },
  { version: '1.1.0', adds: ['themes', 'sounds'] },
  { version: '1.2.0', adds: ['xPost'] },
  { version: '1.3.0', adds: ['launchpad'] },
  { version: '1.4.0', adds: ['tokenMetrics'] },
  { version: '2.0.0', adds: ['quickTrade'] },
];

export const FIRST_VERSION = RELEASES[0]!.version;
export const LATEST_VERSION = RELEASES[RELEASES.length - 1]!.version;
const VERSIONS = RELEASES.map((r) => r.version);

/** Features of a version: everything added up to and including it. */
export function featuresOf(version: string): Feature[] {
  const upTo = VERSIONS.indexOf(version);
  if (upTo < 0) throw new Error(`Unknown version ${version}`);
  return RELEASES.slice(0, upTo + 1).flatMap((r) => r.adds);
}

/** The version that adds a feature. */
export function versionOf(feature: Feature): string {
  return RELEASES.find((r) => r.adds.includes(feature))!.version;
}

/** What one account sees. */
export interface ReleaseView {
  /** Version shown to the user ("1.0.0"). */
  readonly version: string;
  readonly features: readonly Feature[];
  /** Early access: every feature built so far, before it is public. */
  readonly early: boolean;
}

/** Who sees what, and who uses limit for free until when. Short ids like "LM-7K3Q2P". */
export interface AccessConfig {
  readonly publicVersion: string;
  readonly earlyAccess: readonly string[];
  /** Short id → last free day ("2026-11-01", free through the end of that day, UTC). */
  readonly freeUntil: Readonly<Record<string, string>>;
}

/** Used when there is no access file: the first version for everyone, no early access, nobody free. */
export const DEFAULT_ACCESS: AccessConfig = { publicVersion: FIRST_VERSION, earlyAccess: [], freeUntil: {} };

const ShortId = z.string().regex(/^LM-[0-9A-Z]{6}$/, 'a limit ID like LM-7K3Q2P');
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date like 2026-11-01').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'not a real date');

const AccessSchema = z
  .object({
    publicVersion: z.enum(VERSIONS as [string, ...string[]]),
    earlyAccess: z.array(ShortId).max(500).default([]),
    freeUntil: z.record(ShortId, Day).default({}),
  })
  .strict();

export type ParsedAccess = { readonly ok: true; readonly config: AccessConfig } | { readonly ok: false; readonly error: string };

/** Validates the access file's text. Unknown fields, unknown versions and malformed ids or dates are rejected. */
export function parseAccessConfig(raw: string): ParsedAccess {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  const r = AccessSchema.safeParse(json);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`).join('; ') };
  return { ok: true, config: r.data };
}

const DAY_MS = 86_400_000;

/**
 * Answers "what does this account see" and "is it free right now" from the current access config.
 * `permanent` accounts (the owner) always have early access.
 */
export class ReleaseService {
  /** @param config current access config @param permanent account ids that always get early access */
  constructor(private readonly config: () => AccessConfig, private readonly permanent: ReadonlySet<string> = new Set()) {}

  /** Version and features for an account. */
  viewFor(account: { readonly id: string; readonly shortId: string }): ReleaseView {
    const c = this.config();
    const early = this.permanent.has(account.id) || c.earlyAccess.includes(account.shortId);
    const version = early ? LATEST_VERSION : c.publicVersion;
    return { version, features: featuresOf(version), early };
  }

  /** End of the account's free period (ms, end of the listed day UTC), or null when it has none. */
  freeUntil(shortId: string): number | null {
    const day = this.config().freeUntil[shortId];
    return day ? Date.parse(`${day}T00:00:00Z`) + DAY_MS : null;
  }
}
