/**
 * @file inputs.test.ts
 * @description Edge cases for everything a user can type or paste: amount / target / preset fields, the % change box,
 *              amount limits, token address, backup code and sound volume.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { clampPercent, percentBoxText } from '../components/orders/TargetSlider';
import { DEFAULT_PRESETS, sanitizePresets } from '../hooks/use-presets';
import { isAccountKey } from '../lib/account';
import { mintFromFomoUrl } from '../lib/format';
import { amountError, cleanNumberInput, cleanPercentInput, percentInputValue } from '../lib/number-input';
import { parseSoundSettings } from '../lib/sounds';
import { formatTargetInput, inferDirection, percentFromTarget, syncWithLive, targetFromPercent } from '../lib/target';
import { keyFromPath, parseTokenKey } from '../lib/token-key';
import { MIN_TRADE_USD } from '../lib/types';

const SOL = 'JDY8BeQUPmcRZnYJGVBiU7x71SMbdUECW6NMUdGGKQDg';
const EVM = '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE';

/** Cleans `next` as if typed into an empty field. */
const clean = (next: string): string => cleanNumberInput(next, '');

describe('cleanNumberInput (amount, target, presets)', () => {
  it('keeps plain numbers and partial typing as typed', () => {
    for (const s of ['', '0', '12', '0.5', '.5', '5.', '0.0', '0.000004399', '007']) expect(clean(s)).toBe(s);
  });

  it('drops whitespace, newlines, "$" and thousand separators from pastes', () => {
    expect(clean('  42 \n')).toBe('42');
    expect(clean('$2,500,000')).toBe('2500000');
    expect(clean('2 500 000')).toBe('2500000');
    expect(clean('1_000')).toBe('1000');
    expect(clean('\t$0.0001\r\n')).toBe('0.0001');
  });

  it('expands k/m/b/t suffixes exactly, any case, with "$" and spaces', () => {
    expect(clean('1.5k')).toBe('1500');
    expect(clean('1.5K')).toBe('1500');
    expect(clean('$2M')).toBe('2000000');
    expect(clean('$2.5 m')).toBe('2500000');
    expect(clean('1.1M')).toBe('1100000'); // not 1100000.0000000002
    expect(clean('.5k')).toBe('500');
    expect(clean('5.k')).toBe('5000');
    expect(clean('0.0015M')).toBe('1500');
    expect(clean('3B')).toBe('3000000000');
    expect(clean('1.02b')).toBe('1020000000');
    expect(clean('2T')).toBe('2000000000000');
    expect(clean('1.23456789k')).toBe('1234.56789');
  });

  it('expands scientific notation to a plain decimal', () => {
    expect(clean('1e6')).toBe('1000000');
    expect(clean('1E6')).toBe('1000000');
    expect(clean('2.5e+3')).toBe('2500');
    expect(clean('1e-7')).toBe('0.0000001');
    expect(clean('4.2e-6')).toBe('0.0000042');
    expect(clean('1e3k')).toBe('1000000');
  });

  it('keeps the previous text when the result would not be a number', () => {
    expect(cleanNumberInput('1.2.3', '1.2')).toBe('1.2'); // a second "." is rejected
    expect(cleanNumberInput('12..', '12.')).toBe('12.');
    expect(cleanNumberInput('k', '')).toBe(''); // suffix with no digits
    expect(cleanNumberInput('.k', '.')).toBe('.');
    expect(cleanNumberInput('e5', '7')).toBe('7');
    expect(cleanNumberInput('1e400', '9')).toBe('9'); // Infinity
  });

  it('removes keystrokes that are not digits', () => {
    expect(cleanNumberInput('12a', '12')).toBe('12');
    expect(cleanNumberInput('5e', '5')).toBe('5'); // lone "e" while typing
    expect(clean('-5')).toBe('5'); // amounts and targets are never negative
    expect(clean('25%')).toBe('25');
    expect(clean('NaN')).toBe('');
    expect(clean('Infinity')).toBe('');
    expect(clean('junk text')).toBe('');
    expect(clean('١٢٣')).toBe(''); // non-ASCII digits are not accepted
    expect(clean('１２')).toBe('');
  });

  it('keeps very large and very small values exact', () => {
    expect(clean('999999999999')).toBe('999999999999');
    expect(clean('1e21')).toBe('1000000000000000000000');
    expect(Number(clean('1e21'))).toBe(1e21);
    expect(clean('0.00000000001')).toBe('0.00000000001');
  });
});

describe('% change box', () => {
  it('cleans typed and pasted percents', () => {
    expect(cleanPercentInput('-', '0')).toBe('-');
    expect(cleanPercentInput('-30', '-3')).toBe('-30');
    expect(cleanPercentInput('400%', '')).toBe('400');
    expect(cleanPercentInput('+50 %', '')).toBe('50');
    expect(cleanPercentInput('−30%', '')).toBe('-30'); // typographic minus, as the UI prints it
    expect(cleanPercentInput('1,000', '')).toBe('1000');
    expect(cleanPercentInput('12.5', '12.')).toBe('12.5');
    expect(cleanPercentInput(' 25\n', '')).toBe('25');
  });

  it('rejects junk keystrokes', () => {
    expect(cleanPercentInput('3-0', '30')).toBe('30');
    expect(cleanPercentInput('--5', '-5')).toBe('-5');
    expect(cleanPercentInput('5a', '5')).toBe('5');
    expect(cleanPercentInput('1.2.3', '1.2')).toBe('1.2');
    expect(cleanPercentInput('abc', '7')).toBe('7');
    expect(cleanPercentInput('1e3', '1')).toBe('1');
  });

  it('reads the value, waiting while there is no digit yet', () => {
    expect(percentInputValue('')).toBe(0);
    expect(percentInputValue('-')).toBeNull();
    expect(percentInputValue('.')).toBeNull();
    expect(percentInputValue('-.')).toBeNull();
    expect(percentInputValue('-30')).toBe(-30);
    expect(percentInputValue('12.5')).toBe(12.5);
    expect(percentInputValue('5.')).toBe(5);
  });

  it('clamps: -100% and below become -99%, take profits up to 1000x are allowed', () => {
    expect(clampPercent(-100)).toBe(-99);
    expect(clampPercent(-99)).toBe(-99);
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(400)).toBe(400);
    expect(clampPercent(1000)).toBe(1000);
    expect(clampPercent(99_900)).toBe(99_900);
    expect(clampPercent(99_901)).toBe(99_900);
    expect(clampPercent(12.5)).toBe(13);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('shows the typed text while it matches the percent, else the percent', () => {
    expect(percentBoxText(null, -30)).toBe('-30');
    expect(percentBoxText('-', 0)).toBe('-'); // regression: "-" used to snap back to "0"
    expect(percentBoxText('-3', -3)).toBe('-3');
    expect(percentBoxText('1.', 1)).toBe('1.'); // regression: "1.5" used to become 15
    expect(percentBoxText('1.5', 2)).toBe('1.5');
    expect(percentBoxText('-150', -99)).toBe('-150'); // clamped value, text kept until blur
    expect(percentBoxText('', 0)).toBe('');
    expect(percentBoxText('20', 50)).toBe('50'); // the slider moved: follow it
    expect(percentBoxText('', 10)).toBe('10');
  });

  it('typing "-30" character by character ends at -30%, not +30%', () => {
    /** Mirrors TargetSlider's onChange: the box shows percentBoxText, a keystroke edits that text. */
    const type = (keys: string[], start: number, replaceAll: boolean): { shown: string; percent: number } => {
      let draft: string | null = null;
      let percent = start;
      keys.forEach((ch, i) => {
        const shown = percentBoxText(draft, percent);
        draft = cleanPercentInput(i === 0 && replaceAll ? ch : shown + ch, shown);
        const v = percentInputValue(draft);
        if (v !== null) percent = clampPercent(v);
      });
      return { shown: percentBoxText(draft, percent), percent };
    };
    expect(type(['-', '3', '0'], 0, true)).toEqual({ shown: '-30', percent: -30 });
    expect(type(['1', '.', '5'], 0, true)).toEqual({ shown: '1.5', percent: 2 });
    expect(type(['4', '0', '0'], 0, true)).toEqual({ shown: '400', percent: 400 });
    expect(type(['1', '0', '0', '0', '0', '0', '0'], 0, true)).toEqual({ shown: '1000000', percent: 99_900 });
  });

  it('slider and target stay consistent both ways', () => {
    const current = 50_000;
    expect(formatTargetInput('marketCap', targetFromPercent(current, 400))).toBe('250000');
    expect(percentFromTarget(current, 250_000)).toBe(400);
    expect(percentFromTarget(current, 500_000)).toBe(900);
    expect(formatTargetInput('marketCap', targetFromPercent(current, -99))).toBe('500');
    expect(syncWithLive('percent', 'marketCap', 60_000, 400, '250000')).toEqual({ target: '300000', percent: 400 });
    expect(syncWithLive('target', 'marketCap', 60_000, 400, '250000')).toEqual({ target: '250000', percent: 317 });
    expect(syncWithLive('target', 'marketCap', 60_000, 5, '.')).toEqual({ target: '.', percent: 5 }); // mid-edit
  });
});

describe('target field → order kind', () => {
  it('a pasted compact market cap keeps its size and direction', () => {
    const current = 100_000;
    expect(inferDirection(current, Number(clean('$2M')))).toBe('above'); // was 2 → "below"
    expect(inferDirection(current, Number(clean('50k')))).toBe('below');
    expect(Number(clean('.'))).toBeNaN(); // not > 0: the form stays disabled
    expect(Number(clean(''))).toBe(0);
  });

  it('formats targets only for positive finite values', () => {
    expect(formatTargetInput('price', Number.POSITIVE_INFINITY)).toBe('');
    expect(formatTargetInput('price', -1)).toBe('');
    expect(formatTargetInput('price', 0.5)).toBe('0.5');
    expect(formatTargetInput('marketCap', 1e12)).toBe('1000000000000');
  });
});

describe('amountError', () => {
  it(`enforces the $${MIN_TRADE_USD} minimum only once something is typed`, () => {
    expect(amountError('usd', '', MIN_TRADE_USD)).toBeNull();
    expect(amountError('usd', '0', MIN_TRADE_USD)).toBe('Minimum $2');
    expect(amountError('usd', '1.99', MIN_TRADE_USD)).toBe('Minimum $2');
    expect(amountError('usd', '2', MIN_TRADE_USD)).toBeNull();
    expect(amountError('usd', '1000000000', MIN_TRADE_USD)).toBeNull();
  });

  it('caps % amounts at 100', () => {
    expect(amountError('percent', '100', MIN_TRADE_USD)).toBeNull();
    expect(amountError('percent', '100.01', MIN_TRADE_USD)).toBe('Max 100%');
    expect(amountError('percent', '400', MIN_TRADE_USD)).toBe('Max 100%');
    expect(amountError('percent', '0.5', MIN_TRADE_USD)).toBeNull();
    expect(amountError('percent', '', MIN_TRADE_USD)).toBeNull();
  });
});

describe('preset boxes', () => {
  it('saved drafts fall back to defaults for empty, "." and zero', () => {
    const fb = DEFAULT_PRESETS.sell.percent;
    expect(sanitizePresets(['', '.', '0', '33'].map(Number), fb)).toEqual([10, 25, 50, 33]);
    expect(sanitizePresets([clean('1k'), clean('2.5'), clean('$5'), clean('1e2')].map(Number), fb)).toEqual([1000, 2.5, 5, 100]);
    expect(sanitizePresets([Number.POSITIVE_INFINITY, -5, 10, 20], fb)).toEqual([10, 25, 10, 20]);
  });
});

describe('token address', () => {
  it('accepts Solana mints and chain-prefixed EVM addresses', () => {
    expect(parseTokenKey(SOL)).toEqual({ chain: 'solana', address: SOL });
    expect(parseTokenKey(`base:${EVM}`)).toEqual({ chain: 'base', address: EVM.toLowerCase() });
    for (const c of ['ethereum', 'bnb', 'robinhood', 'arc']) expect(parseTokenKey(`${c}:${EVM}`)?.chain).toBe(c);
  });

  it('rejects bare EVM addresses, unknown chains, whitespace and junk', () => {
    expect(parseTokenKey(EVM)).toBeNull();
    expect(parseTokenKey(`polygon:${EVM}`)).toBeNull();
    expect(parseTokenKey(`BASE:${EVM}`)).toBeNull();
    expect(parseTokenKey(` ${SOL}`)).toBeNull(); // callers trim first
    expect(parseTokenKey(`${SOL}0OIl`)).toBeNull();
    expect(parseTokenKey('')).toBeNull();
    expect(parseTokenKey(':')).toBeNull();
  });

  it('reads token keys from pasted fomo links', () => {
    expect(mintFromFomoUrl(`https://fomo.family/tokens/solana/${SOL}?ref=x#top`)).toBe(SOL);
    expect(mintFromFomoUrl(`https://fomo.family/tokens/base/${EVM}/`)).toBe(`base:${EVM.toLowerCase()}`);
    expect(mintFromFomoUrl(`https://evil.example/tokens/solana/${SOL}`)).toBeNull();
    expect(mintFromFomoUrl('not a url')).toBeNull();
    expect(keyFromPath(`/tokens/solana/${EVM}`)).toBeNull();
    expect(keyFromPath(`/tokens/base/${SOL}`)).toBeNull();
  });
});

describe('backup code', () => {
  const key = 'A'.repeat(43);
  it('ignores surrounding whitespace and line breaks', () => {
    expect(isAccountKey(`${key}\n`)).toBe(true);
    expect(isAccountKey(`\r\n\t ${key} \r\n`)).toBe(true);
  });

  it('enforces length and characters', () => {
    expect(isAccountKey('a'.repeat(31))).toBe(false);
    expect(isAccountKey('a'.repeat(32))).toBe(true);
    expect(isAccountKey('a'.repeat(128))).toBe(true);
    expect(isAccountKey('a'.repeat(129))).toBe(false);
    expect(isAccountKey('')).toBe(false);
    expect(isAccountKey('   ')).toBe(false);
    expect(isAccountKey(`${key.slice(0, 20)}\n${key.slice(20)}`)).toBe(false); // wrapped across lines
    expect(isAccountKey(`${key}=`)).toBe(false);
    expect(isAccountKey(`${key.slice(1)}+`)).toBe(false);
  });
});

describe('sound volume', () => {
  it('clamps to 0..1 and ignores non-numbers', () => {
    expect(parseSoundSettings({ volume: 0 }).volume).toBe(0);
    expect(parseSoundSettings({ volume: 1.5 }).volume).toBe(1);
    expect(parseSoundSettings({ volume: -1 }).volume).toBe(0);
    expect(parseSoundSettings({ volume: Number.NaN }).volume).toBe(parseSoundSettings({}).volume);
    expect(parseSoundSettings({ volume: '0.5' }).volume).toBe(parseSoundSettings({}).volume);
  });
});
