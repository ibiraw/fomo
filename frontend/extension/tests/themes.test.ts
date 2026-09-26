/**
 * @file themes.test.ts
 * @description Tests for themes: fomo variable overrides, extension tokens and page stylesheet handling.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { setPageTheme } from '../lib/fomo-inject';
import { applyPanelVars, DEFAULT_THEME, fomoOverrideCss, panelVars, themeById, THEMES, withAlpha } from '../lib/themes';

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

  it("overrides fomo's color variables, and nothing for the default theme", () => {
    expect(fomoOverrideCss(DEFAULT_THEME)).toBe('');
    const css = fomoOverrideCss(themeById('royal'));
    expect(css).toContain('--color-bg-primary: #0a0714 !important;');
    expect(css).toContain('--color-green: #3ddc97 !important;');
    expect(css).toContain('--color-accent-primary: #6f45d6 !important;');
    expect(css).toContain('--fomo-limit-brand: #b18cff !important;');
    expect(css).toContain('html, body { background: #0a0714 !important; }');
  });

  it('keeps fomo button colors dark enough for its white text', () => {
    // relative luminance of the action color must allow >= 3:1 contrast with white
    const lum = (hex: string): number => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    for (const t of THEMES) expect((1.05) / (lum(t.action) + 0.05), t.name).toBeGreaterThanOrEqual(3);
  });

  it('maps a theme to the extension tokens and applies them inline', () => {
    const t = themeById('mono');
    expect(panelVars(t)).toMatchObject({ '--background': '#09090b', '--primary': '#ffffff', '--primary-foreground': '#09090b', '--yellow': '#ffffff' });
    const el = document.createElement('div');
    applyPanelVars(el, t);
    expect(el.style.getPropertyValue('--buy')).toBe('#22c55e');
  });

  it('installs, updates and clears the page theme stylesheet', () => {
    setPageTheme(document, ':root{--x:1}');
    setPageTheme(document, ':root{--x:2}');
    expect(document.querySelectorAll('#fomo-limit-theme')).toHaveLength(1);
    expect(document.getElementById('fomo-limit-theme')!.textContent).toBe(':root{--x:2}');
    setPageTheme(document, '');
    expect(document.getElementById('fomo-limit-theme')).toBeNull();
  });
});
