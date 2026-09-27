/**
 * @file number-input.ts
 * @description Cleaning of what the user types or pastes into the numeric order fields (amount, target, presets, the
 *              % change box). Keystrokes that can't be part of a number are rejected (the previous text is kept), and
 *              pasted values like "$2.5M", "1,500,000" or "1e6" become plain numbers instead of silently losing their
 *              suffix ("2M" must never turn into "2").
 * @author Reborn1987
 */

/** Multipliers for compact suffixes, as fomo writes market caps ("12.5K", "1.02B"). */
const SUFFIX_EXP: Record<string, number> = { k: 3, m: 6, b: 9, t: 12 };

/** A whole pasted number: mantissa, optional exponent ("1e6") and optional compact suffix ("1.5k"). */
const COMPACT_RE = /^(\d*\.?\d*)(?:e([+-]?\d+))?([kmbt])?$/i;

/** A plain decimal the user may still be typing: "", "12", "1.", ".5". */
const PLAIN_RE = /^\d*\.?\d*$/;

/**
 * Moves the decimal point of a plain decimal `mantissa` by `exp` places, exactly (no float rounding):
 * ("1.5", 3) → "1500", ("1", -7) → "0.0000001".
 */
function shiftDecimal(mantissa: string, exp: number): string {
  const [int = '', frac = ''] = mantissa.split('.');
  let digits = int + frac;
  let point = int.length + exp;
  if (point <= 0) {
    digits = '0'.repeat(1 - point) + digits;
    point = 1;
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(point).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Text for a numeric field after the user typed or pasted `next` over `prev`. Spaces, line breaks, "$" and thousand
 * separators are dropped; "k/m/b/t" suffixes and "e" exponents are expanded; other non-digits are removed. Returns
 * `prev` when the result would not be a number (a second ".", a value too large to represent).
 */
export function cleanNumberInput(next: string, prev: string): string {
  const s = next.replace(/[\s,$_]/g, '');
  const compact = COMPACT_RE.exec(s);
  if (compact && (compact[2] !== undefined || compact[3] !== undefined)) {
    const [, mantissa = '', e, suffix] = compact;
    if (!/\d/.test(mantissa)) return prev;
    const out = shiftDecimal(mantissa, Number(e ?? 0) + (suffix ? SUFFIX_EXP[suffix.toLowerCase()]! : 0));
    return Number.isFinite(Number(out)) ? out : prev;
  }
  const digits = s.replace(/[^0-9.]/g, '');
  return PLAIN_RE.test(digits) ? digits : prev;
}

/**
 * Text for the % change box after the user typed or pasted `next` over `prev`: digits, one leading minus and one
 * "."; "+", "%", spaces and thousand separators are dropped and typographic minus signs ("−30%") count as "-".
 * Returns `prev` for anything else, so a stray keystroke is rejected.
 */
export function cleanPercentInput(next: string, prev: string): string {
  const s = next.replace(/[−–—]/g, '-').replace(/[\s%+,]/g, '');
  return /^-?\d*\.?\d*$/.test(s) ? s : prev;
}

/**
 * The number a cleaned % box text stands for: 0 when empty, null while it has no digit yet ("-", ".", "-.").
 * The caller rounds and clamps it.
 */
export function percentInputValue(text: string): number | null {
  if (text === '') return 0;
  return /\d/.test(text) ? Number(text) : null;
}

/** Order amount limits the form enforces before the server does: FOMO's $ minimum and at most 100% of a balance. */
export function amountError(unit: 'usd' | 'percent', text: string, minUsd: number): string | null {
  const v = Number(text);
  if (unit === 'usd') return text !== '' && v < minUsd ? `Minimum $${minUsd}` : null;
  return v > 100 ? 'Max 100%' : null;
}
