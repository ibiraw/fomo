/**
 * @file layout-alerts.test.ts
 * @description LayoutAlerts: one "new version" message per 30 min, one "layout broken" alert per 10 min counting the
 *              accounts in between (with the saved snapshot's path), and a "resumed" message when trades restart.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { LayoutAlerts } from '../../src/core/monitoring/layout-alerts.js';
import type { LayoutReport } from '../../src/core/monitoring/layout-report.js';
import type { Account } from '../../src/ports/account-store.js';

const acct = (id: string, name: string | null = null): Account => ({
  id, shortId: `LM-${id.toUpperCase().padEnd(6, 'X')}`, wallets: { solana: null, evm: null }, fomoUsername: name, fomoUserId: null, createdAt: 0, lastSeenAt: 0,
});
const report = (over: Partial<LayoutReport> = {}): LayoutReport => ({ account: acct('a'), ok: false, missing: ['amount input'], newVersion: false, snapshot: null, paused: true, ...over });

/** LayoutAlerts on a settable clock, collecting messages and saved snapshots. */
function setup() {
  let t = 1_000_000;
  const out: [string, string][] = [];
  const saved: string[] = [];
  const alerts = new LayoutAlerts((k, text) => out.push([k, text]), (label, snap) => { saved.push(`${label}:${snap}`); return `reports/${label}.txt`; }, () => t);
  return { alerts, out, saved, advance: (ms: number) => { t += ms; } };
}

describe('LayoutAlerts', () => {
  it('announces a new fomo version once per 30 minutes', () => {
    const { alerts, out, advance } = setup();
    alerts.handle(report({ ok: null, paused: null, newVersion: true, account: acct('a', 'ibiraw') }));
    alerts.handle(report({ ok: null, paused: null, newVersion: true }));
    advance(30 * 60_000);
    alerts.handle(report({ ok: null, paused: null, newVersion: true }));
    expect(out.map(([k]) => k)).toEqual(['server', 'server']);
    expect(out[0]![1]).toMatch(/fomo shipped a new version \(seen by LM-AXXXXX \(@ibiraw\)\)/);
  });

  it('alerts a broken layout once per 10 minutes with the snapshot path, counting accounts in between', () => {
    const { alerts, out, saved, advance } = setup();
    alerts.handle(report({ snapshot: 'div.panel' }));
    alerts.handle(report({ account: acct('b') }));
    alerts.handle(report({ account: acct('c') }));
    expect(out).toHaveLength(1);
    expect(out[0]![0]).toBe('error');
    expect(out[0]![1]).toMatch(/missing amount input\. Trades paused — nothing was clicked.*snapshot: reports\/LM-AXXXXX\.txt/);
    expect(saved).toEqual(['LM-AXXXXX:div.panel']);
    advance(10 * 60_000);
    alerts.handle(report({ account: acct('d'), paused: null }));
    expect(out[1]![1]).toMatch(/\(3 accounts so far\).*Nothing was clicked/);
  });

  it('reports resumed trades, and stays quiet for a plain passing check', () => {
    const { alerts, out } = setup();
    alerts.handle(report({ ok: true, paused: null, missing: [] }));
    expect(out).toEqual([]);
    alerts.handle(report({ ok: true, paused: false, missing: [] }));
    expect(out).toEqual([['server', '✅ fomo layout recognised again for LM-AXXXXX — trades resumed']]);
  });
});
