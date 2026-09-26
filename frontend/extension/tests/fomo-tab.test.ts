/**
 * @file fomo-tab.test.ts
 * @description Tests for FOMO tab selection/navigation and trade dispatch with a fake tabs API.
 * @author Reborn1987
 */

import { describe, expect, it, vi } from 'vitest';

import { executeInFomoTab, prepareTab, tokenUrl, type TabsApi, type TabTimings } from '../lib/fomo-tab';
import type { Order } from '../lib/types';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const FAST: TabTimings = { readyMs: 60, pollMs: 5, tradeMs: 60 };
const ORDER = { id: 'o', mint: MINT, side: 'sell', amount: { kind: 'percent', value: 50 } } as unknown as Order;

/** Fake tabs API; `onMint` decides the ping reply, `trade` the trade reply. */
function fakeTabs(tabs: { id: number; url: string }[], opts: { onMint?: () => boolean; trade?: () => Promise<unknown> } = {}) {
  const api = {
    query: vi.fn(async () => tabs),
    create: vi.fn(async ({ url }: { url: string }) => { const t = { id: 99, url }; tabs.push(t); return t; }),
    update: vi.fn(async (_id: number, _p: object) => ({})),
    sendMessage: vi.fn(async (_id: number, msg: { type: string }) => {
      if (msg.type === 'fomo.ping') return { onMint: opts.onMint ? opts.onMint() : true };
      return opts.trade ? opts.trade() : { ok: true, detail: 'sold' };
    }),
  };
  return api as typeof api & TabsApi;
}

describe('prepareTab', () => {
  it('prefers a tab already on the token page', async () => {
    const tabs = fakeTabs([{ id: 1, url: 'https://fomo.family/' }, { id: 2, url: tokenUrl(MINT) }]);
    expect(await prepareTab(tabs, MINT, FAST)).toBe(2);
    expect(tabs.update).toHaveBeenCalledWith(2, { autoDiscardable: false });
    expect(tabs.update).not.toHaveBeenCalledWith(2, { url: tokenUrl(MINT) });
  });

  it('navigates another FOMO tab, or opens one when none exist', async () => {
    const tabs = fakeTabs([{ id: 1, url: 'https://fomo.family/profile/x' }]);
    expect(await prepareTab(tabs, MINT, FAST)).toBe(1);
    expect(tabs.update).toHaveBeenCalledWith(1, { url: tokenUrl(MINT) });
    const none = fakeTabs([]);
    expect(await prepareTab(none, MINT, FAST)).toBe(99);
    expect(none.create).toHaveBeenCalledWith({ url: tokenUrl(MINT), active: false });
  });

  it('waits for the content script and times out if the page never loads', async () => {
    let n = 0;
    const slow = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { onMint: () => { if (n++ < 2) throw new Error('no receiver'); return true; } });
    expect(await prepareTab(slow, MINT, FAST)).toBe(1);
    const never = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { onMint: () => false });
    await expect(prepareTab(never, MINT, FAST)).rejects.toThrow(/did not load/);
  });
});

describe('executeInFomoTab', () => {
  it('sends the trade request and returns the content script result', async () => {
    const tabs = fakeTabs([{ id: 1, url: tokenUrl(MINT) }]);
    expect(await executeInFomoTab(tabs, ORDER, FAST)).toEqual({ ok: true, detail: 'sold' });
    expect(tabs.sendMessage).toHaveBeenLastCalledWith(1, { type: 'fomo.trade', mint: MINT, request: { side: 'sell', amount: { kind: 'percent', value: 50 } } });
  });

  it('fails cleanly when the tab never becomes ready (nothing clicked)', async () => {
    const tabs = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { onMint: () => false });
    expect(await executeInFomoTab(tabs, ORDER, FAST)).toMatchObject({ ok: false, kind: 'ui_error' });
  });

  it('reports unknown when the tab dies or hangs mid-trade', async () => {
    const dead = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { trade: async () => undefined });
    expect(await executeInFomoTab(dead, ORDER, FAST)).toMatchObject({ ok: false, kind: 'unknown' });
    const hung = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { trade: () => new Promise(() => undefined) });
    expect(await executeInFomoTab(hung, ORDER, FAST)).toMatchObject({ ok: false, kind: 'unknown', message: expect.stringMatching(/did not answer/) });
  });
});
