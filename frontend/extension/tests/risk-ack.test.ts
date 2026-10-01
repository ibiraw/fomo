/**
 * @file risk-ack.test.ts
 * @description Auto-tick of fomo's risk warning: finds the checkbox (not the expand button), reads ticked/unticked from
 *              fomo's SVG as seen live on memefi (2026-10-01), ticks only on the Buy tab, never unticks, retries slowly.
 * @vitest-environment happy-dom
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { findRiskCheckbox, parseAutoRiskAck, RiskAckTicker, riskAcknowledged } from '../lib/risk-ack';

const UNTICKED = '<svg><path d="M10.8 2H5.2C4 2 2 4 2 5.2V10.8Z" stroke="currentColor"></path></svg>';
const TICKED = '<svg><path fill="currentColor" stroke="currentColor" d="M2 5.2Z"></path><path stroke="#060510" d="M11.1 5.7L6.8 9.9L4.9 8"></path></svg>';

/** fomo's trade panel with (optionally) the warning box, Buy or Sell selected. */
function page(side: 'buy' | 'sell', warning = true): { doc: Document; box: () => HTMLButtonElement | null; expand: () => HTMLButtonElement | null } {
  document.body.innerHTML = `
    <div id="panel">
      <button class="${side === 'buy' ? '' : 'bg-bg-secondary'}">Buy</button>
      <button class="${side === 'sell' ? '' : 'bg-bg-secondary'}">Sell</button>
      <input placeholder="0">
      <button class="py-2 text-center" disabled>Buy memefi</button>
      ${warning ? `<div class="rounded-xl overflow-hidden bg-critical-transparent"><div class="flex items-start py-2 gap-2 mx-2.5">
        <button type="button" class="shrink-0 mt-0.5" id="box">${UNTICKED}</button>
        <button type="button" class="flex-1 min-w-0 flex items-start justify-between" id="expand"><div class="flex flex-col text-left">
          <span class="text-sm font-bold text-critical">Warning: 3 issues</span>
          <span class="text-xs text-text-primary/60">I understand the risks of trading this token.</span></div>
          <svg><path d="M4 6l4 4 4-4"></path></svg></button></div></div>` : ''}
    </div>`;
  const box = document.getElementById('box') as HTMLButtonElement | null;
  // Like fomo: clicking the checkbox toggles its icon.
  box?.addEventListener('click', () => { box.innerHTML = box.innerHTML.includes('#060510') ? UNTICKED : TICKED; });
  return { doc: document, box: () => document.getElementById('box') as HTMLButtonElement | null, expand: () => document.getElementById('expand') as HTMLButtonElement | null };
}

describe('auto-tick fomo risk warning', () => {
  it('finds the checkbox, not the button that expands the issue list', () => {
    const { box } = page('buy');
    expect(findRiskCheckbox(document.getElementById('panel')!)).toBe(box());
  });

  it("reads fomo's ticked and unticked icons", () => {
    const { box } = page('buy');
    expect(riskAcknowledged(box()!)).toBe(false);
    box()!.innerHTML = TICKED;
    expect(riskAcknowledged(box()!)).toBe(true);
    box()!.setAttribute('aria-checked', 'false');
    expect(riskAcknowledged(box()!)).toBe(false); // ARIA wins when present
  });

  it('ticks it once on the Buy tab and never unticks it', () => {
    const { doc, box } = page('buy');
    const ticker = new RiskAckTicker(doc, () => 0);
    expect(ticker.scan()).toBe(true);
    expect(riskAcknowledged(box()!)).toBe(true);
    expect(ticker.scan()).toBe(false);
    expect(riskAcknowledged(box()!)).toBe(true);
  });

  it('leaves the Sell tab and pages without the warning alone', () => {
    const sell = page('sell');
    expect(new RiskAckTicker(sell.doc).scan()).toBe(false);
    expect(riskAcknowledged(sell.box()!)).toBe(false);
    expect(new RiskAckTicker(page('buy', false).doc).scan()).toBe(false);
  });

  it("clicks a checkbox that didn't take again only after a pause", () => {
    const { doc, box } = page('buy');
    let now = 0;
    const ticker = new RiskAckTicker(doc, () => now);
    box()!.replaceWith(Object.assign(box()!.cloneNode(true), {})); // a checkbox that ignores clicks
    let clicks = 0;
    box()!.addEventListener('click', () => clicks++);
    ticker.scan();
    now = 500;
    ticker.scan();
    expect(clicks).toBe(1);
    now = 2_000;
    ticker.scan();
    expect(clicks).toBe(2);
  });

  it('defaults to off', () => {
    expect(parseAutoRiskAck(undefined)).toBe(false);
    expect(parseAutoRiskAck(true)).toBe(true);
  });
});
