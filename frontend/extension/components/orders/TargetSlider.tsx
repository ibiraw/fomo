/**
 * @file TargetSlider.tsx
 * @description −100%…+100% slider (relative to the current market cap/price) plus a % box.
 * @author Reborn1987
 */

import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface Props {
  /** Percent change from the current value. */
  readonly percent: number;
  readonly onChange: (percent: number) => void;
}

/** Lowest allowed change: −100% would mean a target of 0. */
export const MIN_PERCENT = -99;
export const MAX_PERCENT = 100;
const TICKS = [-100, -50, 0, 50, 100];

/** Clamps and rounds a percent to the slider range. */
export function clampPercent(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, Math.round(v)));
}

/** Slider with tick labels and an editable % box. */
export function TargetSlider({ percent, onChange }: Props) {
  return (
    <div className="grid grid-cols-[1fr_4.5rem] items-center gap-3">
      <div className="space-y-1.5 pt-1">
        <Slider
          min={MIN_PERCENT}
          max={MAX_PERCENT}
          step={1}
          value={[clampPercent(percent)]}
          onValueChange={([v]) => onChange(v ?? 0)}
          className="[&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-buy [&_[data-slot=slider-track]]:bg-accent"
        />
        <div className="flex justify-between">
          {TICKS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange(clampPercent(t))}
              title={t === -100 ? 'Sets −99% (a target of $0 is not possible)' : `Set ${t > 0 ? '+' : ''}${t}%`}
              className={cn(
                'rounded bg-accent px-1.5 py-0.5 text-[10px] transition-colors hover:bg-foreground/15 hover:text-foreground',
                clampPercent(t) === clampPercent(percent) ? 'font-semibold text-foreground ring-1 ring-foreground/30' : 'text-muted-foreground',
              )}
            >
              {t > 0 ? `+${t}` : t}%
            </button>
          ))}
        </div>
      </div>
      <label className="flex h-9 items-center rounded-lg bg-secondary px-2 focus-within:ring-1 focus-within:ring-ring">
        <input
          aria-label="Change from current, percent"
          inputMode="numeric"
          value={String(percent)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9-]/g, '');
            onChange(raw === '' || raw === '-' ? 0 : clampPercent(Number(raw)));
          }}
          className="w-full min-w-0 bg-transparent text-right text-sm text-foreground outline-none"
        />
        <span className="pl-1 text-xs text-muted-foreground">%</span>
      </label>
    </div>
  );
}
