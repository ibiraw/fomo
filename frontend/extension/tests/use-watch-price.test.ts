/**
 * @file use-watch-price.test.ts
 * @description The live-price request for the page's token: a slow or lost answer is asked again after 5 s and never
 *              shows "not available"; a real refusal (unsupported pool) is shown and re-checked every minute; a later
 *              success clears it.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWatchPrice } from '../hooks/use-watch-price';
import { isTransientError } from '../lib/server-connection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.useRealTimers());

describe('isTransientError', () => {
  it('knows "no answer" and "no connection" from real refusals', () => {
    for (const m of ['Server did not answer in time', 'Connection closed', 'Connection lost', 'Not connected to the limit server', 'Too many requests, retry shortly', 'Price temporarily unavailable, retrying']) expect(isTransientError(m)).toBe(true);
    expect(isTransientError('No Raydium CPMM pool for X')).toBe(false);
  });
});

describe('useWatchPrice', () => {
  it('retries a slow answer quietly, shows a real refusal, and clears it after a later success', async () => {
    vi.useFakeTimers();
    const answers: (Error | null)[] = [new Error('Server did not answer in time'), new Error('No pool for X'), null];
    const send = vi.fn(async () => { const a = answers.shift(); if (a) throw a; return null; });
    let seen: string | null = 'unset';
    function Probe() { seen = useWatchPrice('MINT', true, send as never); return null; }
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => { root.render(React.createElement(Probe)); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(seen).toBeNull(); // timed out: no "not available"
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(seen).toBe('No pool for X');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(send).toHaveBeenCalledTimes(3);
    expect(seen).toBeNull();
    act(() => root.unmount());
  });
});
