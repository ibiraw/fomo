/**
 * @file sqlite-account-store.adapter.ts
 * @description AccountStorePort on node:sqlite (same database file as the orders). Stores secret hashes only.
 * @author Reborn1987
 */

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { newShortId } from '../../core/accounts/short-id.js';
import { AccountStorePort, type Account, type FomoProfile, type UserWallets } from '../../ports/account-store.js';

interface AccountRow {
  id: string;
  short_id: string;
  secret_hash: string;
  solana_wallet: string | null;
  evm_wallet: string | null;
  fomo_username: string | null;
  fomo_user_id: string | null;
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
    shortId: r.short_id,
    wallets: { solana: r.solana_wallet, evm: r.evm_wallet as `0x${string}` | null },
    fomoUsername: r.fomo_username ?? null,
    fomoUserId: r.fomo_user_id ?? null,
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
    // v1.1.0: short readable ids; accounts made before get one now.
    const cols = (this.db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('short_id')) this.db.exec('ALTER TABLE accounts ADD COLUMN short_id TEXT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_short_id ON accounts(short_id)');
    // v1.3.0: the user's fomo username (monitoring shows "LM-7K3Q2P (@name)").
    if (!cols.includes('fomo_username')) this.db.exec('ALTER TABLE accounts ADD COLUMN fomo_username TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_fomo_username ON accounts(fomo_username)');
    // v1.4.0: fomo's unique user id (usernames aren't unique over time).
    if (!cols.includes('fomo_user_id')) this.db.exec('ALTER TABLE accounts ADD COLUMN fomo_user_id TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_fomo_user_id ON accounts(fomo_user_id)');
    for (const { id } of this.db.prepare('SELECT id FROM accounts WHERE short_id IS NULL').all() as { id: string }[]) {
      this.insertWithShortId((shortId) => this.db.prepare('UPDATE accounts SET short_id = ? WHERE id = ?').run(shortId, id));
    }
  }

  /** Runs `write` with a fresh short id, retrying on the (rare) collision. */
  private insertWithShortId(write: (shortId: string) => void): void {
    for (let attempt = 0; ; attempt++) {
      try {
        write(newShortId());
        return;
      } catch (err) {
        if (attempt >= 5 || !/UNIQUE constraint failed: accounts\.short_id/.test(String(err))) throw err;
      }
    }
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

  /** Inserts a new account with a unique short id. */
  create(secretHash: string, wallets: UserWallets, id: string = randomUUID()): Account {
    const now = this.now();
    this.insertWithShortId((shortId) =>
      this.db
        .prepare('INSERT INTO accounts (id, short_id, secret_hash, solana_wallet, evm_wallet, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, shortId, secretHash, wallets.solana, wallets.evm, now, now),
    );
    return this.get(id) as Account;
  }

  /** Replaces the wallets. */
  setWallets(id: string, wallets: UserWallets): Account | null {
    const res = this.db.prepare('UPDATE accounts SET solana_wallet = ?, evm_wallet = ? WHERE id = ?').run(wallets.solana, wallets.evm, id);
    return res.changes === 1 ? this.get(id) : null;
  }

  /** Sets the fomo username and user id. */
  setFomoProfile(id: string, profile: FomoProfile): Account | null {
    const res = this.db.prepare('UPDATE accounts SET fomo_username = ?, fomo_user_id = ? WHERE id = ?').run(profile.username, profile.userId, id);
    return res.changes === 1 ? this.get(id) : null;
  }

  /** Accounts with this wallet, most recently seen first. */
  findByWallet(kind: 'solana' | 'evm', address: string): Account[] {
    const col = kind === 'solana' ? 'solana_wallet' : 'evm_wallet';
    return (this.db.prepare(`SELECT * FROM accounts WHERE ${col} = ? ORDER BY last_seen_at DESC`).all(address) as unknown as AccountRow[]).map(toAccount);
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
