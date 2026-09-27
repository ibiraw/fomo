/**
 * @file Walkthrough.tsx
 * @description Auto-playing walkthrough of a limit order: a replica of fomo's panel with the Limit tab,
 *              live chart, slider, order row and on-chain confirmation. Steps are clickable (jump) and the
 *              loop pauses while hovered. Honors prefers-reduced-motion (shows steps without animation).
 * @author Reborn1987
 */

'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import {
  chartSeries,
  loopTime,
  LOOP_MS,
  marketCapAt,
  sliderAt,
  START_MC,
  statusAt,
  stepAt,
  STEPS,
  TARGET_MC,
  usdK,
  type DemoStatus,
} from '@/lib/demo';
import { cn } from '@/lib/utils';

/** Drives loop time with requestAnimationFrame; pausable. */
function useLoopClock(paused: boolean): [number, (t: number) => void] {
  const [t, setT] = useState(0);
  const base = useRef({ start: 0, offset: 0 });
  useEffect(() => {
    if (paused) return;
    let raf = 0;
    const clock = base.current; // same object for the hook's lifetime; jump() mutates it in place
    clock.start = performance.now();
    const tick = (now: number): void => {
      setT(loopTime(clock.offset + now - clock.start));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clock.offset += performance.now() - clock.start;
    };
  }, [paused]);
  const jump = (to: number): void => {
    base.current.offset = to;
    base.current.start = performance.now();
    setT(to);
  };
  return [t, jump];
}

const STATUS_LABEL: Record<Exclude<DemoStatus, 'none'>, { text: string; cls: string }> = {
  open: { text: 'Waiting', cls: 'bg-accent text-muted-foreground' },
  triggered: { text: 'Triggered', cls: 'bg-brand/15 text-brand' },
  trading: { text: 'Trading…', cls: 'bg-brand/15 text-brand' },
  filled: { text: 'Filled', cls: 'bg-buy/15 text-buy' },
};

/** Mini SVG price chart with the target line. */
function Chart({ t, showTarget }: { t: number; showTarget: boolean }) {
  const W = 320;
  const H = 96;
  const lo = TARGET_MC * 0.9;
  const hi = START_MC * 1.04;
  const y = (v: number): number => H - ((v - lo) / (hi - lo)) * H;
  const pts = chartSeries(t);
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / 120) * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = pts.at(-1) ?? START_MC;
  const lastX = ((pts.length - 1) / 120) * W;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="Simulated market cap chart">
      {showTarget && (
        <g>
          <line x1="0" x2={W} y1={y(TARGET_MC)} y2={y(TARGET_MC)} stroke="var(--primary)" strokeDasharray="4 4" strokeWidth="1" opacity="0.8" />
          <text x={W - 4} y={y(TARGET_MC) - 4} textAnchor="end" fontSize="9" fill="var(--primary)">target {usdK(TARGET_MC)}</text>
        </g>
      )}
      <path d={path} fill="none" stroke={last <= TARGET_MC * 1.01 ? 'var(--buy)' : 'var(--sell)'} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={lastX} cy={y(last)} r="3" fill="var(--foreground)" />
    </svg>
  );
}

/** The replica fomo trade panel. */
function Panel({ t }: { t: number }) {
  const step = stepAt(t);
  const pct = sliderAt(t);
  const mc = marketCapAt(t);
  const status = statusAt(t);
  const target = START_MC * (1 + pct / 100);
  const pressed = t >= 4_600 && t < 5_000;

  return (
    <div className="w-full max-w-sm rounded-2xl border bg-background p-3 shadow-2xl shadow-black/60">
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">$DEMO</span>
        <span>MC <span className="font-mono text-foreground">{usdK(mc)}</span></span>
      </div>
      <Chart t={t} showTarget={step >= 2} />

      <div className="mt-2 flex gap-2">
        {['Buy', 'Sell', 'Limit'].map((tab) => (
          <div
            key={tab}
            className={cn(
              'flex-1 rounded-lg p-2 text-center text-sm font-bold transition-colors',
              tab === 'Limit' && step >= 0 ? 'bg-brand/20 text-brand' : 'bg-secondary text-muted-foreground',
              tab === 'Limit' && t < 700 && 'ring-2 ring-brand/60',
            )}
          >
            {tab}
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex h-10 items-center gap-3 rounded-xl bg-secondary px-3 text-sm">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Amount</span>
          <span className="flex-1">25</span>
          <span className="font-semibold">$</span>
        </div>
        <div className="flex h-10 items-center gap-3 rounded-xl bg-secondary px-3 text-sm">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Mkt cap</span>
          <span className="flex-1 font-mono">{Math.round(target).toLocaleString('en-US')}</span>
          <span className="font-semibold">$</span>
        </div>
        <div className="px-1 pt-1">
          <div className="relative h-1.5 rounded-full bg-accent">
            <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-buy shadow" style={{ left: `${((pct + 100) / 200) * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>-100%</span><span>0%</span><span>+100%</span>
          </div>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          <span className="font-semibold text-buy">Limit buy</span> at {usdK(target)} ({pct}%)
        </p>
        <div className={cn('rounded-xl bg-action py-2.5 text-center text-sm font-bold text-on-action transition-transform', pressed && 'scale-95 opacity-80')}>
          Place limit buy
        </div>
      </div>

      {/* Fixed-height slots: content fades in/out without changing the panel's height (no layout shift). */}
      <div className="mt-3 h-9">
        <AnimatePresence>
          {status !== 'none' && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex h-9 items-center gap-2 rounded-lg bg-secondary px-2.5 text-xs"
            >
              <span className="font-bold text-buy">Limit buy</span>
              <span className="flex-1 truncate">MC ≤ {usdK(TARGET_MC)} · $25</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', STATUS_LABEL[status].cls)}>{STATUS_LABEL[status].text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-2 h-9">
        <AnimatePresence>
          {status === 'filled' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-9 items-center rounded-lg border border-buy/40 bg-buy/10 px-3 text-xs text-buy"
            >
              Bought $25 of $DEMO · confirmed on-chain in 2.6s
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Walkthrough section: step list + animated panel. */
export function Walkthrough() {
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [t, jump] = useLoopClock(hovered || !!reduced);
  const step = stepAt(t);

  return (
    <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto]" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <ol className="space-y-2">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => jump(s.at + 1)}
              className={cn(
                'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                i === step ? 'border-brand/50 bg-brand/5' : 'border-transparent hover:bg-muted',
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', i === step ? 'bg-brand text-primary-foreground' : 'bg-accent text-muted-foreground')}>
                  {i + 1}
                </span>
                <span className={cn('font-semibold', i === step ? 'text-foreground' : 'text-muted-foreground')}>{s.title}</span>
              </div>
              {/* Description + progress always take their space; only visibility changes (no layout shift). */}
              <p className={cn('mt-1 min-h-10 pl-9 text-sm text-muted-foreground transition-opacity', i === step ? 'opacity-100' : 'opacity-0')} aria-hidden={i !== step}>
                {s.body}
              </p>
              <div className={cn('ml-9 mt-1 h-0.5 overflow-hidden rounded', i === step && !reduced ? 'bg-accent' : 'bg-transparent')}>
                {i === step && !reduced && (
                  <div
                    className="h-full bg-brand"
                    style={{ width: `${Math.min(100, ((t - s.at) / ((STEPS[i + 1]?.at ?? LOOP_MS) - s.at)) * 100)}%` }}
                  />
                )}
              </div>
            </button>
          </li>
        ))}
        <li className="pl-4 pt-1 text-xs text-faint">{hovered ? 'Paused — move away to resume' : 'Demo — simulated prices. Click a step to jump.'}</li>
      </ol>
      <div className="flex justify-center">
        <Panel t={t} />
      </div>
    </div>
  );
}
