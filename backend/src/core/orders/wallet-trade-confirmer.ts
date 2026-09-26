/**
 * @file wallet-trade-confirmer.ts
 * @description Confirms FOMO trades on-chain by polling the user's wallet token balance for the mint.
 *              FOMO holds real SPL tokens in the user's wallet (verified 2026-09-26), so a buy raises and
 *              a sell lowers that balance within ~1s of landing, regardless of FOMO's UI refresh.
 * @author Reborn1987
 */

import type { SolanaAccountsPort } from '../../ports/solana-accounts.js';
import { TradeConfirmerPort, type BalanceChange } from '../../ports/trade-confirmer.js';
import type { OrderSide } from './order.js';
import { isTokenKey, parseTokenKey } from '../chains/token-key.js';

export class WalletTradeConfirmer extends TradeConfirmerPort {
  /**
   * @param accounts RPC access @param wallet the user's FOMO Solana wallet
   * @param pollMs poll interval @param onError sink for transient RPC errors (polling continues)
   */
  constructor(
    private readonly accounts: SolanaAccountsPort,
    private readonly wallet: string,
    private readonly pollMs: number,
    private readonly onError: (err: unknown) => void,
  ) {
    super();
  }

  /** Solana tokens only. */
  covers(mint: string): boolean {
    return isTokenKey(mint) && parseTokenKey(mint).chain === 'solana';
  }

  /** Current raw balance of `mint` in the wallet. */
  snapshot(mint: string): Promise<bigint> {
    return this.accounts.getTokenBalance(this.wallet, mint);
  }

  /** Polls until the balance moves in the trade's direction, or the signal aborts. */
  async waitForChange(mint: string, before: bigint, side: OrderSide, signal: AbortSignal): Promise<BalanceChange | null> {
    while (!signal.aborted) {
      try {
        const after = await this.snapshot(mint);
        if (side === 'buy' ? after > before : after < before) return { before, after };
      } catch (err) {
        this.onError(err);
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, this.pollMs);
        signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
    return null;
  }
}
