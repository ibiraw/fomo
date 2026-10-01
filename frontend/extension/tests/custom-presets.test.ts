/**
 * @file custom-presets.test.ts
 * @description The balance is still found when the user changed fomo's presets (LM-WFA346, 2026-10-01: "$300" instead
 *              of "$100" paused his trades as "missing buy balance"). Markup from his layout snapshot.
 * @vitest-environment happy-dom
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { findPanel, readBalance } from '../lib/fomo-dom';
import { checkLayout } from '../lib/fomo-health';

/** fomo's Buy tab with the user's own presets. */
function mount(presets: string[], side: 'buy' | 'sell' = 'buy'): HTMLElement {
  document.body.innerHTML = `
    <div class="border rounded-2xl p-2 flex flex-col gap-2">
      <div class="flex gap-2">
        <button class="${side === 'buy' ? 'bg-green-transparent text-green' : 'bg-bg-secondary'}">Buy</button>
        <button class="${side === 'sell' ? 'bg-red-transparent text-red' : 'bg-bg-secondary'}">Sell</button>
      </div>
      <div class="bg-bg-secondary rounded-xl"><div><div>$</div><input placeholder="0"></div><div><div>Enter amount</div></div></div>
      <div class="grid grid-cols-4 gap-2">${presets.map((p) => `<button class="hover-scrim h-8">${p}</button>`).join('')}</div>
      <div class="flex flex-col px-2 text-sm"><div class="flex justify-between"><div class="flex"><div><span>$810.55</span></div><button>Max</button></div></div></div>
      <button class="py-2 text-center" disabled>${side === 'buy' ? 'Buy' : 'Sell'} PROPHET</button>
    </div>`;
  return findPanel(document)!;
}

describe('custom fomo presets', () => {
  it('reads the balance with the default presets', () => {
    expect(readBalance(mount(['$25', '$50', '$75', '$100']), 'buy')).toBe(810.55);
  });

  it('reads the balance when the last preset was changed ($300)', () => {
    const panel = mount(['$25', '$50', '$75', '$300']);
    expect(readBalance(panel, 'buy')).toBe(810.55);
    expect(checkLayout(document).missing.join(' ')).not.toMatch(/balance/);
  });

  it('reads it with any custom amounts, and on the Sell tab with custom percentages', () => {
    expect(readBalance(mount(['$10', '$1.5K', '$2,000', '$5K']), 'buy')).toBe(810.55);
    expect(readBalance(mount(['5%', '20%', '33%', '75%'], 'sell'), 'sell')).toBe(810.55);
  });

  it('still reports a missing balance when there is none', () => {
    const panel = mount(['$25', '$50', '$75', '$300']);
    panel.querySelector('span')!.textContent = 'Deposit';
    expect(readBalance(panel, 'buy')).toBeNull();
  });
});
