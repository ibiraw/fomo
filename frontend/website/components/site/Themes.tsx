/**
 * @file Themes.tsx
 * @description Theme showcase: a mini fomo page painted in the selected extension theme, with a picker.
 *              Cycles through themes on its own until the visitor picks one (or prefers reduced motion).
 * @author Reborn1987
 */

'use client';

import { useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { SITE_THEMES, themeStyle, type SiteTheme } from '@/lib/themes';
import { cn } from '@/lib/utils';

const CYCLE_MS = 1_600;

/** A slice of fomo's token page recolored by the theme: header strip, chart line and the Limit panel. */
function MiniFomo({ t }: { t: SiteTheme }) {
  return (
    <div
      className="overflow-hidden rounded-2xl border transition-colors duration-500"
      style={{ ...themeStyle(t), background: 'var(--t-bg)', color: 'var(--t-text)', borderColor: 'var(--t-line)' } as React.CSSProperties}
    >
      <div className="flex items-center justify-between border-b px-4 py-2.5 text-xs transition-colors duration-500" style={{ borderColor: 'var(--t-line)', color: 'var(--t-muted)' }}>
        <span className="font-bold tracking-tight" style={{ color: 'var(--t-text)' }}>fomo</span>
        <span>$DEMO · MC <b style={{ color: 'var(--t-text)' }}>$42.0K</b></span>
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-[1fr_15rem]">
        <div className="rounded-xl p-3 transition-colors duration-500" style={{ background: 'var(--t-surface)' }}>
          <svg viewBox="0 0 300 110" className="h-28 w-full" role="img" aria-label="Sample chart">
            <line x1="0" x2="300" y1="78" y2="78" stroke="var(--t-brand)" strokeDasharray="4 4" strokeWidth="1" />
            <polyline fill="none" strokeWidth="2" stroke="var(--t-buy)" points="0,40 30,34 60,46 90,30 120,50 150,44 180,62 210,58 240,76 270,72 300,80" />
            <circle cx="300" cy="80" r="3" fill="var(--t-text)" />
          </svg>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            {[['Holders', '1.2K'], ['24h vol', '$91K'], ['Liquidity', '$18K']].map(([k, v]) => (
              <div key={k} className="rounded-lg px-2 py-1.5" style={{ background: 'var(--t-bg)' }}>
                <div style={{ color: 'var(--t-muted)' }}>{k}</div>
                <div className="font-semibold">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-2 rounded-xl p-2.5 transition-colors duration-500" style={{ background: 'var(--t-surface)' }}>
          <div className="grid grid-cols-3 gap-1.5 text-center text-xs font-bold">
            <div className="rounded-md py-1.5" style={{ background: 'var(--t-bg)', color: 'var(--t-muted)' }}>Buy</div>
            <div className="rounded-md py-1.5" style={{ background: 'var(--t-bg)', color: 'var(--t-muted)' }}>Sell</div>
            <div className="rounded-md py-1.5" style={{ background: 'color-mix(in srgb, var(--t-brand) 20%, transparent)', color: 'var(--t-brand)' }}>Limit</div>
          </div>
          <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs" style={{ background: 'var(--t-bg)' }}>
            <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--t-muted)' }}>Mkt cap</span>
            <span className="flex-1 font-mono">29,400</span>$
          </div>
          <div className="relative mx-1 h-1 rounded-full" style={{ background: 'var(--t-line)' }}>
            <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: '35%', background: 'var(--t-buy)' }} />
          </div>
          <div className="rounded-lg py-2 text-center text-xs font-bold" style={{ background: 'var(--t-button)', color: 'var(--t-on-button)' }}>Place limit buy</div>
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]" style={{ background: 'var(--t-bg)' }}>
            <span className="font-bold" style={{ color: 'var(--t-sell)' }}>Take profit</span>
            <span className="flex-1 truncate" style={{ color: 'var(--t-muted)' }}>MC ≥ $120K · 50%</span>
            <span className="rounded px-1 text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--t-buy) 16%, transparent)', color: 'var(--t-buy)' }}>Filled</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Themes section body: preview + picker. */
export function Themes() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(1); // start on Mono, the site's own scheme
  const [picked, setPicked] = useState(false);

  useEffect(() => {
    if (picked || reduced) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % SITE_THEMES.length), CYCLE_MS);
    return () => clearInterval(t);
  }, [picked, reduced]);

  const current = SITE_THEMES[index]!;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
      <MiniFomo t={current} />
      <div className="space-y-3">
        <div>
          <p className="text-lg font-semibold">{current.name}</p>
          <p className="text-sm text-muted-foreground">{current.vibe}</p>
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Preview a theme">
          {SITE_THEMES.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={i === index}
              onClick={() => { setIndex(i); setPicked(true); }}
              className={cn('rounded-lg border p-2 text-left transition-colors', i === index ? 'border-foreground' : 'border-border hover:border-muted-foreground')}
              style={{ background: t.bg }}
            >
              <span className="flex gap-1">
                {[t.brand, t.button, t.buy, t.sell].map((c, j) => <span key={j} className="size-2.5 rounded-full" style={{ background: c }} />)}
              </span>
              <span className="mt-1.5 block truncate text-[11px] font-semibold" style={{ color: t.text }}>{t.name}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {picked ? (
            <button type="button" onClick={() => setPicked(false)} className="underline underline-offset-2 hover:text-foreground">Resume auto-play</button>
          ) : reduced ? 'Pick a theme to preview it.' : 'Cycling through themes — pick one to stop.'}
        </p>
      </div>
    </div>
  );
}
