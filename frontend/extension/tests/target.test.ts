/**
 * @file target.test.ts
 * @description Tests for target/percent conversion, direction inference, slider clamping and preset sanitizing.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { clampPercent } from '../components/orders/TargetSlider';
import { DEFAULT_PRESETS, presetKey, sanitizePresets } from '../hooks/use-presets';
import { formatTargetInput, inferDirection, percentFromTarget, targetFromPercent } from '../lib/target';

describe('target math', () => {
  it('converts between % change and target', () => {
    expect(targetFromPercent(33771, -30)).toBeCloseTo(23639.7);
    expect(targetFromPercent(1000, 100)).toBe(2000);
    expect(percentFromTarget(1000, 700)).toBe(-30);
    expect(percentFromTarget(1000, 1506)).toBe(51);
    expect(percentFromTarget(0, 5)).toBe(0);
  });

  it('infers direction from the target position', () => {
    expect(inferDirection(1000, 700)).toBe('below');
    expect(inferDirection(1000, 1000)).toBe('above');
    expect(inferDirection(1000, 1500)).toBe('above');
  });

  it('formats target inputs per metric', () => {
    expect(formatTargetInput('marketCap', 33771.6)).toBe('33772');
    expect(formatTargetInput('price', 0.0000043988)).toBe('0.000004399');
    expect(formatTargetInput('price', 1.23456)).toBe('1.2346');
    expect(formatTargetInput('price', 0)).toBe('');
    expect(formatTargetInput('marketCap', Number.NaN)).toBe('');
  });

  it('clamps slider percents', () => {
    expect(clampPercent(-150)).toBe(-99);
    expect(clampPercent(250)).toBe(100);
    expect(clampPercent(12.6)).toBe(13);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe('presets', () => {
  it('keeps valid presets and repairs invalid ones', () => {
    const fb = DEFAULT_PRESETS.buy.usd;
    expect(sanitizePresets([5, 10, 20, 40], fb)).toEqual([5, 10, 20, 40]);
    expect(sanitizePresets([5, -1, Number.NaN, 'x'], fb)).toEqual([5, 50, 75, 100]);
    expect(sanitizePresets([1, 2], fb)).toEqual(fb);
    expect(sanitizePresets(undefined, fb)).toEqual(fb);
    expect(presetKey('sell', 'percent')).toBe('presets.sell.percent');
  });
});
