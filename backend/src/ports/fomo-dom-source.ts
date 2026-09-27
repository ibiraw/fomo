/**
 * @file fomo-dom-source.ts
 * @description FomoDomSourcePort — where the fomo page-layout overrides come from (a JSON file on the server today).
 * @author Reborn1987
 */

import type { FomoDomOverrides } from '../core/fomo-dom/fomo-dom-overrides.js';

export abstract class FomoDomSourcePort {
  /** Current overrides, or null when there are none (extensions use their built-ins). */
  abstract current(): FomoDomOverrides | null;

  /** Starts watching; `onChange` fires with the new overrides after every valid change. */
  abstract start(onChange: (overrides: FomoDomOverrides | null) => void): void;

  /** Stops watching. */
  abstract stop(): void;
}
