/**
 * @file fomo.content.ts
 * @description Content script on fomo.family. Answers readiness pings and executes trades sent by the
 *              background worker on the current token page.
 * @author Reborn1987
 */

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

/** True when the page shows the Solana token `mint`. */
function onMintPage(mint: string): boolean {
  return location.pathname === `/tokens/solana/${mint}`;
}

export default defineContentScript({
  matches: ['https://fomo.family/*'],
  runAt: 'document_idle',
  /** Registers the message handler. */
  main() {
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
  },
});
