/**
 * @file evm-payment-watcher.ts
 * @description Finds payments to the treasury on one EVM chain by polling ERC-20 Transfer logs (to = treasury) of the
 *              accepted coins. Polling from a stored block cursor means nothing is missed across restarts or dropped
 *              connections; re-reading a block is harmless because payments are recorded once per transaction.
 * @author Reborn1987
 */

import { toEventSelector } from 'viem';

import type { EvmChain } from '../chains/token-key.js';
import type { BillingStorePort } from '../../ports/billing-store.js';
import type { EvmLog, EvmRpcPort, Hex } from '../../ports/evm-rpc.js';
import type { IncomingTransfer } from './billing-service.js';
import type { PaymentAsset } from './payment-assets.js';

export const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');
/** Blocks per eth_getLogs call (providers cap ranges at 10k). */
const CHUNK = 2_000n;
/** Blocks left unread at the head, so a log is only read once its block is settled. */
const CONFIRMATIONS = 2n;

/** Topic form of an address. */
function topicOf(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

/** Address from a topic. */
function addressOf(topic: Hex | undefined): string {
  return topic ? `0x${topic.slice(26)}`.toLowerCase() : '';
}

export class EvmPaymentWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /**
   * @param chain chain slug @param rpc chain access @param assets accepted coins on this chain (non-empty)
   * @param treasury receiving address @param cursors cursor storage @param onTransfer payment sink
   * @param onError sink for RPC failures (polling continues) @param pollMs poll interval
   */
  constructor(
    private readonly chain: EvmChain,
    private readonly rpc: EvmRpcPort,
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

  /** Reads new settled blocks since the cursor (first run: starts at the current head). */
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const key = `evm:${this.chain}`;
      const safeHead = (await this.rpc.blockNumber()) - CONFIRMATIONS;
      const stored = this.cursors.cursor(key);
      let from = stored === null ? safeHead : BigInt(stored) + 1n;
      while (from <= safeHead) {
        const to = from + CHUNK - 1n < safeHead ? from + CHUNK - 1n : safeHead;
        const logs = await this.rpc.getLogs(
          { address: this.assets.map((a) => a.address as Hex), topics: [TRANSFER_TOPIC, null, topicOf(this.treasury)] },
          from,
          to,
        );
        for (const log of logs) this.handle(log);
        this.cursors.setCursor(key, to.toString());
        from = to + 1n;
      }
      if (stored === null) this.cursors.setCursor(key, safeHead.toString());
    } catch (err) {
      this.onError(err);
    } finally {
      this.running = false;
    }
  }

  /** Turns a Transfer log into a payment. */
  private handle(log: EvmLog): void {
    const asset = this.assets.find((a) => a.address === log.address.toLowerCase());
    if (!asset || addressOf(log.topics[2]) !== this.treasury.toLowerCase()) return;
    const amountRaw = BigInt(log.data.slice(0, 66));
    if (amountRaw <= 0n) return;
    this.onTransfer({ chain: this.chain, txId: log.transactionHash, from: addressOf(log.topics[1]), asset, amountRaw });
  }
}
