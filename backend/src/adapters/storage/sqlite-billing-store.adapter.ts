/**
 * @file sqlite-billing-store.adapter.ts
 * @description BillingStorePort on node:sqlite (same database file as orders and accounts). Payment ids are unique,
 *              so a transfer seen twice (live + backfill, or Arc's two log sources) is credited once.
 * @author Reborn1987
 */

import { DatabaseSync } from 'node:sqlite';

import { BillingStorePort, type Invoice, type PaidAccess, type PaymentRecord } from '../../ports/billing-store.js';

const SCHEMA = `
-- v1.0.0
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  asset TEXT NOT NULL,
  sender TEXT NOT NULL,
  amount REAL NOT NULL,
  credit_usd REAL NOT NULL,
  user_id TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE TABLE IF NOT EXISTS unlocks (
  user_id TEXT PRIMARY KEY,
  unlocked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  user_id TEXT PRIMARY KEY,
  code INTEGER NOT NULL,
  token_price_usd REAL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_code ON invoices(code, expires_at);
CREATE TABLE IF NOT EXISTS paid_access (
  user_id TEXT PRIMARY KEY,
  paid_until INTEGER NOT NULL,
  spent_usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_cursors (
  chain TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

interface PaymentRow {
  id: string;
  chain: string;
  asset: string;
  sender: string;
  amount: number;
  credit_usd: number;
  user_id: string | null;
  received_at: number;
}

interface InvoiceRow {
  user_id: string;
  code: number;
  token_price_usd: number | null;
  expires_at: number;
}

const toPayment = (r: PaymentRow): PaymentRecord => ({
  id: r.id, chain: r.chain, asset: r.asset, from: r.sender, amount: r.amount, creditUsd: r.credit_usd, userId: r.user_id, receivedAt: r.received_at,
});
const toInvoice = (r: InvoiceRow): Invoice => ({ userId: r.user_id, code: r.code, tokenPriceUsd: r.token_price_usd, expiresAt: r.expires_at });

export class SqliteBillingStoreAdapter extends BillingStorePort {
  private readonly db: DatabaseSync;

  /** @param path SQLite file path, or ':memory:' for tests */
  constructor(path: string) {
    super();
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  /** Inserts unless the id exists. */
  addPayment(p: PaymentRecord): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO payments (id, chain, asset, sender, amount, credit_usd, user_id, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, p.chain, p.asset, p.from, p.amount, p.creditUsd, p.userId, p.receivedAt);
    return res.changes === 1;
  }

  /** Sum of the account's credits. */
  creditUsd(userId: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(credit_usd), 0) AS total FROM payments WHERE user_id = ?').get(userId) as { total: number };
    return row.total;
  }

  /** Payments without an account. */
  unmatched(): PaymentRecord[] {
    return (this.db.prepare('SELECT * FROM payments WHERE user_id IS NULL ORDER BY received_at DESC').all() as unknown as PaymentRow[]).map(toPayment);
  }

  /** Unlock time or null. */
  unlockedAt(userId: string): number | null {
    const row = this.db.prepare('SELECT unlocked_at FROM unlocks WHERE user_id = ?').get(userId) as { unlocked_at: number } | undefined;
    return row?.unlocked_at ?? null;
  }

  /** Records the unlock once. */
  unlock(userId: string, at: number): void {
    this.db.prepare('INSERT OR IGNORE INTO unlocks (user_id, unlocked_at) VALUES (?, ?)').run(userId, at);
  }

  /** Paid access or null. */
  access(userId: string): PaidAccess | null {
    const row = this.db.prepare('SELECT paid_until, spent_usd FROM paid_access WHERE user_id = ?').get(userId) as { paid_until: number; spent_usd: number } | undefined;
    return row ? { paidUntil: row.paid_until, spentUsd: row.spent_usd } : null;
  }

  /** Upserts paid access. */
  setAccess(userId: string, a: PaidAccess): void {
    this.db
      .prepare('INSERT INTO paid_access (user_id, paid_until, spent_usd) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET paid_until = excluded.paid_until, spent_usd = excluded.spent_usd')
      .run(userId, a.paidUntil, a.spentUsd);
  }

  /** Accounts with credited payments. */
  usersWithPayments(): string[] {
    return (this.db.prepare('SELECT DISTINCT user_id FROM payments WHERE user_id IS NOT NULL').all() as { user_id: string }[]).map((r) => r.user_id);
  }

  /** Valid invoice of an account. */
  activeInvoice(userId: string, now: number): Invoice | null {
    const row = this.db.prepare('SELECT * FROM invoices WHERE user_id = ? AND expires_at > ?').get(userId, now) as InvoiceRow | undefined;
    return row ? toInvoice(row) : null;
  }

  /** Valid invoice with a code. */
  invoiceByCode(code: number, now: number): Invoice | null {
    const row = this.db.prepare('SELECT * FROM invoices WHERE code = ? AND expires_at > ?').get(code, now) as InvoiceRow | undefined;
    return row ? toInvoice(row) : null;
  }

  /** Codes of valid invoices. */
  codesInUse(now: number): Set<number> {
    return new Set((this.db.prepare('SELECT code FROM invoices WHERE expires_at > ?').all(now) as { code: number }[]).map((r) => r.code));
  }

  /** Upserts the account's invoice. */
  saveInvoice(inv: Invoice): void {
    this.db
      .prepare('INSERT INTO invoices (user_id, code, token_price_usd, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET code = excluded.code, token_price_usd = excluded.token_price_usd, expires_at = excluded.expires_at')
      .run(inv.userId, inv.code, inv.tokenPriceUsd, inv.expiresAt);
  }

  /** Stored cursor. */
  cursor(chain: string): string | null {
    const row = this.db.prepare('SELECT value FROM payment_cursors WHERE chain = ?').get(chain) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /** Upserts a cursor. */
  setCursor(chain: string, value: string): void {
    this.db.prepare('INSERT INTO payment_cursors (chain, value) VALUES (?, ?) ON CONFLICT(chain) DO UPDATE SET value = excluded.value').run(chain, value);
  }

  /** Drops unlock and invoice; unassigns payments. */
  forgetUser(userId: string): void {
    this.db.prepare('DELETE FROM unlocks WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM invoices WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM paid_access WHERE user_id = ?').run(userId);
    this.db.prepare('UPDATE payments SET user_id = NULL WHERE user_id = ?').run(userId);
  }

  /** Closes the database. */
  close(): void {
    this.db.close();
  }
}
