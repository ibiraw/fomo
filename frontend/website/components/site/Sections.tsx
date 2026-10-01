/**
 * @file Sections.tsx
 * @description Static sections of the limit site: header, hero, features, architecture, FAQ and
 *              footer (setup and pricing live in GetStarted.tsx). No personal information anywhere.
 * @author Reborn1987
 */

import Link from 'next/link';
import {
  Activity,
  BellOff,
  CircleCheck,
  KeyRound,
  Layers,
  MousePointerClick,
  Radio,
  ShieldCheck,
  Timer,
} from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isReleased } from '@/lib/releases';
import { LogoWord, MoonMark } from './Logo';
import { TokenStrip } from './TokenCA';

/** Lowercase wordmark. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <MoonMark size={26} />
      <LogoWord />
    </span>
  );
}

/** limit's X account. */
export const X_URL = 'https://x.com/limitdotfamily';

/** The X logo (single-colour, follows the text colour). */
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Sticky top bar. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link href="/#top" aria-label="limit home"><Wordmark className="text-lg" /></Link>
        <nav className="hidden gap-6 text-sm text-muted-foreground md:flex">
          <Link href="/#demo" className="hover:text-foreground">Demo</Link>
          <Link href="/#features" className="hover:text-foreground">Features</Link>
          {isReleased('1.1.0') && <Link href="/#themes" className="hover:text-foreground">Themes</Link>}
          <Link href="/#how" className="hover:text-foreground">How it works</Link>
          <Link href="/#pricing" className="hover:text-foreground">Pricing</Link>
          <Link href="/#get" className="hover:text-foreground">Get limit</Link>
          <Link href="/#updates" className="hover:text-foreground">What&apos;s new</Link>
          <Link href="/#faq" className="hover:text-foreground">FAQ</Link>
        </nav>
        <div className="flex items-center gap-3">
          <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="limit on X (@limitdotfamily)" title="@limitdotfamily on X" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><XIcon className="size-4" /></a>
          <Badge variant="outline" className="border-brand/40 text-brand">Unofficial</Badge>
        </div>
      </div>
    </header>
  );
}

/** Hero. */
export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[28rem] max-w-3xl rounded-full bg-brand/10 blur-3xl" />
      <div className="relative mx-auto max-w-4xl px-5 pb-16 pt-20 text-center md:pt-28">
        <TokenStrip />
        <Badge variant="outline" className="mb-6 border-border text-muted-foreground">Unofficial · not affiliated with fomo.family</Badge>
        <h1 className="text-balance text-4xl font-bold tracking-tight md:text-6xl">
          Limit orders for <span className="text-brand">fomo</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
          Set a market-cap target. Limit clicks Buy or Sell in your own fomo tab the moment it hits —
          dip buys, take profits and stop losses, without watching the chart.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="rounded-xl bg-brand font-bold text-on-brand hover:bg-brand/90">
            <a href="#demo">See it work</a>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-xl">
            <a href="#get">Get limit — free to try</a>
          </Button>
        </div>
        <dl className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-4 text-center">
          {[
            ['~2.6s', 'trigger to filled'],
            ['0', 'private keys needed'],
            ['<1s', 'price updates, on-chain'],
          ].map(([v, l]) => (
            <div key={l} className="rounded-xl border bg-card/50 px-3 py-4">
              <dt className="sr-only">{l}</dt>
              <dd className="text-2xl font-bold text-foreground">{v}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">{l}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** Section heading. */
export function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-brand">{eyebrow}</p>
      <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-balance text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Feature cards; `since` hides a card until that version is public. */
const FEATURES: readonly { icon: typeof Timer; title: string; body: string; since?: string }[] = [
  { icon: MousePointerClick, title: 'A native Limit tab', body: "Sits next to fomo's Buy and Sell. Presets, a −100% to +100% market-cap slider, and the order type worked out for you." },
  { icon: Radio, title: 'Private RPC, live prices', body: 'limit streams launchpad curves and DEX pools over its own dedicated blockchain connections on Solana, Base, Ethereum, BNB, Robinhood and Arc, so a new price lands in under a second, the moment a trade confirms. Anything else falls back to a slower price, clearly marked.' },
  { icon: CircleCheck, title: 'Confirmed on-chain', body: 'A fill only counts when your wallet balance actually changes — no guessing from the page.' },
  { icon: Timer, since: '1.2.0', title: "The token's last post", body: "See how long ago the token's X account last posted — green when fresh, red when it's gone quiet — with a preview." },
  { icon: BellOff, title: 'Auto-cancel', body: 'Sold out of a token? Its leftover take-profits and stop-losses cancel themselves.' },
  { icon: Activity, title: 'Built for speed', body: 'One trade at a time, re-checked before firing, retried on slippage. Trigger to filled in about 2.6 seconds.' },
];

/** Feature grid. */
export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHead eyebrow="Features" title="Everything fomo's panel is missing" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.filter((f) => f.since === undefined || isReleased(f.since)).map((f) => (
          <div key={f.title} className="rounded-2xl border bg-card p-5">
            <f.icon className="size-5 text-brand" aria-hidden />
            <h3 className="mt-3 font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const PARTS = [
  { icon: Layers, name: 'Browser extension', where: 'in Chrome or Brave', points: ['Adds the Limit tab to fomo', "Clicks fomo's own Buy / Sell", ...(isReleased('1.2.0') ? ['Reads the token’s latest X post'] : ['Shows your orders on every token page'])] },
  { icon: Activity, name: 'limit server', where: 'always on', points: ['Keeps your orders', 'Watches live prices, triggers orders', 'Confirms fills from your wallet'] },
  { icon: Radio, name: 'Blockchains', where: 'public, read-only', points: ['Solana, Base, Ethereum, BNB, Robinhood, Arc', 'Live pool prices and your balances', 'No keys, read-only'] },
] as const;

/** Architecture overview. */
export function HowItWorks() {
  return (
    <section id="how" className="border-y bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <SectionHead eyebrow="How it works" title="Three parts, no keys" sub="The server watches prices around the clock. Your own fomo tab does the clicking, so your keys never leave fomo." />
        <div className="grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          {PARTS.map((p, i) => (
            <div key={p.name} className="contents">
              <div className="rounded-2xl border bg-background p-5">
                <p.icon className="size-5 text-brand" aria-hidden />
                <h3 className="mt-3 font-semibold">{p.name}</h3>
                <p className="text-xs text-muted-foreground">{p.where}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  {p.points.map((pt) => <li key={pt}>· {pt}</li>)}
                </ul>
              </div>
              {i < PARTS.length - 1 && (
                <div className="flex items-center justify-center text-2xl text-faint" aria-hidden>
                  <span className="hidden md:inline">⇄</span><span className="md:hidden">⇅</span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
          <div className="flex gap-3 rounded-xl border bg-background p-4">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-buy" aria-hidden />
            <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">No private keys.</span> It never asks for them. Trades go through fomo exactly as if you clicked.</p>
          </div>
          <div className="flex gap-3 rounded-xl border bg-background p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-buy" aria-hidden />
            <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">Anonymous account.</span> No email or sign-up: the extension makes a private account key on install. Its backup code moves you to another browser.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  ['Is this made by fomo?', 'No. limit is an independent, unofficial tool. It is not affiliated with, endorsed by or connected to fomo.family or Fomo Labs.'],
  ['Do you need my private keys or seed phrase?', 'Never. limit clicks the Buy and Sell buttons in your own logged-in fomo tab, exactly like you would. It only reads public blockchain data.'],
  ['Which tokens work?', "On Solana: pump.fun (curve and PumpSwap), bonk.fun / Raydium LaunchLab, Raydium CPMM and fomo's own launchpad pools are priced live on-chain. On Base, Ethereum, BNB, Robinhood and Arc: four.meme and flap.sh curves and Uniswap / PancakeSwap pools are read live too. Anything else uses a slower backup price — the app tells you when that happens."],
  ['What do I need to run it?', 'Chrome or Brave with the extension and a logged-in fomo tab. The browser must stay open for orders to fire: the server watches prices, but only your fomo tab can click Buy or Sell.'],
  ['Is automating fomo allowed?', "fomo's terms don't allow automated access, so using a tool like this could get your fomo account flagged. Use it knowing that risk."],
  ['Can orders fail?', 'Yes — for example on high slippage. Slippage failures are retried; anything limit cannot confirm is marked "Check fomo" instead of guessing.'],
] as const;

/** FAQ accordion. */
export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-24">
      <SectionHead eyebrow="FAQ" title="Questions" />
      <Accordion type="single" collapsible className="rounded-2xl border bg-card px-5">
        {FAQ.map(([q, a]) => (
          <AccordionItem key={q} value={q}>
            <AccordionTrigger className="text-left">{q}</AccordionTrigger>
            <AccordionContent className="text-muted-foreground">{a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

/** Footer with disclaimers. */
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto max-w-6xl space-y-3 px-5 py-10 text-xs text-muted-foreground">
        <Wordmark className="text-base text-foreground" />
        <p>limit is an independent, unofficial tool and is not affiliated with, endorsed by or connected to fomo.family or Fomo Labs. &quot;fomo&quot; is used only to describe the platform this tool works with.</p>
        <p>Nothing here is financial advice. Crypto trading is risky; memecoins especially. Automated orders can fail, fill at unexpected prices, or break if fomo changes its site. Use at your own risk.</p>
        <p className="flex gap-4">
          <a href="/policies" className="underline underline-offset-2 hover:text-foreground">Policies</a>
          <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</a>
          <a href={X_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 underline underline-offset-2 hover:text-foreground"><XIcon className="size-3" />@limitdotfamily</a>
        </p>
      </div>
    </footer>
  );
}
