/**
 * @file sounds.ts
 * @description Order sounds: which sound an order update earns, the stored setting (on/off, pack, volume) and the
 *              Web Audio player. The packs themselves live in sound-packs.ts (synthesized, no audio files).
 * @author Reborn1987
 */

import { SOUND_PACKS, soundPack, type SoundEvent, type SoundPackId } from './sound-packs';
import type { Order } from './types';

export type { SoundEvent, SoundPackId } from './sound-packs';

export const SOUND_EVENTS: readonly { readonly id: SoundEvent; readonly label: string }[] = [
  { id: 'buy', label: 'Buy filled' },
  { id: 'tp', label: 'Take profit' },
  { id: 'sl', label: 'Stop loss' },
  { id: 'fail', label: 'Failed' },
];

/** Stored setting. */
export interface SoundSettings {
  readonly enabled: boolean;
  readonly pack: SoundPackId;
  /** 0..1 */
  readonly volume: number;
}

export const SOUND_SETTINGS_KEY = 'orderSounds';
export const DEFAULT_SOUND_SETTINGS: SoundSettings = { enabled: true, pack: 'arcade', volume: 0.6 };

/** Message the background sends to the offscreen audio page. */
export interface PlaySoundMessage {
  readonly type: 'fomo.sound';
  readonly pack: SoundPackId;
  readonly event: SoundEvent;
  readonly volume: number;
}

/** Normalizes a stored value (missing or malformed → defaults; volume clamped to 0..1). */
export function parseSoundSettings(v: unknown): SoundSettings {
  const o = (v && typeof v === 'object' ? v : {}) as { enabled?: unknown; pack?: unknown; volume?: unknown };
  const pack = SOUND_PACKS.some((p) => p.id === o.pack) ? (o.pack as SoundPackId) : DEFAULT_SOUND_SETTINGS.pack;
  const volume = typeof o.volume === 'number' && Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : DEFAULT_SOUND_SETTINGS.volume;
  return { enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_SOUND_SETTINGS.enabled, pack, volume };
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

/** Plays pack sounds on one lazily created AudioContext, through a compressor so loud volumes don't clip. */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** @param createContext factory (injectable for tests) */
  constructor(private readonly createContext: () => AudioContext = () => new AudioContext()) {}

  /**
   * Plays `event` from `pack` at `volume` (0..1); resolves with the sound's length in seconds.
   * Rejects when the browser keeps audio blocked, so callers can say so instead of failing silently.
   */
  async play(pack: SoundPackId, event: SoundEvent, volume: number): Promise<number> {
    if (!this.ctx || !this.master) {
      this.ctx = this.createContext();
      const comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this.ctx.state !== 'running') throw new Error('Chrome is blocking sound for this page');
    this.master.gain.value = Math.min(1, Math.max(0, volume));
    const p = soundPack(pack);
    const trim = this.ctx.createGain();
    trim.gain.value = p.gain;
    trim.connect(this.master);
    p.sounds[event](this.ctx, trim, this.ctx.currentTime + 0.02);
    return p.length[event];
  }
}
