/**
 * @file fomo.content.ts
 * @description Content script on fomo.family. Answers readiness pings, executes trades sent by the background
 *              worker on the current token page, reports the user's wallet addresses read from fomo's storage, and
 *              (v2.0.0) keeps the quick Buy/Sell buttons on fomo's Feed and Alerts items.
 * @author Reborn1987
 */

import { readFomoUserId, readFomoWallets } from '@/lib/account';
import { readOwnFomoUsername } from '@/lib/fomo-dom';
import { followFomoDom } from '@/lib/fomo-dom-config';
import { FomoHealthWatcher, type FomoHealthMessage } from '@/lib/fomo-health-watch';
import { SpotTradeWatcher, titleSymbol, type SpotTradeMessage } from '@/lib/fomo-spot-watch';
import type { WalletsDetectedMessage } from '@/lib/messages';
import { keyFromPath, tokenPath } from '@/lib/token-key';
import { DEFAULT_QUICK_PRESETS, QUICK_PRESETS_KEY, QuickTradeButtons, toQuickPresets, type QuickPresets, type QuickTradeReply } from '@/lib/quick-trade';
import { hasFeature, loadRelease, onReleaseChange } from '@/lib/release';
import { executeTrade } from '@/lib/trade';
import { AUTO_RISK_ACK_KEY, parseAutoRiskAck, RiskAckTicker } from '@/lib/risk-ack';
import type { ExecutionResult, TradeRequest } from '@/lib/types';

/** Messages the background worker sends to this script. */
export type ContentMessage =
  | { readonly type: 'fomo.ping'; readonly mint: string }
  | { readonly type: 'fomo.trade'; readonly mint: string; readonly request: TradeRequest };

/** Reply to fomo.ping. */
export interface PingReply {
  readonly onMint: boolean;
}

/** True when the page shows the token `mint` (any chain). */
function onMintPage(mint: string): boolean {
  return keyFromPath(location.pathname) === keyFromPath(tokenPath(mint));
}

export default defineContentScript({
  matches: ['https://fomo.family/*'],
  runAt: 'document_idle',
  /** Registers the message handler (once, even if the background injects the script again). */
  main() {
    // A previous copy may exist; skip only if it is still alive. After an extension reload the old
    // copy is orphaned (its runtime.id is gone) and this new copy must take over.
    const flagged = window as unknown as { __fomoLimitOrdersAlive?: () => boolean };
    if (flagged.__fomoLimitOrdersAlive?.()) return;
    // fomo self-check: new-version prompt + layout check on token pages; reports go to the background worker.
    const health = new FomoHealthWatcher({
      doc: document,
      path: () => location.pathname,
      isTokenPage: (path) => keyFromPath(path) !== null,
      loggedIn: () => {
        try {
          return readFomoUserId(localStorage) !== null;
        } catch {
          return false;
        }
      },
      send: (msg: FomoHealthMessage) => void browser.runtime.sendMessage(msg).catch(() => undefined),
      now: () => Date.now(),
    });
    health.start();
    // Trades made with fomo's own Buy/Sell (its "Buying …" / "Selling …" toasts) → background → monitoring.
    new SpotTradeWatcher({
      doc: document,
      mint: () => keyFromPath(location.pathname),
      symbol: () => (keyFromPath(location.pathname) ? titleSymbol(document.title) : null),
      send: (msg: SpotTradeMessage) => void browser.runtime.sendMessage(msg).catch(() => undefined),
      now: () => Date.now(),
    }).start();
    // Page-layout knowledge: built-ins now, the server's overrides as soon as storage answers; re-check on changes.
    void followFomoDom(() => health.recheck());
    flagged.__fomoLimitOrdersAlive = () => {
      try {
        return !!browser.runtime?.id;
      } catch {
        return false;
      }
    };
    startQuickTrade();
    startRiskAck();
    browser.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
      if (msg.type === 'fomo.ping') {
        sendResponse({ onMint: onMintPage(msg.mint) } satisfies PingReply);
        return false;
      }
      if (msg.type === 'fomo.trade') {
        const run = async (): Promise<ExecutionResult> => {
          if (!onMintPage(msg.mint)) return { ok: false, kind: 'ui_error', message: 'FOMO tab is not on the order token page' };
          return executeTrade(document, msg.request);
        };
        void run().then(sendResponse);
        return true; // async response
      }
      return false;
    });
    // Wallet addresses: read silently from fomo's own storage (nothing is opened or clicked). fomo fills it in
    // after login, so check again a little later.
    for (const delayMs of [0, 5_000, 30_000]) setTimeout(reportWallets, delayMs);
  },
});

/**
 * Auto-tick fomo's risk warning on the Buy tab (setting, off by default): watches the page while it's on and ticks the
 * "I understand the risks" checkbox the moment it shows up, so a hyped launch isn't delayed by it.
 */
function startRiskAck(): void {
  const ticker = new RiskAckTicker(document);
  let pending: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (pending) return;
    pending = setTimeout(() => { pending = null; ticker.scan(); }, 40); // fast: this is about saving seconds
  };
  const observer = new MutationObserver(schedule);
  const apply = (on: boolean): void => {
    observer.disconnect();
    if (!on) return;
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    schedule();
  };
  void browser.storage.local.get(AUTO_RISK_ACK_KEY).then((st) => apply(parseAutoRiskAck(st[AUTO_RISK_ACK_KEY])));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && AUTO_RISK_ACK_KEY in changes) apply(parseAutoRiskAck(changes[AUTO_RISK_ACK_KEY]!.newValue));
  });
}

/** The quick Buy/Sell buttons (null until started). */
let quickButtons: QuickTradeButtons | null = null;

/**
 * Quick Buy/Sell buttons (v2.0.0) on fomo's Feed and Alerts items: kept up to date on page changes while the account's
 * version has them; removed when it doesn't. Amounts follow the presets set in the popup.
 */
function startQuickTrade(): void {
  let presets: QuickPresets = DEFAULT_QUICK_PRESETS;
  let enabled = false;
  const buttons = new QuickTradeButtons({
    doc: document,
    presets: () => presets,
    send: (req) => browser.runtime.sendMessage(req) as Promise<QuickTradeReply>,
  });
  quickButtons = buttons;
  buttons.clear(); // buttons left by an older copy of limit (before an update) no longer work
  let pending: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (!enabled || pending) return;
    pending = setTimeout(() => { pending = null; buttons.scan(); }, 250);
  };
  const observer = new MutationObserver(schedule);
  const apply = (on: boolean): void => {
    enabled = on;
    if (on) {
      observer.observe(document.body, { childList: true, subtree: true });
      schedule();
    } else {
      observer.disconnect();
      buttons.clear();
    }
  };
  void loadRelease().then((r) => apply(hasFeature(r, 'quickTrade')));
  onReleaseChange((r) => apply(hasFeature(r, 'quickTrade')));
  void browser.storage.local.get(QUICK_PRESETS_KEY).then((s) => { presets = toQuickPresets(s[QUICK_PRESETS_KEY]); });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(QUICK_PRESETS_KEY in changes)) return;
    presets = toQuickPresets(changes[QUICK_PRESETS_KEY]!.newValue);
    if (enabled) { buttons.clear(); schedule(); } // redraw with the new amounts
  });
}

/** Sends the user's fomo wallet addresses, username and user id to the background when any are found. */
function reportWallets(): void {
  try {
    const wallets = readFomoWallets(localStorage);
    const fomoUsername = readOwnFomoUsername(document);
    const fomoUserId = readFomoUserId(localStorage);
    if (wallets.solana || wallets.evm || fomoUsername || fomoUserId) {
      void browser.runtime.sendMessage({ type: 'fomo.wallets', wallets, fomoUsername, fomoUserId } satisfies WalletsDetectedMessage).catch(() => undefined);
    }
  } catch {
    // storage blocked or extension reloaded — try again on the next page load
  }
}
