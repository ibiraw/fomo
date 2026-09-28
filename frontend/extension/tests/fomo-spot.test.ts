/**
 * @file fomo-spot.test.ts
 * @description Spot-trade watcher: fomo's "Buying …" / "Selling …" toasts are reported once each (with the page's
 *              token), other toasts are ignored, still-empty toasts are looked at again, and the prefixes follow the
 *              server's layout settings.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { setFomoDom } from '../lib/fomo-dom-config';
import { parseSellToast, readPosition, summarizeSell } from '../lib/fomo-positions';
import { SpotTradeWatcher, spotSide, titleSymbol, tradeText, type SpotTradeMessage } from '../lib/fomo-spot-watch';

const toast = (text: string): string => `<div class="bg-bg-primary rounded-xl outline">${text}</div>`;

afterEach(() => {
  setFomoDom(null);
  document.body.innerHTML = '';
});

describe('SpotTradeWatcher', () => {
  it('reports each trade toast once, with the token, and ignores other toasts', () => {
    const sent: SpotTradeMessage[] = [];
    const w = new SpotTradeWatcher({ doc: document, mint: () => 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump', symbol: () => null, send: (m) => sent.push(m), now: () => 0 });
    document.body.innerHTML = toast('Buying   $3.00\nKEK') + toast('Copied to clipboard') + toast('');
    w.scan();
    w.scan();
    expect(sent).toEqual([{ type: 'fomo.spot', side: 'buy', detail: 'Buying $3.00 KEK', mint: 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump', sell: null }]);
    document.body.querySelectorAll('div')[2]!.textContent = 'Selling 1.2M KEK'; // the empty toast finished rendering
    w.scan();
    expect(sent.at(-1)).toMatchObject({ side: 'sell', detail: 'Selling 1.2M KEK' });
    expect(sent).toHaveLength(2);
  });

  it('reports a toast fomo reuses for the next trade, but not its ticking "ago" time', () => {
    const sent: SpotTradeMessage[] = [];
    const w = new SpotTradeWatcher({ doc: document, mint: () => null, symbol: () => null, send: (m) => sent.push(m), now: () => 0 });
    document.body.innerHTML = toast('Selling 467.4K TAERIJust now');
    w.scan();
    const el = document.body.querySelector('div')!;
    el.textContent = 'Selling 467.4K TAERI 1m ago'; // only the time changed
    w.scan();
    el.textContent = 'Selling 2.1M SOLCATJust now'; // same toast, next trade
    w.scan();
    expect(sent.map((m) => m.detail)).toEqual(['Selling 467.4K TAERIJust now', 'Selling 2.1M SOLCATJust now']);
    expect(tradeText('Buying $3.00 KEK 12 mins ago')).toBe('Buying $3.00 KEK');
  });

  it('follows the server-set prefixes', () => {
    expect(spotSide('Achat de $3 KEK')).toBeNull();
    setFomoDom({ spotBuyPrefixes: ['Achat'], spotSellPrefixes: ['Vente'] });
    expect(spotSide('Achat de $3 KEK')).toBe('buy');
    expect(spotSide('vente de 1M KEK')).toBe('sell');
  });
});

/** fomo's "Your positions" list as observed 2026-09-28. */
const positions = (rows: string): string =>
  `<div><div><div class="flex"><div class="text-base">Your positions</div><span>2</span></div></div>${rows}</div>`;
const row = (sym: string, amount: string, value: string, arrow: string, pct: string): string =>
  `<div><p>${sym}</p><p>${amount} ${sym}</p><p>${value}</p><p>${arrow}</p><p>${pct}</p><p>Buy</p></div>`;

describe('fomo positions and sells', () => {
  it('reads the token row: amount, value and signed PnL', () => {
    document.body.innerHTML = positions(row('KEK', '717.3K', '$87.45', '▼', '11.71%') + row('QCAT', '211.3K', '$48.20', '▲', '12.40%'));
    expect(readPosition(document, 'qcat')).toEqual({ amount: 211_300, valueUsd: 48.2, pnlPct: 12.4 });
    expect(readPosition(document, 'KEK')).toEqual({ amount: 717_300, valueUsd: 87.45, pnlPct: -11.71 });
    expect(readPosition(document, 'NOPE')).toBeNull();
    document.body.innerHTML = '';
    expect(readPosition(document, 'KEK')).toBeNull();
  });

  it('turns a sell toast into all / partial, ~USD and PnL', () => {
    expect(parseSellToast('Selling 211.3K QCAT')).toEqual({ amount: 211_300, symbol: 'QCAT' });
    const held = { amount: 211_300, valueUsd: 48.2, pnlPct: 12.4 };
    expect(summarizeSell('Selling 211.3K QCAT', held)).toEqual({ all: true, soldPct: 100, usd: 48.2, pnlPct: 12.4 });
    expect(summarizeSell('Selling 95K QCAT', held)).toEqual({ all: false, soldPct: 45, usd: 21.67, pnlPct: 12.4 });
    expect(summarizeSell('Selling 95K QCAT', null)).toBeNull();
    expect(summarizeSell('Selling lots', held)).toBeNull();
  });

  it('measures a sell against the position just before it (the snapshot, if fomo already removed the row)', () => {
    const sent: SpotTradeMessage[] = [];
    let t = 0;
    const w = new SpotTradeWatcher({ doc: document, mint: () => 'ethereum:0xf276c33394bcc329156450f575873357a2c3ef06', symbol: () => 'QCAT', send: (m) => sent.push(m), now: () => t });
    document.body.innerHTML = positions(row('QCAT', '211.3K', '$48.20', '▼', '3.10%'));
    w.scan(); // snapshot taken
    t += 1_000;
    document.body.innerHTML = toast('Selling 211.3K QCAT'); // row gone after a full sell
    w.scan();
    expect(sent[0]).toMatchObject({ side: 'sell', sell: { all: true, soldPct: 100, usd: 48.2, pnlPct: -3.1 } });
    expect(titleSymbol('$67.1K MC | QCAT | fomo')).toBe('QCAT');
    expect(titleSymbol('fomo')).toBeNull();
  });
});
