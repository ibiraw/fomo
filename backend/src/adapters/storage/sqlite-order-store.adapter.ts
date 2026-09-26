/**
 * @file sqlite-order-store.adapter.ts
 * @description OrderStorePort adapter using Node's built-in SQLite (node:sqlite). Status changes are
 *              compare-and-set UPDATEs so an order can never be triggered or executed twice.
 * @author Reborn1987
 */

import { randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type { Order, OrderAmount, OrderStatus, ValidCreateOrder } from '../../core/orders/order.js';
import { OrderStorePort, type TransitionPatch } from '../../ports/order-store.js';

/** Raw row shape as stored in SQLite. */
interface OrderRow {
  id: string;
  user_id: string;
  mint: string;
  side: string;
  trigger_metric: string;
  trigger_direction: string;
  trigger_value: number;
  trigger_supply: number | null;
  amount_kind: string;
  amount_value: number;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  triggered_at_value: number | null;
  created_at: number;
  updated_at: number;
}

const SCHEMA = `
-- v1.0.0
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  trigger_metric TEXT NOT NULL CHECK (trigger_metric IN ('price','marketCap')),
  trigger_direction TEXT NOT NULL CHECK (trigger_direction IN ('below','above')),
  trigger_value REAL NOT NULL,
  amount_kind TEXT NOT NULL CHECK (amount_kind IN ('usd','percent')),
  amount_value REAL NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  last_error TEXT,
  triggered_at_value REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`;

/** v1.1.0: optional supply used for market-cap triggers (fomo's displayed supply). */
const MIGRATION_TRIGGER_SUPPLY = 'ALTER TABLE orders ADD COLUMN trigger_supply REAL';
/** v1.2.0: owning account. Orders created before accounts existed get `legacyUserId`. */
const MIGRATION_USER_ID = 'ALTER TABLE orders ADD COLUMN user_id TEXT';
const INDEX_USER = 'CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status)';

/** Maps a DB row to the domain Order. */
function toOrder(r: OrderRow): Order {
  return {
    id: r.id,
    userId: r.user_id,
    mint: r.mint,
    side: r.side as Order['side'],
    trigger: {
      metric: r.trigger_metric as Order['trigger']['metric'],
      direction: r.trigger_direction as Order['trigger']['direction'],
      value: r.trigger_value,
      supply: r.trigger_supply,
    },
    amount: { kind: r.amount_kind, value: r.amount_value } as OrderAmount,
    status: r.status as OrderStatus,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    lastError: r.last_error,
    triggeredAtValue: r.triggered_at_value,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class SqliteOrderStoreAdapter extends OrderStorePort {
  private readonly db: DatabaseSync;
  private readonly insertStmt: StatementSync;
  private readonly getStmt: StatementSync;

  /**
   * @param path SQLite file path, or ':memory:' for tests. @param now clock (injectable for tests).
   * @param legacyUserId owner given to orders stored before accounts existed
   */
  constructor(path: string, private readonly now: () => number = Date.now, legacyUserId = 'legacy') {
    super();
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    const cols = (this.db.prepare('PRAGMA table_info(orders)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('trigger_supply')) this.db.exec(MIGRATION_TRIGGER_SUPPLY);
    if (!cols.includes('user_id')) this.db.exec(MIGRATION_USER_ID);
    this.db.prepare('UPDATE orders SET user_id = ? WHERE user_id IS NULL').run(legacyUserId);
    this.db.exec(INDEX_USER);
    this.insertStmt = this.db.prepare(`
      INSERT INTO orders (id, user_id, mint, side, trigger_metric, trigger_direction, trigger_value, trigger_supply,
        amount_kind, amount_value, status, attempts, max_attempts, created_at, updated_at)
      VALUES (:id, :user, :mint, :side, :metric, :direction, :tvalue, :tsupply, :akind, :avalue, 'open', 0, :max, :now, :now)`);
    this.getStmt = this.db.prepare('SELECT * FROM orders WHERE id = ?');
  }

  /** Inserts a new open order for `userId`. */
  create(input: ValidCreateOrder, userId: string): Order {
    const id = randomUUID();
    this.insertStmt.run({
      id,
      user: userId,
      mint: input.mint,
      side: input.side,
      metric: input.trigger.metric,
      direction: input.trigger.direction,
      tvalue: input.trigger.value,
      tsupply: input.trigger.supply,
      akind: input.amount.kind,
      avalue: input.amount.value,
      max: input.maxAttempts,
      now: this.now(),
    });
    return this.get(id) as Order;
  }

  /** Fetches one order. */
  get(id: string): Order | null {
    const row = this.getStmt.get(id) as OrderRow | undefined;
    return row ? toOrder(row) : null;
  }

  /** Lists orders filtered by status and/or owner, newest first. */
  list(statuses?: readonly OrderStatus[], userId?: string): Order[] {
    const where: string[] = [];
    const args: string[] = [];
    if (statuses?.length) { where.push(`status IN (${statuses.map(() => '?').join(',')})`); args.push(...statuses); }
    if (userId !== undefined) { where.push('user_id = ?'); args.push(userId); }
    const sql = `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC`;
    return (this.db.prepare(sql).all(...args) as unknown as OrderRow[]).map(toOrder);
  }

  /** Compare-and-set status transition; returns null if the order was not in a `from` status. */
  transition(id: string, from: readonly OrderStatus[], to: OrderStatus, patch: TransitionPatch = {}): Order | null {
    const sets = ['status = ?', 'updated_at = ?'];
    const args: (string | number | null)[] = [to, this.now()];
    if (patch.attempts !== undefined) { sets.push('attempts = ?'); args.push(patch.attempts); }
    if (patch.lastError !== undefined) { sets.push('last_error = ?'); args.push(patch.lastError); }
    if (patch.triggeredAtValue !== undefined) { sets.push('triggered_at_value = ?'); args.push(patch.triggeredAtValue); }
    const res = this.db
      .prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`)
      .run(...args, id, ...from);
    return res.changes === 1 ? this.get(id) : null;
  }

  /** Closes the database. */
  close(): void {
    this.db.close();
  }
}
