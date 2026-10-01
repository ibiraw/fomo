/**
 * @file background.ts
 * @description Service worker: keeps the connection to the local order server, mirrors order/price state
 *              to the popup, and executes trades in the FOMO tab when the server asks.
 * @author Reborn1987
 */

import { generateAccountKey, isAccountKey, walletsUpdate, type AccountView, type Wallets } from '@/lib/account';
import type { BillingStatus } from '@/lib/billing';
import { executeInFomoTab, tradeInNewTab, type TabsApi, type WorkerTabStore } from '@/lib/fomo-tab';
import {
  DEFAULT_SERVER_URL,
  POPUP_PORT,
  type BackgroundMessage,
  type PopupRequest,
  type PopupState,
  type WalletsDetectedMessage,
} from '@/lib/messages';
import { ServerConnection, type ConnectionStatus } from '@/lib/server-connection';
import { FOMO_DOM_STORAGE_KEY } from '@/lib/fomo-dom-config';
import { hasFeature, loadRelease, RELEASE_STORAGE_KEY, toRelease, updateAvailable } from '@/lib/release';
import type { QuickTradeReply, QuickTradeRequest } from '@/lib/quick-trade';
import type { FomoHealthMessage } from '@/lib/fomo-health-watch';
import type { SpotTradeMessage } from '@/lib/fomo-spot-watch';
import { XLatestService } from '@/lib/x-latest';
import { scrapeLatestPost } from '@/lib/x-scraper';
import { loadSoundSettings, soundForUpdate, type PlaySoundMessage, type SoundEvent } from '@/lib/sounds';
import type { Order, PriceTick } from '@/lib/types';
import { DEFAULT_KEEP_AWAKE, hasWaitingOrders, KEEP_AWAKE_KEY, KeepAwake, loadKeepAwake, parseKeepAwake, type PowerApi } from '@/lib/keep-awake';

const KEEPALIVE_ALARM = 'fomo-keepalive';
const OFFSCREEN_PATH = '/offscreen.html';

/** The parts of Chrome's offscreen / contexts APIs used for audio (not in the cross-browser typings). */
interface ChromeAudioApis {
  runtime: { getContexts(f: { contextTypes: string[]; documentUrls: string[] }): Promise<unknown[]> };
  offscreen: { createDocument(p: { url: string; reasons: string[]; justification: string }): Promise<void> };
}

let offscreenReady: Promise<void> | null = null;

/** Opens the hidden audio page once (service workers can't play audio themselves). */
function ensureOffscreen(): Promise<void> {
  offscreenReady ??= (async () => {
    const api = (globalThis as unknown as { chrome: ChromeAudioApis }).chrome;
    const existing = await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)] });
    if (existing.length === 0) {
      await api.offscreen.createDocument({ url: OFFSCREEN_PATH, reasons: ['AUDIO_PLAYBACK'], justification: 'Plays a sound when a limit order fills or fails.' });
    }
  })().catch((err: unknown) => {
    offscreenReady = null; // try again next time
    throw err;
  });
  return offscreenReady;
}

/** Plays an order sound if the user has sounds on. */
async function playSound(event: SoundEvent): Promise<void> {
  if (!hasFeature(await loadRelease(), 'sounds')) return; // order sounds arrive with v1.2
  const settings = await loadSoundSettings();
  if (!settings.enabled || settings.volume <= 0) return;
  await ensureOffscreen();
  await browser.runtime.sendMessage({ type: 'fomo.sound', pack: settings.pack, event, volume: settings.volume } satisfies PlaySoundMessage);
}

export default defineBackground({
  type: 'module',
  /** Wires storage, connection, popup ports and the keepalive alarm. Must not be async. */
  main() {
    let status: ConnectionStatus = 'disconnected';
    let serverUrl = DEFAULT_SERVER_URL;
    let token: string | null = null;
    let account: AccountView | null = null;
    let billing: BillingStatus | null = null;
    /** Latest wallets read from a fomo tab (sent to the server once connected). */
    let detected: Wallets | null = null;
    /** fomo username (top bar) and user id (fomo's storage) last read by the content script. */
    let detectedUsername: string | null = null;
    let detectedUserId: string | null = null;
    const orders = new Map<string, Order>();
    const ticks: Record<string, PriceTick> = {};
    // Keep the computer awake while orders wait (setting on by default): a sleeping PC can't trade.
    const awake = new KeepAwake((globalThis as unknown as { chrome?: { power?: PowerApi } }).chrome?.power);
    let keepAwakeOn = DEFAULT_KEEP_AWAKE;
    const syncAwake = (): void => { awake.sync(keepAwakeOn && hasWaitingOrders(orders.values())); };
    void loadKeepAwake().then((v) => { keepAwakeOn = v; syncAwake(); });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && KEEP_AWAKE_KEY in changes) { keepAwakeOn = parseKeepAwake(changes[KEEP_AWAKE_KEY]!.newValue); syncAwake(); }
    });
    const ports = new Set<Browser.runtime.Port>();

    /** Snapshot for the popup. */
    const state = (): PopupState => ({
      status,
      serverUrl,
      hasToken: !!token,
      account,
      billing,
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
    // The extension's own background FOMO tab; kept in session storage to survive worker restarts.
    const worker: WorkerTabStore = {
      get: async () => {
        const s = await browser.storage.session.get('workerTabId');
        return typeof s.workerTabId === 'number' ? s.workerTabId : null;
      },
      set: async (tabId) => { await browser.storage.session.set({ workerTabId: tabId }); },
      clear: async () => { await browser.storage.session.remove('workerTabId'); },
    };
    const conn = new ServerConnection((url) => new WebSocket(url), {
      onStatus: (s) => { status = s; push(); },
      onSnapshot: (list, latest, acc) => {
        account = acc;
        void syncWallets();
        orders.clear();
        list.forEach((o) => orders.set(o.id, o));
        latest.forEach((t) => (ticks[t.mint] = t));
        syncAwake();
        push();
      },
      onOrder: (o) => {
        const sound = soundForUpdate(orders.get(o.id), o);
        orders.set(o.id, o);
        syncAwake();
        push();
        if (sound) void playSound(sound).catch((err: unknown) => console.error('[limit] sound failed', err));
      },
      onTick: (t) => { ticks[t.mint] = t; push(); },
      onBilling: (b) => { billing = b; push(); },
      // fomo page-layout overrides: the content scripts on fomo tabs follow this storage key.
      onFomoDom: (overrides) => {
        const op = overrides ? browser.storage.local.set({ [FOMO_DOM_STORAGE_KEY]: overrides }) : browser.storage.local.remove(FOMO_DOM_STORAGE_KEY);
        void op.catch((err: unknown) => console.error('[limit] could not save fomo layout overrides', err));
      },
      // The account's version and features: the popup, panel and fomo tabs follow this storage key.
      onRelease: (release) => {
        const op = release ? browser.storage.local.set({ [RELEASE_STORAGE_KEY]: toRelease(release) }) : browser.storage.local.remove(RELEASE_STORAGE_KEY);
        void op.catch((err: unknown) => console.error('[limit] could not save the release', err));
        // A newer build on limit.family: "NEW" on the toolbar icon until this copy is updated (the popup explains how).
        const newer = updateAvailable(toRelease(release), browser.runtime.getManifest().version);
        void browser.action.setBadgeText({ text: newer ? 'NEW' : '' }).catch(() => undefined);
        if (newer) void browser.action.setBadgeBackgroundColor({ color: '#516af6' }).catch(() => undefined);
      },
      onExecute: async (o) => {
        trading = o.mint;
        try {
          return await executeInFomoTab(tabs, inject, worker, o);
        } finally {
          trading = null;
        }
      },
    });

    // Reads X with the user's own session in a background tab (not focused) that is closed right after.
    const xLatest = new XLatestService({
      openTab: async (url) => {
        const tab = await browser.tabs.create({ url, active: false });
        if (tab.id === undefined) throw new Error('Could not open X');
        return tab.id;
      },
      closeTab: async (id) => { await browser.tabs.remove(id); },
      tabStatus: async (id) => (await browser.tabs.get(id)).status,
      scrape: async (tabId, timeoutMs) => {
        const [res] = await browser.scripting.executeScript({ target: { tabId }, func: scrapeLatestPost, args: [timeoutMs] });
        if (!res?.result) throw new Error('X page did not return a result');
        return res.result;
      },
    });

    /**
     * Loads settings and (re)connects. A new install gets an account key automatically (it is also the backup code);
     * after the user deletes their account no new one is made until they ask.
     */
    const connectFromStorage = async (): Promise<void> => {
      const s = await browser.storage.local.get(['serverUrl', 'token', 'accountDeleted']);
      serverUrl = typeof s.serverUrl === 'string' && s.serverUrl ? s.serverUrl : DEFAULT_SERVER_URL;
      token = typeof s.token === 'string' && s.token ? s.token : null;
      if (!token && s.accountDeleted !== true) {
        token = generateAccountKey();
        await browser.storage.local.set({ token });
      }
      account = null;
      conn.start(serverUrl, token);
    };

    /** Sends newly detected wallet addresses (and the fomo username) to the server when they differ from the account's. */
    const syncWallets = async (): Promise<void> => {
      if (!account || conn.getStatus() !== 'connected') return;
      const next = detected ? walletsUpdate(account.wallets, detected) : null;
      if (next) {
        try {
          account = (await conn.request('wallets.set', { wallets: next })) as AccountView;
          push();
        } catch (err) {
          console.error('[limit] could not save wallets', err);
        }
      }
      await syncUsername();
    };

    /** Sends the detected fomo username / user id when the account doesn't have them yet (or they changed). */
    const syncUsername = async (): Promise<void> => {
      if (!account || conn.getStatus() !== 'connected') return;
      const body: { fomoUsername?: string; fomoUserId?: string } = {};
      if (detectedUsername && detectedUsername !== account.fomoUsername) body.fomoUsername = detectedUsername;
      if (detectedUserId && detectedUserId !== account.fomoUserId) body.fomoUserId = detectedUserId;
      if (!body.fomoUsername && !body.fomoUserId) return;
      try {
        account = (await conn.request('profile.set', body)) as AccountView;
        push();
      } catch (err) {
        console.error('[limit] could not save fomo username', err);
      }
    };

    // fomo self-check reports from content scripts → server (state changes, failures at most every 10 min).
    let lastLayoutOk: boolean | null = null;
    let lastLayoutFailAt = 0;
    /** Token of the order limit is trading right now (null when idle). */
    let trading: string | null = null;
    browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
      const quick = msg as Partial<QuickTradeRequest> | undefined;
      if (quick?.type === 'fomo.quick') {
        // A quick Buy/Sell button: open the token in a new tab and press fomo's own Buy/Sell there (a spot trade, no
        // server order; its toast is reported like any trade the user makes by hand).
        void (async (): Promise<QuickTradeReply> => {
          if (!hasFeature(await loadRelease(), 'quickTrade')) return { ok: false, error: 'Quick trades arrive in limit v2.0.0' };
          if (typeof quick.mint !== 'string' || (quick.side !== 'buy' && quick.side !== 'sell') || !quick.amount) return { ok: false, error: 'Bad request' };
          const result = await tradeInNewTab(tabs, inject, quick.mint, { side: quick.side, amount: quick.amount });
          return result.ok ? { ok: true } : { ok: false, error: result.message, unknown: result.kind === 'unknown' };
        })().then(sendResponse, (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies QuickTradeReply));
        return true; // answered asynchronously
      }
      const spot = msg as Partial<SpotTradeMessage> | undefined;
      if (spot?.type === 'fomo.spot') {
        // limit's own trade shows the same toast: skip reports on the token it is trading, keep the user's other trades.
        if (!(trading !== null && (spot.mint === trading || !spot.mint)) && (spot.side === 'buy' || spot.side === 'sell') && typeof spot.detail === 'string') {
          void conn.request('trade.spot', {
            side: spot.side, detail: spot.detail, ...(spot.mint ? { mint: spot.mint } : {}), ...(spot.sell ? { sell: spot.sell } : {}),
          }).catch(() => undefined);
        }
        return;
      }
      const m = msg as Partial<FomoHealthMessage> | undefined;
      if (m?.type === 'fomo.newVersion') {
        void conn.request('layout.status', { newVersion: true }).catch(() => undefined);
        // Reload fomo's new version in limit's own background tab (never in the user's tabs, never mid-trade).
        void worker.get().then((id) => {
          if (id !== null && id === sender.tab?.id && trading === null) void browser.tabs.reload(id).catch(() => undefined);
        });
        return;
      }
      if (m?.type !== 'fomo.layout' || typeof m.ok !== 'boolean') return;
      const now = Date.now();
      if (m.ok === lastLayoutOk && (m.ok || now - lastLayoutFailAt < 10 * 60_000)) return;
      if (!m.ok) lastLayoutFailAt = now;
      lastLayoutOk = m.ok;
      void conn.request('layout.status', { ok: m.ok, missing: m.missing ?? [], ...(m.snapshot ? { snapshot: m.snapshot } : {}) })
        .catch((err: unknown) => {
          lastLayoutOk = null; // not delivered: send again next time
          console.error('[limit] could not report the fomo layout check', err);
        });
    });

    // The fomo content script reports the wallets it reads from the page's own storage.
    browser.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as Partial<WalletsDetectedMessage> | undefined;
      if (m?.type !== 'fomo.wallets' || !m.wallets) return;
      detected = m.wallets;
      if (m.fomoUsername) detectedUsername = m.fomoUsername;
      if (m.fomoUserId) detectedUserId = m.fomoUserId;
      void syncWallets();
    });

    /** Handles one popup request and replies. */
    const handle = async (port: Browser.runtime.Port, req: PopupRequest): Promise<void> => {
      const reply = (msg: BackgroundMessage): void => port.postMessage(msg);
      try {
        let data: unknown;
        if (req.type === 'settings.save') {
          await browser.storage.local.set({ serverUrl: req.serverUrl.trim() });
          await connectFromStorage();
        } else if (req.type === 'account.key') {
          data = token;
        } else if (req.type === 'account.restore') {
          if (!isAccountKey(req.key)) throw new Error("That doesn't look like a backup code — it's a long string of letters, numbers, - and _.");
          await browser.storage.local.set({ token: req.key.trim(), accountDeleted: false });
          await connectFromStorage();
        } else if (req.type === 'account.new') {
          await browser.storage.local.remove('token');
          await browser.storage.local.set({ accountDeleted: false });
          await connectFromStorage();
        } else if (req.type === 'account.delete') {
          data = await conn.request('account.delete', {});
          conn.stop();
          token = null;
          account = null;
          orders.clear();
          syncAwake();
          await browser.storage.local.remove('token');
          await browser.storage.local.set({ accountDeleted: true });
          status = 'no_token';
          push();
        } else if (req.type === 'wallets.set') {
          account = (await conn.request('wallets.set', { wallets: req.wallets })) as AccountView;
          push();
          data = account;
        } else if (req.type === 'order.create') {
          data = await conn.request('order.create', { order: req.order });
        } else if (req.type === 'order.cancel') {
          data = await conn.request('order.cancel', { id: req.id });
        } else if (req.type === 'token.info') {
          data = await conn.request('token.info', { mint: req.mint });
        } else if (req.type === 'token.launchpad') {
          data = await conn.request('token.launchpad', { mint: req.mint });
        } else if (req.type === 'token.metrics') {
          data = await conn.request('token.metrics', { mint: req.mint });
        } else if (req.type === 'wallet.holds') {
          data = await conn.request('wallet.holds', { mint: req.mint });
        } else if (req.type === 'price.watch') {
          const tick = (await conn.request('price.watch', { mint: req.mint })) as PriceTick | null;
          if (tick) { ticks[tick.mint] = tick; push(); }
          data = tick;
        } else if (req.type === 'billing.quote') {
          data = await conn.request('billing.quote', {});
        } else if (req.type === 'billing.claim') {
          data = await conn.request('billing.claim', { tx: req.tx });
        } else if (req.type === 'x.latest') {
          if (!hasFeature(await loadRelease(), 'xPost')) throw new Error('The X post checker is not in your version yet');
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

    // After an install, update or reload, fomo tabs that were already open still run the old copy, which can no
    // longer reach limit (no Limit panel, no trade alerts). Attach the new copy to every one of them, whatever token
    // each shows; the old copies step aside on their own (their panel removes itself).
    browser.runtime.onInstalled.addListener(() => {
      void (async () => {
        const open = await browser.tabs.query({ url: 'https://fomo.family/*' });
        for (const tab of open) {
          if (tab.id === undefined || tab.discarded) continue;
          await browser.scripting
            .executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/fomo-panel.js', '/content-scripts/fomo.js'] })
            .catch((err: unknown) => console.warn('[limit] could not attach to an open fomo tab', err));
        }
      })();
    });

    // The service worker can be stopped by Chrome; the alarm wakes it and restores the connection.
    void browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
    browser.alarms.onAlarm.addListener((a) => {
      if (a.name === KEEPALIVE_ALARM) conn.ensure(serverUrl, token);
    });

    void connectFromStorage();
  },
});
