/**
 * @file opengraph-image.tsx
 * @description Link preview image (generated at build time) for X, Telegram, Discord etc.
 * @author Reborn1987
 */

import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const alt = 'limit — automated orders for fomo (unofficial)';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** 1200×630 preview: wordmark, headline and a chart line hitting its target. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#09090b', color: '#fafafa', padding: 72, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <svg width="64" height="64" viewBox="0 0 64 64">
              <rect width="64" height="64" rx="14" fill="#09090b" stroke="#26262c" strokeWidth="2" />
              <ellipse cx="32" cy="36" rx="25" ry="11" fill="none" stroke="#516af6" strokeWidth="3" strokeDasharray="5 4" transform="rotate(-18 32 36)" />
              <path d="M40 14 A16 16 0 1 0 50 38 A12 12 0 1 1 40 14 Z" fill="#fafafa" />
            </svg>
            <div style={{ display: 'flex', fontSize: 48, fontWeight: 800, letterSpacing: -1 }}>
              l
              {[0, 1].map((k) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'row' }}>
                  <div style={{ display: 'flex', position: 'relative' }}>
                    ı
                    <div style={{ position: 'absolute', left: '50%', top: 16, width: 9, height: 9, marginLeft: -4.5, borderRadius: 9, background: '#516af6' }} />
                  </div>
                  {k === 0 ? 'm' : 't'}
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 22, color: '#9a9aa3', border: '2px solid #34343c', borderRadius: 999, padding: '6px 18px' }}>Unofficial</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: -3, lineHeight: 1 }}>Limit orders for fomo.</div>
          <div style={{ fontSize: 32, color: '#9a9aa3' }}>Dip buys, take profits and stop losses — on autopilot.</div>
        </div>
        <svg width="1056" height="120" viewBox="0 0 1056 120">
          <line x1="0" x2="1056" y1="96" y2="96" stroke="#52525b" strokeDasharray="10 10" strokeWidth="3" />
          <polyline fill="none" stroke="#22c55e" strokeWidth="6" points="0,24 130,14 260,40 390,30 520,58 650,50 780,80 910,74 1056,96" />
          <circle cx="1046" cy="96" r="10" fill="#fafafa" />
        </svg>
      </div>
    ),
    size,
  );
}
