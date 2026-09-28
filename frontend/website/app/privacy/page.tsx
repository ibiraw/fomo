/**
 * @file page.tsx
 * @description Privacy policy for the limit extension and server (linked from the Chrome Web Store listing).
 * @author Reborn1987
 */

import type { Metadata } from 'next';

import { PolicyBlock } from '@/components/site/PolicyBlock';
import { SiteFooter, SiteHeader } from '@/components/site/Sections';
import { isReleased } from '@/lib/releases';

export const metadata: Metadata = {
  title: 'Privacy — limit',
  description: 'What the limit extension and its order server collect, why, and how to delete it.',
};

const UPDATED = 'September 28, 2026';

/** Privacy policy page. */
export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl space-y-10 px-5 py-16 text-[15px] leading-relaxed text-muted-foreground">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Privacy policy</p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground text-balance">What limit knows about you</h1>
          <p>Last updated {UPDATED}. This covers the limit Chrome extension and the limit order server it connects to.</p>
        </header>

        <PolicyBlock title="The short version">
          <ul className="list-disc space-y-2 pl-5">
            <li>We never ask for, see or store your private keys, seed phrase, password or fomo login.</li>
            <li>We store only what is needed to run your orders: an anonymous account ID, your public wallet addresses, your fomo username and fomo user ID, and your orders.</li>
            <li>We don&apos;t sell data, show ads, or share it with anyone except as described below.</li>
            <li>You can delete your account from the extension&apos;s Settings.</li>
          </ul>
        </PolicyBlock>

        <PolicyBlock title="What we store on the order server">
          <ul className="list-disc space-y-2 pl-5">
            <li><b className="text-foreground">Anonymous account ID.</b> The extension creates a random secret when you install it. The server keeps only a hash of it. There is no name, email or phone number.</li>
            <li><b className="text-foreground">Public wallet addresses.</b> Your fomo Solana and EVM addresses, read from your logged-in fomo tab. These are public on the blockchain anyway; we use them to confirm your trades on-chain and to stop sell orders once you no longer hold a token.</li>
            <li><b className="text-foreground">Your fomo username and fomo user ID.</b> The username is read from your own profile link on fomo.family (the one next to your avatar); the user ID is fomo&apos;s own identifier for your login, read from the page&apos;s storage. Usernames can change or repeat, the ID doesn&apos;t — together they let support match your account ID to your fomo profile.</li>
            <li><b className="text-foreground">Your orders.</b> Token, trigger (price or market cap), amount, status and timestamps, so the server can watch prices and tell the extension when to trade.</li>
            <li><b className="text-foreground">Trades you make on fomo.</b> While limit is installed, fomo&apos;s own trade notice (for example &ldquo;Buying $3.00 KEK&rdquo;) and the token&apos;s address are logged for our service monitoring, so we can tell your manual trades apart from limit&apos;s. When you sell, the value and profit/loss fomo shows for that position are included (roughly how much you sold it for, and whether you were up or down).</li>
            <li><b className="text-foreground">Subscription payments.</b> For the monthly subscription we record payments received by our wallets: chain, coin, amount, the sending wallet address and the transaction id — all public on the blockchain — which account they paid for, and until when.</li>
            <li><b className="text-foreground">Activity log.</b> A record of account, order and payment events (with your short user ID, e.g. LM-7K3Q2P) that we use to monitor the service and answer support requests; the operator receives these events as private notifications.</li>
            <li><b className="text-foreground">Technical logs.</b> Short-lived server logs (errors, order status changes). Our network provider (Cloudflare) processes IP addresses to deliver and protect the service.</li>
          </ul>
        </PolicyBlock>

        <PolicyBlock title="What stays in your browser">
          <ul className="list-disc space-y-2 pl-5">
            <li><b className="text-foreground">The fomo page.</b> The extension reads the token page you are on (market cap, balance, the trade panel) and clicks fomo&apos;s own Buy and Sell buttons when an order triggers. Page content is not sent to our server beyond the order details above.</li>
            {isReleased('1.7') && <li><b className="text-foreground">X (Twitter).</b> If you open a token&apos;s latest post, the extension reads it with your own x.com session in a background tab and shows it to you. Nothing from X is sent to our server.</li>}
            <li><b className="text-foreground">Settings.</b> {isReleased('1.2') ? 'Theme, sounds, default tab' : 'Your default tab'} and your account secret are kept in Chrome&apos;s extension storage on your computer.</li>
          </ul>
        </PolicyBlock>

        <PolicyBlock title="Who else is involved">
          <p>Prices are read from public blockchains through our RPC provider and, for some tokens, from DexScreener and Jupiter. Those requests contain token addresses only — never anything about you.</p>
        </PolicyBlock>

        <PolicyBlock title="How long we keep it, and deleting it">
          <p>Your account, wallet addresses and orders are kept while you use the service. Settings → <b className="text-foreground">Delete my account</b> removes your account, key, wallet addresses, fomo username and fomo user ID immediately and cancels your open orders; the history of orders you placed, the activity log and records of payments received are kept for bookkeeping, no longer linked to a usable account; uninstalling alone does not, because the server can&apos;t tell an uninstall from a reinstall. Server logs are deleted within 30 days.</p>
        </PolicyBlock>

        <PolicyBlock title="Chrome Web Store user data policy">
          <p>limit&apos;s use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the extension&apos;s single purpose — automated limit, take-profit and stop-loss orders on fomo.family — and is never used for advertising, credit decisions, or sold.</p>
        </PolicyBlock>

        <PolicyBlock title="Contact">
          <p>Questions or deletion requests: use the contact email on the limit Chrome Web Store listing. Terms of use, payments and refunds are covered in our <a href="/policies" className="text-foreground underline underline-offset-2">policies</a>.</p>
        </PolicyBlock>
      </main>
      <SiteFooter />
    </>
  );
}
