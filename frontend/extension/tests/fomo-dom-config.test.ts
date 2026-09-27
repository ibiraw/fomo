/**
 * @file fomo-dom-config.test.ts
 * @description Server-sent fomo page-layout overrides: merged field by field over the built-ins, invalid values
 *              ignored, and the page readers (panel, tabs, balance, submit, notifications, supply, username) follow
 *              an override — i.e. a fomo redesign can be fixed from the server without a store update.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { activeSide, findAmountInput, findPanel, findSubmit, findTab, notificationTexts, readBalance, readOwnFomoUsername, readSupply, submitReady } from '../lib/fomo-dom';
import { containsAnyWord, DEFAULT_FOMO_DOM, fomoDom, parseFomoDomConfig, setFomoDom } from '../lib/fomo-dom-config';

afterEach(() => {
  setFomoDom(null);
  document.body.innerHTML = '';
});

describe('parseFomoDomConfig', () => {
  it('gives the built-ins for missing or non-object input', () => {
    for (const raw of [null, undefined, 'x', 42, [], true]) expect(parseFomoDomConfig(raw)).toEqual(DEFAULT_FOMO_DOM);
  });

  it('overrides valid fields and keeps the built-ins for invalid ones, field by field', () => {
    const cfg = parseFomoDomConfig({
      tabLabels: { buy: 'Acheter', sell: 'Vendre' },
      amountInput: 'input[name="amount"]',
      notification: 'div[[[', // invalid selector → ignored
      failureWords: ['échec'],
      slippageWords: [], // empty → ignored
      sellPresets: [25, 50, 150], // 150 > 100 → ignored
      submitClasses: ['btn-submit'],
      tabBaseClasses: 'x" onclick="alert(1)', // not class names → ignored
      supplyLabel: 'Line1\nLine2', // multi-line → ignored
      unknownKey: 'ignored',
    });
    expect(cfg.tabLabels).toEqual({ buy: 'Acheter', sell: 'Vendre' });
    expect(cfg.amountInput).toBe('input[name="amount"]');
    expect(cfg.notification).toBe(DEFAULT_FOMO_DOM.notification);
    expect(cfg.failureWords).toEqual(['échec']);
    expect(cfg.slippageWords).toEqual(DEFAULT_FOMO_DOM.slippageWords);
    expect(cfg.sellPresets).toEqual(DEFAULT_FOMO_DOM.sellPresets);
    expect(cfg.submitClasses).toEqual(['btn-submit']);
    expect(cfg.tabBaseClasses).toBe(DEFAULT_FOMO_DOM.tabBaseClasses);
    expect(cfg.supplyLabel).toBe(DEFAULT_FOMO_DOM.supplyLabel);
    expect('unknownKey' in cfg).toBe(false);
  });

  it('rejects over-long values and incomplete buy/sell pairs', () => {
    const cfg = parseFomoDomConfig({ amountInput: `input${'x'.repeat(400)}`, lastPreset: { buy: '$100' }, failureWords: Array(21).fill('x') });
    expect(cfg.amountInput).toBe(DEFAULT_FOMO_DOM.amountInput);
    expect(cfg.lastPreset).toEqual(DEFAULT_FOMO_DOM.lastPreset);
    expect(cfg.failureWords).toEqual(DEFAULT_FOMO_DOM.failureWords);
  });

  it('matches words as plain, case-insensitive substrings (no patterns)', () => {
    expect(containsAnyWord('Transaction FAILED: slippage', ['fail'])).toBe(true);
    expect(containsAnyWord('Buying $3.00 X', ['fail', 'error'])).toBe(false);
    expect(containsAnyWord('a.b', ['.*'])).toBe(false); // not a regex
  });
});

describe('page readers follow the server overrides', () => {
  /** A "redesigned" fomo panel: French labels, a new amount input and submit class. */
  const redesigned = `
    <div id="panel">
      <div><button class="tab">Acheter</button><button class="tab off">Vendre</button></div>
      <input name="amount" value="">
      <div><button>100 $</button><span>$42.50</span></div>
      <button class="btn-submit">Acheter KEK</button>
    </div>
    <div class="toast-new">Échec de la transaction</div>
    <div><span>Offre</span><div>1.5B</div></div>
    <nav><a class="me" href="/u/ibiraw">me</a></nav>`;

  it('finds nothing with the built-ins, everything once the overrides arrive', () => {
    document.body.innerHTML = redesigned;
    expect(findPanel(document)).toBeNull();

    setFomoDom({
      tabLabels: { buy: 'Acheter', sell: 'Vendre' },
      amountInput: 'input[name="amount"]',
      inactiveTabClass: 'off',
      lastPreset: { buy: '100 $', sell: '100 %' },
      submitClasses: ['btn-submit'],
      notification: 'div.toast-new',
      failureWords: ['échec'],
      supplyLabel: 'Offre',
      ownProfileLink: 'nav a.me',
      profilePathPrefix: '/u/',
    });
    const panel = findPanel(document)!;
    expect(panel?.id).toBe('panel');
    expect(findTab(panel, 'sell')?.textContent).toBe('Vendre');
    expect(activeSide(panel)).toBe('buy');
    expect(findAmountInput(panel)?.name).toBe('amount');
    expect(readBalance(panel, 'buy')).toBe(42.5);
    expect(findSubmit(panel)?.textContent).toBe('Acheter KEK');
    expect(submitReady(panel, 'buy')).toBe(true);
    expect(notificationTexts(document)).toEqual(['Échec de la transaction']);
    expect(containsAnyWord(notificationTexts(document)[0]!, fomoDom().failureWords)).toBe(true);
    expect(readSupply(document)).toBeCloseTo(1_500_000_000);
    expect(readOwnFomoUsername(document)).toBe('ibiraw');
  });

  it('goes back to the built-ins when the server clears its overrides', () => {
    setFomoDom({ amountInput: 'input[name="amount"]' });
    expect(fomoDom().amountInput).toBe('input[name="amount"]');
    setFomoDom(null);
    expect(fomoDom()).toEqual(DEFAULT_FOMO_DOM);
  });
});
