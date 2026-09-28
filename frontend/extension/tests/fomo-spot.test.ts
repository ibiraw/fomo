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
import { SpotTradeWatcher, spotSide, type SpotTradeMessage } from '../lib/fomo-spot-watch';

const toast = (text: string): string => `<div class="bg-bg-primary rounded-xl outline">${text}</div>`;

afterEach(() => {
  setFomoDom(null);
  document.body.innerHTML = '';
});

describe('SpotTradeWatcher', () => {
  it('reports each trade toast once, with the token, and ignores other toasts', () => {
    const sent: SpotTradeMessage[] = [];
    const w = new SpotTradeWatcher({ doc: document, mint: () => 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump', send: (m) => sent.push(m) });
    document.body.innerHTML = toast('Buying   $3.00\nKEK') + toast('Copied to clipboard') + toast('');
    w.scan();
    w.scan();
    expect(sent).toEqual([{ type: 'fomo.spot', side: 'buy', detail: 'Buying $3.00 KEK', mint: 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump' }]);
    document.body.querySelectorAll('div')[2]!.textContent = 'Selling 1.2M KEK'; // the empty toast finished rendering
    w.scan();
    expect(sent.at(-1)).toMatchObject({ side: 'sell', detail: 'Selling 1.2M KEK' });
    expect(sent).toHaveLength(2);
  });

  it('follows the server-set prefixes', () => {
    expect(spotSide('Achat de $3 KEK')).toBeNull();
    setFomoDom({ spotBuyPrefixes: ['Achat'], spotSellPrefixes: ['Vente'] });
    expect(spotSide('Achat de $3 KEK')).toBe('buy');
    expect(spotSide('vente de 1M KEK')).toBe('sell');
  });
});
