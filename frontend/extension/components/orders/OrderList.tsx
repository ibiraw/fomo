/**
 * @file OrderList.tsx
 * @description Scrollable list of orders with live market data, status and cancel.
 * @author Reborn1987
 */

import { useMutation } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  amountLabel,
  formatUsdCompact,
  isCancellable,
  orderKind,
  shortMint,
  STATUS_LABEL,
  triggerLabel,
} from '@/lib/format';
import { tokenUrl } from '@/lib/fomo-tab';
import type { Order, OrderStatus, PriceTick } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<OrderStatus, string> = {
  open: 'bg-secondary text-secondary-foreground',
  triggered: 'bg-amber-500/20 text-amber-300',
  executing: 'bg-amber-500/20 text-amber-300',
  filled: 'bg-buy/20 text-buy',
  failed: 'bg-sell/20 text-sell',
  cancelled: 'bg-secondary text-muted-foreground',
  unknown: 'bg-sell/20 text-sell',
};

interface Props {
  readonly orders: Order[];
  readonly ticks: Record<string, PriceTick>;
  readonly onCancel: (id: string) => Promise<unknown>;
  /** Scroll height in px. */
  readonly height?: number;
  /** Text shown when there are no orders. */
  readonly emptyText?: string;
}

/** One order row. */
function OrderCard({ order, tick, onCancel }: { order: Order; tick: PriceTick | undefined; onCancel: Props['onCancel'] }) {
  const cancel = useMutation({ mutationFn: () => onCancel(order.id) });
  return (
    <div className="rounded-lg border bg-card p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-sm font-semibold', order.side === 'buy' ? 'text-buy' : 'text-sell')}>{orderKind(order)}</span>
        <Badge className={STATUS_STYLE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
      </div>
      <a className="block text-xs text-muted-foreground hover:underline" href={tokenUrl(order.mint)} target="_blank" rel="noreferrer">
        {shortMint(order.mint)}
      </a>
      <p className="text-sm">
        {triggerLabel(order)} · {amountLabel(order)}
      </p>
      {tick && isCancellable(order.status) && (
        <p className="text-xs text-muted-foreground">Now MC {formatUsdCompact(tick.marketCapUsd)}</p>
      )}
      {order.lastError && <p className="text-xs text-sell">{order.lastError}</p>}
      {cancel.error && <p className="text-xs text-destructive">{cancel.error.message}</p>}
      {isCancellable(order.status) && (
        <Button size="sm" variant="secondary" className="w-full" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
          {cancel.isPending ? 'Cancelling…' : 'Cancel'}
        </Button>
      )}
    </div>
  );
}

/** All orders, active first. */
export function OrderList({ orders, ticks, onCancel, height = 380, emptyText = 'No orders yet.' }: Props) {
  if (orders.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  const sorted = [...orders].sort((a, b) => Number(isCancellable(b.status)) - Number(isCancellable(a.status)) || b.createdAt - a.createdAt);
  return (
    <ScrollArea className="pr-3" style={{ height }}>
      <div className="space-y-2">
        {sorted.map((o) => <OrderCard key={o.id} order={o} tick={ticks[o.mint]} onCancel={onCancel} />)}
      </div>
    </ScrollArea>
  );
}
