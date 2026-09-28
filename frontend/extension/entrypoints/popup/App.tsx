/**
 * @file App.tsx
 * @description Popup root: connection status, new order form, order list and settings (account, theme, sounds).
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { NewOrderForm } from '@/components/orders/NewOrderForm';
import { OrderList } from '@/components/orders/OrderList';
import { AccountSection, NoAccount } from '@/components/AccountSection';
import { UnlockBanner, UnlockSection } from '@/components/UnlockSection';
import { TokenInsights } from '@/components/panel/TokenInsights';
import { TokenXCard } from '@/components/panel/TokenXCard';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Segmented } from '@/components/orders/Segmented';
import { OrderSounds } from '@/components/OrderSounds';
import { ThemePicker } from '@/components/ThemePicker';
import { useBackground } from '@/hooks/use-background';
import { useDefaultTab } from '@/hooks/use-default-tab';
import { useHolds } from '@/hooks/use-holds';
import { useTheme } from '@/hooks/use-theme';
import { useTokenSymbols } from '@/hooks/use-token-symbols';
import { useWatchPrice } from '@/hooks/use-watch-price';
import { mintFromFomoUrl } from '@/lib/format';
import { applyPanelVars } from '@/lib/themes';
import type { ConnectionStatus } from '@/lib/server-connection';
import { cn } from '@/lib/utils';
import { SettingsCard } from '@/components/SettingsCard';
import { useRelease } from '@/hooks/use-release';
import { hasFeature } from '@/lib/release';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Server offline',
  no_token: 'No account',
  bad_token: 'Key rejected',
  deleted: 'Account deleted',
};

/** Popup UI. */
export default function App() {
  const { state, send } = useBackground();
  const [tabMint, setTabMint] = useState<string | null>(null);
  const [theme] = useTheme();
  const release = useRelease();
  const [defaultTab, setDefaultTab] = useDefaultTab();
  const holds = useHolds(tabMint, state?.status === 'connected', send, state?.orders ?? []);
  const labels = useTokenSymbols((state?.orders ?? []).map((o) => o.mint), send, state?.status === 'connected');
  useEffect(() => applyPanelVars(document.documentElement, theme), [theme]);

  const priceError = useWatchPrice(tabMint, state?.status === 'connected', send);

  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setTabMint(mintFromFomoUrl(tab?.url)));
  }, []);

  if (!state) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  const hasAccount = state.status !== 'no_token' && state.status !== 'bad_token' && state.status !== 'deleted';
  const active = state.orders.filter((o) => o.status === 'open' || o.status === 'triggered' || o.status === 'executing').length;

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-base font-bold" aria-label="limit">
          <img src="/icon/48.png" alt="" className="size-6 rounded-md" />
          <span aria-hidden="true">l<span className="wm-i">ı</span>m<span className="wm-i">ı</span>t</span>
          <span className="text-[11px] font-medium text-muted-foreground">v{release.version}</span>
        </h1>
        <Badge className={cn(state.status === 'connected' ? 'bg-buy/20 text-buy' : 'bg-sell/20 text-sell')}>{STATUS_TEXT[state.status]}</Badge>
      </header>

      {!hasAccount ? (
        <NoAccount reason={state.status === 'bad_token' ? 'rejected' : 'deleted'} send={send} />
      ) : (
        <Tabs defaultValue="new">
          <TabsList className="w-full">
            <TabsTrigger value="new">New order</TabsTrigger>
            <TabsTrigger value="orders">Orders{active > 0 ? ` (${active})` : ''}</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="new" className="pt-2">
            <div className="mb-3 empty:hidden"><UnlockBanner status={state.billing} where="popup" /></div>
            {state.status === 'disconnected' && (
              <p className="mb-3 text-sm text-sell">Can't reach the limit server. It reconnects on its own — check your internet connection.</p>
            )}
            {tabMint && state.status === 'connected' && hasFeature(release, 'launchpad') && <div className="mb-3"><TokenInsights mint={tabMint} send={send} release={release} /></div>}
            {tabMint && state.status === 'connected' && hasFeature(release, 'xPost') && <div className="mb-3"><TokenXCard mint={tabMint} send={send} /></div>}
            {priceError && <p className="mb-3 rounded-md bg-card p-2 text-xs text-yellow">This token can't be priced yet: {priceError}</p>}
            <NewOrderForm ticks={state.ticks} initialMint={tabMint} holds={holds} onCreate={(order) => send({ type: 'order.create', order })} />
          </TabsContent>
          <TabsContent value="orders" className="pt-2">
            <OrderList orders={state.orders} ticks={state.ticks} showMint labels={labels} onCancel={(id) => send({ type: 'order.cancel', id })} />
          </TabsContent>
          <TabsContent value="settings" className="space-y-3 pt-2">
            <UnlockSection status={state.billing} send={send} />
            <SettingsCard className="space-y-2">
              <h2 className="text-sm font-semibold">When I open a token</h2>
              <p className="text-xs text-muted-foreground">Which tab fomo's trade panel starts on.</p>
              <Segmented
                value={defaultTab}
                onChange={(t) => void setDefaultTab(t)}
                options={[{ value: 'buy', label: "fomo's Buy tab" }, { value: 'limit', label: 'Limit tab' }]}
              />
            </SettingsCard>
            {hasFeature(release, 'themes') && <SettingsCard className="space-y-2">
              <h2 className="text-sm font-semibold">Theme</h2>
              <p className="text-xs text-muted-foreground">Recolors fomo.family and the Limit panel in every open fomo tab.</p>
              <ThemePicker />
            </SettingsCard>}
            {hasFeature(release, 'sounds') && <OrderSounds />}
            <AccountSection account={state.account} serverUrl={state.serverUrl} send={send} />
          </TabsContent>
        </Tabs>
      )}
      <p className="text-[11px] leading-snug text-muted-foreground">
        Keep your browser open with a logged-in fomo.family tab. Orders trade by clicking FOMO's own buttons.
      </p>
    </div>
  );
}
