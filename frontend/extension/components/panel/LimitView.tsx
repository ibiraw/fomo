/**
 * @file LimitView.tsx
 * @description The on-page "Limit" tab content inside FOMO's trade panel: order form for the current
 *              token plus that token's orders.
 * @author Reborn1987
 */

import { useSyncExternalStore } from 'react';

import { NewOrderForm } from '@/components/orders/NewOrderForm';
import { OrderList } from '@/components/orders/OrderList';
import { ThemePicker } from '@/components/ThemePicker';
import { useBackground } from '@/hooks/use-background';
import { useFomoSupply } from '@/hooks/use-fomo-supply';
import { useWatchPrice } from '@/hooks/use-watch-price';
import type { ConnectionStatus } from '@/lib/server-connection';

import { TokenXCard } from './TokenXCard';

/** External store for the current page's mint (updated on FOMO's client-side navigation). */
export interface MintStore {
  subscribe(cb: () => void): () => void;
  get(): string | null;
}

const OFFLINE_TEXT: Partial<Record<ConnectionStatus, string>> = {
  no_token: 'Not paired yet — open the FOMO Limit Orders extension and paste the pairing code.',
  bad_token: 'Pairing code rejected — re-pair in the extension popup.',
  disconnected: 'Order server offline — start it with npm run dev in backend/.',
  connecting: 'Connecting to the order server…',
};

/** Limit-order view for the token shown on the page. */
export function LimitView({ mintStore }: { mintStore: MintStore }) {
  const mint = useSyncExternalStore(mintStore.subscribe, mintStore.get);
  const { state, send } = useBackground();
  const supply = useFomoSupply(mint);
  const priceError = useWatchPrice(mint, state?.status === 'connected', send);

  if (!state) return <p className="p-2 text-sm text-muted-foreground">Loading…</p>;
  if (!mint) return <p className="p-2 text-sm text-muted-foreground">Limit orders are available on Solana token pages.</p>;

  const notice = OFFLINE_TEXT[state.status];
  const orders = state.orders.filter((o) => o.mint === mint);

  return (
    <div className="space-y-4 p-1 pt-2">
      {notice && <p className="rounded-md bg-sell/15 p-2 text-xs text-sell">{notice}</p>}
      {state.status === 'connected' && <TokenXCard key={`x:${mint}`} mint={mint} send={send} />}
      {priceError ? (
        <div className="space-y-1 rounded-lg border bg-card p-3">
          <p className="text-sm font-semibold text-yellow">Limit orders aren't available for this token yet</p>
          <p className="text-xs text-muted-foreground">{priceError}</p>
        </div>
      ) : (
        <NewOrderForm key={`form:${mint}`} ticks={state.ticks} initialMint={mint} lockMint mcSupply={supply} onCreate={(order) => send({ type: 'order.create', order })} />
      )}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Orders on this token</p>
        <OrderList orders={orders} ticks={state.ticks} height={260} emptyText="No orders on this token yet." onCancel={(id) => send({ type: 'order.cancel', id })} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className="text-xs text-muted-foreground">Theme</span>
        <ThemePicker compact />
      </div>
    </div>
  );
}
