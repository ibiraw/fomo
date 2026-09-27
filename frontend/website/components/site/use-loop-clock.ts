/**
 * @file use-loop-clock.ts
 * @description requestAnimationFrame clock for the site's looping demos (Walkthrough, BeforeAfter): pausable, and
 *              `jump` moves to any loop time.
 * @author Reborn1987
 */

'use client';

import { useEffect, useRef, useState } from 'react';

/** Drives loop time with requestAnimationFrame; pausable. `wrap` folds elapsed ms into the loop. */
export function useLoopClock(paused: boolean, wrap: (ms: number) => number): [number, (t: number) => void] {
  const [t, setT] = useState(0);
  const base = useRef({ start: 0, offset: 0 });
  useEffect(() => {
    if (paused) return;
    let raf = 0;
    const clock = base.current; // same object for the hook's lifetime; jump() mutates it in place
    clock.start = performance.now();
    const tick = (now: number): void => {
      setT(wrap(clock.offset + now - clock.start));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clock.offset += performance.now() - clock.start;
    };
  }, [paused, wrap]); // callers pass a module-level function, so `wrap` is stable
  const jump = (to: number): void => {
    base.current.offset = to;
    base.current.start = performance.now();
    setT(to);
  };
  return [t, jump];
}
