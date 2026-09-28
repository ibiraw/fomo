/**
 * @file BeforeAfter.tsx
 * @description "fomo vs fomo + limit": two replicas of fomo's trade panel play the same night-time dip side by side.
 *              Plain fomo can only buy at the current price, so the dip is missed; with limit a Limit tab appears, a
 *              "buy if it drops 20%" order is set, and it fills while the user sleeps. Below, what fomo offers next to
 *              what limit adds. Loop pauses on hover; prefers-reduced-motion shows the finished state.
 * @author Reborn1987
 */

'use client';

import { Check, Minus, Moon } from 'lucide-react';

import { isReleased } from '@/lib/releases';
import { useReducedMotion } from 'motion/react';
import { useState } from 'react';

import {
  awayAt,
  BA_CHART_END,
  BA_LOOP_MS,
  BA_START_MC,
  BA_TARGET_MC,
  BA_TRIGGER_X,
  baChartX,
  baMarketCapAt,
  captionsAt,
  clockAt,
  limitPanelAt,
  outcomeAt,
  type LimitPanelState,
} from '@/lib/before-after';
import { usdK } from '@/lib/demo';
import { cn } from '@/lib/utils';

import { useLoopClock } from './use-loop-clock';

/** Folds elapsed ms into the loop. */
const wrap = (ms: number): number => ((ms % BA_LOOP_MS) + BA_LOOP_MS) % BA_LOOP_MS;

/** Chart geometry. */
const W = 300;
const H = 96;
const LO = 150_000;
const HI = 240_000;
const yOf = (mc: number): number => H - 4 - ((mc - LO) / (HI - LO)) * (H - 8);

/** Mini market-cap chart; the target line shows only when an order exists. */
function Chart({ t, target }: { t: number; target: boolean }) {
  const x = baChartX(t);
  const pts = Array.from({ length: 121 }, (_, i) => {
    const xi = (i / 120) * x;
    return `${(xi * W).toFixed(1)},${yOf(baMarketCapAt(xi)).toFixed(1)}`;
  });
  const mc = baMarketCapAt(x);
  const down = mc < BA_START_MC;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full overflow-visible" role="img" aria-label="Simulated market cap chart">
      {target && <line x1="0" x2={W} y1={yOf(BA_TARGET_MC)} y2={yOf(BA_TARGET_MC)} stroke="var(--primary)" strokeDasharray="4 4" strokeWidth="1" opacity="0.7" />}
      <polyline points={pts.join(' ')} fill="none" stroke={down ? 'var(--sell)' : 'var(--buy)'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x * W} cy={yOf(mc)} r="3" fill="var(--foreground)" />
      {target && x >= BA_TRIGGER_X && <circle cx={BA_TRIGGER_X * W} cy={yOf(BA_TARGET_MC)} r="6" fill="none" stroke="var(--buy)" strokeWidth="2" />}
    </svg>
  );
}

/** Token header + chart shared by both sides. */
function Market({ t, target }: { t: number; target: boolean }) {
  const mc = baMarketCapAt(baChartX(t));
  const chg = ((mc - BA_START_MC) / BA_START_MC) * 100;
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>$KEK · market cap</span>
        <span className={cn('font-semibold tabular-nums', chg < 0 ? 'text-sell' : 'text-buy')}>{chg >= 0 ? '+' : ''}{chg.toFixed(1)}%</span>
      </div>
      <p className="text-lg font-bold tabular-nums">{usdK(mc)}</p>
      <Chart t={t} target={target} />
    </div>
  );
}

/** Both panels share one height (the Limit view's), so switching views never resizes the section or shifts the page. */
const PANEL_BOX = 'min-h-[19rem] rounded-xl border bg-background p-2.5';

/** A short "tap" highlight on the element the demo is using. */
const tapRing = (on: boolean): string => cn('transition-shadow', on && 'ring-2 ring-foreground/70');

/** Plain fomo trade panel: Buy and Sell only. */
function FomoPanel() {
  return (
    <div className={cn(PANEL_BOX, 'space-y-2')}>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg bg-accent p-2 text-center text-sm font-bold">Buy</div>
        <div className="rounded-lg bg-secondary p-2 text-center text-sm font-bold text-muted-foreground">Sell</div>
      </div>
      <div className="flex h-10 items-center gap-3 rounded-xl bg-secondary px-3 text-sm">
        <span className="text-xs font-semibold uppercase text-muted-foreground">Amount</span>
        <span className="flex-1 text-faint">0.0</span>
        <span className="font-semibold">$</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-center text-xs font-semibold text-muted-foreground">
        {['25', '50', '75', '100'].map((v) => <span key={v} className="rounded-lg bg-secondary py-1.5">{v}</span>)}
      </div>
      <div className="rounded-xl bg-buy p-2.5 text-center text-sm font-bold text-background">Buy KEK</div>
      <p className="text-center text-xs text-muted-foreground">Buys at the price right now. Nothing else.</p>
    </div>
  );
}

const ORDER_STATUS: Record<NonNullable<LimitPanelState['order']>, { text: string; cls: string }> = {
  waiting: { text: 'Waiting', cls: 'bg-accent text-muted-foreground' },
  buying: { text: 'Buying…', cls: 'bg-brand/15 text-brand' },
  filled: { text: 'Filled', cls: 'bg-buy/15 text-buy' },
};

/** The same panel with limit installed. */
function LimitPanel({ t }: { t: number }) {
  const s = limitPanelAt(t);
  const mc = baMarketCapAt(baChartX(t));
  const limit = s.tab === 'limit';
  const target = s.targetSet ? BA_TARGET_MC : BA_START_MC;
  const ready = s.amount !== '' && s.targetSet;
  const need = ((BA_TARGET_MC - mc) / mc) * 100;
  return (
    <div className={cn(PANEL_BOX, 'space-y-2')}>
      <div className={cn('grid gap-1.5', s.hasLimitTab ? 'grid-cols-3' : 'grid-cols-2')}>
        <div className={cn('rounded-lg p-2 text-center text-sm font-bold', limit ? 'bg-secondary text-muted-foreground' : 'bg-accent')}>Buy</div>
        <div className="rounded-lg bg-secondary p-2 text-center text-sm font-bold text-muted-foreground">Sell</div>
        {s.hasLimitTab && (
          <div className={cn('animate-in zoom-in-50 fade-in rounded-lg p-2 text-center text-sm font-bold duration-500', limit ? 'bg-accent' : 'bg-secondary text-muted-foreground', tapRing(s.tap === 'limit-tab'))}>
            Limit
          </div>
        )}
      </div>
      <div className={cn('flex h-10 items-center gap-3 rounded-xl bg-secondary px-3 text-sm', tapRing(s.tap === 'amount'))}>
        <span className="text-xs font-semibold uppercase text-muted-foreground">Amount</span>
        <span className={cn('flex-1 tabular-nums', !s.amount && 'text-faint')}>{s.amount || '0.0'}</span>
        <span className="font-semibold">$</span>
      </div>
      {limit ? (
        <>
          <div className="flex h-10 items-center gap-3 rounded-xl bg-secondary px-3 text-sm">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Mkt cap</span>
            <span className="flex-1 font-mono tabular-nums">{Math.round(target).toLocaleString('en-US')}</span>
            <span className="text-xs text-muted-foreground">{usdK(target)}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-center text-xs font-semibold">
            {['−10%', '−20%', '−35%', '−50%'].map((v) => (
              <span key={v} className={cn('rounded-lg py-1.5', v === '−20%' && s.targetSet ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground', v === '−20%' && tapRing(s.tap === 'chip'))}>{v}</span>
            ))}
          </div>
          <div className={cn('rounded-xl p-2.5 text-center text-sm font-bold transition-colors', ready ? 'bg-foreground text-background' : 'bg-accent text-muted-foreground', tapRing(s.tap === 'cta'), s.tap === 'cta' && 'scale-[.98]')}>
            Place limit buy
          </div>
          {/* Fixed height so the section doesn't change size (and shift the page) when the order row appears. */}
          <div className="flex min-h-14 flex-col justify-center">
          {s.order ? (
            <div className="animate-in fade-in slide-in-from-bottom-1 space-y-1.5 rounded-lg bg-secondary px-2.5 py-2 duration-300">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-buy">Limit buy</span>
                <span className="flex-1 truncate">MC ≤ {usdK(BA_TARGET_MC)} · $50</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', ORDER_STATUS[s.order].cls)}>{ORDER_STATUS[s.order].text}</span>
              </div>
              <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
                <span>Now {usdK(mc)}</span>
                <span>{s.order === 'waiting' ? `needs ${need.toFixed(1)}%` : `bought $50 at ${usdK(BA_TARGET_MC)}`}</span>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">{ready ? 'Buys when it drops 20% to ' + usdK(BA_TARGET_MC) : 'Pick an amount and a target'}</p>
          )}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-1.5 text-center text-xs font-semibold text-muted-foreground">
            {['25', '50', '75', '100'].map((v) => <span key={v} className="rounded-lg bg-secondary py-1.5">{v}</span>)}
          </div>
          <div className="rounded-xl bg-buy p-2.5 text-center text-sm font-bold text-background">Buy KEK</div>
        </>
      )}
    </div>
  );
}

/** One side of the comparison: header, market, panel, caption, overlays. */
function Side({ label, accent, t, caption, children, target, away, toast }: {
  label: string; accent: boolean; t: number; caption: string; children: React.ReactNode; target: boolean; away: string; toast: { show: boolean; good: boolean; text: string };
}) {
  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-3.5">
      <div className="flex items-center justify-between">
        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest', accent ? 'bg-foreground text-background' : 'bg-accent text-muted-foreground')}>{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{clockAt(t)}</span>
      </div>
      <Market t={t} target={target} />
      {children}
      <p className="min-h-10 text-balance text-center text-sm text-muted-foreground">{caption}</p>
      <div className={cn('pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/75 text-center transition-opacity duration-500', awayAt(t) ? 'opacity-100' : 'opacity-0')}>
        <Moon className="size-7 text-foreground" aria-hidden />
        <p className="max-w-[16rem] text-sm text-muted-foreground">{away}</p>
      </div>
      <div className={cn(
        'absolute inset-x-3 bottom-3 rounded-xl border px-3 py-2.5 text-sm shadow-xl transition-transform duration-500',
        toast.good ? 'border-buy/40 bg-background' : 'border-sell/40 bg-background',
        toast.show ? 'translate-y-0' : 'translate-y-[160%]',
      )}>
        <span className={cn('font-bold', toast.good ? 'text-buy' : 'text-sell')}>{toast.good ? 'Filled. ' : 'Missed. '}</span>
        {toast.text}
      </div>
    </div>
  );
}

const FOMO_HAS = ['Buy and Sell at the current price', 'Your positions and PnL', 'Cash and wallet on every chain it supports'] as const;
const LIMIT_ADDS: readonly string[] = [
  'Limit buy: buy the dip at your price',
  'Breakout buy: buy when it runs past a level',
  'Take profit and stop loss on anything you hold',
  'Runs while you’re away (browser stays open)',
  'Solana, Ethereum, Base, BNB, Robinhood and Arc',
  isReleased('1.2') ? 'Fill sounds, auto-cancel when you sell out' : 'Auto-cancel when you sell out',
];

/** The comparison section body. */
export function BeforeAfter() {
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  // Reduced motion: hold the finished state instead of playing.
  const [clock] = useLoopClock(hovered || !!reduced, wrap);
  const t = reduced ? BA_CHART_END + 1_000 : clock;
  const captions = captionsAt(t);
  const outcome = outcomeAt(t);
  const placed = limitPanelAt(t).order !== null;

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <Side
          label="fomo" accent={false} t={t} caption={captions.before} target={false}
          away="You're asleep. fomo can only trade while you're there."
          toast={{ show: outcome.missed, good: false, text: 'The dip came and went. It’s back up +15%.' }}
        >
          <FomoPanel />
        </Side>
        <Side
          label="fomo + limit" accent t={t} caption={captions.after} target={placed}
          away="You're asleep. limit is watching the price."
          toast={{ show: outcome.filled, good: true, text: `Bought $50 of KEK at ${usdK(BA_TARGET_MC)}.` }}
        >
          <LimitPanel t={t} />
        </Side>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border p-5">
          <h3 className="font-semibold">What fomo gives you</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {FOMO_HAS.map((x) => <li key={x} className="flex gap-2"><Minus className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />{x}</li>)}
          </ul>
        </div>
        <div className="rounded-2xl border border-foreground/25 bg-card p-5">
          <h3 className="font-semibold">What limit adds</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {LIMIT_ADDS.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-buy" aria-hidden />{x}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
