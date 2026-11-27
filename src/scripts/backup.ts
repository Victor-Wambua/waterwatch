import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { loadConfig } from '../core/config.ts';

/** Online-consistent backup: VACUUM INTO a new SQLite file plus a copy of the private photo directory. */
const cfg = loadConfig();
const dest = process.argv[2] ?? join('backups', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(dest, { recursive: true });
const db = new DatabaseSync(cfg.dbPath);
db.exec(`VACUUM INTO '${join(dest, 'waterwatch.sqlite').replace(/'/g, "''")}'`);
db.close();
try { cpSync(join(cfg.dataDir, 'photos'), join(dest, 'photos'), { recursive: true }); } catch { /* no photos yet */ }
void copyFileSync;
console.log('Backup written to', dest);
