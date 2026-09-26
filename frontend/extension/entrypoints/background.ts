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
import { XLatestService } from '@/lib/x-latest';
import { scrapeLatestPost } from '@/lib/x-scraper';
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
    /** Adds the FOMO content script to a tab that was open before the extension was installed. */
    const inject = async (tabId: number): Promise<void> => {
      await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/fomo.js'] });
    };
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
      onExecute: (o) => executeInFomoTab(tabs, inject, o),
    });

    // Reads X with the user's own session in a minimized window that is closed right after.
    const xLatest = new XLatestService({
      openWindow: async (url) => {
        const w = await browser.windows.create({ url, state: 'minimized', focused: false });
        const tabId = w?.tabs?.[0]?.id;
        if (!w?.id || tabId === undefined) throw new Error('Could not open X');
        return { windowId: w.id, tabId };
      },
      closeWindow: async (id) => { await browser.windows.remove(id); },
      tabStatus: async (id) => (await browser.tabs.get(id)).status,
      scrape: async (tabId, timeoutMs) => {
        const [res] = await browser.scripting.executeScript({ target: { tabId }, func: scrapeLatestPost, args: [timeoutMs] });
        if (!res?.result) throw new Error('X page did not return a result');
        return res.result;
      },
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
        let data: unknown;
        if (req.type === 'settings.save') {
          await browser.storage.local.set({ serverUrl: req.serverUrl.trim(), token: req.token.trim() });
          await connectFromStorage();
        } else if (req.type === 'order.create') {
          data = await conn.request('order.create', { order: req.order });
        } else if (req.type === 'order.cancel') {
          data = await conn.request('order.cancel', { id: req.id });
        } else if (req.type === 'token.info') {
          data = await conn.request('token.info', { mint: req.mint });
        } else if (req.type === 'price.watch') {
          const tick = (await conn.request('price.watch', { mint: req.mint })) as PriceTick | null;
          if (tick) { ticks[tick.mint] = tick; push(); }
          data = tick;
        } else {
          data = await xLatest.get(req.url, req.force ?? false);
        }
        reply({ type: 'reply', reqId: req.reqId, ok: true, data });
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
