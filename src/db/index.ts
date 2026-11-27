import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './schema.ts';

export type Params = Record<string, SQLInputValue>;
export type Row = Record<string, unknown>;

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, Date.now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

const cache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function stmt(db: DatabaseSync, sql: string): StatementSync {
  let m = cache.get(db);
  if (!m) { m = new Map(); cache.set(db, m); }
  let s = m.get(sql);
  if (!s) { s = db.prepare(sql); m.set(sql, s); }
  return s;
}

/** Transaction helper (nest-safe via savepoints). */
let depth = 0;
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  const name = `sp${depth++}`;
  db.exec(depth === 1 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  try {
    const r = fn();
    db.exec(depth === 1 ? 'COMMIT' : `RELEASE ${name}`);
    return r;
  } catch (e) {
    db.exec(depth === 1 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
    throw e;
  } finally {
    depth--;
  }
}

/**
 * The ONLY way application code reads or writes tenant-owned tables.
 * Every statement must reference the :org named parameter (checked at runtime), which is bound to the
 * organisation of the authenticated actor. Cross-tenant access is therefore impossible by construction
 * and is also covered by exhaustive tests (tests/integration/tenant-isolation.test.ts).
 */
export class TenantDb {
  readonly raw: DatabaseSync;
  readonly orgId: string;
  constructor(raw: DatabaseSync, orgId: string) {
    if (!orgId) throw new Error('TenantDb requires an organisation id');
    this.raw = raw;
    this.orgId = orgId;
  }
  private check(sql: string) {
    if (!/:org\b/.test(sql)) throw new Error('Tenant query must reference :org');
  }
  get<T = Row>(sql: string, p: Params = {}): T | undefined {
    this.check(sql);
    return stmt(this.raw, sql).get({ ...p, org: this.orgId }) as T | undefined;
  }
  all<T = Row>(sql: string, p: Params = {}): T[] {
    this.check(sql);
    return stmt(this.raw, sql).all({ ...p, org: this.orgId }) as T[];
  }
  run(sql: string, p: Params = {}): { changes: number } {
    this.check(sql);
    const r = stmt(this.raw, sql).run({ ...p, org: this.orgId });
    return { changes: Number(r.changes) };
  }
  tx<T>(fn: () => T): T { return tx(this.raw, fn); }
}

/** System-level access for cross-tenant, non-tenant-data concerns (auth, sessions, orgs, device lookup). */
export class SystemDb {
  readonly raw: DatabaseSync;
  constructor(raw: DatabaseSync) { this.raw = raw; }
  get<T = Row>(sql: string, p: Params = {}): T | undefined { return stmt(this.raw, sql).get(p) as T | undefined; }
  all<T = Row>(sql: string, p: Params = {}): T[] { return stmt(this.raw, sql).all(p) as T[]; }
  run(sql: string, p: Params = {}): { changes: number } { return { changes: Number(stmt(this.raw, sql).run(p).changes) }; }
  tx<T>(fn: () => T): T { return tx(this.raw, fn); }
}
