/**
 * @file UnlockSection.tsx
 * @description The unlock (paywall): free orders left, progress toward the price, and how to pay — pick a chain, send
 *              USDC (USDG on Robinhood) or, once launched, the platform token at a discount. Also a compact banner for
 *              the order forms. Renders nothing when the server has no paywall.
 * @author Reborn1987
 */

import { useMutation } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { SendFn } from '@/hooks/use-background';
import { chainName, mustUnlock, remainingUsd, type BillingQuote, type BillingStatus, type PaymentMethod } from '@/lib/billing';
import { cn } from '@/lib/utils';

/** Text with a copy button (falls back to selectable text when the clipboard is refused). */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-md bg-secondary px-2 py-1.5 text-[11px] select-all" title={value}>{value}</code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-border bg-secondary transition-colors hover:border-foreground/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          {copied ? <Check className="size-3.5 text-buy" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

/** Progress toward the price. */
function Progress({ status }: { status: BillingStatus }) {
  const pct = Math.min(100, (status.creditUsd / status.priceUsd) * 100);
  return (
    <div className="space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-buy transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-muted-foreground">Received ${status.creditUsd.toFixed(2)} of ${status.priceUsd} — ${remainingUsd(status).toFixed(2)} to go.</p>
    </div>
  );
}

/** Payment instructions for one method. */
function MethodDetails({ method, status }: { method: PaymentMethod; status: BillingStatus }) {
  const token = method.kind === 'token';
  const remaining = token ? status.tokenPriceUsd * (remainingUsd(status) / status.priceUsd) : remainingUsd(status);
  return (
    <div className="space-y-2">
      <CopyField label={`Send ${method.symbol} on ${chainName(method.chain)} to`} value={method.payTo} />
      <p className="text-xs">
        <b>From your fomo wallet:</b> send {token ? `$${remaining.toFixed(2)} worth of ${method.symbol}` : `${remaining.toFixed(2)} ${method.symbol}`} or more — it's matched to you automatically.
      </p>
      <p className="rounded-md border border-yellow/50 bg-yellow/10 px-2 py-1.5 text-[11px] text-yellow">
        fomo takes a withdrawal fee, so a bit less arrives than you send. Add about $0.50 — anything short just adds up, and you can top up.
      </p>
      <CopyField label="From any other wallet, send exactly" value={`${method.amount}`} />
      <p className="text-[11px] text-muted-foreground">
        The last digits identify you. Only {token ? `the official ${method.symbol} token` : method.symbol === 'USDG' ? 'official USDG' : 'official USDC'} counts. Payments show up within about a minute.
      </p>
    </div>
  );
}

/** Settings → Unlock. */
export function UnlockSection({ status, send }: { status: BillingStatus | null; send: SendFn }) {
  const [chain, setChain] = useState<string | null>(null);
  const quote = useMutation({ mutationFn: async () => (await send({ type: 'billing.quote' })) as BillingQuote });
  if (!status) return null;

  if (status.unlocked) {
    return (
      <section className="space-y-1">
        <h2 className="text-sm font-semibold">Unlock</h2>
        <p className="flex items-center gap-1.5 text-xs text-buy"><Check className="size-3.5" aria-hidden /> Unlocked for good — thanks for supporting auto fomo.</p>
      </section>
    );
  }

  const q = quote.data;
  const methods = q?.methods ?? [];
  const selected = methods.find((m) => `${m.chain}:${m.symbol}` === chain) ?? methods[0] ?? null;
  const hasToken = methods.some((m) => m.kind === 'token');

  return (
    <section className="space-y-2.5">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Unlock auto fomo</h2>
        <p className="text-xs text-muted-foreground">
          {status.freeOrdersLeft > 0 ? `${status.freeOrdersLeft} free ${status.freeOrdersLeft === 1 ? 'order' : 'orders'} left. ` : 'Your free orders are used. '}
          One payment of ${status.priceUsd} in USDC unlocks it forever{hasToken ? ` — or $${status.tokenPriceUsd} in the token` : ''}.
        </p>
      </div>
      {status.creditUsd > 0 && <Progress status={status} />}
      {!q ? (
        <Button size="sm" className="w-full" onClick={() => quote.mutate()} disabled={quote.isPending}>
          {quote.isPending ? 'Loading…' : 'Show how to pay'}
        </Button>
      ) : (
        <div className="space-y-2.5">
          <div role="radiogroup" aria-label="Pay with" className="flex flex-wrap gap-1">
            {methods.map((m) => {
              const key = `${m.chain}:${m.symbol}`;
              const on = selected === m;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setChain(key)}
                  className={cn(
                    'cursor-pointer rounded-md border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                    on ? 'border-yellow bg-yellow/10 text-foreground' : 'border-border bg-secondary text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                    m.kind === 'token' && !on && 'border-yellow/40',
                  )}
                >
                  {m.kind === 'token' ? `${m.symbol} · $${q.tokenPriceUsd}` : `${chainName(m.chain)} ${m.symbol}`}
                </button>
              );
            })}
          </div>
          {selected && <MethodDetails method={selected} status={q} />}
          <p className="text-[11px] text-muted-foreground">Your code {q.code} is kept until {new Date(q.expiresAt).toLocaleString()}.</p>
        </div>
      )}
      {quote.error && <p className="text-xs text-sell">{quote.error.message}</p>}
    </section>
  );
}

/** One-line notice for the order forms: free orders left, or that an unlock is needed. */
export function UnlockBanner({ status, where }: { status: BillingStatus | null; where: 'popup' | 'panel' }) {
  if (!status || status.unlocked) return null;
  const locked = mustUnlock(status);
  const hint = where === 'popup' ? 'Settings → Unlock' : 'open auto fomo extension → Settings';
  return (
    <p
      role="status"
      className={cn(
        'rounded-md px-2.5 py-2 text-xs font-semibold',
        locked ? 'bg-yellow text-black' : 'border border-yellow/60 bg-yellow/15 text-yellow',
      )}
    >
      {locked
        ? `Free orders used — unlock for $${status.priceUsd} USDC in ${hint}.`
        : `${status.freeOrdersLeft} free ${status.freeOrdersLeft === 1 ? 'order' : 'orders'} left${status.freeOrdersWaiting > 0 ? ` (${status.freeOrdersWaiting} waiting to fill)` : ''}, then $${status.priceUsd} USDC once (${hint}).`}
    </p>
  );
}
