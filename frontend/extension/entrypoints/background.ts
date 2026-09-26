/**
 * @file background.ts
 * @description Service worker: keeps the connection to the local order server, mirrors order/price state
 *              to the popup, and executes trades in the FOMO tab when the server asks.
 * @author Reborn1987
 */

import { executeInFomoTab, type TabsApi } from '@/lib/fomo-tab';
import {
  DEFAULT_SERVER_URL,
  POPUP_PORT,
  type BackgroundMessage,
  type PopupRequest,
  type PopupState,
} from '@/lib/messages';
import { ServerConnection, type ConnectionStatus } from '@/lib/server-connection';
import type { Order, PriceTick } from '@/lib/types';

const KEEPALIVE_ALARM = 'fomo-keepalive';

export default defineBackground({
  type: 'module',
  /** Wires storage, connection, popup ports and the keepalive alarm. Must not be async. */
  main() {
    let status: ConnectionStatus = 'disconnected';
    let serverUrl = DEFAULT_SERVER_URL;
    let token: string | null = null;
    const orders = new Map<string, Order>();
    const ticks: Record<string, PriceTick> = {};
    const ports = new Set<Browser.runtime.Port>();

    /** Snapshot for the popup. */
    const state = (): PopupState => ({
      status,
      serverUrl,
      hasToken: !!token,
      orders: [...orders.values()].sort((a, b) => b.createdAt - a.createdAt),
      ticks: { ...ticks },
    });

    /** Pushes state to every open popup. */
    const push = (): void => {
      const msg: BackgroundMessage = { type: 'state', state: state() };
      ports.forEach((p) => p.postMessage(msg));
    };

    const tabs = browser.tabs as unknown as TabsApi;
    const conn = new ServerConnection((url) => new WebSocket(url), {
      onStatus: (s) => { status = s; push(); },
      onSnapshot: (list, latest) => {
        orders.clear();
        list.forEach((o) => orders.set(o.id, o));
        latest.forEach((t) => (ticks[t.mint] = t));
        push();
      },
      onOrder: (o) => { orders.set(o.id, o); push(); },
      onTick: (t) => { ticks[t.mint] = t; push(); },
      onExecute: (o) => executeInFomoTab(tabs, o),
    });

    /** Loads settings from storage and (re)connects. */
    const connectFromStorage = async (): Promise<void> => {
      const s = await browser.storage.local.get(['serverUrl', 'token']);
      serverUrl = typeof s.serverUrl === 'string' && s.serverUrl ? s.serverUrl : DEFAULT_SERVER_URL;
      token = typeof s.token === 'string' && s.token ? s.token : null;
      conn.start(serverUrl, token);
    };

    /** Handles one popup request and replies. */
    const handle = async (port: Browser.runtime.Port, req: PopupRequest): Promise<void> => {
      const reply = (msg: BackgroundMessage): void => port.postMessage(msg);
      try {
        if (req.type === 'settings.save') {
          await browser.storage.local.set({ serverUrl: req.serverUrl.trim(), token: req.token.trim() });
          await connectFromStorage();
        } else if (req.type === 'order.create') {
          await conn.request('order.create', { order: req.order });
        } else {
          await conn.request('order.cancel', { id: req.id });
        }
        reply({ type: 'reply', reqId: req.reqId, ok: true });
      } catch (err) {
        reply({ type: 'reply', reqId: req.reqId, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    };

    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== POPUP_PORT) return;
      ports.add(port);
      port.onMessage.addListener((req: PopupRequest) => void handle(port, req));
      port.onDisconnect.addListener(() => ports.delete(port));
      port.postMessage({ type: 'state', state: state() } satisfies BackgroundMessage);
    });

    // The service worker can be stopped by Chrome; the alarm wakes it and restores the connection.
    void browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
    browser.alarms.onAlarm.addListener((a) => {
      if (a.name === KEEPALIVE_ALARM) conn.ensure(serverUrl, token);
    });

    void connectFromStorage();
  },
});
