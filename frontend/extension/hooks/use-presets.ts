/**
 * @file use-presets.ts
 * @description Editable amount presets per side and unit, persisted in extension storage.
 * @author Reborn1987
 */

import { useCallback, useEffect, useState } from 'react';

import type { OrderSide } from '@/lib/types';

export type AmountUnit = 'usd' | 'percent';

/** Defaults mirror FOMO's own presets ($25–$100 buys, 10–100% sells). */
export const DEFAULT_PRESETS: Record<OrderSide, Record<AmountUnit, number[]>> = {
  buy: { usd: [25, 50, 75, 100], percent: [10, 25, 50, 100] },
  sell: { usd: [10, 25, 50, 100], percent: [10, 25, 50, 100] },
};

/** Storage key for one side/unit preset list. */
export function presetKey(side: OrderSide, unit: AmountUnit): string {
  return `presets.${side}.${unit}`;
}

/** Keeps 4 positive finite numbers; falls back to defaults for anything invalid. */
export function sanitizePresets(values: unknown, fallback: number[]): number[] {
  if (!Array.isArray(values) || values.length !== fallback.length) return fallback;
  return values.map((v, i) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback[i]!));
}

/** Presets for the given side/unit and a saver. */
export function usePresets(side: OrderSide, unit: AmountUnit): { presets: number[]; save: (values: number[]) => Promise<void> } {
  const fallback = DEFAULT_PRESETS[side][unit];
  const [presets, setPresets] = useState(fallback);
  const key = presetKey(side, unit);

  useEffect(() => {
    let alive = true;
    setPresets(fallback);
    void browser.storage.local.get(key).then((s) => { if (alive) setPresets(sanitizePresets(s[key], fallback)); });
    return () => { alive = false; };
  }, [key, fallback]);

  const save = useCallback(async (values: number[]) => {
    const clean = sanitizePresets(values, fallback);
    await browser.storage.local.set({ [key]: clean });
    setPresets(clean);
  }, [key, fallback]);

  return { presets, save };
}
