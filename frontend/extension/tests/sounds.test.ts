/**
 * @file sounds.test.ts
 * @description Order sounds: which update plays what, settings parsing, and that every Arcade sound schedules notes.
 * @author Reborn1987
 */

import { describe, expect, it, vi } from 'vitest';

import { ArcadePlayer, parseSoundSettings, scheduleArcade, SOUND_EVENTS, soundForUpdate } from '../lib/sounds';
import type { Order } from '../lib/types';

const order = (o: Partial<Order> & { direction?: 'above' | 'below' }): Order =>
  ({ id: 'o', mint: 'm', side: 'buy', status: 'open', trigger: { metric: 'price', direction: o.direction ?? 'below', value: 1, supply: null }, ...o }) as unknown as Order;

describe('soundForUpdate', () => {
  it('plays only on a change into a final outcome', () => {
    expect(soundForUpdate(order({ status: 'executing' }), order({ status: 'filled' }))).toBe('buy');
    expect(soundForUpdate(order({ status: 'executing', side: 'sell' }), order({ status: 'filled', side: 'sell', direction: 'above' }))).toBe('tp');
    expect(soundForUpdate(undefined, order({ status: 'filled', side: 'sell', direction: 'below' }))).toBe('sl');
    expect(soundForUpdate(order({ status: 'executing' }), order({ status: 'failed' }))).toBe('fail');
    expect(soundForUpdate(order({ status: 'executing' }), order({ status: 'unknown' }))).toBe('fail');
    expect(soundForUpdate(order({ status: 'filled' }), order({ status: 'filled' }))).toBeNull();
    expect(soundForUpdate(order({ status: 'open' }), order({ status: 'triggered' }))).toBeNull();
    expect(soundForUpdate(order({ status: 'open' }), order({ status: 'cancelled' }))).toBeNull();
  });
});

describe('parseSoundSettings', () => {
  it('defaults, keeps valid values and clamps volume', () => {
    expect(parseSoundSettings(undefined)).toEqual({ enabled: true, volume: 0.6 });
    expect(parseSoundSettings({ enabled: false, volume: 0.25 })).toEqual({ enabled: false, volume: 0.25 });
    expect(parseSoundSettings({ enabled: 'yes', volume: 7 })).toEqual({ enabled: true, volume: 1 });
    expect(parseSoundSettings({ volume: -1 }).volume).toBe(0);
    expect(parseSoundSettings({ volume: Number.NaN }).volume).toBe(0.6);
  });
});

/** Minimal Web Audio stand-in that records oscillator frequencies. */
function fakeAudio(state: 'running' | 'suspended' = 'suspended') {
  const freqs: number[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn((v: number) => freqs.push(v)), exponentialRampToValueAtTime: vi.fn() });
  const node = (): Record<string, unknown> => {
    const n: Record<string, unknown> = { connect: vi.fn(() => node()), start: vi.fn(), stop: vi.fn(), frequency: param(), gain: param(), type: '' };
    return n;
  };
  const ctx = {
    state, currentTime: 1, destination: node(),
    createOscillator: vi.fn(node), createGain: vi.fn(node), createDynamicsCompressor: vi.fn(node),
    resume: vi.fn(async () => { ctx.state = 'running'; }),
  };
  return { ctx, freqs };
}

describe('Arcade sounds', () => {
  it('schedules notes for every event', () => {
    for (const { id } of SOUND_EVENTS) {
      const { ctx, freqs } = fakeAudio();
      scheduleArcade(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, id, 0);
      expect(freqs.length, id).toBeGreaterThan(0);
    }
  });

  it('creates one context, resumes it when suspended and applies the volume', async () => {
    const { ctx } = fakeAudio();
    const create = vi.fn(() => ctx as unknown as AudioContext);
    const player = new ArcadePlayer(create);
    await player.play('buy', 0.4);
    await player.play('tp', 2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    const master = ctx.createGain.mock.results[0]!.value as { gain: { value: number } };
    expect(master.gain.value).toBe(1);
  });
});
