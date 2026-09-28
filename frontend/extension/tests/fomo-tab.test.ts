/**
 * @file fomo-tab.test.ts
 * @description Tests for FOMO tab selection/navigation and trade dispatch with a fake tabs API.
 * @author Reborn1987
 */

import { describe, expect, it, vi } from 'vitest';

import { executeInFomoTab, isTokenPage, prepareTab, tokenUrl, tradeInNewTab, type TabsApi, type TabTimings, type WorkerTabStore } from '../lib/fomo-tab';
import type { Order } from '../lib/types';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const FAST: TabTimings = { readyMs: 60, pollMs: 5, tradeMs: 60 };
const noInject = async (): Promise<void> => undefined;

/** In-memory worker-tab store. */
function workerStore(initial: number | null = null): WorkerTabStore & { id: number | null } {
  const w = { id: initial, get: async () => w.id, set: async (id: number) => { w.id = id; }, clear: async () => { w.id = null; } };
  return w;
}
const ORDER = { id: 'o', mint: MINT, side: 'sell', amount: { kind: 'percent', value: 50 } } as unknown as Order;

/** Fake tabs API; `onMint` decides the ping reply, `trade` the trade reply. */
function fakeTabs(tabs: { id: number; url: string; active?: boolean }[], opts: { onMint?: () => boolean; trade?: () => Promise<unknown> } = {}) {
  const api = {
    query: vi.fn(async () => tabs),
    create: vi.fn(async ({ url }: { url: string }) => { const t = { id: 99, url }; tabs.push(t); return t; }),
    update: vi.fn(async (_id: number, _p: object) => ({})),
    remove: vi.fn(async (id: number) => { const i = tabs.findIndex((t) => t.id === id); if (i >= 0) tabs.splice(i, 1); }),
    sendMessage: vi.fn(async (_id: number, msg: { type: string }) => {
      if (msg.type === 'fomo.ping') return { onMint: opts.onMint ? opts.onMint() : true };
      return opts.trade ? opts.trade() : { ok: true, detail: 'sold' };
    }),
  };
  return api as typeof api & TabsApi;
}

describe('tradeInNewTab (quick buttons)', () => {
  it("opens the token in a new tab in front, trades there with fomo's button and leaves the tab open", async () => {
    const tabs = fakeTabs([{ id: 1, url: tokenUrl(MINT) }]);
    const req = { side: 'buy', amount: { kind: 'usd', value: 25 } } as const;
    const r = await tradeInNewTab(tabs, noInject, MINT, req, FAST);
    expect(r).toMatchObject({ ok: true });
    expect(tabs.create).toHaveBeenCalledWith({ url: tokenUrl(MINT), active: true });
    expect(tabs.sendMessage).toHaveBeenCalledWith(99, { type: 'fomo.trade', mint: MINT, request: req });
    expect(tabs.remove).not.toHaveBeenCalled();
  });

  it('fails without clicking when the page never gets ready, and reports an unknown outcome when the tab goes quiet', async () => {
    const req = { side: 'sell', amount: { kind: 'percent', value: 50 } } as const;
    const never = fakeTabs([], { onMint: () => false });
    expect(await tradeInNewTab(never, noInject, MINT, req, FAST)).toMatchObject({ ok: false, kind: 'ui_error' });
    expect(never.sendMessage).not.toHaveBeenCalledWith(99, expect.objectContaining({ type: 'fomo.trade' }));
    const quiet = fakeTabs([], { trade: () => new Promise(() => undefined) });
    expect(await tradeInNewTab(quiet, noInject, MINT, req, FAST)).toMatchObject({ ok: false, kind: 'unknown' });
  });
});

describe('prepareTab', () => {
  it('prefers a tab already on the token page', async () => {
    const tabs = fakeTabs([{ id: 1, url: 'https://fomo.family/' }, { id: 2, url: tokenUrl(MINT) }]);
    expect(await prepareTab(tabs, noInject, MINT, workerStore(), FAST)).toBe(2);
    expect(tabs.update).toHaveBeenCalledWith(2, { autoDiscardable: false });
    expect(tabs.update).not.toHaveBeenCalledWith(2, { url: tokenUrl(MINT) });
  });

  it('treats token pages with query strings as the same page and prefers the tab in front', async () => {
    expect(isTokenPage(`${tokenUrl(MINT)}?tradeId=abc`, MINT)).toBe(true);
    expect(isTokenPage(`${tokenUrl(MINT)}/`, MINT)).toBe(true);
    expect(isTokenPage('https://fomo.family/profile/x', MINT)).toBe(false);
    expect(isTokenPage('not a url', MINT)).toBe(false);
    expect(isTokenPage(undefined, MINT)).toBe(false);
    const tabs = fakeTabs([
      { id: 1, url: `${tokenUrl(MINT)}?tradeId=1` },
      { id: 2, url: `${tokenUrl(MINT)}?tradeId=2`, active: true },
    ]);
    expect(await prepareTab(tabs, noInject, MINT, workerStore(), FAST)).toBe(2);
    expect(tabs.update).not.toHaveBeenCalledWith(2, { url: tokenUrl(MINT) }); // no reload
  });

  it("never navigates the user's own tabs: opens a background worker tab instead", async () => {
    const tabs = fakeTabs([{ id: 1, url: 'https://fomo.family/profile/x', active: true }]);
    const worker = workerStore();
    expect(await prepareTab(tabs, noInject, MINT, worker, FAST)).toBe(99);
    expect(tabs.create).toHaveBeenCalledWith({ url: tokenUrl(MINT), active: false });
    expect(tabs.update).not.toHaveBeenCalledWith(1, expect.objectContaining({ url: expect.any(String) }));
    expect(worker.id).toBe(99);
  });

  it('reuses and navigates the worker tab for the next token', async () => {
    const tabs = fakeTabs([{ id: 1, url: 'https://fomo.family/', active: true }, { id: 7, url: 'https://fomo.family/tokens/solana/other' }]);
    expect(await prepareTab(tabs, noInject, MINT, workerStore(7), FAST)).toBe(7);
    expect(tabs.update).toHaveBeenCalledWith(7, { url: tokenUrl(MINT) });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('opens a new worker tab when the remembered one was closed', async () => {
    const tabs = fakeTabs([]);
    const worker = workerStore(42);
    expect(await prepareTab(tabs, noInject, MINT, worker, FAST)).toBe(99);
    expect(worker.id).toBe(99);
  });

  it('injects the content script once into tabs opened before install', async () => {
    let injected = false;
    const inject = vi.fn(async () => { injected = true; });
    const tabs = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], {
      onMint: () => { if (!injected) throw new Error('Could not establish connection. Receiving end does not exist.'); return true; },
    });
    expect(await prepareTab(tabs, inject, MINT, workerStore(), FAST)).toBe(1);
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it('explains why the tab never became ready', async () => {
    const tabs = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { onMint: () => { throw new Error('Receiving end does not exist'); } });
    const failInject = async (): Promise<void> => { throw new Error('Cannot access contents of the page'); };
    await expect(prepareTab(tabs, failInject, MINT, workerStore(), FAST)).rejects.toThrow(/could not add helper script: Cannot access/);
  });

  it('waits for the content script and times out if the page never loads', async () => {
    let n = 0;
    const slow = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { onMint: () => { if (n++ < 2) throw new Error('no receiver'); return true; } });
    expect(await prepareTab(slow, noInject, MINT, workerStore(), FAST)).toBe(1);
    const never = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { onMint: () => false });
    await expect(prepareTab(never, noInject, MINT, workerStore(), FAST)).rejects.toThrow(/not ready.*not showing the token page/);
  });
});

describe('executeInFomoTab', () => {
  it('sends the trade request and returns the content script result', async () => {
    const tabs = fakeTabs([{ id: 1, url: tokenUrl(MINT) }]);
    expect(await executeInFomoTab(tabs, noInject, workerStore(), ORDER, FAST)).toMatchObject({ ok: true, detail: expect.stringMatching(/^sold \[tab \d+\.\ds total\]$/) });
    expect(tabs.sendMessage).toHaveBeenLastCalledWith(1, { type: 'fomo.trade', mint: MINT, request: { side: 'sell', amount: { kind: 'percent', value: 50 } } });
  });

  it('fails cleanly when the tab never becomes ready (nothing clicked)', async () => {
    const tabs = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { onMint: () => false });
    expect(await executeInFomoTab(tabs, noInject, workerStore(), ORDER, FAST)).toMatchObject({ ok: false, kind: 'ui_error' });
  });

  it('reports unknown when the tab dies or hangs mid-trade', async () => {
    const dead = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { trade: async () => undefined });
    expect(await executeInFomoTab(dead, noInject, workerStore(), ORDER, FAST)).toMatchObject({ ok: false, kind: 'unknown' });
    const hung = fakeTabs([{ id: 1, url: tokenUrl(MINT) }], { trade: () => new Promise(() => undefined) });
    expect(await executeInFomoTab(hung, noInject, workerStore(), ORDER, FAST)).toMatchObject({ ok: false, kind: 'unknown', message: expect.stringMatching(/did not answer/) });
  });
});

describe('background tab clean-up', () => {
  it('closes the background tab it opened once the trade is done', async () => {
    const tabs = fakeTabs([{ id: 1, url: 'https://fomo.family/tokens/solana/OtherMint1111111111111111111111111111111', active: true }]);
    const worker = workerStore();
    const res = await executeInFomoTab(tabs, noInject, worker, ORDER, FAST);
    expect(res.ok).toBe(true);
    expect(tabs.create).toHaveBeenCalledWith({ url: tokenUrl(MINT), active: false });
    expect(tabs.remove).toHaveBeenCalledWith(99);
    expect(worker.id).toBeNull();
  });

  it("never closes the user's own tab on that token", async () => {
    const tabs = fakeTabs([{ id: 5, url: tokenUrl(MINT), active: true }]);
    await executeInFomoTab(tabs, noInject, workerStore(), ORDER, FAST);
    expect(tabs.remove).not.toHaveBeenCalled();
  });

  it('keeps the background tab open when the outcome is unknown, and tolerates it already being closed', async () => {
    const unknown = fakeTabs([], { trade: async () => undefined });
    const w1 = workerStore();
    const r1 = await executeInFomoTab(unknown, noInject, w1, ORDER, FAST);
    expect(r1).toMatchObject({ ok: false, kind: 'unknown' });
    expect(unknown.remove).not.toHaveBeenCalled();
    expect(w1.id).toBe(99);

    const gone = fakeTabs([], { trade: async () => ({ ok: false, kind: 'slippage', message: 'slipped' }) });
    gone.remove.mockRejectedValueOnce(new Error('No tab with id: 99'));
    const w2 = workerStore();
    expect(await executeInFomoTab(gone, noInject, w2, ORDER, FAST)).toMatchObject({ kind: 'slippage' });
    expect(w2.id).toBeNull();
  });
});
