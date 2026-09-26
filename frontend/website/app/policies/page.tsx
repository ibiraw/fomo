/**
 * @file page.tsx
 * @description Policies for limit: terms of use, subscription and payments, refunds, risk, acceptable use,
 *              availability and liability. Linked from the footer and the Chrome Web Store listing.
 * @author Reborn1987
 */

import type { Metadata } from 'next';

import { PolicyBlock } from '@/components/site/PolicyBlock';
import { SiteFooter, SiteHeader } from '@/components/site/Sections';

export const metadata: Metadata = {
  title: 'Policies — limit',
  description: 'Terms of use, subscription and payments, refunds and risks for the limit extension.',
};

const UPDATED = 'September 26, 2026';

/** Jump links at the top of the page. */
const SECTIONS = [
  ['terms', 'Terms of use'],
  ['subscription', 'Subscription & payments'],
  ['refunds', 'Refunds'],
  ['risk', 'Trading risk'],
  ['use', 'Acceptable use'],
  ['availability', 'Availability'],
  ['liability', 'Liability'],
  ['changes', 'Changes & contact'],
] as const;

/** Policies page. */
export default function Policies() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl space-y-10 px-5 py-16 text-[15px] leading-relaxed text-muted-foreground">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Policies</p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground text-balance">The rules of using limit</h1>
          <p>Last updated {UPDATED}. By installing or using the limit extension you agree to these policies. How we handle your data is covered in the <a href="/privacy" className="text-foreground underline underline-offset-2">privacy policy</a>.</p>
          <nav aria-label="On this page" className="flex flex-wrap gap-2 pt-1">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-md border px-2.5 py-1 text-xs text-foreground transition-colors hover:border-foreground/40 hover:bg-accent">
                {label}
              </a>
            ))}
          </nav>
        </header>

        <PolicyBlock id="terms" title="Terms of use">
          <p>limit is an independent, unofficial tool. It is not made by, affiliated with or endorsed by fomo.family or Fomo Labs. It places orders by clicking fomo&apos;s own Buy and Sell buttons in your logged-in browser, so you remain bound by fomo&apos;s own terms when you use it.</p>
          <p>You are responsible for your fomo account, your wallets and every order you set up. limit never holds your funds, private keys or passwords.</p>
          <p>You must be old enough, and allowed where you live, to trade crypto assets.</p>
        </PolicyBlock>

        <PolicyBlock id="subscription" title="Subscription & payments">
          <ul className="list-disc space-y-2 pl-5">
            <li><b className="text-foreground">Free orders.</b> New accounts get a few free orders. A free order is used when it fills; orders waiting to fill hold a free slot.</li>
            <li><b className="text-foreground">Monthly access.</b> After that, access is paid per 30 days at the price shown in the extension (Settings → Subscription), in USDC on Solana, Ethereum, Base, BNB Chain or Arc, or USDG on Robinhood Chain. Once launched, the limit token may also be accepted at the price shown.</li>
            <li><b className="text-foreground">Renewals.</b> Each payment adds 30 days after the end of your current period, so paying early never loses days. Nothing renews automatically; when a period ends you can no longer place new orders until you pay again. Orders already waiting keep running.</li>
            <li><b className="text-foreground">Partial payments</b> add up toward the next period. Amounts beyond whole periods are treated as a tip and are not carried over.</li>
            <li><b className="text-foreground">Exchange payments.</b> Payments sent from an exchange must be claimed in the extension with the transaction link. A payment can be claimed by one account only.</li>
            <li><b className="text-foreground">Fees.</b> You pay any network or withdrawal fees. The amount that arrives in our wallet is what counts.</li>
            <li><b className="text-foreground">Wrong coin or chain.</b> Only the coins and chains listed in the extension are credited. Tokens sent anywhere else, or look-alike tokens, may not be recoverable.</li>
          </ul>
        </PolicyBlock>

        <PolicyBlock id="refunds" title="Refunds">
          <p><b className="text-foreground">All payments are final and non-refundable.</b> Crypto transfers can&apos;t be reversed, and we don&apos;t refund unused time, overpayments or payments sent to the wrong address or chain.</p>
          <p>If a payment didn&apos;t show up on your account, contact us with your user ID (Settings → Account, e.g. LM-7K3Q2P) and the transaction link — we&apos;ll check it by hand.</p>
        </PolicyBlock>

        <PolicyBlock id="risk" title="Trading risk">
          <ul className="list-disc space-y-2 pl-5">
            <li>Nothing on this site or in the extension is financial advice. Crypto — and memecoins in particular — is highly risky; you can lose everything you trade.</li>
            <li>Automated orders can fail, fill late, fill at a different price than your target (slippage), or not fill at all — for example when prices move fast, liquidity is thin, your balance is too low, fomo changes its site, or your computer, browser or internet connection is off.</li>
            <li>Orders only run while Chrome is open with a logged-in fomo.family tab and your computer is awake.</li>
            <li>Prices come from public blockchains and third-party services and may be delayed or wrong.</li>
          </ul>
        </PolicyBlock>

        <PolicyBlock id="use" title="Acceptable use">
          <p>Don&apos;t use limit to break the law or fomo&apos;s terms, manipulate markets, overload our servers, get around the free-order limit or payments, reverse-engineer the service to attack it, or claim payments that aren&apos;t yours. We may suspend accounts that do.</p>
        </PolicyBlock>

        <PolicyBlock id="availability" title="Availability">
          <p>We aim to keep limit running around the clock, but it is provided &ldquo;as is&rdquo;, without guarantees. It can be interrupted by maintenance, outages at our providers (blockchain RPCs, Cloudflare, fomo itself) or changes to fomo&apos;s website. Paid time is not extended for outages.</p>
          <p>We may change, pause or discontinue features, or the service as a whole.</p>
        </PolicyBlock>

        <PolicyBlock id="liability" title="Liability">
          <p>To the fullest extent the law allows, we are not liable for trading losses, missed or unexpected fills, lost profits, or any indirect damages arising from using or being unable to use limit. Our total liability for anything related to the service is limited to what you paid us in the 30 days before the claim.</p>
        </PolicyBlock>

        <PolicyBlock id="changes" title="Changes & contact">
          <p>We may update these policies; the date at the top shows the latest version. Continuing to use limit after a change means you accept it.</p>
          <p>Questions: use the contact email on the limit Chrome Web Store listing, and include your user ID.</p>
        </PolicyBlock>
      </main>
      <SiteFooter />
    </>
  );
}
