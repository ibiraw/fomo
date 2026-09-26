/**
 * @file App.tsx
 * @description Popup root: connection status, pairing, new order form and order list.
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { NewOrderForm } from '@/components/orders/NewOrderForm';
import { OrderList } from '@/components/orders/OrderList';
import { PairingForm } from '@/components/orders/PairingForm';
import { TokenXCard } from '@/components/panel/TokenXCard';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBackground } from '@/hooks/use-background';
import { useWatchPrice } from '@/hooks/use-watch-price';
import { mintFromFomoUrl } from '@/lib/format';
import type { ConnectionStatus } from '@/lib/server-connection';
import { cn } from '@/lib/utils';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Server offline',
  no_token: 'Not paired',
  bad_token: 'Pairing rejected',
};

/** Popup UI. */
export default function App() {
  const { state, send } = useBackground();
  const [tabMint, setTabMint] = useState<string | null>(null);

  const priceError = useWatchPrice(tabMint, state?.status === 'connected', send);

  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setTabMint(mintFromFomoUrl(tab?.url)));
  }, []);

  if (!state) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  const paired = state.status !== 'no_token' && state.status !== 'bad_token';
  const active = state.orders.filter((o) => o.status === 'open' || o.status === 'triggered' || o.status === 'executing').length;
  const save = (serverUrl: string, token: string): Promise<unknown> => send({ type: 'settings.save', serverUrl, token });

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-bold">FOMO Limit Orders</h1>
        <Badge className={cn(state.status === 'connected' ? 'bg-buy/20 text-buy' : 'bg-sell/20 text-sell')}>{STATUS_TEXT[state.status]}</Badge>
      </header>

      {!paired ? (
        <PairingForm serverUrl={state.serverUrl} badToken={state.status === 'bad_token'} onSave={save} />
      ) : (
        <Tabs defaultValue="new">
          <TabsList className="w-full">
            <TabsTrigger value="new">New order</TabsTrigger>
            <TabsTrigger value="orders">Orders{active > 0 ? ` (${active})` : ''}</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="new" className="pt-2">
            {state.status === 'disconnected' && (
              <p className="mb-3 text-sm text-sell">Server offline — start it with <code>npm run dev</code> in <code>backend/</code>.</p>
            )}
            {tabMint && state.status === 'connected' && <div className="mb-3"><TokenXCard mint={tabMint} send={send} /></div>}
            {priceError && <p className="mb-3 rounded-md bg-card p-2 text-xs text-yellow">This token can't be priced yet: {priceError}</p>}
            <NewOrderForm ticks={state.ticks} initialMint={tabMint} onCreate={(order) => send({ type: 'order.create', order })} />
          </TabsContent>
          <TabsContent value="orders" className="pt-2">
            <OrderList orders={state.orders} ticks={state.ticks} showMint onCancel={(id) => send({ type: 'order.cancel', id })} />
          </TabsContent>
          <TabsContent value="settings" className="pt-2">
            <PairingForm serverUrl={state.serverUrl} badToken={false} onSave={save} />
          </TabsContent>
        </Tabs>
      )}
      <p className="text-[11px] leading-snug text-muted-foreground">
        Keep Chrome open with a logged-in fomo.family tab. Orders trade by clicking FOMO's own buttons.
      </p>
    </div>
  );
}
