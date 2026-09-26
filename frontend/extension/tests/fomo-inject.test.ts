/**
 * @file fomo-inject.test.ts
 * @description Tests for the Limit tab injection into FOMO's trade panel.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACTIVE_ATTR,
  appendViewAfter,
  ensureLimitTab,
  ensurePageStyle,
  isLimitActive,
  LIMIT_TAB_ID,
  setLimitActive,
} from '../lib/fomo-inject';
import { mountFakeFomo } from './fake-fomo';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

/** Wraps the fake panel's tabs in a row like FOMO does ("DIV.flex.gap-2"). */
function mountWithTabRow(): HTMLElement {
  mountFakeFomo(document, { cash: 100, position: 0 });
  const panel = document.getElementById('panel')!;
  const row = document.createElement('div');
  row.className = 'flex gap-2';
  panel.prepend(row);
  row.append(document.getElementById('tab-buy')!, document.getElementById('tab-sell')!);
  return panel;
}

describe('fomo-inject', () => {
  it('adds one Limit tab right after Sell, idempotently', () => {
    const panel = mountWithTabRow();
    const a = ensureLimitTab(document);
    ensureLimitTab(document);
    expect(a?.panel).toBe(panel);
    const tabs = [...a!.tabRow.querySelectorAll('button')].map((b) => b.textContent);
    expect(tabs).toEqual(['Buy', 'Sell', 'Limit']);
    expect(a!.tabRow.hasAttribute('data-fomo-limit-keep')).toBe(true);
  });

  it('toggles the Limit view from its tab and back from Buy/Sell', () => {
    const panel = mountWithTabRow();
    ensureLimitTab(document);
    const limit = document.getElementById(LIMIT_TAB_ID)!;
    limit.click();
    expect(isLimitActive(panel)).toBe(true);
    expect(limit.hasAttribute('data-active')).toBe(true);
    document.getElementById('tab-sell')!.click();
    expect(panel.hasAttribute(ACTIVE_ATTR)).toBe(false);
    expect(limit.hasAttribute('data-active')).toBe(false);
    expect(limit.className).toContain('bg-bg-secondary');
  });

  it('restores the active look when FOMO re-renders the tab row', () => {
    const panel = mountWithTabRow();
    ensureLimitTab(document);
    setLimitActive(panel, true);
    document.getElementById(LIMIT_TAB_ID)!.remove();
    ensureLimitTab(document);
    expect(document.getElementById(LIMIT_TAB_ID)!.hasAttribute('data-active')).toBe(true);
  });

  it('wraps the view host so page CSS can hide it', () => {
    mountWithTabRow();
    const { tabRow } = ensureLimitTab(document)!;
    const host = document.createElement('fomo-limit-orders');
    appendViewAfter(tabRow, host);
    expect(tabRow.nextElementSibling?.hasAttribute('data-fomo-limit-view')).toBe(true);
    expect(host.parentElement).toBe(tabRow.nextElementSibling);
  });

  it('returns null without a panel or tab row, and adds the page style once', () => {
    expect(ensureLimitTab(document)).toBeNull();
    mountFakeFomo(document, { cash: 1, position: 0 });
    document.getElementById('tab-sell')!.remove();
    expect(ensureLimitTab(document)).toBeNull();
    ensurePageStyle(document);
    ensurePageStyle(document);
    expect(document.head.querySelectorAll('style')).toHaveLength(1);
  });
});
