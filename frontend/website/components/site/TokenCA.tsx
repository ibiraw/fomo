/**
 * @file TokenCA.tsx
 * @description The official $LIMIT contract address with a copy button: a compact strip for the hero and a full box
 *              for the pricing section. Renders nothing (strip) / the "No token yet" warning (box) until launch.
 * @author Reborn1987
 */
'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { LIMIT_TOKEN, solscanUrl, tokenLive } from '@/lib/token';

/** Copy-to-clipboard button for the CA; falls back to selecting the text. */
function CopyCA({ className = '' }: { className?: string }) {
  const [done, setDone] = useState(false);
  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(LIMIT_TOKEN.ca)
      .then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })
      .catch(() => document.getElementById('limit-ca')?.ownerDocument.getSelection()?.selectAllChildren(document.getElementById('limit-ca')!));
  };
  return (
    <button type="button" onClick={copy} aria-label="Copy the contract address" className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/15 px-3 py-1.5 text-sm font-semibold text-brand hover:bg-brand/25 ${className}`}>
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Hero strip: "$LIMIT is live · CA … · Copy". */
export function TokenStrip() {
  if (!tokenLive()) return null;
  return (
    <div className="mx-auto mb-6 flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-buy/40 bg-buy/10 px-3 py-2 text-sm">
      <span className="font-semibold text-buy">${LIMIT_TOKEN.symbol} is live</span>
      <span className="text-muted-foreground">CA</span>
      <code className="min-w-0 break-all font-mono text-xs text-foreground sm:text-sm">{LIMIT_TOKEN.ca}</code>
      <CopyCA />
    </div>
  );
}

/** Pricing box: the official CA (or the "No token yet" warning before launch). */
export function TokenBox() {
  if (!tokenLive()) {
    return (
      <div className="mx-auto mt-4 flex max-w-4xl flex-wrap items-center gap-3 rounded-xl border border-sell/40 bg-sell/10 p-4 text-sm">
        <Badge className="bg-sell/20 text-sell">No token yet</Badge>
        <p className="text-muted-foreground">A limit token hasn&apos;t launched. Anything claiming to be it right now is fake.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto mt-4 max-w-4xl rounded-2xl border border-buy/40 bg-buy/10 p-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-buy/20 text-buy">Live</Badge>
        <span className="font-semibold">${LIMIT_TOKEN.symbol} ({LIMIT_TOKEN.name}) on {LIMIT_TOKEN.chain}</span>
        <span className="text-muted-foreground">· launched on {LIMIT_TOKEN.launchpad}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border bg-background p-3">
        <code id="limit-ca" className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">{LIMIT_TOKEN.ca}</code>
        <CopyCA />
        <a href={solscanUrl()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Solscan <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <p className="mt-3 text-muted-foreground">
        This is the only official ${LIMIT_TOKEN.symbol}. Pay for limit with ${LIMIT_TOKEN.monthUsd} worth of it per 30 days instead of $50 USDC.
      </p>
    </div>
  );
}
