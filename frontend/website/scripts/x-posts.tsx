/**
 * @file x-posts.tsx
 * @description Renders the X post images (1600×900, X's in-feed 16:9) in limit's look: fomo's dark ground with a soft
 *              blue glow, the "limit" wordmark (Figtree 700, blue dots), the crescent-and-orbit mark, green/red for
 *              buy/sell. One PNG per design; the copy for each lives with the post templates.
 *              Usage (from frontend/website): npx tsx scripts/x-posts.tsx <out dir>
 * @author Reborn1987
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';
import React from 'react';

const W = 1600;
const H = 900;
const BG = '#060510';
const CARD = '#11121c';
const LINE = '#262738';
const WHITE = '#fafafa';
const MUTED = '#9a9cb2';
const FAINT = '#5d5f78';
const BLUE = '#516af6';
const BLUE_TEXT = '#7b8cff';
const GREEN = '#22c55e';
const RED = '#f43f5e';
const AMBER = '#f5b942';

/** Figtree as TTF (satori reads TTF/OTF/WOFF): Google's CSS API serves TTF to non-browser clients. */
async function figtree(weight: number): Promise<ArrayBuffer> {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Figtree:wght@${weight}`)).text();
  const url = /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
  if (!url) throw new Error(`No TTF in Google Fonts response:\n${css.slice(0, 300)}`);
  return (await fetch(url)).arrayBuffer();
}

/** "limit" with a blue dot on each (dotless) i. */
function Wordmark({ size, color = WHITE }: { size: number; color?: string }) {
  const dot = size * 0.19;
  const letter = (c: string, k: string) => <span key={k} style={{ display: 'flex' }}>{c}</span>;
  const i = (k: string) => (
    <span key={k} style={{ display: 'flex', position: 'relative' }}>
      ı
      <span style={{ position: 'absolute', left: '50%', top: size * 0.1, width: dot, height: dot, marginLeft: -dot / 2, borderRadius: dot, background: BLUE }} />
    </span>
  );
  return (
    <div style={{ display: 'flex', fontFamily: 'Figtree', fontWeight: 700, fontSize: size, letterSpacing: -size * 0.03, lineHeight: 1, color }}>
      {letter('l', 'l')}{i('a')}{letter('m', 'm')}{i('b')}{letter('t', 't')}
    </div>
  );
}

/** The logo mark: crescent on the dashed orbit. */
function Mark({ size, left, top, opacity = 1 }: { size: number; left: number; top: number; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ position: 'absolute', left, top, opacity }}>
      <ellipse cx="32" cy="36" rx="25" ry="11" fill="none" stroke={BLUE} strokeWidth="2.2" strokeDasharray="4.5 3.6" transform="rotate(-18 32 36)" />
      <path d="M40 14 A16 16 0 1 0 50 38 A12 12 0 1 1 40 14 Z" fill={WHITE} />
    </svg>
  );
}

/** Every image: the ground, a soft glow, a faint orbit, and the site in the footer. */
function Frame({ children, glow = [1200, 180], orbit = true, footer = true }: { children: React.ReactNode; glow?: [number, number]; orbit?: boolean; footer?: boolean }) {
  return (
    <div style={{ width: W, height: H, display: 'flex', background: BG, position: 'relative', overflow: 'hidden', fontFamily: 'Figtree', color: WHITE }}>
      {/* The glow is drawn on a full-frame layer (a layer larger than the image gets cut off in a hard line). */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex', backgroundImage: `radial-gradient(circle 760px at ${glow[0]}px ${glow[1]}px, rgba(81,106,246,0.26) 0%, rgba(81,106,246,0.08) 45%, rgba(6,5,16,0) 100%)` }} />
      {orbit && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          <ellipse cx={W * 0.72} cy={H * 0.55} rx={W * 0.62} ry={H * 0.34} fill="none" stroke="rgba(81,106,246,0.18)" strokeWidth="2" strokeDasharray="10 12" transform={`rotate(-14 ${W * 0.72} ${H * 0.55})`} />
        </svg>
      )}
      {children}
      {footer && (
        <div style={{ position: 'absolute', left: 90, right: 90, bottom: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 26, color: MUTED }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Wordmark size={34} />
          </div>
          <div style={{ display: 'flex', fontWeight: 600, color: WHITE }}>limit.family</div>
        </div>
      )}
    </div>
  );
}

/** Small uppercase label. */
function Eyebrow({ children, color = BLUE_TEXT }: { children: React.ReactNode; color?: string }) {
  return <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', color }}>{children}</div>;
}

/** A dot + label pill. */
function Pill({ color, children, size = 26 }: { color: string; children: React.ReactNode; size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `2px solid ${LINE}`, background: CARD, borderRadius: 999, padding: `${size * 0.45}px ${size * 0.9}px`, fontSize: size, fontWeight: 600 }}>
      <div style={{ display: 'flex', width: size * 0.45, height: size * 0.45, borderRadius: 99, background: color }} />
      {children}
    </div>
  );
}

const ORDER_TYPES: [string, string, string][] = [
  ['Limit buy', 'Buy the dip at your market cap', GREEN],
  ['Breakout buy', 'Buy when it breaks above a level', BLUE_TEXT],
  ['Take profit', 'Sell some or all when it pumps', GREEN],
  ['Stop loss', 'Get out if it dumps', RED],
];

/** name → image. */
const DESIGNS: Record<string, () => React.ReactElement> = {
  '01-launch': () => (
    <Frame glow={[1180, 300]} footer={false}>
      <Mark size={520} left={1000} top={150} />
      <div style={{ position: 'absolute', left: 120, top: 170, display: 'flex', flexDirection: 'column', gap: 30 }}>
        <Eyebrow>Now live</Eyebrow>
        <Wordmark size={250} />
        <div style={{ display: 'flex', fontSize: 58, fontWeight: 600, letterSpacing: -1, maxWidth: 820, lineHeight: 1.12 }}>Limit orders for fomo. On autopilot.</div>
        <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
          <Pill color={GREEN} size={24}>Take profit</Pill>
          <Pill color={RED} size={24}>Stop loss</Pill>
          <Pill color={BLUE_TEXT} size={24}>Breakout</Pill>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 120, bottom: 70, display: 'flex', fontSize: 30, fontWeight: 700 }}>limit.family</div>
    </Frame>
  ),

  '02-order-types': () => (
    <Frame glow={[800, 120]}>
      <div style={{ position: 'absolute', left: 90, top: 90, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Eyebrow>4 order types</Eyebrow>
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 700, letterSpacing: -2 }}>Set it. Walk away.</div>
      </div>
      <div style={{ position: 'absolute', left: 90, right: 90, top: 330, display: 'flex', gap: 24 }}>
        {ORDER_TYPES.map(([t, d, c]) => (
          <div key={t} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, background: CARD, border: `2px solid ${LINE}`, borderRadius: 28, padding: '38px 32px' }}>
            <div style={{ display: 'flex', width: 58, height: 58, borderRadius: 16, background: `${c}22`, alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ display: 'flex', width: 22, height: 22, borderRadius: 99, background: c }} />
            </div>
            <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, letterSpacing: -0.5 }}>{t}</div>
            <div style={{ display: 'flex', fontSize: 27, color: MUTED, lineHeight: 1.3 }}>{d}</div>
          </div>
        ))}
      </div>
    </Frame>
  ),

  '03-no-keys': () => (
    <Frame glow={[800, 450]} orbit={false}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', left: 0, top: 0 }}>
        <circle cx={W / 2} cy={H / 2 - 40} r="330" fill="none" stroke="rgba(81,106,246,0.22)" strokeWidth="2" strokeDasharray="10 12" />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 230, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        <div style={{ display: 'flex', fontSize: 200, fontWeight: 700, letterSpacing: -6, lineHeight: 1 }}>0</div>
        <div style={{ display: 'flex', fontSize: 60, fontWeight: 700, letterSpacing: -1 }}>private keys needed.</div>
        <div style={{ display: 'flex', fontSize: 32, color: MUTED, maxWidth: 900, textAlign: 'center', lineHeight: 1.35 }}>No seed phrase either. limit clicks fomo's own Buy and Sell in your logged-in tab.</div>
      </div>
    </Frame>
  ),

  '04-chains': () => (
    <Frame glow={[300, 700]}>
      <div style={{ position: 'absolute', left: 90, top: 110, display: 'flex', flexDirection: 'column', gap: 18, width: 620 }}>
        <Eyebrow>Every chain fomo trades</Eyebrow>
        <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.02 }}>6 chains. One Limit tab.</div>
        <div style={{ display: 'flex', fontSize: 30, color: MUTED, lineHeight: 1.35, marginTop: 8 }}>Launchpad curves and DEX pools, priced live from the chain.</div>
      </div>
      <div style={{ position: 'absolute', right: 90, top: 110, width: 700, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        {[['Solana', '#9945ff'], ['Ethereum', '#8fa4ff'], ['Base', '#2f6bff'], ['BNB', '#f3ba2f'], ['Robinhood', '#c3f53c'], ['Arc', '#b8bccb']].map(([n, c]) => (
          <div key={n} style={{ width: 340, display: 'flex', alignItems: 'center', gap: 20, background: CARD, border: `2px solid ${LINE}`, borderRadius: 22, padding: '30px 30px' }}>
            <div style={{ display: 'flex', width: 26, height: 26, borderRadius: 99, background: c }} />
            <div style={{ display: 'flex', fontSize: 38, fontWeight: 700 }}>{n}</div>
          </div>
        ))}
      </div>
    </Frame>
  ),

  '05-speed': () => (
    <Frame glow={[400, 250]}>
      <div style={{ position: 'absolute', left: 90, top: 100, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Eyebrow>Private RPC</Eyebrow>
        <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>Prices straight from the chain.</div>
      </div>
      <div style={{ position: 'absolute', left: 90, right: 90, top: 360, display: 'flex', gap: 28 }}>
        {[['<1s', 'price updates, on-chain', 'Our own dedicated connections, updated the moment a trade confirms.'], ['~2.6s', 'trigger to filled', 'Re-checked before it fires, confirmed from your wallet.'], ['6', 'chains, one Limit tab', 'Solana, Ethereum, Base, BNB, Robinhood and Arc.']].map(([big, label, sub]) => (
          <div key={big} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, borderTop: `3px solid ${BLUE}`, paddingTop: 34 }}>
            <div style={{ display: 'flex', fontSize: 110, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>{big}</div>
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 600, color: BLUE_TEXT }}>{label}</div>
            <div style={{ display: 'flex', fontSize: 26, color: MUTED, lineHeight: 1.35 }}>{sub}</div>
          </div>
        ))}
      </div>
    </Frame>
  ),

  '06-pricing': () => (
    <Frame glow={[1150, 420]}>
      <div style={{ position: 'absolute', left: 90, top: 150, display: 'flex', flexDirection: 'column', gap: 20, width: 720 }}>
        <Eyebrow>Free to try</Eyebrow>
        <div style={{ display: 'flex', fontSize: 96, fontWeight: 700, letterSpacing: -3, lineHeight: 1 }}>Your first 3 fills are on us.</div>
        <div style={{ display: 'flex', fontSize: 32, color: MUTED, lineHeight: 1.35 }}>A free order is used only when it actually fills.</div>
      </div>
      <div style={{ position: 'absolute', right: 110, top: 190, width: 560, display: 'flex', flexDirection: 'column', gap: 18, background: CARD, border: `2px solid ${LINE}`, borderRadius: 32, padding: '48px 48px' }}>
        <div style={{ display: 'flex', fontSize: 28, color: MUTED, fontWeight: 600 }}>After that</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
          <div style={{ display: 'flex', fontSize: 130, fontWeight: 700, letterSpacing: -5, lineHeight: 1 }}>$50</div>
          <div style={{ display: 'flex', fontSize: 34, color: MUTED, paddingBottom: 14 }}>/ 30 days</div>
        </div>
        <div style={{ display: 'flex', fontSize: 28, color: MUTED }}>Paid in USDC on any supported chain</div>
        <div style={{ display: 'flex', height: 2, background: LINE, marginTop: 8 }} />
        {['Unlimited orders', 'All 6 chains', 'No keys, no custody'].map((t) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, fontWeight: 600 }}>
            <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 99, background: GREEN }} />{t}
          </div>
        ))}
      </div>
    </Frame>
  ),

  '07-order-card': () => (
    <Frame glow={[1080, 450]}>
      <div style={{ position: 'absolute', left: 90, top: 180, display: 'flex', flexDirection: 'column', gap: 20, width: 620 }}>
        <Eyebrow>Take profit</Eyebrow>
        <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.02 }}>Sell the top while you sleep.</div>
        <div style={{ display: 'flex', fontSize: 30, color: MUTED, lineHeight: 1.35 }}>Pick a market cap, pick how much. limit does the rest.</div>
      </div>
      <div style={{ position: 'absolute', right: 110, top: 150, width: 620, display: 'flex', flexDirection: 'column', gap: 20, background: CARD, border: `2px solid ${LINE}`, borderRadius: 32, padding: 40 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {['Buy', 'Sell'].map((t, i) => (
            <div key={t} style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '16px 0', borderRadius: 16, fontSize: 28, fontWeight: 700, background: i === 1 ? 'rgba(244,63,94,0.18)' : '#1a1b27', color: i === 1 ? '#fb7185' : MUTED }}>{t}</div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0b0c15', border: `2px solid ${LINE}`, borderRadius: 18, padding: '22px 26px' }}>
          <div style={{ display: 'flex', fontSize: 24, color: MUTED, fontWeight: 700, letterSpacing: 2 }}>AMOUNT</div>
          <div style={{ display: 'flex', fontSize: 38, fontWeight: 700 }}>50%</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0b0c15', border: `2px solid ${LINE}`, borderRadius: 18, padding: '22px 26px' }}>
          <div style={{ display: 'flex', fontSize: 24, color: MUTED, fontWeight: 700, letterSpacing: 2 }}>MKT CAP</div>
          <div style={{ display: 'flex', fontSize: 38, fontWeight: 700 }}>$200,000</div>
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>If it hits, you'd get about $164 before fees</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 18, padding: '22px 26px', background: 'rgba(34,197,94,0.12)', border: '2px solid rgba(34,197,94,0.35)' }}>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 700 }}>Take profit · 50%</div>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: GREEN }}>Filled</div>
        </div>
        <div style={{ display: 'flex', fontSize: 20, color: FAINT }}>Example order</div>
      </div>
    </Frame>
  ),

  '08-setup': () => (
    <Frame glow={[800, 800]}>
      <div style={{ position: 'absolute', left: 90, top: 100, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Eyebrow>Set up in a minute</Eyebrow>
        <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>Three steps to your first order.</div>
      </div>
      <div style={{ position: 'absolute', left: 90, right: 90, top: 340, display: 'flex', gap: 28 }}>
        {[['Download', 'Get limit from limit.family and unzip it.'], ['Load it', 'Open brave://extensions, turn on Developer mode, Load unpacked.'], ['Trade', 'Open a coin on fomo. A new Limit tab is waiting.']].map(([t, d], i) => (
          <div key={t} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, background: CARD, border: `2px solid ${LINE}`, borderRadius: 28, padding: '40px 36px' }}>
            <div style={{ display: 'flex', width: 64, height: 64, borderRadius: 99, border: `2px solid ${BLUE}`, alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700, color: BLUE_TEXT }}>{i + 1}</div>
            <div style={{ display: 'flex', fontSize: 42, fontWeight: 700 }}>{t}</div>
            <div style={{ display: 'flex', fontSize: 28, color: MUTED, lineHeight: 1.35 }}>{d}</div>
          </div>
        ))}
      </div>
    </Frame>
  ),

  '09-problem': () => (
    <Frame glow={[1300, 200]}>
      <svg width="900" height="420" viewBox="0 0 900 420" style={{ position: 'absolute', right: 70, top: 170 }}>
        <polyline points="0,340 90,320 170,300 240,250 300,190 360,120 410,70 450,40 490,90 540,160 600,230 670,280 740,330 820,360 900,375" fill="none" stroke={RED} strokeWidth="6" strokeLinejoin="round" />
        <circle cx="450" cy="40" r="14" fill={GREEN} />
        <line x1="0" y1="40" x2="900" y2="40" stroke={GREEN} strokeWidth="2" strokeDasharray="10 10" />
        <circle cx="90" cy="320" r="10" fill={WHITE} />
      </svg>
      <div style={{ position: 'absolute', right: 110, top: 118, display: 'flex', fontSize: 26, fontWeight: 700, color: GREEN }}>a take profit sells here</div>
      <div style={{ position: 'absolute', left: 90, top: 150, display: 'flex', flexDirection: 'column', gap: 18, width: 560 }}>
        {[['You bought at', '$20K'], ['It ran to', '$90K'], ['It’s now', '$15K']].map(([l, v], i) => (
          <div key={l} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 30, color: MUTED }}>{l}</div>
            <div style={{ display: 'flex', fontSize: 100, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05, color: i === 1 ? GREEN : i === 2 ? RED : WHITE }}>{v}</div>
          </div>
        ))}
      </div>
    </Frame>
  ),

  '10-build-log': () => (
    <Frame glow={[1250, 150]}>
      <div style={{ position: 'absolute', left: 90, top: 90, right: 90, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Eyebrow>Build log</Eyebrow>
          <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>Shipped this week</div>
        </div>
        <Pill color={GREEN} size={26}>Live now</Pill>
      </div>
      <div style={{ position: 'absolute', left: 90, right: 90, top: 300, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {[
          ['New', 'Live prices for fresh pons coins on Robinhood, from their curve', GREEN],
          ['Fix', 'Graduated coins move off dust pools to their real pool', BLUE_TEXT],
          ['Fix', 'A sell fomo refuses is tried again at your next target', BLUE_TEXT],
          ['New', 'Holder stats for coins up to 7 days old on BNB, Arc and Robinhood', GREEN],
        ].map(([tag, t, c]) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 26, background: CARD, border: `2px solid ${LINE}`, borderRadius: 22, padding: '24px 30px' }}>
            <div style={{ display: 'flex', width: 92, justifyContent: 'center', fontSize: 22, fontWeight: 700, letterSpacing: 2, color: c, border: `2px solid ${c}`, borderRadius: 999, padding: '6px 0' }}>{tag.toUpperCase()}</div>
            <div style={{ display: 'flex', fontSize: 33, fontWeight: 600 }}>{t}</div>
          </div>
        ))}
      </div>
    </Frame>
  ),

  '11-changelog': () => (
    <Frame glow={[800, 300]} orbit={false}>
      <Mark size={880} left={900} top={-80} opacity={0.12} />
      <div style={{ position: 'absolute', left: 90, top: 150, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <Eyebrow>Update</Eyebrow>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 30 }}>
          <Wordmark size={190} />
          <div style={{ display: 'flex', fontSize: 96, fontWeight: 700, letterSpacing: -3, color: BLUE_TEXT, lineHeight: 1, paddingBottom: 8 }}>this week</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
          {['Faster pool switching after graduation', 'Retries on sells fomo refuses', 'Cleaner sell alerts'].map((t) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 38, fontWeight: 600 }}>
              <div style={{ display: 'flex', width: 12, height: 12, borderRadius: 99, background: BLUE }} />{t}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  ),

  '12-coming-soon': () => (
    <Frame glow={[800, 450]}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <Eyebrow color={AMBER}>Coming soon</Eyebrow>
        <div style={{ display: 'flex', fontSize: 92, fontWeight: 700, letterSpacing: -3 }}>Buy from the feed.</div>
        <div style={{ display: 'flex', fontSize: 32, color: MUTED }}>Quick buttons under every post in your fomo Feed and Alerts.</div>
      </div>
      <div style={{ position: 'absolute', left: 330, right: 330, top: 470, display: 'flex', flexDirection: 'column', gap: 22, background: CARD, border: `2px solid ${LINE}`, borderRadius: 28, padding: '32px 36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ display: 'flex', width: 56, height: 56, borderRadius: 99, background: '#262738' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', width: 220, height: 18, borderRadius: 9, background: '#2d2e42' }} />
            <div style={{ display: 'flex', width: 380, height: 14, borderRadius: 7, background: '#1f2030' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {[['Buy $50', GREEN], ['Buy $200', GREEN], ['Sell 50%', RED]].map(([t, c]) => (
            <div key={t} style={{ display: 'flex', padding: '14px 28px', borderRadius: 16, fontSize: 30, fontWeight: 700, color: c, background: `${c}22`, border: `2px solid ${c}66` }}>{t}</div>
          ))}
        </div>
      </div>
    </Frame>
  ),
};

/** Renders every design to `<dir>/<name>.png`. */
async function main(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const fonts = [
    { name: 'Figtree', data: await figtree(700), weight: 700 as const },
    { name: 'Figtree', data: await figtree(600), weight: 600 as const },
    { name: 'Figtree', data: await figtree(500), weight: 500 as const },
  ];
  for (const [name, render] of Object.entries(DESIGNS)) {
    const image = new ImageResponse(render(), { width: W, height: H, fonts });
    const out = join(dir, `${name}.png`);
    writeFileSync(out, Buffer.from(await image.arrayBuffer()));
    console.log(`wrote ${out}`);
  }
}

void main(process.argv[2] ?? 'x-posts');
