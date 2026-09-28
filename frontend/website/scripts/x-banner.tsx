/**
 * @file x-banner.tsx
 * @description Renders the X (Twitter) header banner, 1500×500: the "limit" wordmark (Figtree 700, blue dots on both
 *              i's) with the tagline, and the logo mark (crescent on the dashed orbit in fomo's Buy-button blue) on
 *              the right. Everything stays in the vertical middle and clear of the bottom-left, because X covers that
 *              corner with the profile picture and crops the top/bottom on phones.
 *              Usage (from frontend/website): npx tsx scripts/x-banner.tsx <out.png>
 * @author Reborn1987
 */

import { writeFileSync } from 'node:fs';

import { ImageResponse } from 'next/og';
import React from 'react';

const BG = '#09090b';
const WHITE = '#fafafa';
const BLUE = '#516af6';
const MUTED = '#9a9aa3';

/** Figtree 700 as TTF (satori reads TTF/OTF/WOFF, not WOFF2): Google's CSS API serves TTF to non-browser clients. */
async function figtree(weight: number): Promise<ArrayBuffer> {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Figtree:wght@${weight}`)).text();
  const url = /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
  if (!url) throw new Error(`No TTF in Google Fonts response:\n${css.slice(0, 300)}`);
  return (await fetch(url)).arrayBuffer();
}

/** "limit" with a blue dot on each (dotless) i, as flex boxes satori can lay out. */
function Wordmark({ size }: { size: number }) {
  const dot = size * 0.19;
  const letter = (c: string) => <span style={{ display: 'flex' }}>{c}</span>;
  const i = (k: string) => (
    <span key={k} style={{ display: 'flex', position: 'relative' }}>
      ı
      <span style={{ position: 'absolute', left: '50%', top: size * 0.1, width: dot, height: dot, marginLeft: -dot / 2, borderRadius: dot, background: BLUE }} />
    </span>
  );
  return (
    <div style={{ display: 'flex', fontFamily: 'Figtree', fontWeight: 700, fontSize: size, letterSpacing: -size * 0.03, lineHeight: 1, color: WHITE }}>
      {letter('l')}{i('a')}{letter('m')}{i('b')}{letter('t')}
    </div>
  );
}

/** Renders the banner PNG to `out`. */
async function main(out: string): Promise<void> {
const bold = await figtree(700);
const regular = await figtree(500);

const image = new ImageResponse(
  (
    <div style={{ width: 1500, height: 500, display: 'flex', background: BG, position: 'relative', overflow: 'hidden' }}>
      {/* The logo mark (same geometry as the icon and profile picture), large on the right. */}
      <svg width="360" height="360" viewBox="0 0 64 64" style={{ position: 'absolute', left: 1020, top: 60 }}>
        <ellipse cx="32" cy="36" rx="25" ry="11" fill="none" stroke={BLUE} strokeWidth="2.4" strokeDasharray="4.5 3.6" transform="rotate(-18 32 36)" />
        <path d="M40 14 A16 16 0 1 0 50 38 A12 12 0 1 1 40 14 Z" fill={WHITE} />
      </svg>
      <div style={{ position: 'absolute', left: 330, top: 128, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Wordmark size={200} />
        <div style={{ display: 'flex', fontFamily: 'Figtree', fontWeight: 500, fontSize: 38, color: MUTED, letterSpacing: -0.5 }}>
          Limit orders for fomo. On autopilot.
        </div>
      </div>
    </div>
  ),
  { width: 1500, height: 500, fonts: [{ name: 'Figtree', data: bold, weight: 700 }, { name: 'Figtree', data: regular, weight: 500 }] },
);
writeFileSync(out, Buffer.from(await image.arrayBuffer()));
console.log(`wrote ${out}`);
}

void main(process.argv[2] ?? 'x-banner.png');
