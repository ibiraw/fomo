/**
 * @file opengraph-image.tsx
 * @description Link preview image (generated at build time) for X, Telegram, Discord etc.
 * @author Reborn1987
 */

import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const alt = 'auto fomo — limit orders for fomo (unofficial)';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** 1200×630 preview: wordmark, headline and a chart line hitting its target. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#060510', color: '#f7f7f7', padding: 72, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>auto&nbsp;<span style={{ color: '#ffbf17' }}>fomo</span></div>
          <div style={{ fontSize: 22, color: '#ffbf17', border: '2px solid #ffbf1766', borderRadius: 999, padding: '6px 18px' }}>Unofficial</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 800, letterSpacing: -3, lineHeight: 1 }}>Limit orders for&nbsp;<span style={{ color: '#ffbf17' }}>fomo</span>.</div>
          <div style={{ fontSize: 32, color: '#9899a3' }}>Dip buys, take profits and stop losses — on autopilot.</div>
        </div>
        <svg width="1056" height="120" viewBox="0 0 1056 120">
          <line x1="0" x2="1056" y1="96" y2="96" stroke="#ffbf17" strokeDasharray="10 10" strokeWidth="3" />
          <polyline fill="none" stroke="#21c95e" strokeWidth="6" points="0,24 130,14 260,40 390,30 520,58 650,50 780,80 910,74 1056,96" />
          <circle cx="1046" cy="96" r="10" fill="#f7f7f7" />
        </svg>
      </div>
    ),
    size,
  );
}
