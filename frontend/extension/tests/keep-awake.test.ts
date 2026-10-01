/**
 * @file keep-awake.test.ts
 * @description Keep-awake: which orders count as waiting, the stored setting, and that chrome.power is only called on
 *              a change of wish.
 * @author Reborn1987
 */

import { describe, expect, it, vi } from 'vitest';

import { hasWaitingOrders, KeepAwake, parseKeepAwake } from '../lib/keep-awake';
import type { Order, OrderStatus } from '../lib/types';

const order = (status: OrderStatus) => ({ status }) as Order;

describe('keep-awake', () => {
  it('counts open, triggered and executing orders as waiting, never finished ones', () => {
    expect(hasWaitingOrders([])).toBe(false);
    expect(hasWaitingOrders(['filled', 'failed', 'cancelled', 'unknown'].map((s) => order(s as OrderStatus)))).toBe(false);
    for (const s of ['open', 'triggered', 'executing'] as const) expect(hasWaitingOrders([order('filled'), order(s)])).toBe(true);
  });

  it('defaults the setting to on and keeps a stored choice', () => {
    expect(parseKeepAwake(undefined)).toBe(true);
    expect(parseKeepAwake('yes')).toBe(true);
    expect(parseKeepAwake(false)).toBe(false);
    expect(parseKeepAwake(true)).toBe(true);
  });

  it('requests system keep-awake once, releases once, and re-applies after a fresh start', () => {
    const power = { requestKeepAwake: vi.fn(), releaseKeepAwake: vi.fn() };
    const k = new KeepAwake(power);
    expect(k.sync(true)).toBe(true);
    k.sync(true);
    expect(power.requestKeepAwake).toHaveBeenCalledTimes(1);
    expect(power.requestKeepAwake).toHaveBeenCalledWith('system');
    expect(k.sync(false)).toBe(false);
    k.sync(false);
    expect(power.releaseKeepAwake).toHaveBeenCalledTimes(1);
    new KeepAwake(power).sync(false); // a restarted worker doesn't know the state: it applies the first wish
    expect(power.releaseKeepAwake).toHaveBeenCalledTimes(2);
  });

  it('does nothing without the power API', () => {
    expect(new KeepAwake(undefined).sync(true)).toBe(false);
  });
});
