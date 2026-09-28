/**
 * @file solana-accounts.ts
 * @description SolanaAccountsPort — raw account reads and live account subscriptions.
 * @author Reborn1987
 */

/** Token mint supply info. */
export interface MintSupply {
  readonly amount: bigint;
  readonly decimals: number;
}

/** Callback receiving the latest raw account bytes and the slot they were observed at. */
export type AccountListener = (data: Uint8Array, slot: bigint) => void;

/** Handle for an account subscription. */
export interface AccountSubscription {
  stop(): void;
}

/** Abstract Solana RPC access. Adapter: KitSolanaAccountsAdapter (Chainstack HTTP + WSS). */
export abstract class SolanaAccountsPort {
  /** Returns account bytes, or null when the account does not exist. */
  abstract getAccount(address: string): Promise<Uint8Array | null>;

  /** Returns the mint's current supply and decimals. AccountNotFoundError when the address is not a token mint. */
  abstract getMintSupply(mint: string): Promise<MintSupply>;

  /** Total raw amount of `mint` held by `owner` across all its token accounts (0 if none). */
  abstract getTokenBalance(owner: string, mint: string): Promise<bigint>;

  /** Addresses of a program's accounts of `dataSize` bytes whose bytes at `offset` equal the address `bytes`. */
  abstract findProgramAccounts(program: string, dataSize: number, match: { readonly offset: number; readonly bytes: string }): Promise<string[]>;

  /** Every token account of the mint as owner + raw amount (one entry per account; an owner may have several). */
  abstract getTokenHolders(mint: string): Promise<readonly { readonly owner: string; readonly amount: bigint }[]>;

  /**
   * Streams account data changes. Implementations must reconnect on drop and re-deliver
   * the current state after reconnecting so no update is silently missed.
   */
  abstract subscribe(address: string, listener: AccountListener): AccountSubscription;
}
