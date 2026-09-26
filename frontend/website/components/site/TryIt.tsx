/**
 * @file TryIt.tsx
 * @description Small interactive piece of the Limit tab: buy/sell, amount presets and the market-cap
 *              slider, showing how the order type is inferred. Simulated market cap; nothing is traded.
 * @author Reborn1987
 */

'use client';

import { useEffect, useState } from 'react';

import { Slider } from '@/components/ui/slider';
import { usdK } from '@/lib/demo';
import { orderExplainer, orderKind, type Side } from '@/lib/order-kind';
import { cn } from '@/lib/utils';

const PRESETS: Record<Side, { unit: '$' | '%'; values: number[] }> = {
  buy: { unit: '$', values: [25, 50, 75, 100] },
  sell: { unit: '%', values: [10, 25, 50, 100] },
};

/** Simulated live market cap with a gentle random walk. */
function useLiveMc(start: number): number {
  const [mc, setMc] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setMc((v) => Math.max(start * 0.8, Math.min(start * 1.2, v * (1 + (Math.random() - 0.5) * 0.01)))), 900);
    return () => clearInterval(id);
  }, [start]);
  return mc;
}

/** Interactive limit-order form. */
export function TryIt() {
  const mc = useLiveMc(58_000);
  const [side, setSide] = useState<Side>('sell');
  const [pct, setPct] = useState(50);
  const [amount, setAmount] = useState(50);
  const target = mc * (1 + pct / 100);
  const kind = orderKind(side, pct);

  return (
    <div className="mx-auto w-full max-w-md space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Try it — simulated</span>
        <span>Live MC <span className="font-mono text-foreground">{usdK(mc)}</span></span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setSide(s); setAmount(PRESETS[s].values[1]!); }}
            className={cn('h-9 rounded-lg text-sm font-bold capitalize transition-colors', side === s ? (s === 'buy' ? 'bg-buy/20 text-buy' : 'bg-sell/20 text-sell') : 'bg-secondary text-muted-foreground hover:bg-accent')}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {PRESETS[side].values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAmount(v)}
            className={cn('h-9 rounded-lg text-sm transition-colors', amount === v ? 'bg-accent text-foreground' : 'bg-secondary text-muted-foreground hover:bg-accent')}
          >
            {PRESETS[side].unit === '$' ? `$${v}` : `${v}%`}
          </button>
        ))}
      </div>
      <div className="flex h-10 items-center gap-3 rounded-xl bg-secondary px-3 text-sm">
        <span className="text-xs font-semibold uppercase text-muted-foreground">Mkt cap</span>
        <span className="flex-1 font-mono">{Math.round(target).toLocaleString('en-US')}</span>
        <span className="text-xs text-muted-foreground">{pct > 0 ? '+' : ''}{pct}%</span>
      </div>
      <Slider
        min={-99}
        max={100}
        step={1}
        value={[pct]}
        onValueChange={([v]) => setPct(v ?? 0)}
        aria-label="Target, percent from the live market cap"
        className="py-2 [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-buy [&_[data-slot=slider-track]]:bg-accent"
      />
      <p className="min-h-10 text-sm text-muted-foreground">
        <span className={cn('font-semibold', side === 'buy' ? 'text-buy' : 'text-sell')}>{kind}</span>
        {' — '}
        {orderExplainer(side, pct, usdK(target)).split(': ')[1]}
      </p>
      <div className="rounded-xl bg-blue py-2.5 text-center text-sm font-bold text-white opacity-90">
        Place {kind.toLowerCase()} · {PRESETS[side].unit === '$' ? `$${amount}` : `${amount}%`}
      </div>
    </div>
  );
}
