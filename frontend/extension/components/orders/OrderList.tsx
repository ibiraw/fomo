/**
 * @file OrderList.tsx
 * @description Compact, scrollable order list: one line per order (type, trigger, amount, status), live
 *              market cap and a clear Cancel button for active orders, and a one-line note when relevant.
 * @author Reborn1987
 */

import { useMutation } from '@tanstack/react-query';
import type React from 'react';
import { X } from 'lucide-react';

import { ScrollArea } from '@/components/ui/scroll-area';
import {
  amountShort,
  formatUsdCompact,
  isCancellable,
  orderKind,
  orderMarketCap,
  shortMint,
  shortNote,
  STATUS_LABEL,
  triggerLabel,
} from '@/lib/format';
import { tokenUrl } from '@/lib/fomo-tab';
import type { Order, OrderStatus, PriceTick } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<OrderStatus, string> = {
  open: 'bg-accent text-muted-foreground',
  triggered: 'bg-yellow/15 text-yellow',
  executing: 'bg-yellow/15 text-yellow',
  filled: 'bg-buy/15 text-buy',
  failed: 'bg-sell/15 text-sell',
  cancelled: 'bg-accent text-faint',
  unknown: 'bg-sell/15 text-sell',
};

interface Props {
  readonly orders: Order[];
  readonly ticks: Record<string, PriceTick>;
  readonly onCancel: (id: string) => Promise<unknown>;
  /** Scroll height in px. */
  readonly height?: number;
  /** Text shown when there are no orders. */
  readonly emptyText?: string;
  /** Show which token each order is for (popup lists every token). */
  readonly showMint?: boolean;
  /** mint → display label such as "$UNPEG" (falls back to a shortened address). */
  readonly labels?: Record<string, string>;
  /** Where token links open: a new tab (popup) or the current fomo tab (Limit panel). */
  readonly linkTarget?: '_blank' | '_self';
}

/** One compact order row. */
function OrderRow({ order, tick, onCancel, showMint, label, linkTarget }: {
  order: Order; tick: PriceTick | undefined; onCancel: Props['onCancel']; showMint: boolean; label: string | undefined; linkTarget: '_blank' | '_self';
}) {
  const cancel = useMutation({ mutationFn: () => onCancel(order.id) });
  const active = isCancellable(order.status);
  const note = shortNote(order);
  const done = order.status === 'cancelled' || order.status === 'filled';

  return (
    <div className={cn('rounded-lg bg-secondary px-2.5 py-2', done && 'opacity-60')}>
      <div className="flex items-center gap-2 text-xs">
        <span className={cn('shrink-0 font-bold', order.side === 'buy' ? 'text-buy' : 'text-sell')}>{orderKind(order)}</span>
        <span className="min-w-0 flex-1 truncate text-foreground">
          {triggerLabel(order)} · {amountShort(order)}
          {showMint && (
            <a className="ml-1 font-semibold text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground hover:decoration-solid" href={tokenUrl(order.mint)} target={linkTarget} rel="noreferrer" title={`Open ${order.mint} on fomo`}>
              {label ?? shortMint(order.mint)}
            </a>
          )}
        </span>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold', STATUS_STYLE[order.status])}>{STATUS_LABEL[order.status]}</span>
      </div>

      {active && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{tick ? `Now ${formatUsdCompact(orderMarketCap(order, tick))}` : ' '}</span>
          <button
            type="button"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-sell/60 bg-sell/10 px-2.5 text-xs font-semibold text-sell transition-colors hover:bg-sell/20 disabled:opacity-50"
          >
            <X className="size-3.5" />
            {cancel.isPending ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      )}

      {(note || cancel.error) && (
        <p title={cancel.error?.message ?? order.lastError ?? ''} className={cn('mt-1 truncate text-[11px]', order.status === 'cancelled' ? 'text-muted-foreground' : 'text-sell')}>
          {cancel.error?.message ?? note}
        </p>
      )}
    </div>
  );
}

/** All orders, active first. */
export function OrderList({ orders, ticks, onCancel, height = 380, emptyText = 'No orders yet.', showMint = false, labels = {}, linkTarget = '_blank' }: Props) {
  if (orders.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">{emptyText}</p>;
  }
  const sorted = [...orders].sort((a, b) => Number(isCancellable(b.status)) - Number(isCancellable(a.status)) || b.createdAt - a.createdAt);
  return (
    // The height cap goes on the scrolling viewport; capping the ScrollArea root alone lets content spill out.
    <ScrollArea
      className="pr-3 [&_[data-slot=scroll-area-viewport]]:max-h-[var(--order-list-max)]"
      style={{ '--order-list-max': `${height}px` } as React.CSSProperties}
    >
      <div className="space-y-1.5">
        {sorted.map((o) => (
          <OrderRow key={o.id} order={o} tick={ticks[o.mint]} onCancel={onCancel} showMint={showMint} label={labels[o.mint]} linkTarget={linkTarget} />
        ))}
      </div>
    </ScrollArea>
  );
}
