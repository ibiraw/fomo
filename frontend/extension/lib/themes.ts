/**
 * @file themes.ts
 * @description Color themes the user can apply to fomo.family and the Limit panel. A theme overrides
 *              fomo's own CSS color variables (so the whole page follows) and the extension's tokens.
 *              fomo's variable names were read from the live site (2026-09-26).
 * @author Reborn1987
 */

export interface Theme {
  readonly id: string;
  readonly name: string;
  /** Page background. */
  readonly bg: string;
  /** Cards and panels. */
  readonly surface: string;
  /** Opaque raised surface (menus, muted blocks). */
  readonly raised: string;
  /** Borders and dividers. */
  readonly line: string;
  readonly text: string;
  readonly muted: string;
  readonly faint: string;
  /** Brand accent: the Limit tab, highlights. */
  readonly brand: string;
  /** Button color on fomo's page. fomo always prints white text on it, so it must stay dark enough. */
  readonly action: string;
  /** Soft tint of the action color (fomo's secondary/accent surfaces). */
  readonly actionSoft: string;
  /** The Limit panel's own Place button (may be light, since we control its text color). */
  readonly button: string;
  readonly onButton: string;
  readonly buy: string;
  readonly sell: string;
}

/** fomo's own colors — selecting it removes every override. */
export const DEFAULT_THEME: Theme = {
  id: 'fomo', name: 'fomo Default',
  bg: '#060510', surface: '#12111a', raised: '#161522', line: '#474b52',
  text: '#f7f7f7', muted: '#9899a3', faint: '#474b52',
  brand: '#ffbf17', action: '#516af6', actionSoft: '#221d4b', button: '#516af6', onButton: '#ffffff',
  buy: '#21c95e', sell: '#ff622e',
};

export const THEMES: readonly Theme[] = [
  DEFAULT_THEME,
  { id: 'mono', name: 'Mono', bg: '#09090b', surface: '#16161a', raised: '#1c1c21', line: '#34343c', text: '#fafafa', muted: '#9a9aa3', faint: '#52525b',
    brand: '#ffffff', action: '#3f3f46', actionSoft: '#1f1f24', button: '#ffffff', onButton: '#09090b', buy: '#22c55e', sell: '#f43f5e' },
  { id: 'gold', name: 'Midnight Gold', bg: '#07080c', surface: '#111318', raised: '#171a20', line: '#2c303a', text: '#f5f1e8', muted: '#9c9689', faint: '#4d4a44',
    brand: '#e8c268', action: '#8a6a1f', actionSoft: '#231c0d', button: '#e8c268', onButton: '#14100a', buy: '#3ccf8e', sell: '#f0634f' },
  { id: 'signal', name: 'Signal Blue', bg: '#070b14', surface: '#101827', raised: '#141e30', line: '#26314a', text: '#eef3ff', muted: '#8e9bb5', faint: '#3e4a63',
    brand: '#4f8cff', action: '#2f63d6', actionSoft: '#12203f', button: '#4f8cff', onButton: '#ffffff', buy: '#2fd08a', sell: '#ff5d73' },
  { id: 'teal', name: 'Deep Teal', bg: '#041012', surface: '#0a1c1f', raised: '#0e2327', line: '#1c3a3f', text: '#e8fbfa', muted: '#86aaa8', faint: '#39504f',
    brand: '#22d3c5', action: '#0e7f78', actionSoft: '#0b2a29', button: '#22d3c5', onButton: '#021413', buy: '#4ade80', sell: '#ff6b5e' },
  { id: 'royal', name: 'Royal Lavender', bg: '#0a0714', surface: '#150f26', raised: '#1b1430', line: '#30264d', text: '#f4f0ff', muted: '#a59cc0', faint: '#4d4566',
    brand: '#b18cff', action: '#6f45d6', actionSoft: '#231a42', button: '#b18cff', onButton: '#150a2e', buy: '#3ddc97', sell: '#ff6b81' },
  { id: 'ice', name: 'Ice', bg: '#0a0e12', surface: '#121a21', raised: '#16202a', line: '#26343f', text: '#eef9ff', muted: '#8ea3b1', faint: '#3e4f5b',
    brand: '#7fe0ff', action: '#1b6f91', actionSoft: '#10232e', button: '#7fe0ff', onButton: '#04131a', buy: '#35d49a', sell: '#ff6b6b' },
  { id: 'solar', name: 'Solar Flare', bg: '#0d0806', surface: '#1a110c', raised: '#21160f', line: '#3a281d', text: '#fff4ec', muted: '#b39b8c', faint: '#5a4638',
    brand: '#ff8a3d', action: '#c4561a', actionSoft: '#2d1709', button: '#ff8a3d', onButton: '#1a0c03', buy: '#3fd97f', sell: '#ff4d5e' },
  { id: 'tokyo', name: 'Neon Tokyo', bg: '#0a0616', surface: '#150f26', raised: '#1b1430', line: '#30264d', text: '#f1f5ff', muted: '#9d9abb', faint: '#4a4666',
    brand: '#22e5ff', action: '#d62a80', actionSoft: '#2a0f22', button: '#ff3d9a', onButton: '#ffffff', buy: '#35e39a', sell: '#ff7a45' },
];

/** Looks up a theme by id, falling back to fomo's own colors. */
export function themeById(id: unknown): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** `#rrggbb` + alpha (0–1) as `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
  return `${hex.slice(0, 7)}${a}`;
}

/** CSS that recolors fomo's page by overriding its color variables. Empty for the default theme. */
export function fomoOverrideCss(t: Theme): string {
  if (t.id === DEFAULT_THEME.id) return '';
  const v: Record<string, string> = {
    '--color-background': t.bg,
    '--color-bg-primary': t.bg,
    '--color-bg-secondary': t.surface,
    '--color-popover': t.surface,
    '--color-bg-tertiary': withAlpha(t.text, 0.1),
    '--color-bg-tertiary-solid': t.raised,
    '--color-muted': t.raised,
    '--color-border': t.line,
    '--color-input': t.line,
    '--color-foreground': t.text,
    '--color-text-primary': t.text,
    '--color-popover-foreground': t.text,
    '--color-accent-foreground': t.text,
    '--color-text-secondary': t.muted,
    '--color-muted-foreground': t.muted,
    '--color-text-tertiary': t.faint,
    '--color-accent-primary': t.action,
    '--color-primary': t.action,
    '--color-ring': t.action,
    '--color-accent-gradient-start': t.action,
    '--color-accent-primary-transparent': withAlpha(t.action, 0.16),
    '--color-accent': t.actionSoft,
    '--color-accent-secondary': t.actionSoft,
    '--color-secondary': t.actionSoft,
    '--color-green': t.buy,
    '--color-green-transparent': withAlpha(t.buy, 0.2),
    '--color-red': t.sell,
    '--color-red-transparent': withAlpha(t.sell, 0.2),
    '--color-critical': t.sell,
    '--color-critical-transparent': withAlpha(t.sell, 0.12),
    '--color-destructive': t.sell,
    '--fomo-limit-brand': t.brand,
  };
  const decls = Object.entries(v).map(([k, val]) => `  ${k}: ${val} !important;`).join('\n');
  return `:root {\n${decls}\n}\nhtml, body { background: ${t.bg} !important; }`;
}

/** The extension's own design tokens (popup + Limit panel) for a theme. */
export function panelVars(t: Theme): Record<string, string> {
  const tint = withAlpha(t.text, 0.1);
  return {
    '--background': t.bg,
    '--foreground': t.text,
    '--card': t.surface,
    '--card-foreground': t.text,
    '--popover': t.surface,
    '--popover-foreground': t.text,
    '--primary': t.button,
    '--primary-foreground': t.onButton,
    '--secondary': t.surface,
    '--secondary-foreground': t.text,
    '--muted': tint,
    '--muted-foreground': t.muted,
    '--accent': tint,
    '--accent-foreground': t.text,
    '--destructive': t.sell,
    '--border': tint,
    '--input': withAlpha(t.text, 0.14),
    '--ring': t.brand,
    '--buy': t.buy,
    '--sell': t.sell,
    '--yellow': t.brand,
    '--faint': t.faint,
  };
}

/** Applies panelVars as inline custom properties on an element (they inherit into shadow roots). */
export function applyPanelVars(el: HTMLElement, t: Theme): void {
  for (const [k, v] of Object.entries(panelVars(t))) el.style.setProperty(k, v);
}
