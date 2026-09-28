/**
 * @file LimitView.tsx
 * @description The on-page "Limit" tab content inside FOMO's trade panel: order form for the current
 *              token plus that token's orders.
 * @author Reborn1987
 */

import { useState, useSyncExternalStore } from 'react';

import { NewOrderForm } from '@/components/orders/NewOrderForm';
import { OrderList } from '@/components/orders/OrderList';
import { useBackground } from '@/hooks/use-background';
import { useFomoLaunchpad } from '@/hooks/use-fomo-launchpad';
import { useFomoPosition } from '@/hooks/use-fomo-position';
import { useFomoSupply } from '@/hooks/use-fomo-supply';
import { useHolds } from '@/hooks/use-holds';
import { useTokenSymbols } from '@/hooks/use-token-symbols';
import { isCancellable } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useWatchPrice } from '@/hooks/use-watch-price';
import type { ConnectionStatus } from '@/lib/server-connection';

import { UnlockBanner } from '@/components/UnlockSection';

import { TokenInsights } from './TokenInsights';
import { TokenXCard } from './TokenXCard';
import { useRelease } from '@/hooks/use-release';
import { hasFeature } from '@/lib/release';

/** External store for the current page's mint (updated on FOMO's client-side navigation). */
export interface MintStore {
  subscribe(cb: () => void): () => void;
  get(): string | null;
}

const OFFLINE_TEXT: Partial<Record<ConnectionStatus, string>> = {
  no_token: 'No account yet — open the limit extension to start one.',
  bad_token: 'Your account key was rejected — open the limit extension.',
  deleted: 'Your account was deleted — open the limit extension to start a new one.',
  disconnected: "Can't reach the limit server — it reconnects on its own.",
  connecting: 'Connecting to the limit server…',
};

/** Limit-order view for the token shown on the page. */
export function LimitView({ mintStore }: { mintStore: MintStore }) {
  const mint = useSyncExternalStore(mintStore.subscribe, mintStore.get);
  const { state, send } = useBackground();
  const supply = useFomoSupply(mint);
  const heldTokens = useFomoPosition(mint);
  const pageLaunchpad = useFomoLaunchpad(mint);
  const holds = useHolds(mint, state?.status === 'connected', send, state?.orders ?? []);
  const [scope, setScope] = useState<'token' | 'all'>('token');
  const release = useRelease();
  const allOrders = state?.orders ?? [];
  const labels = useTokenSymbols(allOrders.map((o) => o.mint), send, state?.status === 'connected');
  const priceError = useWatchPrice(mint, state?.status === 'connected', send);

  if (!state) return <p className="p-2 text-sm text-muted-foreground">Loading…</p>;
  if (!mint) return <p className="p-2 text-sm text-muted-foreground">Limit orders are available on token pages.</p>;

  const notice = OFFLINE_TEXT[state.status];
  const orders = state.orders.filter((o) => o.mint === mint);
  const activeHere = orders.filter((o) => isCancellable(o.status)).length;
  const activeAll = state.orders.filter((o) => isCancellable(o.status)).length;

  return (
    <div className="space-y-4 p-1 pt-2">
      {notice && <p className="rounded-md bg-sell/15 p-2 text-xs text-sell">{notice}</p>}
      {state.status === 'connected' && <TokenInsights key={`i:${mint}`} mint={mint} send={send} release={release} pageLaunchpad={pageLaunchpad} />}
      {state.status === 'connected' && hasFeature(release, 'xPost') && <TokenXCard key={`x:${mint}`} mint={mint} send={send} />}
      <UnlockBanner status={state.billing} where="panel" />
      {priceError ? (
        <div className="space-y-1.5 rounded-lg border bg-card p-3">
          <p className="text-sm font-semibold text-yellow">Limit orders aren't available for this token yet</p>
          <p className="text-xs text-muted-foreground">It trades on a pool limit can't read prices from yet, so orders couldn't trigger.</p>
          <details className="text-[11px] text-faint">
            <summary className="select-none text-muted-foreground underline underline-offset-2 hover:text-foreground">Technical details</summary>
            <p className="mt-1 break-all">{priceError}</p>
          </details>
        </div>
      ) : (
        <NewOrderForm key={`form:${mint}`} ticks={state.ticks} initialMint={mint} lockMint mcSupply={supply} holds={holds} heldTokens={heldTokens} onCreate={(order) => send({ type: 'order.create', order })} />
      )}
      <div className="space-y-2">
        <div className="flex rounded-md bg-secondary p-0.5" role="tablist" aria-label="Which orders to show">
          {([['token', `This token${activeHere ? ` (${activeHere})` : ''}`], ['all', `All tokens${activeAll ? ` (${activeAll})` : ''}`]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={scope === k}
              onClick={() => setScope(k)}
              className={cn('flex-1 rounded px-2 py-1 text-xs font-medium transition-colors', scope === k ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        {scope === 'token' && orders.length === 0 && state.orders.length > 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No orders on this token.{' '}
            <button type="button" onClick={() => setScope('all')} className="font-semibold text-foreground underline underline-offset-2 hover:decoration-2">
              See all orders ({activeAll > 0 ? `${activeAll} active` : state.orders.length})
            </button>
          </p>
        ) : (
          <OrderList
            orders={scope === 'token' ? orders : state.orders}
            ticks={state.ticks}
            height={260}
            showMint={scope === 'all'}
            labels={labels}
            linkTarget="_self"
            emptyText={scope === 'token' ? 'No orders on this token yet.' : 'No orders yet.'}
            onCancel={(id) => send({ type: 'order.cancel', id })}
          />
        )}
      </div>
    </div>
  );
}
