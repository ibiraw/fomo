/**
 * @file solana-transfers.ts
 * @description SolanaTransfersPort — SPL token transfers received by a wallet (for payment detection).
 * @author Reborn1987
 */

/** One incoming transfer of a mint to the wallet. */
export interface SolanaTransfer {
  readonly signature: string;
  /** Owner wallet of the sending token account ('' when it can't be told). */
  readonly from: string;
  readonly amountRaw: bigint;
}

export abstract class SolanaTransfersPort {
  /** Newest transaction signature touching the wallet's token account(s) for `mint`, or null. */
  abstract latestSignature(owner: string, mint: string): Promise<string | null>;

  /** Successful transfers of `mint` into `owner` after `afterSignature` (exclusive), oldest first. */
  abstract incoming(owner: string, mint: string, afterSignature: string | null): Promise<SolanaTransfer[]>;
}
