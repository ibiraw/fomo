/**
 * @file sqlite-activity-store.adapter.ts
 * @description ActivityStorePort on node:sqlite (same database file): the permanent activity log, whose undelivered
 *              rows are the Telegram outbox.
 * @author Reborn1987
 */

import { DatabaseSync } from 'node:sqlite';

import { ActivityStorePort, type ActivityEntry, type ActivityKind } from '../../ports/activity.js';

const SCHEMA = `
-- v1.0.0
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_activity_unsent ON activity(sent_at, id);
`;

export class SqliteActivityStoreAdapter extends ActivityStorePort {
  private readonly db: DatabaseSync;

  /** @param path SQLite file path, or ':memory:' for tests */
  constructor(path: string) {
    super();
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  /** Appends an entry. */
  add(at: number, kind: ActivityKind, text: string): void {
    this.db.prepare('INSERT INTO activity (at, kind, text) VALUES (?, ?, ?)').run(at, kind, text);
  }

  /** Oldest undelivered entries. */
  pending(limit: number): ActivityEntry[] {
    return this.db.prepare('SELECT id, at, kind, text FROM activity WHERE sent_at IS NULL ORDER BY id LIMIT ?').all(limit) as unknown as ActivityEntry[];
  }

  /** Marks entries delivered. */
  markSent(ids: readonly number[], at: number): void {
    if (ids.length === 0) return;
    this.db.prepare(`UPDATE activity SET sent_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(at, ...ids);
  }

  /** Closes the database. */
  close(): void {
    this.db.close();
  }
}
