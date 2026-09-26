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
  SELL_PRESETS,
  setReactInputValue,
  submitBlocker,
  submitReady,
} from './fomo-dom';
import { MIN_TRADE_USD, type ExecutionResult, type TradeRequest } from './types';

/** Timeouts (ms); injectable for tests. */
export interface TradeTimings {
  readonly panelMs: number;
  readonly stepMs: number;
  readonly readyMs: number;
  readonly confirmMs: number;
}

export const DEFAULT_TIMINGS: TradeTimings = { panelMs: 15_000, stepMs: 3_000, readyMs: 10_000, confirmMs: 30_000 };

/** Failure keywords in FOMO notifications. Calibrate once a real failure is observed. */
const FAILURE_RE = /fail|error|slippage|revert|rejected|insufficient/i;

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
  if (!panel) return fail('not_logged_in', 'FOMO trade panel not found — is the tab logged in and on a token page?');

  // 1. Select the Buy/Sell tab.
  if (activeSide(panel) !== req.side) findTab(panel, req.side)?.click();
  if (!(await waitFor(doc, () => (activeSide(findPanel(doc) ?? panel) === req.side ? true : null), t.stepMs))) {
    return fail('ui_error', `Could not switch to the ${req.side} tab`);
  }
  const p = (): HTMLElement => findPanel(doc) ?? panel;

  // 2. Work out the amount and fill it in.
  const balance = await waitFor(doc, () => readBalance(p(), req.side), t.stepMs);
  if (balance === null) return fail('ui_error', 'Could not read the balance on the trade panel');
  const input = findAmountInput(p());
  if (!input) return fail('ui_error', 'Amount box not found');

  let usd: number;
  const preset = req.side === 'sell' && req.amount.kind === 'percent' && (SELL_PRESETS as readonly number[]).includes(req.amount.value)
    ? findSellPreset(p(), req.amount.value)
    : null;
  if (req.amount.kind === 'usd') usd = req.amount.value;
  else usd = floorCents((balance * req.amount.value) / 100);

  if (usd < MIN_TRADE_USD) {
    return fail('insufficient_funds', `Trade would be $${usd.toFixed(2)}, below FOMO's $${MIN_TRADE_USD} minimum (balance $${balance.toFixed(2)})`);
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
    const failure = notificationTexts(doc).slice(before).find((s) => FAILURE_RE.test(s));
    if (failure) return fail(/slippage/i.test(failure) ? 'slippage' : 'ui_error', `FOMO reported: ${failure}`);
    const now = readBalance(p(), req.side);
    if (now !== null && now <= balance - Math.min(usd, balance) * 0.5) {
      return { ok: true, detail: `${req.side === 'buy' ? 'Bought' : 'Sold'} ~$${usd.toFixed(2)} (balance $${balance.toFixed(2)} → $${now.toFixed(2)})` };
    }
    return null;
  }, t.confirmMs);
  return timed(outcome ?? fail('unknown', `Clicked ${req.side} but could not confirm within ${t.confirmMs / 1000}s — check FOMO`));
}
