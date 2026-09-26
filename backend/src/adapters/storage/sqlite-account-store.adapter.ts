/**
 * @file sqlite-account-store.adapter.ts
 * @description AccountStorePort on node:sqlite (same database file as the orders). Stores secret hashes only.
 * @author Reborn1987
 */

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { AccountStorePort, type Account, type UserWallets } from '../../ports/account-store.js';

interface AccountRow {
  id: string;
  secret_hash: string;
  solana_wallet: string | null;
  evm_wallet: string | null;
  created_at: number;
  last_seen_at: number;
}

const SCHEMA = `
-- v1.0.0
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  solana_wallet TEXT,
  evm_wallet TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_solana ON accounts(solana_wallet);
CREATE INDEX IF NOT EXISTS idx_accounts_evm ON accounts(evm_wallet);
`;

/** Maps a row to the domain Account. */
function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    wallets: { solana: r.solana_wallet, evm: r.evm_wallet as `0x${string}` | null },
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  };
}

export class SqliteAccountStoreAdapter extends AccountStorePort {
  private readonly db: DatabaseSync;

  /** @param path SQLite file path, or ':memory:' for tests @param now clock */
  constructor(path: string, private readonly now: () => number = Date.now) {
    super();
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  /** Looks up by secret hash (unique index). */
  findBySecretHash(secretHash: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE secret_hash = ?').get(secretHash) as AccountRow | undefined;
    return row ? toAccount(row) : null;
  }

  /** Looks up by id. */
  get(id: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
    return row ? toAccount(row) : null;
  }

  /** Inserts a new account. */
  create(secretHash: string, wallets: UserWallets, id: string = randomUUID()): Account {
    const now = this.now();
    this.db
      .prepare('INSERT INTO accounts (id, secret_hash, solana_wallet, evm_wallet, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, secretHash, wallets.solana, wallets.evm, now, now);
    return this.get(id) as Account;
  }

  /** Replaces the wallets. */
  setWallets(id: string, wallets: UserWallets): Account | null {
    const res = this.db.prepare('UPDATE accounts SET solana_wallet = ?, evm_wallet = ? WHERE id = ?').run(wallets.solana, wallets.evm, id);
    return res.changes === 1 ? this.get(id) : null;
  }

  /** Most recently seen account with this wallet. */
  findByWallet(kind: 'solana' | 'evm', address: string): Account | null {
    const col = kind === 'solana' ? 'solana_wallet' : 'evm_wallet';
    const row = this.db.prepare(`SELECT * FROM accounts WHERE ${col} = ? ORDER BY last_seen_at DESC LIMIT 1`).get(address) as AccountRow | undefined;
    return row ? toAccount(row) : null;
  }

  /** Updates last_seen_at. */
  touch(id: string): void {
    this.db.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').run(this.now(), id);
  }

  /** Deletes the account. */
  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes === 1;
  }

  /** Closes the database. */
  close(): void {
    this.db.close();
  }
}
