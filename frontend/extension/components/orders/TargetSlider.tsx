/**
 * @file TargetSlider.tsx
 * @description −100%…+100% slider (relative to the current market cap/price) plus a % box.
 * @author Reborn1987
 */

import { Slider } from '@/components/ui/slider';

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
        <div className="flex justify-between text-[10px] text-muted-foreground">
          {TICKS.map((t) => <span key={t}>{t > 0 ? `+${t}` : t}%</span>)}
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
