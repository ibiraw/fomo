/**
 * @file trade.ts
 * @description Places one trade on the open FOMO token page by driving the trade panel like a user,
 *              then confirms it by watching the cash/position balance change.
 * @author Reborn1987
 */

import {
  activeSide,
  findAmountInput,
  findPanel,
  findSellPreset,
  findSubmit,
  findTab,
  notificationTexts,
  readBalance,
  setReactInputValue,
  submitBlocker,
  submitReady,
} from './fomo-dom';
import { readFomoUserId } from './account';
import { containsAnyWord, fomoDom } from './fomo-dom-config';
import { MIN_TRADE_USD, type ExecutionResult, type TradeRequest } from './types';

/** Timeouts (ms); injectable for tests. */
export interface TradeTimings {
  readonly panelMs: number;
  readonly stepMs: number;
  /** How long to wait for the balance to load (FOMO shows $0 until the position/cash arrives). */
  readonly balanceMs: number;
  /** A balance must stay unchanged this long to count as loaded. */
  readonly settleMs: number;
  readonly readyMs: number;
  readonly confirmMs: number;
}

export const DEFAULT_TIMINGS: TradeTimings = { panelMs: 15_000, stepMs: 3_000, balanceMs: 8_000, settleMs: 500, readyMs: 10_000, confirmMs: 30_000 };


/**
 * Resolves with `check()`'s first non-null value, re-checking on every DOM change
 * (MutationObserver is not throttled in background tabs, unlike timers). Resolves null on timeout.
 */
export function waitFor<T>(doc: Document, check: () => T | null, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const first = check();
    if (first !== null) return resolve(first);
    const obs = new MutationObserver(() => {
      const v = check();
      if (v !== null) done(v);
    });
    const timer = setTimeout(() => done(check()), timeoutMs);
    const done = (v: T | null): void => {
      obs.disconnect();
      clearTimeout(timer);
      resolve(v);
    };
    obs.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true });
  });
}

/**
 * Waits for the balance to be loaded: above $0 and unchanged for `settleMs`. Right after a page load FOMO
 * renders the panel with a $0 placeholder before the real cash/position arrives. Returns the last value
 * seen (possibly 0) when `timeoutMs` passes, or null if no balance was ever readable.
 */
export function waitForSettledBalance(read: () => number | null, timeoutMs: number, settleMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let last: number | null = null;
    let since = Date.now();
    const deadline = Date.now() + timeoutMs;
    const check = (): void => {
      const v = read();
      if (v !== last) { last = v; since = Date.now(); }
      if (last !== null && last > 0 && Date.now() - since >= settleMs) return finish(last);
      if (Date.now() >= deadline) finish(last);
    };
    const timer = setInterval(check, 100);
    const finish = (v: number | null): void => { clearInterval(timer); resolve(v); };
    check();
  });
}

/** Builds a failed result. */
function fail(kind: Exclude<ExecutionResult, { ok: true }>['kind'], message: string): ExecutionResult {
  return { ok: false, kind, message };
}

/** Rounds down to cents so we never ask for more than the balance. */
function floorCents(v: number): number {
  return Math.floor(v * 100) / 100;
}

/** Executes `req` on the current page. Never throws; always returns a typed result. */
export async function executeTrade(doc: Document, req: TradeRequest, t: TradeTimings = DEFAULT_TIMINGS): Promise<ExecutionResult> {
  try {
    return await run(doc, req, t);
  } catch (err) {
    return fail('ui_error', `Unexpected error on FOMO page: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** True when fomo's own storage has a logged-in user (independent of the page layout). */
function loggedIn(): boolean {
  try {
    return readFomoUserId(localStorage) !== null;
  } catch {
    return false;
  }
}

/** The trade steps. Records how long each step took (appended to the result for diagnosis). */
async function run(doc: Document, req: TradeRequest, t: TradeTimings): Promise<ExecutionResult> {
  const t0 = Date.now();
  const marks: string[] = [];
  const mark = (step: string): void => { marks.push(`${step} ${((Date.now() - t0) / 1000).toFixed(1)}s`); };
  const timed = (r: ExecutionResult): ExecutionResult => {
    mark('end');
    const timing = ` (${marks.join(', ')})`;
    return r.ok ? { ...r, detail: r.detail + timing } : { ...r, message: r.message + timing };
  };
  const panel = await waitFor(doc, () => findPanel(doc), t.panelMs);
  if (!panel) {
    // Logged in (fomo's own storage says so) but no panel → fomo's layout changed; nothing was clicked.
    return loggedIn()
      ? fail('layout', 'FOMO trade panel not recognised (fomo layout changed?) — nothing was clicked')
      : fail('not_logged_in', 'FOMO trade panel not found — is the tab logged in and on a token page?');
  }

  // 1. Select the Buy/Sell tab.
  if (activeSide(panel) !== req.side) findTab(panel, req.side)?.click();
  if (!(await waitFor(doc, () => (activeSide(findPanel(doc) ?? panel) === req.side ? true : null), t.stepMs))) {
    return fail('layout', `Could not switch to the ${req.side} tab (fomo layout changed?) — nothing was bought or sold`);
  }
  const p = (): HTMLElement => findPanel(doc) ?? panel;

  // 2. Work out the amount and fill it in.
  const balance = await waitForSettledBalance(() => readBalance(p(), req.side), t.balanceMs, t.settleMs);
  if (balance === null) return fail('layout', 'Could not read the balance on the trade panel (fomo layout changed?) — nothing was clicked');
  mark('balance');
  const input = findAmountInput(p());
  if (!input) return fail('layout', 'Amount box not found (fomo layout changed?) — nothing was clicked');

  let usd: number;
  const preset = req.side === 'sell' && req.amount.kind === 'percent' && fomoDom().sellPresets.includes(req.amount.value)
    ? findSellPreset(p(), req.amount.value)
    : null;
  if (req.amount.kind === 'usd') usd = req.amount.value;
  else usd = floorCents((balance * req.amount.value) / 100);

  if (usd < MIN_TRADE_USD) {
    return timed(fail('insufficient_funds', `Trade would be $${usd.toFixed(2)}, below FOMO's $${MIN_TRADE_USD} minimum (balance $${balance.toFixed(2)} after waiting ${t.balanceMs / 1000}s for it to load)`));
  }
  if (usd > balance + 0.005) {
    return fail('insufficient_funds', `Needs $${usd.toFixed(2)} but only $${balance.toFixed(2)} available`);
  }
  if (preset) preset.click();
  else setReactInputValue(input, usd.toFixed(2));

  // 3. Wait for the quote, then submit.
  mark('amount');
  if (!(await waitFor(doc, () => (submitReady(p(), req.side) ? true : null), t.readyMs))) {
    return timed(fail('ui_error', `FOMO did not accept the amount: "${submitBlocker(p()) ?? 'unknown'}"`));
  }
  mark('quote');
  const before = notificationTexts(doc).length;
  findSubmit(p())!.click();
  mark('clicked');

  // 4. Confirm: the balance must drop (cash for buys, position for sells) or a failure notice appears.
  const outcome = await waitFor<ExecutionResult>(doc, () => {
    // Failure / slippage words come from fomo-dom-config (calibrate there once a real failure is observed).
    const { failureWords, slippageWords } = fomoDom();
    const failure = notificationTexts(doc).slice(before).find((s) => containsAnyWord(s, failureWords));
    if (failure) return fail(containsAnyWord(failure, slippageWords) ? 'slippage' : 'ui_error', `FOMO reported: ${failure}`);
    const now = readBalance(p(), req.side);
    if (now !== null && now <= balance - Math.min(usd, balance) * 0.5) {
      return { ok: true, detail: `${req.side === 'buy' ? 'Bought' : 'Sold'} ~$${usd.toFixed(2)} (balance $${balance.toFixed(2)} → $${now.toFixed(2)})` };
    }
    return null;
  }, t.confirmMs);
  return timed(outcome ?? fail('unknown', `Clicked ${req.side} but could not confirm within ${t.confirmMs / 1000}s — check FOMO`));
}
