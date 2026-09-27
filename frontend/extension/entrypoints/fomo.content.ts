/**
 * @file fomo.content.ts
 * @description Content script on fomo.family. Answers readiness pings, executes trades sent by the background
 *              worker on the current token page, and reports the user's wallet addresses read from fomo's storage.
 * @author Reborn1987
 */

import { readFomoUserId, readFomoWallets } from '@/lib/account';
import { readOwnFomoUsername } from '@/lib/fomo-dom';
import { followFomoDom } from '@/lib/fomo-dom-config';
import { FomoHealthWatcher, type FomoHealthMessage } from '@/lib/fomo-health-watch';
import type { WalletsDetectedMessage } from '@/lib/messages';
import { keyFromPath, tokenPath } from '@/lib/token-key';
import { executeTrade } from '@/lib/trade';
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
    // Page-layout knowledge: built-ins now, the server's overrides as soon as storage answers; re-check on changes.
    void followFomoDom(() => health.recheck());
    flagged.__fomoLimitOrdersAlive = () => {
      try {
        return !!browser.runtime?.id;
      } catch {
        return false;
      }
    };
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
