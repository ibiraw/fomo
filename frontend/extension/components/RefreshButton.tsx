/**
 * @file RefreshButton.tsx
 * @description The small refresh button in the top-right corner of the token cards (insights, X post): a bordered
 *              square with a ↻ icon that spins while refreshing.
 * @author Reborn1987
 */

import { RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Icon-only refresh button; `label` is its tooltip and screen-reader name. */
export function RefreshButton({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md border border-input text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-60"
    >
      <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} aria-hidden />
    </button>
  );
}
