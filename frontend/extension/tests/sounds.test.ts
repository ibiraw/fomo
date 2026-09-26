/**
 * @file sounds.test.ts
 * @description Order sounds: which update plays what, settings parsing, and that every Arcade sound schedules notes.
 * @author Reborn1987
 */

import { describe, expect, it, vi } from 'vitest';

import { SOUND_PACKS, soundPack } from '../lib/sound-packs';
import { parseSoundSettings, SOUND_EVENTS, soundForUpdate, SoundPlayer } from '../lib/sounds';
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
    expect(parseSoundSettings(undefined)).toEqual({ enabled: true, pack: 'arcade', volume: 0.6 });
    expect(parseSoundSettings({ enabled: false, pack: 'sonar', volume: 0.25 })).toEqual({ enabled: false, pack: 'sonar', volume: 0.25 });
    expect(parseSoundSettings({ enabled: 'yes', pack: 'polka', volume: 7 })).toEqual({ enabled: true, pack: 'arcade', volume: 1 });
    expect(parseSoundSettings({ volume: -1 }).volume).toBe(0);
    expect(parseSoundSettings({ volume: Number.NaN }).volume).toBe(0.6);
  });
});

/** Minimal Web Audio stand-in that records every scheduled frequency / gain start. */
function fakeAudio(state: 'running' | 'suspended' = 'suspended', resumes = true) {
  const starts: number[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn((v: number) => starts.push(v)), exponentialRampToValueAtTime: vi.fn() });
  const node = (): Record<string, unknown> => ({
    connect: vi.fn(() => node()), start: vi.fn(), stop: vi.fn(), type: '', buffer: null,
    frequency: param(), gain: param(), detune: param(), Q: param(), delayTime: param(),
  });
  const ctx = {
    state, currentTime: 1, sampleRate: 8000, destination: node(),
    createOscillator: vi.fn(node), createGain: vi.fn(node), createDynamicsCompressor: vi.fn(node),
    createBiquadFilter: vi.fn(node), createBufferSource: vi.fn(node), createDelay: vi.fn(node),
    createBuffer: vi.fn((_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) })),
    resume: vi.fn(async () => { if (resumes) ctx.state = 'running'; }),
  };
  return { ctx, starts };
}

describe('sound packs', () => {
  it('every pack schedules audio for every event', () => {
    expect(SOUND_PACKS.map((p) => p.id)).toEqual(['arcade', 'chime', 'register', 'pop', 'degen', 'sonar']);
    for (const pack of SOUND_PACKS) {
      for (const { id } of SOUND_EVENTS) {
        const { ctx, starts } = fakeAudio();
        pack.sounds[id](ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 0);
        expect(starts.length, `${pack.id}/${id}`).toBeGreaterThan(0);
        expect(pack.length[id]).toBeGreaterThan(0);
      }
    }
    expect(soundPack('nope').id).toBe('arcade');
  });

  it('plays through one context, resuming it and clamping volume', async () => {
    const { ctx } = fakeAudio();
    const create = vi.fn(() => ctx as unknown as AudioContext);
    const player = new SoundPlayer(create);
    expect(await player.play('chime', 'tp', 0.4)).toBe(1.1);
    await player.play('degen', 'sl', 2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    const master = ctx.createGain.mock.results[0]!.value as { gain: { value: number } };
    expect(master.gain.value).toBe(1);
  });

  it('reports blocked audio instead of failing silently', async () => {
    const { ctx } = fakeAudio('suspended', false);
    await expect(new SoundPlayer(() => ctx as unknown as AudioContext).play('arcade', 'buy', 0.5)).rejects.toThrow(/blocking sound/);
  });
});
