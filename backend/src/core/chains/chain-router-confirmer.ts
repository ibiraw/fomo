/**
 * @file chain-router-confirmer.ts
 * @description Routes trade confirmation / balance reads to the confirmer for the token's chain.
 * @author Reborn1987
 */

import type { OrderSide } from '../orders/order.js';
import { ConfigError } from '../errors.js';
import { TradeConfirmerPort, type BalanceChange } from '../../ports/trade-confirmer.js';
import { parseTokenKey, type Chain } from './token-key.js';

export class ChainRouterConfirmer extends TradeConfirmerPort {
  /** @param confirmers one confirmer per chain that has a wallet configured */
  constructor(private readonly confirmers: ReadonlyMap<Chain, TradeConfirmerPort>) {
    super();
  }

  /** Balance of `key` in the wallet for its chain. */
  snapshot(key: string): Promise<bigint> {
    return this.pick(key).snapshot(key);
  }

  /** Waits for the balance of `key` to move, on its chain. */
  waitForChange(key: string, before: bigint, side: OrderSide, signal: AbortSignal): Promise<BalanceChange | null> {
    return this.pick(key).waitForChange(key, before, side, signal);
  }

  /** True when a wallet is configured for the token's chain. */
  covers(key: string): boolean {
    const c = this.confirmers.get(parseTokenKey(key).chain);
    return c ? c.covers(key) : false;
  }

  /** The confirmer for the token's chain; ConfigError when none is configured. */
  private pick(key: string): TradeConfirmerPort {
    const { chain } = parseTokenKey(key);
    const c = this.confirmers.get(chain);
    if (!c) throw new ConfigError(`No wallet configured for ${chain} (set ${chain === 'solana' ? 'FOMO_WALLET' : 'FOMO_EVM_WALLET'} in backend/.env)`);
    return c;
  }
}
