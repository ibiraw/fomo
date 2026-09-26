/**
 * @file Sections.tsx
 * @description Static sections of the auto fomo site: header, hero, features, architecture, holder
 *              access (coming soon), FAQ and footer. No personal information anywhere.
 * @author Reborn1987
 */

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
  Wallet,
} from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** Lowercase wordmark. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      auto <span className="text-brand">fomo</span>
    </span>
  );
}

/** Sticky top bar. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <a href="#top" aria-label="auto fomo home"><Wordmark className="text-lg" /></a>
        <nav className="hidden gap-6 text-sm text-muted-foreground md:flex">
          <a href="#demo" className="hover:text-foreground">Demo</a>
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#themes" className="hover:text-foreground">Themes</a>
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#holders" className="hover:text-foreground">Holders</a>
          <a href="#faq" className="hover:text-foreground">FAQ</a>
        </nav>
        <Badge variant="outline" className="border-brand/40 text-brand">Unofficial</Badge>
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
        <Badge variant="outline" className="mb-6 border-border text-muted-foreground">Unofficial · not affiliated with fomo.family</Badge>
        <h1 className="text-balance text-4xl font-bold tracking-tight md:text-6xl">
          Limit orders for <span className="text-brand">fomo</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
          Set a market-cap target. <Wordmark /> clicks Buy or Sell in your own fomo tab the moment it hits —
          dip buys, take profits and stop losses, without watching the chart.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="rounded-xl bg-brand font-bold text-primary-foreground hover:bg-brand/90">
            <a href="#demo">See it work</a>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-xl">
            <a href="#holders">Holder access — soon</a>
          </Button>
        </div>
        <dl className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-4 text-center">
          {[
            ['~2.6s', 'trigger to filled'],
            ['0', 'private keys needed'],
            ['on-chain', 'live prices'],
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

const FEATURES = [
  { icon: MousePointerClick, title: 'A native Limit tab', body: "Sits next to fomo's Buy and Sell. Presets, a −100% to +100% market-cap slider, and the order type worked out for you." },
  { icon: Radio, title: 'Live on-chain prices', body: 'Reads pump.fun, PumpSwap, Raydium CPMM and bonk.fun curves straight from Solana — sub-second. Anything else falls back to Jupiter.' },
  { icon: CircleCheck, title: 'Confirmed on-chain', body: 'A fill only counts when your wallet balance actually changes — no guessing from the page.' },
  { icon: Timer, title: "The token's last post", body: "See how long ago the token's X account last posted — green when fresh, red when it's gone quiet — with a preview." },
  { icon: BellOff, title: 'Auto-cancel', body: 'Sold out of a token? Its leftover take-profits and stop-losses cancel themselves.' },
  { icon: Activity, title: 'Built for speed', body: 'One trade at a time, re-checked before firing, retried on slippage. Trigger to filled in about 2.6 seconds.' },
] as const;

/** Feature grid. */
export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHead eyebrow="Features" title="Everything fomo's panel is missing" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
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
  { icon: Layers, name: 'Chrome extension', where: 'in your browser', points: ['Adds the Limit tab to fomo', "Clicks fomo's own Buy / Sell", 'Reads the token’s latest X post'] },
  { icon: Activity, name: 'Order engine', where: 'on your own PC', points: ['Stores your orders', 'Watches prices, triggers orders', 'Confirms fills from your wallet'] },
  { icon: Radio, name: 'Solana', where: 'public blockchain', points: ['Live pool reserves', 'Your token balances', 'No keys, read-only'] },
] as const;

/** Architecture overview. */
export function HowItWorks() {
  return (
    <section id="how" className="border-y bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <SectionHead eyebrow="How it works" title="Three parts, all on your side" sub="Nothing runs on someone else's server. Your orders, your browser, your machine." />
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
            <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">Locked to your machine.</span> Only the paired extension can talk to your order engine.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Holder access — coming soon. */
export function Holders() {
  return (
    <section id="holders" className="mx-auto max-w-6xl px-5 py-24">
      <div className="relative overflow-hidden rounded-3xl border border-brand/30 bg-card p-8 md:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative max-w-2xl">
          <Badge className="bg-brand/15 text-brand">Coming soon</Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Early access for token holders</h2>
          <p className="mt-3 text-muted-foreground">
            <Wordmark /> opens to token holders first. Connect your wallet and holding the token unlocks the download.
          </p>
          <div className="mt-6 rounded-xl border border-sell/40 bg-sell/10 p-4 text-sm">
            <p className="font-semibold text-sell">No token has launched yet.</p>
            <p className="mt-1 text-muted-foreground">There is no contract address. Anything claiming to be the auto fomo token right now is fake.</p>
          </div>
          <Button disabled size="lg" className="mt-6 rounded-xl">
            <Wallet className="size-4" aria-hidden /> Connect wallet — available at launch
          </Button>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  ['Is this made by fomo?', 'No. auto fomo is an independent, unofficial tool. It is not affiliated with, endorsed by or connected to fomo.family or Fomo Labs.'],
  ['Do you need my private keys or seed phrase?', 'Never. auto fomo clicks the Buy and Sell buttons in your own logged-in fomo tab, exactly like you would. It only reads public blockchain data.'],
  ['Which tokens work?', 'Solana tokens on pump.fun (curve and PumpSwap), bonk.fun / Raydium LaunchLab curves and Raydium CPMM pools are priced live on-chain. Other tokens use Jupiter prices, a few seconds behind — the app tells you when that happens.'],
  ['What do I need to run it?', 'Chrome with the extension, the order engine running on your computer, and a Solana RPC endpoint. Chrome must stay open with a logged-in fomo tab for orders to fire.'],
  ['Is automating fomo allowed?', "fomo's terms don't allow automated access, so using a tool like this could get your fomo account flagged. Use it knowing that risk."],
  ['Can orders fail?', 'Yes — for example on high slippage. Slippage failures are retried; anything auto fomo cannot confirm is marked "Check fomo" instead of guessing.'],
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
        <p>auto fomo is an independent, unofficial tool and is not affiliated with, endorsed by or connected to fomo.family or Fomo Labs. &quot;fomo&quot; is used only to describe the platform this tool works with.</p>
        <p>Nothing here is financial advice. Crypto trading is risky; memecoins especially. Automated orders can fail, fill at unexpected prices, or break if fomo changes its site. Use at your own risk.</p>
        <p><a href="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</a></p>
      </div>
    </footer>
  );
}
