/**
 * @file GetStarted.tsx
 * @description "Get limit" (zip download, Chrome Web Store pending, step-by-step setup) and "Pricing"
 *              (3 free orders, then monthly USDC). Numbers mirror the server's paywall defaults
 *              (FREE_ORDERS, UNLOCK_PRICE_USD, ACCESS_PERIOD_DAYS, MAX_ACTIVE_ORDERS_PER_USER) — keep in sync.
 * @author Reborn1987
 */

import { Download, Gift, RefreshCw, Store, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LIMIT_TOKEN, tokenLive } from '@/lib/token';
import { SectionHead } from './Sections';
import { TokenBox } from './TokenCA';

/**
 * Where the packed extension is served (copied into the site root on deploy). Served with no-store, so updates are
 * live at once; the query only skips a copy Cloudflare cached before that header existed.
 */
export const EXTENSION_ZIP = '/limit.zip?v=4';

/** Paywall defaults (backend config). */
const FREE_ORDERS = 3;
const PRICE_USD = 50;
const PERIOD_DAYS = 30;
const MAX_OPEN_ORDERS = 25;

/** Setup steps: title, then the detail line. `code` parts render as monospace. */
const STEPS: readonly { title: string; body: readonly (string | { code: string })[] }[] = [
  { title: 'Download and unzip', body: ['Windows: right-click the file → Extract All. Mac: double-click it. You get a folder called ', { code: 'limit' }, ". Move it somewhere safe, like Documents — the browser runs limit from that folder, so don't delete it."] },
  { title: 'Open your extensions page', body: ['Type ', { code: 'chrome://extensions' }, ' in the address bar (Brave: ', { code: 'brave://extensions' }, ', Edge: ', { code: 'edge://extensions' }, ').'] },
  { title: 'Turn on Developer mode', body: ['The switch is in the top-right corner. It only lets your browser load extensions from a folder.'] },
  { title: 'Click “Load unpacked”', body: ['Pick the ', { code: 'limit' }, ' folder (the one with ', { code: 'manifest.json' }, ' inside). limit appears in the list.'] },
  { title: 'Pin it', body: ['Click the puzzle icon next to the address bar and pin limit, so it is one click away.'] },
  { title: 'Open fomo and log in', body: ['Go to fomo.family. limit makes your account by itself — no email, no sign-up. A Limit tab appears next to Buy and Sell.'] },
  { title: 'Save your backup code', body: ['limit icon → Settings → Account → Backup code. It is the only way back into your account from another browser or computer.'] },
  { title: 'Place your first order', body: ['Pick a market cap on the Limit tab. Keep the browser open with fomo logged in — that is when your orders can fire.'] },
];

/** Download buttons, the setup steps and how updates work. */
export function GetLimit() {
  return (
    <section id="get" className="border-y bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <SectionHead eyebrow="Get limit" title="Set up in two minutes" sub="Works in Chrome, Brave and Edge, on Windows and Mac (not Safari or Firefox). No keys, no sign-up." />
        <div className="mx-auto flex max-w-xl flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg" className="rounded-xl bg-brand font-bold text-on-brand hover:bg-brand/90">
            <a href={EXTENSION_ZIP} download="limit.zip"><Download className="size-4" aria-hidden /> Download limit (.zip)</a>
          </Button>
          <Button disabled size="lg" variant="outline" className="rounded-xl">
            <Store className="size-4" aria-hidden /> Chrome Web Store — coming soon
          </Button>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">The store listing is waiting for Google&apos;s approval. Until then, install it from the zip below.</p>

        <ol className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4 rounded-2xl border bg-background p-5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 text-sm font-bold text-brand tabular-nums">{i + 1}</span>
              <div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {s.body.map((part, j) =>
                    typeof part === 'string' ? part : <code key={j} className="rounded bg-secondary px-1 py-0.5 text-[0.85em] text-foreground">{part.code}</code>,
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mx-auto mt-6 flex max-w-4xl gap-3 rounded-xl border bg-background p-4">
          <RefreshCw className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Updating.</span> Download the zip again, unzip it over the same <code className="rounded bg-secondary px-1 py-0.5 text-[0.85em] text-foreground">limit</code> folder, then click ↻ on limit in your extensions page. Your account and orders stay.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Free orders, the monthly price and how paying works. */
export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHead eyebrow="Pricing" title="Try it free. Then one simple price." />
      <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6">
          <Gift className="size-5 text-buy" aria-hidden />
          <p className="mt-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Free</p>
          <p className="mt-1 text-4xl font-bold">{FREE_ORDERS} orders</p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>· Every new account gets {FREE_ORDERS} free orders.</li>
            <li>· A free order is only used up when it <span className="text-foreground">fills</span>. Cancel it, or if it fails, you get it back.</li>
            <li>· Orders waiting to fill hold a free slot, so up to {FREE_ORDERS} can wait at once.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-brand/40 bg-card p-6">
          <Wallet className="size-5 text-brand" aria-hidden />
          <p className="mt-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Monthly</p>
          <p className="mt-1 text-4xl font-bold">${PRICE_USD} <span className="text-base font-medium text-muted-foreground">USDC / {PERIOD_DAYS} days</span></p>
          {tokenLive() && <p className="mt-1 text-sm font-semibold text-buy">or ${LIMIT_TOKEN.monthUsd} in ${LIMIT_TOKEN.symbol}</p>}
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>· Up to {MAX_OPEN_ORDERS} orders waiting at a time, on every chain.</li>
            <li>· Nothing renews by itself. Paying early adds {PERIOD_DAYS} days to the end — you never lose days.</li>
            <li>· When your month ends, orders already waiting keep running; new ones need a renewal.</li>
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-4 max-w-4xl rounded-2xl border bg-card p-6">
        <h3 className="font-semibold">How to pay</h3>
        <p className="mt-1 text-sm text-muted-foreground">In the extension: limit icon → Settings → Subscription → Subscribe, then pick a chain.</p>
        <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <li className="rounded-xl border bg-background p-4"><span className="font-semibold text-foreground">From your fomo wallet</span><span className="mt-1 block text-muted-foreground">Send the amount shown. It&apos;s matched to you automatically, usually within a minute.</span></li>
          <li className="rounded-xl border bg-background p-4"><span className="font-semibold text-foreground">From another wallet</span><span className="mt-1 block text-muted-foreground">Send the exact amount shown — its last digits identify you.</span></li>
          <li className="rounded-xl border bg-background p-4"><span className="font-semibold text-foreground">From an exchange</span><span className="mt-1 block text-muted-foreground">Paste the withdrawal&apos;s transaction link into “Paid from an exchange?”.</span></li>
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Accepted: official USDC on Solana, Ethereum, Base, BNB Chain and Arc, or USDG on Robinhood Chain{tokenLive() ? `, or $${LIMIT_TOKEN.symbol} on Solana` : ''}. Crypto payments are final and non-refundable.
        </p>
      </div>

      <TokenBox />
    </section>
  );
}
