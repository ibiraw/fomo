/**
 * @file fomo-tab.ts
 * @description Finds or opens the FOMO tab for an order's token and asks its content script to trade.
 * @author Reborn1987
 */

import type { ExecutionResult, Order, TradeRequest } from './types';

/** Subset of the extension tabs API used here (injectable for tests). */
export interface TabsApi {
  query(q: { url: string }): Promise<{ id?: number; url?: string }[]>;
  create(p: { url: string; active: boolean }): Promise<{ id?: number }>;
  update(id: number, p: { url?: string; autoDiscardable?: boolean }): Promise<unknown>;
  sendMessage(id: number, msg: unknown): Promise<unknown>;
}

/**
 * Injects the content script into a tab. Chrome only injects manifest content scripts on page load,
 * so tabs opened before the extension was installed/updated have no script until this runs.
 */
export type InjectFn = (tabId: number) => Promise<void>;

/** Chrome's error when no content script is listening in the tab. */
const NO_RECEIVER_RE = /Receiving end does not exist|Could not establish connection/i;

/** Tuning (ms). */
export interface TabTimings {
  readonly readyMs: number;
  readonly pollMs: number;
  /** Must exceed the content script's own trade timeouts. */
  readonly tradeMs: number;
}

export const DEFAULT_TAB_TIMINGS: TabTimings = { readyMs: 30_000, pollMs: 500, tradeMs: 75_000 };

const FOMO_MATCH = 'https://fomo.family/*';

/** URL of a Solana token page on FOMO. */
export function tokenUrl(mint: string): string {
  return `https://fomo.family/tokens/solana/${mint}`;
}

/** Resolves after `ms`. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Rejects after `ms` with `message`. */
function timeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

/**
 * Picks a FOMO tab (one already on the token page if possible), navigates it to the token and waits
 * until the content script reports it is on that page. Returns the tab id.
 */
export async function prepareTab(tabs: TabsApi, inject: InjectFn, mint: string, t: TabTimings = DEFAULT_TAB_TIMINGS): Promise<number> {
  const url = tokenUrl(mint);
  const open = await tabs.query({ url: FOMO_MATCH });
  let tab = open.find((x) => x.url === url) ?? open[0];
  if (!tab?.id) tab = await tabs.create({ url, active: false });
  const id = tab.id as number;
  await tabs.update(id, { autoDiscardable: false }); // keep Chrome's Memory Saver from unloading it
  if (tab.url !== url) await tabs.update(id, { url });

  const deadline = Date.now() + t.readyMs;
  let injected = false;
  let injectFailure: string | null = null;
  let lastProblem = 'page did not finish loading';
  while (Date.now() < deadline) {
    try {
      const reply = (await tabs.sendMessage(id, { type: 'fomo.ping', mint })) as { onMint?: boolean } | undefined;
      if (reply?.onMint) return id;
      lastProblem = 'tab is not showing the token page';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastProblem = msg;
      // No script in the tab (opened before install): inject once. While a page is still loading the
      // same error appears, and injecting then is harmless — the script guards against double setup.
      if (!injected && NO_RECEIVER_RE.test(msg)) {
        injected = true;
        try {
          await inject(id);
        } catch (injectErr) {
          injectFailure = `could not add helper script: ${injectErr instanceof Error ? injectErr.message : String(injectErr)}`;
        }
      }
    }
    await sleep(t.pollMs);
  }
  throw new Error(`FOMO tab was not ready within ${t.readyMs / 1000}s (${injectFailure ?? lastProblem})`);
}

/** Converts an order into the content-script trade request. */
export function toTradeRequest(order: Order): TradeRequest {
  return { side: order.side, amount: order.amount };
}

/** Runs `order` in a FOMO tab. Never throws. */
export async function executeInFomoTab(tabs: TabsApi, inject: InjectFn, order: Order, t: TabTimings = DEFAULT_TAB_TIMINGS): Promise<ExecutionResult> {
  let id: number;
  try {
    id = await prepareTab(tabs, inject, order.mint, t);
  } catch (err) {
    // Nothing was clicked yet, so this is a definite failure, not an unknown outcome.
    return { ok: false, kind: 'ui_error', message: err instanceof Error ? err.message : String(err) };
  }
  try {
    const result = await timeout(
      tabs.sendMessage(id, { type: 'fomo.trade', mint: order.mint, request: toTradeRequest(order) }) as Promise<ExecutionResult | undefined>,
      t.tradeMs,
      'FOMO tab did not answer',
    );
    return result ?? { ok: false, kind: 'unknown', message: 'FOMO tab closed or reloaded during the trade — check FOMO' };
  } catch (err) {
    return { ok: false, kind: 'unknown', message: `${err instanceof Error ? err.message : String(err)} — check FOMO` };
  }
}
