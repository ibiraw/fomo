/**
 * @file themes.ts
 * @description The extension's themes, for showing on the site. Colors mirror
 *              frontend/extension/lib/themes.ts — keep the two in sync when themes change.
 * @author Reborn1987
 */

export interface SiteTheme {
  readonly id: string;
  readonly name: string;
  readonly bg: string;
  readonly surface: string;
  readonly line: string;
  readonly text: string;
  readonly muted: string;
  /** Limit tab / highlights. */
  readonly brand: string;
  /** The Limit panel's Place button and its text. */
  readonly button: string;
  readonly onButton: string;
  readonly buy: string;
  readonly sell: string;
  /** One-line character of the theme. */
  readonly vibe: string;
}

export const SITE_THEMES: readonly SiteTheme[] = [
  { id: 'fomo', name: 'fomo Default', vibe: "fomo's own colors", bg: '#060510', surface: '#12111a', line: '#22212c', text: '#f7f7f7', muted: '#9899a3', brand: '#ffbf17', button: '#516af6', onButton: '#ffffff', buy: '#21c95e', sell: '#ff622e' },
  { id: 'mono', name: 'Mono', vibe: 'Black and white; only trades have color', bg: '#09090b', surface: '#16161a', line: '#26262c', text: '#fafafa', muted: '#9a9aa3', brand: '#ffffff', button: '#ffffff', onButton: '#09090b', buy: '#22c55e', sell: '#f43f5e' },
  { id: 'gold', name: 'Midnight Gold', vibe: 'Ink black, muted gold', bg: '#07080c', surface: '#111318', line: '#1e2129', text: '#f5f1e8', muted: '#9c9689', brand: '#e8c268', button: '#e8c268', onButton: '#14100a', buy: '#3ccf8e', sell: '#f0634f' },
  { id: 'signal', name: 'Signal Blue', vibe: 'Calm trading-terminal navy', bg: '#070b14', surface: '#101827', line: '#1d2638', text: '#eef3ff', muted: '#8e9bb5', brand: '#4f8cff', button: '#4f8cff', onButton: '#ffffff', buy: '#2fd08a', sell: '#ff5d73' },
  { id: 'teal', name: 'Deep Teal', vibe: 'Sea-dark, bright teal', bg: '#041012', surface: '#0a1c1f', line: '#132d31', text: '#e8fbfa', muted: '#86aaa8', brand: '#22d3c5', button: '#22d3c5', onButton: '#021413', buy: '#4ade80', sell: '#ff6b5e' },
  { id: 'royal', name: 'Royal Lavender', vibe: 'Soft violet, easy on the eyes', bg: '#0a0714', surface: '#150f26', line: '#241a3d', text: '#f4f0ff', muted: '#a59cc0', brand: '#b18cff', button: '#b18cff', onButton: '#150a2e', buy: '#3ddc97', sell: '#ff6b81' },
  { id: 'ice', name: 'Ice', vibe: 'Crisp blue-grey, pale cyan', bg: '#0a0e12', surface: '#121a21', line: '#1d2932', text: '#eef9ff', muted: '#8ea3b1', brand: '#7fe0ff', button: '#7fe0ff', onButton: '#04131a', buy: '#35d49a', sell: '#ff6b6b' },
  { id: 'solar', name: 'Solar Flare', vibe: 'Warm brown-black, burnt orange', bg: '#0d0806', surface: '#1a110c', line: '#2a1c14', text: '#fff4ec', muted: '#b39b8c', brand: '#ff8a3d', button: '#ff8a3d', onButton: '#1a0c03', buy: '#3fd97f', sell: '#ff4d5e' },
  { id: 'tokyo', name: 'Neon Tokyo', vibe: 'Cyan brand, hot pink action', bg: '#0a0616', surface: '#150f26', line: '#261b40', text: '#f1f5ff', muted: '#9d9abb', brand: '#22e5ff', button: '#ff3d9a', onButton: '#ffffff', buy: '#35e39a', sell: '#ff7a45' },
];

/** CSS custom properties that paint a mock with a theme. */
export function themeStyle(t: SiteTheme): Record<string, string> {
  return {
    '--t-bg': t.bg, '--t-surface': t.surface, '--t-line': t.line, '--t-text': t.text, '--t-muted': t.muted,
    '--t-brand': t.brand, '--t-button': t.button, '--t-on-button': t.onButton, '--t-buy': t.buy, '--t-sell': t.sell,
  };
}
