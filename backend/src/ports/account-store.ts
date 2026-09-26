/**
 * @file account-store.ts
 * @description AccountStorePort — anonymous accounts: a hashed secret, the user's public wallet addresses, timestamps.
 * @author Reborn1987
 */

/** The user's fomo wallets (public addresses). The EVM address is the same on every EVM chain. */
export interface UserWallets {
  readonly solana: string | null;
  readonly evm: `0x${string}` | null;
}

export interface Account {
  readonly id: string;
  /** Short readable id shown to the user and in monitoring ("AF-7K3Q2P"). */
  readonly shortId: string;
  readonly wallets: UserWallets;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

/** Abstract account storage. Adapter: SqliteAccountStoreAdapter. Secrets are never stored, only their hashes. */
export abstract class AccountStorePort {
  /** Account whose secret hashes to `secretHash`, or null. */
  abstract findBySecretHash(secretHash: string): Account | null;

  /** Account by id, or null. */
  abstract get(id: string): Account | null;

  /** Creates an account (a fixed `id` is used for the migrated legacy account). */
  abstract create(secretHash: string, wallets: UserWallets, id?: string): Account;

  /** Replaces the account's wallets; returns the updated account (null if it doesn't exist). */
  abstract setWallets(id: string, wallets: UserWallets): Account | null;

  /** Accounts using this Solana or EVM (lowercase) address, most recently active first. */
  abstract findByWallet(kind: 'solana' | 'evm', address: string): Account[];

  /** Records activity. */
  abstract touch(id: string): void;

  /** Deletes the account; true when it existed. */
  abstract delete(id: string): boolean;
}
