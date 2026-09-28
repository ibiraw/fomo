/**
 * @file fomo-dom-overrides.ts
 * @description Schema of the fomo page-layout overrides the server sends to every extension (`fomoDom` in the welcome,
 *              pushed on change). The extension has built-in values for all of these (frontend/extension/lib/
 *              fomo-dom-config.ts); an override only lists what fomo changed. Plain data only — selectors, labels,
 *              class names and words — never code, so it stays within Chrome Web Store policy. The extension
 *              re-validates every field; this check stops a bad edit from being broadcast at all.
 * @author Reborn1987
 */

import { z } from 'zod';

/** One bounded, single-line value. */
const Text = z.string().trim().min(1).max(300).regex(/^[^\r\n]*$/, 'must be one line');
/** CSS class names only. */
const Classes = Text.regex(/^[\w\-:./[\]% ]+$/, 'only CSS class names');
const Pair = z.object({ buy: Text, sell: Text }).strict();
const Words = z.array(Text).min(1).max(20);

/** Every field optional; unknown fields rejected so a typo is noticed instead of silently ignored. */
export const FomoDomOverridesSchema = z
  .object({
    tabLabels: Pair,
    amountInput: Text,
    inactiveTabClass: Classes,
    lastPreset: Pair,
    sellPresets: z.array(z.number().positive().max(100)).min(1).max(10),
    submitClasses: z.array(Text.regex(/^[\w\-:./[\]%]+$/, 'one CSS class per entry')).min(1).max(10),
    notification: Text,
    failureWords: Words,
    slippageWords: Words,
    supplyLabel: Text,
    ownProfileLink: Text,
    profilePathPrefix: Text,
    tabBaseClasses: Classes,
    tabInactiveClasses: Classes,
    reloadLabels: Words,
    newVersionWords: Words,
    spotBuyPrefixes: Words,
    spotSellPrefixes: Words,
    positionsHeader: Text,
    launchpadIcon: Text,
    quickTradeTabs: Words,
    sideTabInactiveClass: Classes,
    feedItem: Text,
  })
  .partial()
  .strict();

export type FomoDomOverrides = z.infer<typeof FomoDomOverridesSchema>;

/** Result of checking an overrides file (Service Result pattern). */
export type FomoDomParse =
  | { readonly ok: true; readonly overrides: FomoDomOverrides | null }
  | { readonly ok: false; readonly error: string };

/** Validates the contents of an overrides file. An empty object means "no overrides". */
export function parseFomoDomOverrides(json: string): FomoDomParse {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const parsed = FomoDomOverridesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`).join('; ') };
  return { ok: true, overrides: Object.keys(parsed.data).length > 0 ? parsed.data : null };
}
