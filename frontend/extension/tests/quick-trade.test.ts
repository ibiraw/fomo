/**
 * @file quick-trade.test.ts
 * @description v2.0.0 quick Buy/Sell buttons: preset validation, reading an item's token (token-page link, defined.fi
 *              and fomo logo file names, unknown networks), buttons only in the Alerts / Feed tabs, one row per item
 *              (redrawn when the token changes), and a tap → trade in a new tab → outcome on the button.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_QUICK_PRESETS, QuickTradeButtons, quickTradeItems, toQuickPresets, tokenKeyFromLogo, tokenKeyOfItem,
  type QuickTradeReply, type QuickTradeRequest,
} from '../lib/quick-trade';

const RH = '0xfdae23ce76018da62507bb5ef20e6ef5450e8312';
const SOL = 'FAAg5VLNJpTqawCbVxg5BqSVUAku5xrBebqU6vSGCm3n';

/** fomo's side panel with its tab row (the active tab has no grey class) and two items. */
function panel(active: 'Alerts' | 'Tokens' | 'Feed'): string {
  const tab = (t: string) => `<button class="${t === active ? '' : 'text-text-secondary'}">${t}</button>`;
  return `<div id="side"><div>${['Alerts', 'Tokens', 'Leaderboard', 'Feed'].map(tab).join('')}</div>
    <div>
      <div class="border-b border-bg-secondary"><a href="/tokens/robinhood/${RH}?tradeId=abc"><span>bigslime Buy $197</span></a></div>
      <div class="border-b border-bg-secondary"><div class="post"><img src="https://x.s3.amazonaws.com/avatar_small.jpg"><img src="https://token-media.defined.fi/1399811149_${SOL}_small_ea56.png"><p>Thesis</p></div></div>
    </div></div>`;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('presets', () => {
  it('keeps valid amounts and replaces invalid ones with the defaults', () => {
    expect(toQuickPresets({ buyA: 25, buyB: 500, sellPct: 100 })).toEqual({ buyA: 25, buyB: 500, sellPct: 100 });
    expect(toQuickPresets({ buyA: 1, buyB: 'x', sellPct: 0 })).toEqual(DEFAULT_QUICK_PRESETS);
    expect(toQuickPresets(null)).toEqual(DEFAULT_QUICK_PRESETS);
  });
});

describe('reading an item\'s token', () => {
  it('reads defined.fi and fomo logo names, and ignores unknown networks and other images', () => {
    expect(tokenKeyFromLogo(`https://token-media.defined.fi/4663_${RH}_small_e86a.png`)).toBe(`robinhood:${RH}`);
    expect(tokenKeyFromLogo(`https://cdn.fomo/logos/evm_8453_${RH}.webp`)).toBe(`base:${RH}`);
    expect(tokenKeyFromLogo(`https://cdn.fomo/logos/solana_solana_${SOL}.webp?v=1`)).toBe(SOL);
    expect(tokenKeyFromLogo(`https://token-media.defined.fi/1399811149_${SOL}_small_x.png`)).toBe(SOL);
    expect(tokenKeyFromLogo(`https://token-media.defined.fi/999_${RH}_small.png`)).toBeNull();
    expect(tokenKeyFromLogo('https://x.s3.amazonaws.com/434c48b7aa31922836de8fc25e318c81_small.jpg')).toBeNull();
  });

  it('prefers the token-page link, else the logo', () => {
    document.body.innerHTML = panel('Feed');
    const [trade, thesis] = document.querySelectorAll('.border-b');
    expect(tokenKeyOfItem(trade!)).toBe(`robinhood:${RH}`);
    expect(tokenKeyOfItem(thesis!)).toBe(SOL);
  });
});

describe('QuickTradeButtons', () => {
  it('only adds buttons in the Alerts and Feed tabs', () => {
    document.body.innerHTML = panel('Tokens');
    expect(quickTradeItems(document)).toHaveLength(0);
    document.body.innerHTML = panel('Alerts');
    expect(quickTradeItems(document)).toHaveLength(2);
  });

  it('adds one row of the preset buttons per item, and redraws a row when its item shows another token', () => {
    document.body.innerHTML = panel('Feed');
    const w = new QuickTradeButtons({ doc: document, presets: () => ({ buyA: 25, buyB: 100, sellPct: 30 }), send: vi.fn() });
    w.scan();
    w.scan();
    const rows = document.querySelectorAll('[data-limit-quick]');
    expect(rows).toHaveLength(2);
    expect([...rows[0]!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Buy $25', 'Buy $100', 'Sell 30%']);
    document.querySelector('a')!.setAttribute('href', `/tokens/base/${RH}`); // fomo reused the item for another trade
    w.scan();
    expect(document.querySelector('[data-limit-quick]')!.getAttribute('data-limit-quick')).toBe(`base:${RH}`);
    w.clear();
    expect(document.querySelectorAll('[data-limit-quick]')).toHaveLength(0);
  });

  it('asks for a trade on tap without opening the post, and shows the outcome', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = panel('Feed');
    const sent: QuickTradeRequest[] = [];
    let answer: QuickTradeReply = { ok: true };
    const w = new QuickTradeButtons({ doc: document, presets: () => DEFAULT_QUICK_PRESETS, send: async (r) => { sent.push(r); return answer; } });
    w.scan();
    const clicked = vi.fn();
    document.querySelector('.border-b')!.addEventListener('click', clicked);
    const [buy, , sell] = document.querySelectorAll<HTMLButtonElement>('[data-limit-quick] button');
    buy!.click();
    buy!.click(); // a double tap trades once
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{ type: 'fomo.quick', mint: `robinhood:${RH}`, side: 'buy', amount: { kind: 'usd', value: 50 } }]);
    expect(clicked).not.toHaveBeenCalled();
    expect(buy!.textContent).toBe('✓ Bought');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(buy!.textContent).toBe('Buy $50');
    answer = { ok: false, error: "You don't hold this token" };
    sell!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sell!.textContent).toBe('✗ Failed');
    expect(sell!.title).toBe("You don't hold this token");
    await vi.advanceTimersByTimeAsync(6_000);
    answer = { ok: false, error: 'FOMO tab did not answer', unknown: true }; // pressed, outcome not seen
    sell!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sell!.textContent).toBe('? Check fomo');
    expect(sell!.title).toMatch(/may have gone through/);
    vi.useRealTimers();
  });
});
