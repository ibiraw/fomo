/**
 * @file sound-packs.ts
 * @description The order-sound packs (same as the sound gallery artifact): Arcade, Chime, Cash register, Soft pop,
 *              Degen, Sonar. Each schedules Web Audio nodes for buy filled / take profit / stop loss / failed.
 *              Works on AudioContext and OfflineAudioContext.
 * @author Reborn1987
 */

export type SoundEvent = 'buy' | 'tp' | 'sl' | 'fail';
export type SoundPackId = 'arcade' | 'chime' | 'register' | 'pop' | 'degen' | 'sonar';

type Schedule = (ctx: BaseAudioContext, out: AudioNode, t: number) => void;

export interface SoundPack {
  readonly id: SoundPackId;
  readonly name: string;
  readonly vibe: string;
  /** Loudness trim so every pack peaks near the same level (measured by offline rendering). */
  readonly gain: number;
  /** Seconds each sound lasts. */
  readonly length: Record<SoundEvent, number>;
  readonly sounds: Record<SoundEvent, Schedule>;
}

/** Envelope gain: fast attack to `peak`, exponential fade to silence at t + d. */
function env(ctx: BaseAudioContext, out: AudioNode, t: number, d: number, peak: number, attack = 0.004): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  g.connect(out);
  return g;
}

interface ToneOpts {
  readonly type?: OscillatorType;
  readonly f: number;
  readonly f2?: number;
  readonly t: number;
  readonly d: number;
  readonly g?: number;
  readonly attack?: number;
  readonly detune?: number;
  readonly vibrato?: number;
}

/** One oscillator note with optional glide, detune and vibrato. */
function tone(ctx: BaseAudioContext, out: AudioNode, o: ToneOpts): void {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, o.t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, o.t + o.d * 0.9);
  osc.detune.value = o.detune ?? 0;
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = o.vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(o.t);
    lfo.stop(o.t + o.d + 0.05);
  }
  osc.connect(env(ctx, out, o.t, o.d, o.g ?? 0.2, o.attack));
  osc.start(o.t);
  osc.stop(o.t + o.d + 0.05);
}

/** Filtered noise burst (deterministic, so previews sound the same every time). */
function noise(ctx: BaseAudioContext, out: AudioNode, o: { t: number; d: number; g?: number; type?: BiquadFilterType; f?: number; q?: number }): void {
  const len = Math.ceil(ctx.sampleRate * (o.d + 0.05));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < len; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = o.type ?? 'lowpass';
  flt.frequency.value = o.f ?? 1000;
  flt.Q.value = o.q ?? 0.7;
  src.connect(flt).connect(env(ctx, out, o.t, o.d, o.g ?? 0.2, 0.002));
  src.start(o.t);
  src.stop(o.t + o.d + 0.05);
}

/** Bell: inharmonic sine partials, higher ones fading faster. */
function bell(ctx: BaseAudioContext, out: AudioNode, f: number, t: number, d = 0.9, g = 0.12): void {
  ([[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]] as const).forEach(([m, a], i) => tone(ctx, out, { f: f * m, t, d: d / (1 + i * 0.6), g: g * a, attack: 0.002 }));
}

/** Feedback echo; returns the node to play into. */
function echo(ctx: BaseAudioContext, out: AudioNode, time = 0.16, feedback = 0.38): AudioNode {
  const input = ctx.createGain();
  const delay = ctx.createDelay(1);
  const fb = ctx.createGain();
  delay.delayTime.value = time;
  fb.gain.value = feedback;
  input.connect(out);
  input.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(out);
  return input;
}

/** Low-pass filter in front of `out`. */
function lowpass(ctx: BaseAudioContext, out: AudioNode, f: number): AudioNode {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = f;
  lp.connect(out);
  return lp;
}

/** Detuned sawtooth stack with a slight pitch drop. */
function airhorn(ctx: BaseAudioContext, out: AudioNode, t: number, d: number, g = 0.07): void {
  const lp = lowpass(ctx, out, 2400);
  [0, 8, -9].forEach((detune) => tone(ctx, lp, { type: 'sawtooth', f: 466, f2: 440, t, d, g, attack: 0.01, detune }));
  tone(ctx, lp, { type: 'sawtooth', f: 932, f2: 880, t, d, g: g * 0.5, attack: 0.01 });
}

export const SOUND_PACKS: readonly SoundPack[] = [
  {
    id: 'arcade', gain: 4, name: 'Arcade', vibe: '8-bit coin and power-up blips',
    length: { buy: 0.45, tp: 0.6, sl: 0.6, fail: 0.35 },
    sounds: {
      buy: (c, o, t) => { tone(c, o, { type: 'square', f: 988, t, d: 0.08, g: 0.09 }); tone(c, o, { type: 'square', f: 1319, t: t + 0.08, d: 0.35, g: 0.09 }); },
      tp: (c, o, t) => [1047, 1319, 1568, 2093].forEach((f, i) => tone(c, o, { type: 'square', f, t: t + i * 0.07, d: i === 3 ? 0.35 : 0.07, g: 0.08 })),
      sl: (c, o, t) => tone(c, o, { type: 'square', f: 440, f2: 110, t, d: 0.55, g: 0.09, vibrato: 8 }),
      fail: (c, o, t) => { tone(c, o, { type: 'square', f: 110, t, d: 0.12, g: 0.1 }); tone(c, o, { type: 'square', f: 104, t: t + 0.17, d: 0.16, g: 0.1 }); },
    },
  },
  {
    id: 'chime', gain: 1.8, name: 'Chime', vibe: 'Soft bell tones',
    length: { buy: 0.9, tp: 1.1, sl: 0.9, fail: 0.45 },
    sounds: {
      buy: (c, o, t) => { bell(c, o, 1319, t, 0.8); bell(c, o, 1976, t + 0.09, 0.8); },
      tp: (c, o, t) => [1047, 1319, 1568, 2093].forEach((f, i) => bell(c, o, f, t + i * 0.075, 0.95, 0.1)),
      sl: (c, o, t) => { bell(c, o, 880, t, 0.8); bell(c, o, 698, t + 0.13, 0.8); },
      fail: (c, o, t) => { tone(c, o, { f: 220, f2: 160, t, d: 0.35, g: 0.3 }); noise(c, o, { t, d: 0.08, g: 0.08, f: 600 }); },
    },
  },
  {
    id: 'register', gain: 1.4, name: 'Cash register', vibe: 'Ka-ching, coins and a drawer slam',
    length: { buy: 1, tp: 1.1, sl: 0.4, fail: 0.35 },
    sounds: {
      buy: (c, o, t) => { noise(c, o, { t, d: 0.04, g: 0.25, type: 'highpass', f: 3000 }); bell(c, o, 2637, t + 0.06, 0.9, 0.09); bell(c, o, 3520, t + 0.06, 0.9, 0.06); },
      tp: (c, o, t) => {
        noise(c, o, { t, d: 0.04, g: 0.25, type: 'highpass', f: 3000 });
        bell(c, o, 2637, t + 0.05, 0.8, 0.08);
        [3100, 4200, 3700, 4700, 3400, 5200].forEach((f, i) => bell(c, o, f, t + 0.2 + i * 0.07, 0.35, 0.045));
      },
      sl: (c, o, t) => { noise(c, o, { t, d: 0.18, g: 0.35, f: 380 }); tone(c, o, { f: 90, f2: 50, t, d: 0.3, g: 0.4 }); },
      fail: (c, o, t) => tone(c, lowpass(c, o, 1400), { type: 'square', f: 180, t, d: 0.3, g: 0.12 }),
    },
  },
  {
    id: 'pop', gain: 1.4, name: 'Soft pop', vibe: 'Quiet phone-style pops',
    length: { buy: 0.2, tp: 0.45, sl: 0.2, fail: 0.25 },
    sounds: {
      buy: (c, o, t) => tone(c, o, { f: 420, f2: 980, t, d: 0.12, g: 0.3 }),
      tp: (c, o, t) => {
        ([[520, 1040], [700, 1400], [900, 1800]] as const).forEach(([a, b], i) => tone(c, o, { f: a, f2: b, t: t + i * 0.07, d: 0.1, g: 0.25 }));
        bell(c, o, 3136, t + 0.22, 0.25, 0.03);
      },
      sl: (c, o, t) => tone(c, o, { f: 760, f2: 300, t, d: 0.14, g: 0.3 }),
      fail: (c, o, t) => { tone(c, o, { f: 300, t, d: 0.05, g: 0.3 }); tone(c, o, { f: 280, t: t + 0.1, d: 0.06, g: 0.3 }); },
    },
  },
  {
    id: 'degen', gain: 1, name: 'Degen', vibe: 'Air horns and a sad trombone',
    length: { buy: 0.45, tp: 1.2, sl: 1.9, fail: 1.1 },
    sounds: {
      buy: (c, o, t) => airhorn(c, o, t, 0.38),
      tp: (c, o, t) => { airhorn(c, o, t, 0.14); airhorn(c, o, t + 0.19, 0.14); airhorn(c, o, t + 0.38, 0.7); },
      sl: (c, o, t) => {
        const lp = lowpass(c, o, 1100);
        [392, 370, 349].forEach((f, i) => tone(c, lp, { type: 'sawtooth', f, t: t + i * 0.38, d: 0.34, g: 0.09, attack: 0.03 }));
        tone(c, lp, { type: 'sawtooth', f: 330, f2: 311, t: t + 1.14, d: 0.75, g: 0.09, attack: 0.03, vibrato: 7 });
      },
      fail: (c, o, t) => { tone(c, o, { f: 95, f2: 42, t, d: 1, g: 0.6, attack: 0.005 }); noise(c, o, { t, d: 0.25, g: 0.15, f: 220 }); },
    },
  },
  {
    id: 'sonar', gain: 1.4, name: 'Sonar', vibe: 'Terminal pings with an echo',
    length: { buy: 1, tp: 1.2, sl: 1, fail: 0.35 },
    sounds: {
      buy: (c, o, t) => tone(c, echo(c, o), { f: 1250, t, d: 0.22, g: 0.22 }),
      tp: (c, o, t) => { const e = echo(c, o); tone(c, e, { f: 1250, t, d: 0.18, g: 0.2 }); tone(c, e, { f: 1660, t: t + 0.14, d: 0.22, g: 0.2 }); },
      sl: (c, o, t) => tone(c, echo(c, o, 0.22, 0.42), { f: 520, t, d: 0.3, g: 0.3 }),
      fail: (c, o, t) => noise(c, o, { t, d: 0.28, g: 0.22, type: 'bandpass', f: 2200, q: 2 }),
    },
  },
];

/** Looks up a pack (unknown ids fall back to Arcade). */
export function soundPack(id: string): SoundPack {
  return SOUND_PACKS.find((p) => p.id === id) ?? SOUND_PACKS[0]!;
}
