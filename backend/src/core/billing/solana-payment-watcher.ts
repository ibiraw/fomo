/**
 * @file solana-payment-watcher.ts
 * @description Finds payments to the Solana treasury by polling its token accounts for each accepted mint, from a
 *              stored signature cursor. The first run starts at the newest transaction, so old transfers aren't credited.
 * @author Reborn1987
 */

import type { BillingStorePort } from '../../ports/billing-store.js';
import type { SolanaTransfersPort } from '../../ports/solana-transfers.js';
import type { IncomingTransfer } from './billing-service.js';
import type { PaymentAsset } from './payment-assets.js';

export class SolanaPaymentWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /**
   * @param transfers Solana transfer reader @param assets accepted Solana coins @param treasury receiving wallet
   * @param cursors cursor storage @param onTransfer payment sink @param onError sink for RPC failures
   * @param pollMs poll interval
   */
  constructor(
    private readonly transfers: SolanaTransfersPort,
    private readonly assets: readonly PaymentAsset[],
    private readonly treasury: string,
    private readonly cursors: Pick<BillingStorePort, 'cursor' | 'setCursor'>,
    private readonly onTransfer: (t: IncomingTransfer) => void,
    private readonly onError: (err: unknown) => void,
    private readonly pollMs = 15_000,
  ) {}

  /** Polls now and then every `pollMs`. */
  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  /** Stops polling. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Reads new transfers for every accepted mint. */
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const asset of this.assets) {
        const key = `solana:${asset.address}`;
        let cursor = this.cursors.cursor(key);
        if (cursor === null) {
          // First run: remember where the wallet is now. An empty wallet ('') reads from its first transfer.
          cursor = (await this.transfers.latestSignature(this.treasury, asset.address)) ?? '';
          this.cursors.setCursor(key, cursor);
          continue;
        }
        for (const t of await this.transfers.incoming(this.treasury, asset.address, cursor || null)) {
          this.onTransfer({ chain: 'solana', txId: t.signature, from: t.from, asset, amountRaw: t.amountRaw });
          this.cursors.setCursor(key, t.signature);
        }
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.running = false;
    }
  }
}
