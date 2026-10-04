/**
 * @file trade.test.ts
 * @description Tests for executeTrade and FOMO DOM helpers against the simulated FOMO panel.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findPanel, parseUsd, readBalance, setReactInputValue } from '../lib/fomo-dom';
import { executeTrade, waitFor, waitForSettledBalance, type TradeTimings } from '../lib/trade';
import { mountFakeFomo } from './fake-fomo';

const FAST: TradeTimings = { panelMs: 50, stepMs: 50, balanceMs: 400, settleMs: 0, readyMs: 50, confirmMs: 100 };

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('fomo-dom helpers', () => {
  it('parses USD strings', () => {
    expect(parseUsd('$1,234.56')).toBe(1234.56);
    expect(parseUsd('$0')).toBe(0);
    expect(parseUsd('1.2M woj/acc')).toBeNull();
  });

  it('reads cash on the buy tab and position on the sell tab', () => {
    mountFakeFomo(document, { cash: 533.4, position: 4.75 });
    const p = findPanel(document)!;
    expect(readBalance(p, 'buy')).toBe(533.4);
    expect(readBalance(p, 'sell')).toBeNull(); // sell presets not rendered while on buy tab
  });

  it('returns null when no panel exists', () => {
    expect(findPanel(document)).toBeNull();
  });

  it('fires input events React can see', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    let seen = '';
    input.addEventListener('input', () => (seen = input.value));
    setReactInputValue(input, '3.00');
    expect(seen).toBe('3.00');
  });

  it('waitForSettledBalance needs a stable non-zero value, else returns the last one', async () => {
    let v: number | null = 0;
    setTimeout(() => (v = 5), 120);
    expect(await waitForSettledBalance(() => v, 1000, 150)).toBe(5);
    expect(await waitForSettledBalance(() => 0, 250, 50)).toBe(0);
    expect(await waitForSettledBalance(() => null, 150, 50)).toBeNull();
  });

  it('waitFor resolves null on timeout', async () => {
    expect(await waitFor(document, () => null, 10)).toBeNull();
  });
});

describe('executeTrade', () => {
  it('stops before clicking when the deadline runs out, says where, and reports each step', async () => {
    const fake = mountFakeFomo(document, { cash: 100, position: 0, blockSubmit: true });
    const steps: string[] = [];
    const r = await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, { ...FAST, readyMs: 5_000 }, {
      deadline: Date.now() + 300, onStep: (s) => steps.push(s),
    });
    expect(r).toMatchObject({ ok: false, kind: 'timeout', message: expect.stringMatching(/Ran out of time while waiting for fomo's quote \(the button showed .*\) — nothing was clicked/) });
    expect(fake.state.submitted).toBeNull();
    expect(steps).toEqual(['looking for the trade panel', 'switching to the buy tab', 'waiting for the cash balance to load', "waiting for fomo's quote"]);
  });

  it('buys a fixed USD amount and confirms by the cash drop', async () => {
    const fake = mountFakeFomo(document, { cash: 100, position: 0 });
    const r = await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST);
    expect(r).toMatchObject({ ok: true });
    expect(fake.state.submitted).toEqual({ side: 'buy', amount: '5.00' });
    expect(fake.opts.cash).toBe(95);
  });

  it('buys a percentage of cash', async () => {
    const fake = mountFakeFomo(document, { cash: 50, position: 0 });
    expect(await executeTrade(document, { side: 'buy', amount: { kind: 'percent', value: 10 } }, FAST)).toMatchObject({ ok: true });
    expect(fake.state.submitted?.amount).toBe('5.00');
  });

  it('sells a preset percentage by clicking the preset', async () => {
    const fake = mountFakeFomo(document, { cash: 0, position: 40 });
    expect(await executeTrade(document, { side: 'sell', amount: { kind: 'percent', value: 25 } }, FAST)).toMatchObject({ ok: true });
    expect(fake.state.submitted).toEqual({ side: 'sell', amount: '10.00' });
  });

  it('sells a non-preset percentage by typing the dollar amount', async () => {
    const fake = mountFakeFomo(document, { cash: 0, position: 40 });
    expect(await executeTrade(document, { side: 'sell', amount: { kind: 'percent', value: 33 } }, FAST)).toMatchObject({ ok: true });
    expect(fake.state.submitted?.amount).toBe('13.20');
  });

  it('refuses trades under the $2 minimum or above the balance', async () => {
    mountFakeFomo(document, { cash: 0, position: 4 });
    expect(await executeTrade(document, { side: 'sell', amount: { kind: 'percent', value: 25 } }, FAST))
      .toMatchObject({ ok: false, kind: 'insufficient_funds', message: expect.stringMatching(/minimum/) });
    mountFakeFomo(document, { cash: 3, position: 0 });
    expect(await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST))
      .toMatchObject({ ok: false, kind: 'insufficient_funds', message: expect.stringMatching(/only \$3.00/) });
  });

  it('maps FOMO failure notices to slippage / rejected', async () => {
    mountFakeFomo(document, { cash: 100, position: 0, outcome: 'slippage' });
    expect(await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST)).toMatchObject({ ok: false, kind: 'slippage' });
    mountFakeFomo(document, { cash: 100, position: 0, outcome: 'error' });
    expect(await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST)).toMatchObject({ ok: false, kind: 'rejected' });
  });

  it('reports unknown when nothing confirms the trade', async () => {
    mountFakeFomo(document, { cash: 100, position: 0, outcome: 'silent' });
    expect(await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST)).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it('reports when the submit never becomes ready', async () => {
    mountFakeFomo(document, { cash: 100, position: 0, blockSubmit: true });
    expect(await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST))
      .toMatchObject({ ok: false, kind: 'ui_error', message: expect.stringMatching(/Minimum amount/) });
  });

  it('reports a tab it cannot switch to as a layout change (nothing bought or sold)', async () => {
    mountFakeFomo(document, { cash: 100, position: 0 });
    document.getElementById('tab-sell')!.replaceWith(Object.assign(document.createElement('span'), { textContent: 'x' }));
    expect(await executeTrade(document, { side: 'sell', amount: { kind: 'usd', value: 5 } }, FAST))
      .toMatchObject({ ok: false, kind: 'layout', message: expect.stringMatching(/sell tab/) });
  });

  it('reports a missing balance', async () => {
    mountFakeFomo(document, { cash: 100, position: 0 });
    document.getElementById('balance')!.innerHTML = '';
    expect(await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST))
      .toMatchObject({ ok: false, message: expect.stringMatching(/balance/) });
  });

  it('turns unexpected exceptions into ui_error results', async () => {
    mountFakeFomo(document, { cash: 100, position: 0 });
    const spy = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => { throw new Error('boom'); });
    try {
      expect(await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST))
        .toMatchObject({ ok: false, kind: 'ui_error', message: expect.stringMatching(/Unexpected error.*boom/) });
    } finally {
      spy.mockRestore();
    }
  });

  it('waits for the position to load instead of trusting the $0 placeholder', async () => {
    const fake = mountFakeFomo(document, { cash: 0, position: 0 });
    setTimeout(() => { fake.opts.position = 40; document.getElementById('tab-buy')!.click(); document.getElementById('tab-sell')!.click(); }, 150);
    const r = await executeTrade(document, { side: 'sell', amount: { kind: 'percent', value: 100 } }, FAST);
    expect(r).toMatchObject({ ok: true });
    expect(fake.state.submitted).toEqual({ side: 'sell', amount: '40.00' });
  });

  it('still refuses when the balance stays $0 after waiting', async () => {
    mountFakeFomo(document, { cash: 0, position: 0 });
    expect(await executeTrade(document, { side: 'sell', amount: { kind: 'percent', value: 100 } }, FAST))
      .toMatchObject({ ok: false, kind: 'insufficient_funds', message: expect.stringMatching(/after waiting/) });
  });

  it('reports a missing panel as not logged in — or as a layout change when fomo says the user is logged in', async () => {
    expect(await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST)).toMatchObject({ ok: false, kind: 'not_logged_in' });
    localStorage.setItem('ph_phc_test_posthog', JSON.stringify({ $stored_person_properties: { privyId: 'did:privy:cmabc123def456ghi789jkl0m' } }));
    try {
      expect(await executeTrade(document, { side: 'buy', amount: { kind: 'usd', value: 5 } }, FAST)).toMatchObject({ ok: false, kind: 'layout' });
    } finally {
      localStorage.removeItem('ph_phc_test_posthog');
    }
  });
});

