import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS locks (id TEXT PRIMARY KEY, owner TEXT NOT NULL);`);
  }
  get(kind, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(row.data) : null;
  }
  set(kind, id, data) {
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data')
      .run(kind, id, JSON.stringify(data));
  }
  list(kind) {
    return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY id').all(kind).map(r => JSON.parse(r.data));
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  lock(id, owner) {
    try { this.db.prepare('INSERT INTO locks VALUES (?,?)').run(id, owner); }
    catch { throw new Error(`Operation ${id} is locked. Inspect the running process before using unlock ${id}.`); }
  }
  unlock(id, owner) {
    this.db.prepare('DELETE FROM locks WHERE id=? AND owner=?').run(id, owner);
  }
  close() { this.db.close(); }
}
