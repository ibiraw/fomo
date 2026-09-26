/**
 * @file page.tsx
 * @description Privacy policy for the auto fomo extension and server (linked from the Chrome Web Store listing).
 * @author Reborn1987
 */

import type { Metadata } from 'next';

import { SiteFooter, SiteHeader } from '@/components/site/Sections';

export const metadata: Metadata = {
  title: 'Privacy — auto fomo',
  description: 'What the auto fomo extension and its order server collect, why, and how to delete it.',
};

const UPDATED = 'September 26, 2026';

/** One titled block of the policy. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Privacy policy page. */
export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl space-y-10 px-5 py-16 text-[15px] leading-relaxed text-muted-foreground">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Privacy policy</p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground text-balance">What auto fomo knows about you</h1>
          <p>Last updated {UPDATED}. This covers the auto fomo Chrome extension and the auto fomo order server it connects to.</p>
        </header>

        <Block title="The short version">
          <ul className="list-disc space-y-2 pl-5">
            <li>We never ask for, see or store your private keys, seed phrase, password or fomo login.</li>
            <li>We store only what is needed to run your orders: an anonymous account ID, your public wallet addresses, and your orders.</li>
            <li>We don&apos;t sell data, show ads, or share it with anyone except as described below.</li>
            <li>You can delete your account and everything tied to it from the extension&apos;s Settings.</li>
          </ul>
        </Block>

        <Block title="What we store on the order server">
          <ul className="list-disc space-y-2 pl-5">
            <li><b className="text-foreground">Anonymous account ID.</b> The extension creates a random secret when you install it. The server keeps only a hash of it. There is no name, email or phone number.</li>
            <li><b className="text-foreground">Public wallet addresses.</b> Your fomo Solana and EVM addresses, read from your logged-in fomo tab. These are public on the blockchain anyway; we use them to confirm your trades on-chain and to stop sell orders once you no longer hold a token.</li>
            <li><b className="text-foreground">Your orders.</b> Token, trigger (price or market cap), amount, status and timestamps, so the server can watch prices and tell the extension when to trade.</li>
            <li><b className="text-foreground">Unlock payments.</b> For the one-time unlock we record payments received by our wallets: chain, coin, amount, the sending wallet address and the transaction id — all public on the blockchain — and which account they unlocked.</li>
            <li><b className="text-foreground">Technical logs.</b> Short-lived server logs (errors, order status changes). Our network provider (Cloudflare) processes IP addresses to deliver and protect the service.</li>
          </ul>
        </Block>

        <Block title="What stays in your browser">
          <ul className="list-disc space-y-2 pl-5">
            <li><b className="text-foreground">The fomo page.</b> The extension reads the token page you are on (market cap, balance, the trade panel) and clicks fomo&apos;s own Buy and Sell buttons when an order triggers. Page content is not sent to our server beyond the order details above.</li>
            <li><b className="text-foreground">X (Twitter).</b> If you open a token&apos;s latest post, the extension reads it with your own x.com session in a background tab and shows it to you. Nothing from X is sent to our server.</li>
            <li><b className="text-foreground">Settings.</b> Theme, sounds, default tab and your account secret are kept in Chrome&apos;s extension storage on your computer.</li>
          </ul>
        </Block>

        <Block title="Who else is involved">
          <p>Prices are read from public blockchains through our RPC provider and, for some tokens, from DexScreener and Jupiter. Those requests contain token addresses only — never anything about you.</p>
        </Block>

        <Block title="How long we keep it, and deleting it">
          <p>Your account, wallet addresses and orders are kept while you use the service. Settings → <b className="text-foreground">Delete my account</b> removes them from the server immediately (records of payments received stay in our books, no longer linked to an account); uninstalling alone does not, because the server can&apos;t tell an uninstall from a reinstall. Server logs are deleted within 30 days.</p>
        </Block>

        <Block title="Chrome Web Store user data policy">
          <p>auto fomo&apos;s use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the extension&apos;s single purpose — automated limit, take-profit and stop-loss orders on fomo.family — and is never used for advertising, credit decisions, or sold.</p>
        </Block>

        <Block title="Contact">
          <p>Questions or deletion requests: use the contact email on the auto fomo Chrome Web Store listing.</p>
        </Block>
      </main>
      <SiteFooter />
    </>
  );
}
