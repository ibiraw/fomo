/**
 * @file themes.test.ts
 * @description Tests for themes: lookup, alpha colors and the extension tokens.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { applyPanelVars, DEFAULT_THEME, panelVars, themeById, THEMES, withAlpha } from '../lib/themes';

describe('themes', () => {
  it('looks up themes and falls back to fomo Default', () => {
    expect(themeById('mono').name).toBe('Mono');
    expect(themeById('nope')).toBe(DEFAULT_THEME);
    expect(themeById(undefined)).toBe(DEFAULT_THEME);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
  });

  it('adds alpha to hex colors', () => {
    expect(withAlpha('#ffffff', 0.1)).toBe('#ffffff1a');
    expect(withAlpha('#000000', 2)).toBe('#000000ff');
  });

  it('maps a theme to the extension tokens and applies them inline', () => {
    const t = themeById('mono');
    expect(panelVars(t)).toMatchObject({ '--background': '#09090b', '--primary': '#ffffff', '--primary-foreground': '#09090b', '--yellow': '#ffffff' });
    const el = document.createElement('div');
    applyPanelVars(el, t);
    expect(el.style.getPropertyValue('--buy')).toBe('#22c55e');
  });

});
