/**
 * @file sqlite-auto-exit-store.adapter.ts
 * @description AutoExitStorePort on node:sqlite (same database file): one JSON row of auto take profit / stop loss
 *              settings per account (v2.1.0). A row that no longer validates (an older shape) reads as "never saved".
 * @author Reborn1987
 */

import { DatabaseSync } from 'node:sqlite';

import { AutoExitSettingsSchema, type AutoExitSettings } from '../../core/orders/auto-exit.js';
import { AutoExitStorePort } from '../../ports/auto-exit-store.js';

const SCHEMA = `
-- v2.1.0
CREATE TABLE IF NOT EXISTS auto_exit (
  user_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export class SqliteAutoExitStoreAdapter extends AutoExitStorePort {
  private readonly db: DatabaseSync;

  /** @param path SQLite file path, or ':memory:' for tests @param now clock */
  constructor(path: string, private readonly now: () => number = Date.now) {
    super();
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  /** The account's saved settings, or null. */
  get(userId: string): AutoExitSettings | null {
    const row = this.db.prepare('SELECT settings FROM auto_exit WHERE user_id = ?').get(userId) as { settings: string } | undefined;
    if (!row) return null;
    try {
      const parsed = AutoExitSettingsSchema.safeParse(JSON.parse(row.settings));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Saves the account's settings. */
  set(userId: string, settings: AutoExitSettings): void {
    this.db
      .prepare('INSERT INTO auto_exit (user_id, settings, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at')
      .run(userId, JSON.stringify(settings), this.now());
  }

  /** Closes the database. */
  close(): void {
    this.db.close();
  }
}
