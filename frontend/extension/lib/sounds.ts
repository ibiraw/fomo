/**
 * @file sounds.ts
 * @description Order sounds — the "Arcade" pack: 8-bit square-wave blips synthesized with Web Audio (no audio files).
 *              Which sound an order update earns, the stored on/off + volume setting, and the players.
 * @author Reborn1987
 */

import type { Order } from './types';

export type SoundEvent = 'buy' | 'tp' | 'sl' | 'fail';

export const SOUND_EVENTS: readonly { readonly id: SoundEvent; readonly label: string }[] = [
  { id: 'buy', label: 'Buy filled' },
  { id: 'tp', label: 'Take profit' },
  { id: 'sl', label: 'Stop loss' },
  { id: 'fail', label: 'Failed' },
];

/** Stored setting. */
export interface SoundSettings {
  readonly enabled: boolean;
  /** 0..1 */
  readonly volume: number;
}

export const SOUND_SETTINGS_KEY = 'orderSounds';
export const DEFAULT_SOUND_SETTINGS: SoundSettings = { enabled: true, volume: 0.6 };

/** Message the background sends to the offscreen audio page. */
export interface PlaySoundMessage {
  readonly type: 'fomo.sound';
  readonly event: SoundEvent;
  readonly volume: number;
}

/** Normalizes a stored value (missing or malformed → defaults; volume clamped to 0..1). */
export function parseSoundSettings(v: unknown): SoundSettings {
  const o = (v && typeof v === 'object' ? v : {}) as { enabled?: unknown; volume?: unknown };
  const volume = typeof o.volume === 'number' && Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : DEFAULT_SOUND_SETTINGS.volume;
  return { enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_SOUND_SETTINGS.enabled, volume };
}

/** Reads the stored setting (extension storage; used by the background and the popup). */
export async function loadSoundSettings(): Promise<SoundSettings> {
  const s = await browser.storage.local.get(SOUND_SETTINGS_KEY);
  return parseSoundSettings(s[SOUND_SETTINGS_KEY]);
}

/**
 * The sound for an order update, or null. Only a change into a final outcome plays: a filled buy, a filled
 * sell (take profit when it triggered on the way up, stop loss on the way down), or a failed / unconfirmed trade.
 */
export function soundForUpdate(prev: Order | undefined, next: Order): SoundEvent | null {
  if (prev?.status === next.status) return null;
  if (next.status === 'filled') {
    if (next.side === 'buy') return 'buy';
    return next.trigger.direction === 'above' ? 'tp' : 'sl';
  }
  return next.status === 'failed' || next.status === 'unknown' ? 'fail' : null;
}

/** Length of each sound in seconds (for callers that wait or animate). */
export const SOUND_LENGTH: Record<SoundEvent, number> = { buy: 0.45, tp: 0.6, sl: 0.6, fail: 0.35 };

/** One square-wave note with a short attack and exponential fade (optional pitch glide and vibrato). */
function note(ctx: BaseAudioContext, out: AudioNode, o: { f: number; f2?: number; t: number; d: number; g?: number; vibrato?: number }): void {
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(o.f, o.t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, o.t + o.d * 0.9);
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 8;
    depth.gain.value = o.vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(o.t);
    lfo.stop(o.t + o.d + 0.05);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, o.t);
  env.gain.exponentialRampToValueAtTime(o.g ?? 0.09, o.t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, o.t + o.d);
  osc.connect(env).connect(out);
  osc.start(o.t);
  osc.stop(o.t + o.d + 0.05);
}

/** Schedules the Arcade sound for `event` on `out`, starting at time `t`. */
export function scheduleArcade(ctx: BaseAudioContext, out: AudioNode, event: SoundEvent, t: number): void {
  switch (event) {
    case 'buy': // coin: B5 → E6
      note(ctx, out, { f: 988, t, d: 0.08 });
      note(ctx, out, { f: 1319, t: t + 0.08, d: 0.35 });
      break;
    case 'tp': // power-up: C6 E6 G6 C7
      [1047, 1319, 1568, 2093].forEach((f, i) => note(ctx, out, { f, t: t + i * 0.07, d: i === 3 ? 0.35 : 0.07, g: 0.08 }));
      break;
    case 'sl': // falling "bwomp"
      note(ctx, out, { f: 440, f2: 110, t, d: 0.55, vibrato: 8 });
      break;
    case 'fail': // two low buzzes
      note(ctx, out, { f: 110, t, d: 0.12, g: 0.1 });
      note(ctx, out, { f: 104, t: t + 0.17, d: 0.16, g: 0.1 });
      break;
  }
}

/** Plays sounds on one lazily created AudioContext, through a compressor so loud volumes don't clip. */
export class ArcadePlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** @param createContext factory (injectable for tests) */
  constructor(private readonly createContext: () => AudioContext = () => new AudioContext()) {}

  /** Plays `event` at `volume` (0..1). */
  async play(event: SoundEvent, volume: number): Promise<void> {
    if (!this.ctx || !this.master) {
      this.ctx = this.createContext();
      const comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.master.gain.value = Math.min(1, Math.max(0, volume));
    scheduleArcade(this.ctx, this.master, event, this.ctx.currentTime + 0.02);
  }
}
