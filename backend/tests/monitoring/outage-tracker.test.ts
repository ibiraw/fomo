/**
 * @file outage-tracker.test.ts
 * @description OutageTracker: blips that recover before the threshold are silent; lasting outages alert once
 *              with the latest error and report their recovery; sources are independent.
 * @author Reborn1987
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OutageTracker } from '../../src/core/monitoring/outage-tracker.js';

/** Tracker on fake timers with a 2-minute threshold. */
function setup() {
  const alerts: [string, string][] = [];
  const tracker = new OutageTracker((kind, text) => alerts.push([kind, text]), 120_000, () => Date.now());
  return { tracker, alerts };
}

describe('OutageTracker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stays silent when the connection recovers in time', () => {
    const { tracker, alerts } = setup();
    const h = tracker.for('rpc:robinhood');
    h.down(new Error('The socket has been closed.'));
    vi.advanceTimersByTime(30_000);
    h.up();
    vi.advanceTimersByTime(300_000);
    expect(alerts).toEqual([]);
  });

  it('alerts once after the threshold with the latest error, then reports recovery', () => {
    const { tracker, alerts } = setup();
    const h = tracker.for('rpc:robinhood');
    h.down(new Error('first'));
    vi.advanceTimersByTime(60_000);
    h.down(new Error('latest'));
    vi.advanceTimersByTime(60_000);
    expect(alerts).toEqual([['error', 'rpc:robinhood down for 2 min (still retrying): Error: latest']]);
    vi.advanceTimersByTime(180_000);
    h.down(new Error('again'));
    expect(alerts).toHaveLength(1);
    h.up();
    expect(alerts[1]).toEqual(['server', 'rpc:robinhood back up after 5 min']);
  });

  it('treats up() without an outage as a no-op', () => {
    const { tracker, alerts } = setup();
    tracker.up('rpc');
    expect(alerts).toEqual([]);
  });

  it('tracks sources independently', () => {
    const { tracker, alerts } = setup();
    tracker.down('rpc', new Error('a'));
    tracker.down('rpc:base', new Error('b'));
    tracker.up('rpc');
    vi.advanceTimersByTime(120_000);
    expect(alerts).toEqual([['error', 'rpc:base down for 2 min (still retrying): Error: b']]);
  });

  it('reports sub-minute durations in seconds', () => {
    const alerts: string[] = [];
    const tracker = new OutageTracker((_, text) => alerts.push(text), 45_000, () => Date.now());
    tracker.down('rpc', 'plain');
    vi.advanceTimersByTime(45_000);
    expect(alerts).toEqual(['rpc down for 45 s (still retrying): plain']);
  });

  it('stop() cancels pending alerts', () => {
    const { tracker, alerts } = setup();
    tracker.down('rpc', new Error('a'));
    tracker.stop();
    vi.advanceTimersByTime(300_000);
    expect(alerts).toEqual([]);
  });
});
