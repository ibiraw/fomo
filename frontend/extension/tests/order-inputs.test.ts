/**
 * @file order-inputs.test.ts
 * @description Order field components in happy-dom (react-dom only, no extra test library): the numeric FieldBox
 *              rejects bad keystrokes and expands pasted "$2M", and the % box of TargetSlider accepts negatives and
 *              decimals and follows the slider.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FieldBox } from '../components/orders/FieldBox';
import { TargetSlider } from '../components/orders/TargetSlider';
import { setReactInputValue } from '../lib/fomo-dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
/** Latest state the harness saw. */
let seen: { value: string; percent: number };

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  seen = { value: '', percent: 0 };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** FieldBox with real state, recording each value. */
function FieldHarness() {
  const [value, setValue] = useState('');
  seen.value = value;
  return createElement(FieldBox, { label: 'Amount', value, onChange: setValue });
}

/** TargetSlider with real state, recording the percent. */
function SliderHarness({ start = 0 }: { start?: number }) {
  const [percent, setPercent] = useState(start);
  seen.percent = percent;
  return createElement(TargetSlider, { percent, onChange: setPercent });
}

/** Types `value` into `input` as the browser would (whole new value). */
function type(input: HTMLInputElement, value: string): void {
  act(() => setReactInputValue(input, value));
}

describe('FieldBox', () => {
  it('keeps numbers, rejects junk keystrokes and expands pasted suffixes', () => {
    act(() => root.render(createElement(FieldHarness)));
    const input = host.querySelector('input')!;
    type(input, '1.');
    expect(input.value).toBe('1.');
    type(input, '1.5');
    type(input, '1.5.'); // second dot rejected
    expect(input.value).toBe('1.5');
    type(input, '1.5a');
    expect(input.value).toBe('1.5');
    type(input, '$2M');
    expect(input.value).toBe('2000000');
    expect(seen.value).toBe('2000000');
    type(input, ' 2,500,000\n');
    expect(seen.value).toBe('2500000');
  });
});

describe('TargetSlider % box', () => {
  it('lets the user type a negative percent from an empty box', () => {
    act(() => root.render(createElement(SliderHarness)));
    const box = host.querySelector<HTMLInputElement>('input[aria-label="Change from current, percent"]')!;
    type(box, '');
    type(box, '-');
    expect(box.value).toBe('-');
    type(box, '-3');
    type(box, '-30');
    expect(box.value).toBe('-30');
    expect(seen.percent).toBe(-30);
  });

  it('accepts decimals (rounded), large take profits, and clamps on blur', () => {
    act(() => root.render(createElement(SliderHarness)));
    const box = host.querySelector<HTMLInputElement>('input[aria-label="Change from current, percent"]')!;
    type(box, '1.');
    type(box, '1.5');
    expect(box.value).toBe('1.5');
    expect(seen.percent).toBe(2);
    type(box, '400%');
    expect(seen.percent).toBe(400);
    type(box, '-150');
    expect(seen.percent).toBe(-99);
    act(() => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(box.value).toBe('-99');
  });

  it('follows the tick buttons after typing', () => {
    act(() => root.render(createElement(SliderHarness, { start: 20 })));
    const box = host.querySelector<HTMLInputElement>('input[aria-label="Change from current, percent"]')!;
    type(box, '25');
    const plus50 = [...host.querySelectorAll('button')].find((b) => b.textContent === '+50%')!;
    act(() => plus50.click());
    expect(seen.percent).toBe(50);
    expect(box.value).toBe('50');
    const minus100 = [...host.querySelectorAll('button')].find((b) => b.textContent === '-100%')!;
    act(() => minus100.click());
    expect(seen.percent).toBe(-99);
    expect(box.value).toBe('-99');
  });
});
