/**
 * @file evm-wallet-confirmer.ts
 * @description On-chain trade confirmation for EVM tokens: polls the FOMO EVM wallet's ERC-20 balance on the
 *              token's chain (the same wallet address is used on every EVM chain).
 * @author Reborn1987
 */

import type { OrderSide } from '../orders/order.js';
import { isTokenKey, parseTokenKey, type EvmChain } from '../chains/token-key.js';
import { ConfigError } from '../errors.js';
import type { Hex } from '../../ports/evm-rpc.js';
import { TradeConfirmerPort, type BalanceChange } from '../../ports/trade-confirmer.js';
import type { Erc20Reader } from './erc20.js';

export class EvmWalletConfirmer extends TradeConfirmerPort {
  /**
   * @param readers ERC-20 reader per enabled chain @param wallet the user's FOMO EVM wallet
   * @param pollMs poll interval @param onError sink for transient RPC errors (polling continues)
   */
  constructor(
    private readonly readers: ReadonlyMap<EvmChain, Erc20Reader>,
    private readonly wallet: Hex,
    private readonly pollMs: number,
    private readonly onError: (err: unknown) => void,
  ) {
    super();
  }

  /** EVM tokens on enabled chains. */
  covers(key: string): boolean {
    if (!isTokenKey(key)) return false;
    const { chain } = parseTokenKey(key);
    return chain !== 'solana' && this.readers.has(chain);
  }

  /** Current raw balance of the token in the wallet. */
  snapshot(key: string): Promise<bigint> {
    const ref = parseTokenKey(key);
    const reader = ref.chain === 'solana' ? undefined : this.readers.get(ref.chain);
    if (!reader) return Promise.reject(new ConfigError(`${ref.chain} is not an enabled EVM chain`));
    return reader.balanceOf(ref.address as Hex, this.wallet);
  }

  /** Polls until the balance moves in the trade's direction, or the signal aborts. */
  async waitForChange(key: string, before: bigint, side: OrderSide, signal: AbortSignal): Promise<BalanceChange | null> {
    while (!signal.aborted) {
      try {
        const after = await this.snapshot(key);
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
