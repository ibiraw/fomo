/**
 * @file solana-transfers.ts
 * @description SolanaTransfersPort — SPL token transfers received by a wallet (for payment detection).
 * @author Reborn1987
 */

/** One incoming transfer of a mint to the wallet. */
export interface SolanaTransfer {
  readonly signature: string;
  /** Slot the transaction landed in (the watcher's cursor). */
  readonly slot: bigint;
  /** Owner wallet of the sending token account ('' when it can't be told). */
  readonly from: string;
  readonly amountRaw: bigint;
}

/** Result of one scan: the transfers found and how far the scan got. */
export interface SolanaIncoming {
  /** Incoming transfers, oldest first. */
  readonly transfers: readonly SolanaTransfer[];
  /** Newest slot seen among the scanned transactions (any kind), or null when there were none. */
  readonly newestSlot: bigint | null;
}

export abstract class SolanaTransfersPort {
  /** Slot of the newest transaction touching the wallet's token account(s) for `mint`, or null when there is none. */
  abstract latestSlot(owner: string, mint: string): Promise<bigint | null>;

  /**
   * Successful transfers of `mint` into `owner` in slots after `afterSlot` (exclusive), oldest first, plus the newest
   * slot scanned so the cursor also moves past transactions that aren't payments.
   * A slot cursor never expires, unlike a signature cursor: RPC nodes drop old transactions from their history,
   * after which "signatures until <old signature>" fails with "Transaction … not found".
   */
  abstract incoming(owner: string, mint: string, afterSlot: bigint): Promise<SolanaIncoming>;
}
