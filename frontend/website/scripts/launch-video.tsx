/**
 * @file launch-video.tsx
 * @description Renders limit's 30-second launch video (1920×1080, 30 fps, H.264 MP4, no audio) in the brand look:
 *              each frame is laid out with satori (next/og) and piped as PNG into ffmpeg. Scenes: logo → the problem →
 *              a take profit set, hit and filled → order types → stats → pricing → end card.
 *              Usage (from frontend/website): npx tsx scripts/launch-video.tsx <out.mp4> <path to ffmpeg>
 * @author Reborn1987
 */

import { spawn } from 'node:child_process';

import { ImageResponse } from 'next/og';
import React from 'react';

const W = 1920;
const H = 1080;
const FPS = 30;
const SECONDS = 30;

const BG = '#060510';
const CARD = '#11121c';
const LINE = '#262738';
const WHITE = '#fafafa';
const MUTED = '#9a9cb2';
const BLUE = '#516af6';
const BLUE_TEXT = '#7b8cff';
const GREEN = '#22c55e';
const RED = '#f43f5e';

/** Figtree as TTF (satori reads TTF/OTF/WOFF). */
async function figtree(weight: number): Promise<ArrayBuffer> {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Figtree:wght@${weight}`)).text();
  const url = /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
  if (!url) throw new Error(`No TTF in Google Fonts response:\n${css.slice(0, 300)}`);
  return (await fetch(url)).arrayBuffer();
}

/* ---------- timing helpers ---------- */

const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));
/** 0→1 over [a, b] seconds. */
const prog = (t: number, a: number, b: number): number => clamp((t - a) / (b - a));
const easeOut = (x: number): number => 1 - (1 - x) ** 3;
const easeInOut = (x: number): number => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
/** Opacity of a scene shown in [a, b] with fades of `f` seconds. */
const sceneAlpha = (t: number, a: number, b: number, f = 0.45): number => Math.min(prog(t, a, a + f), 1 - prog(t, b - f, b));
/** Fade + rise of an element appearing at `at`. */
function rise(t: number, at: number, dur = 0.6, dist = 34): React.CSSProperties {
  const p = easeOut(prog(t, at, at + dur));
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
}

/* ---------- brand pieces ---------- */

function Wordmark({ size }: { size: number }) {
  const dot = size * 0.19;
  const letter = (c: string, k: string) => <span key={k} style={{ display: 'flex' }}>{c}</span>;
  const i = (k: string) => (
    <span key={k} style={{ display: 'flex', position: 'relative' }}>
      ı
      <span style={{ position: 'absolute', left: '50%', top: size * 0.1, width: dot, height: dot, marginLeft: -dot / 2, borderRadius: dot, background: BLUE }} />
    </span>
  );
  return (
    <div style={{ display: 'flex', fontFamily: 'Figtree', fontWeight: 700, fontSize: size, letterSpacing: -size * 0.03, lineHeight: 1, color: WHITE }}>
      {letter('l', 'l')}{i('a')}{letter('m', 'm')}{i('b')}{letter('t', 't')}
    </div>
  );
}

/** The crescent on its dashed orbit; `draw` 0→1 traces the orbit, `moon` 0→1 fades the crescent in. */
function Mark({ size, draw = 1, moon = 1 }: { size: number; draw?: number; moon?: number }) {
  const circumference = 2 * Math.PI * 25 * 0.72; // approx. length of the 25×11 ellipse
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <ellipse cx="32" cy="36" rx="25" ry="11" fill="none" stroke={BLUE} strokeWidth="2.2" strokeDasharray={draw >= 1 ? '4.5 3.6' : `${circumference * draw} ${circumference}`} transform="rotate(-18 32 36)" />
      <path d="M40 14 A16 16 0 1 0 50 38 A12 12 0 1 1 40 14 Z" fill={WHITE} opacity={moon} />
    </svg>
  );
}

function Frame({ children, glow = [W * 0.72, H * 0.3] }: { children: React.ReactNode; glow?: [number, number] }) {
  return (
    <div style={{ width: W, height: H, display: 'flex', background: BG, position: 'relative', overflow: 'hidden', fontFamily: 'Figtree', color: WHITE }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex', backgroundImage: `radial-gradient(circle 900px at ${glow[0]}px ${glow[1]}px, rgba(81,106,246,0.24) 0%, rgba(81,106,246,0.07) 45%, rgba(6,5,16,0) 100%)` }} />
      {children}
    </div>
  );
}

/** A full-frame layer at `alpha`. */
function Layer({ alpha, children, center = true }: { alpha: number; children: React.ReactNode; center?: boolean }) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: center ? 'center' : 'stretch', justifyContent: center ? 'center' : 'flex-start', opacity: alpha }}>
      {children}
    </div>
  );
}

function Eyebrow({ children, color = BLUE_TEXT, style }: { children: React.ReactNode; color?: string; style?: React.CSSProperties }) {
  return <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, letterSpacing: 5, textTransform: 'uppercase', color, ...style }}>{children}</div>;
}

/* ---------- scenes ---------- */

/** 0–3 s: the mark draws itself, then the wordmark. */
function Intro({ t }: { t: number }) {
  const draw = easeInOut(prog(t, 0.2, 1.4));
  const moon = easeOut(prog(t, 0.6, 1.3));
  const scale = 0.9 + 0.1 * easeOut(prog(t, 0.2, 1.6));
  return (
    <Layer alpha={sceneAlpha(t, 0, 3.1, 0.3)}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40, transform: `scale(${scale})` }}>
        <Mark size={300} draw={draw} moon={moon} />
        <div style={{ display: 'flex', ...rise(t, 1.3, 0.7) }}><Wordmark size={170} /></div>
      </div>
    </Layer>
  );
}

/** 3–9 s: the problem, then the promise. */
function Problem({ t }: { t: number }) {
  const words = ['You', 'can’t', 'watch', 'every', 'chart.'];
  return (
    <>
      <Layer alpha={sceneAlpha(t, 3, 6.1)}>
        <div style={{ display: 'flex', gap: 30, fontSize: 118, fontWeight: 700, letterSpacing: -4 }}>
          {words.map((w, i) => <div key={w} style={{ display: 'flex', ...rise(t, 3.25 + i * 0.16, 0.5, 40) }}>{w}</div>)}
        </div>
      </Layer>
      <Layer alpha={sceneAlpha(t, 6, 9.1)}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
          <div style={{ display: 'flex', fontSize: 118, fontWeight: 700, letterSpacing: -4, ...rise(t, 6.2, 0.6) }}>So limit watches</div>
          <div style={{ display: 'flex', fontSize: 118, fontWeight: 700, letterSpacing: -4, color: BLUE_TEXT, ...rise(t, 6.45, 0.6) }}>them for you.</div>
        </div>
      </Layer>
    </>
  );
}

/** Price path of the demo chart (0..1 along x → market cap in $K). */
function mcAt(x: number): number {
  const base = 80 + 150 * x ** 1.6;
  return base + 9 * Math.sin(x * 23) + 6 * Math.sin(x * 51);
}

/** 9–17 s: set a take profit at $200K, the chart climbs to it, fomo sells, the order fills. */
function Demo({ t }: { t: number }) {
  const alpha = sceneAlpha(t, 9, 17.1);
  const typed = '200,000'.slice(0, Math.round(prog(t, 9.9, 10.7) * 7));
  const pressed = t >= 11.1 && t < 11.35;
  const placed = t >= 11.3;
  // Chart: 12.0 → 14.6 s it runs up to the target.
  const run = easeInOut(prog(t, 11.8, 14.6));
  const cw = 900;
  const ch = 520;
  const maxMc = 260;
  const y = (mc: number): number => ch - (mc / maxMc) * ch;
  const pts: string[] = [];
  const steps = 120;
  for (let i = 0; i <= Math.round(steps * run); i++) {
    const x = i / steps;
    pts.push(`${(x * cw).toFixed(1)},${y(Math.min(mcAt(x), 206)).toFixed(1)}`);
  }
  const hit = t >= 14.6;
  const head = pts.at(-1)?.split(',').map(Number) ?? [0, y(mcAt(0))];
  const mcNow = Math.round(Math.min(mcAt(run), 206));
  const toast = rise(t, 14.75, 0.4, 20);
  const filled = t >= 15.4;
  return (
    <Layer alpha={alpha} center={false}>
      <div style={{ position: 'absolute', left: 120, top: 110, display: 'flex', flexDirection: 'column', gap: 14, ...rise(t, 9.2) }}>
        <Eyebrow>Take profit</Eyebrow>
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 700, letterSpacing: -2 }}>Set a target. Walk away.</div>
      </div>

      {/* Chart */}
      <div style={{ position: 'absolute', left: 120, top: 330, width: cw, height: ch + 60, display: 'flex', ...rise(t, 9.5) }}>
        <svg width={cw} height={ch} viewBox={`0 0 ${cw} ${ch}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={cw} y1={ch * f} y2={ch * f} stroke={LINE} strokeWidth="1.5" />)}
          {placed && <line x1="0" x2={cw} y1={y(200)} y2={y(200)} stroke={GREEN} strokeWidth="2.5" strokeDasharray="12 10" opacity={easeOut(prog(t, 11.3, 11.8))} />}
          {pts.length > 1 && <polyline points={pts.join(' ')} fill="none" stroke={hit ? GREEN : BLUE_TEXT} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />}
          {pts.length > 1 && <circle cx={head[0]} cy={head[1]} r={hit ? 14 : 9} fill={hit ? GREEN : WHITE} />}
        </svg>
        {placed && <div style={{ position: 'absolute', left: cw - 250, top: y(200) - 52, display: 'flex', fontSize: 26, fontWeight: 700, color: GREEN, opacity: easeOut(prog(t, 11.4, 11.9)) }}>target $200K</div>}
        <div style={{ position: 'absolute', left: 0, top: ch + 18, display: 'flex', fontSize: 30, color: MUTED }}>
          {`MC $${run > 0 ? mcNow : 80}K`}
        </div>
      </div>

      {/* Order card */}
      <div style={{ position: 'absolute', right: 120, top: 250, width: 640, display: 'flex', flexDirection: 'column', gap: 20, background: CARD, border: `2px solid ${LINE}`, borderRadius: 34, padding: 40, ...rise(t, 9.4) }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {['Buy', 'Sell'].map((s, i) => (
            <div key={s} style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '18px 0', borderRadius: 16, fontSize: 30, fontWeight: 700, background: i === 1 ? 'rgba(244,63,94,0.18)' : '#1a1b27', color: i === 1 ? '#fb7185' : MUTED }}>{s}</div>
          ))}
        </div>
        {[['AMOUNT', t >= 9.7 ? '50%' : ''], ['MKT CAP', typed ? `$${typed}` : '']].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0b0c15', border: `2px solid ${LINE}`, borderRadius: 18, padding: '24px 28px' }}>
            <div style={{ display: 'flex', fontSize: 24, color: MUTED, fontWeight: 700, letterSpacing: 2 }}>{k}</div>
            <div style={{ display: 'flex', fontSize: 40, fontWeight: 700 }}>{v || ' '}</div>
          </div>
        ))}
        {!placed ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0', borderRadius: 18, fontSize: 32, fontWeight: 700, background: BLUE, transform: pressed ? 'scale(0.96)' : 'scale(1)', opacity: t >= 10.8 ? 1 : 0.5 }}>Place take profit</div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 18, padding: '24px 28px', background: filled ? 'rgba(34,197,94,0.14)' : '#15162a', border: `2px solid ${filled ? 'rgba(34,197,94,0.45)' : LINE}` }}>
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 700 }}>Take profit · 50%</div>
            <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: filled ? GREEN : MUTED }}>{filled ? 'Filled' : 'Waiting'}</div>
          </div>
        )}
      </div>

      {/* fomo's toast */}
      {t >= 14.75 && (
        <div style={{ position: 'absolute', left: 120 + cw / 2 - 230, top: 250, display: 'flex', alignItems: 'center', gap: 16, background: '#0f1019', border: `2px solid ${LINE}`, borderRadius: 18, padding: '18px 26px', fontSize: 30, fontWeight: 600, ...toast }}>
          <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 99, background: RED }} />
          Selling 1.2M $KEK
        </div>
      )}
    </Layer>
  );
}

/** 17–21 s: the four order types. */
function OrderTypes({ t }: { t: number }) {
  const types: [string, string, string][] = [
    ['Limit buy', 'Buy the dip at your price', GREEN],
    ['Breakout buy', 'Buy when it breaks out', BLUE_TEXT],
    ['Take profit', 'Sell into the pump', GREEN],
    ['Stop loss', 'Get out if it dumps', RED],
  ];
  return (
    <Layer alpha={sceneAlpha(t, 17, 21.1)}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 60 }}>
        <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, letterSpacing: -3, ...rise(t, 17.2) }}>Every exit, planned.</div>
        <div style={{ display: 'flex', gap: 28 }}>
          {types.map(([name, sub, c], i) => (
            <div key={name} style={{ width: 380, display: 'flex', flexDirection: 'column', gap: 18, background: CARD, border: `2px solid ${LINE}`, borderRadius: 30, padding: '40px 34px', ...rise(t, 17.6 + i * 0.18, 0.5, 50) }}>
              <div style={{ display: 'flex', width: 64, height: 64, borderRadius: 18, background: `${c}22`, alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ display: 'flex', width: 24, height: 24, borderRadius: 99, background: c }} />
              </div>
              <div style={{ display: 'flex', fontSize: 44, fontWeight: 700 }}>{name}</div>
              <div style={{ display: 'flex', fontSize: 28, color: MUTED }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </Layer>
  );
}

/** 21–24 s: three numbers. */
function Stats({ t }: { t: number }) {
  const stats: [string, string][] = [['6', 'chains'], ['<1s', 'price updates, on-chain'], ['0', 'private keys needed']];
  return (
    <Layer alpha={sceneAlpha(t, 21, 24.1)}>
      <div style={{ display: 'flex', gap: 60 }}>
        {stats.map(([big, label], i) => (
          <div key={label} style={{ width: 460, display: 'flex', flexDirection: 'column', gap: 14, borderTop: `4px solid ${BLUE}`, paddingTop: 38, ...rise(t, 21.2 + i * 0.22, 0.6, 50) }}>
            <div style={{ display: 'flex', fontSize: 170, fontWeight: 700, letterSpacing: -6, lineHeight: 1 }}>{big}</div>
            <div style={{ display: 'flex', fontSize: 38, fontWeight: 600, color: BLUE_TEXT }}>{label}</div>
          </div>
        ))}
      </div>
    </Layer>
  );
}

/** 24–27 s: the offer. */
function Pricing({ t }: { t: number }) {
  return (
    <Layer alpha={sceneAlpha(t, 24, 27.1)}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30 }}>
        <div style={{ display: 'flex', fontSize: 132, fontWeight: 700, letterSpacing: -5, ...rise(t, 24.2) }}>3 fills free.</div>
        <div style={{ display: 'flex', fontSize: 56, fontWeight: 600, color: MUTED, ...rise(t, 24.6) }}>Then $50 per 30 days, in USDC.</div>
      </div>
    </Layer>
  );
}

/** 27–30 s: end card. */
function Outro({ t }: { t: number }) {
  const a = Math.min(prog(t, 27, 27.45), 1 - prog(t, 29.6, 30));
  return (
    <Layer alpha={a}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40, ...rise(t, 27.1) }}>
          <Mark size={220} />
          <Wordmark size={180} />
        </div>
        <div style={{ display: 'flex', fontSize: 54, fontWeight: 600, ...rise(t, 27.5) }}>Limit orders for fomo.</div>
        <div style={{ display: 'flex', fontSize: 44, fontWeight: 700, color: BLUE_TEXT, ...rise(t, 27.8) }}>limit.family</div>
      </div>
    </Layer>
  );
}

/** One frame at time `t` (seconds). */
function FrameAt({ t }: { t: number }) {
  const glowX = W * (0.3 + 0.4 * Math.sin(t / 6));
  return (
    <Frame glow={[glowX, H * 0.35]}>
      {t < 3.2 && <Intro t={t} />}
      {t >= 2.9 && t < 9.2 && <Problem t={t} />}
      {t >= 8.9 && t < 17.2 && <Demo t={t} />}
      {t >= 16.9 && t < 21.2 && <OrderTypes t={t} />}
      {t >= 20.9 && t < 24.2 && <Stats t={t} />}
      {t >= 23.9 && t < 27.2 && <Pricing t={t} />}
      {t >= 26.9 && <Outro t={t} />}
    </Frame>
  );
}

/** Renders every frame and pipes them into ffmpeg. */
async function main(out: string, ffmpeg: string): Promise<void> {
  const fonts = [
    { name: 'Figtree', data: await figtree(700), weight: 700 as const },
    { name: 'Figtree', data: await figtree(600), weight: 600 as const },
    { name: 'Figtree', data: await figtree(500), weight: 500 as const },
  ];
  const enc = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise<void>((resolve, reject) => enc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  const total = FPS * SECONDS;
  for (let f = 0; f < total; f++) {
    const png = Buffer.from(await new ImageResponse(<FrameAt t={f / FPS} />, { width: W, height: H, fonts }).arrayBuffer());
    if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once('drain', r));
    if (f % 90 === 0) console.log(`frame ${f}/${total}`);
  }
  enc.stdin.end();
  await done;
  console.log(`wrote ${out}`);
}

void main(process.argv[2] ?? 'limit-launch.mp4', process.argv[3] ?? 'ffmpeg');
