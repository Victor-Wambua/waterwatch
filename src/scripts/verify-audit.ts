import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../core/config.ts';
import { verifyChain } from '../domain/audit.ts';

const cfg = loadConfig();
const db = new DatabaseSync(process.argv[2] ?? cfg.dbPath, { readOnly: true });
const orgs = db.prepare('SELECT id, name FROM organisations').all() as { id: string; name: string }[];
let bad = 0;
for (const o of [{ id: null, name: 'platform' }, ...orgs]) {
  const r = verifyChain(db, o.id);
  console.log(`${o.name}: ${r.ok ? 'OK' : 'BROKEN at ' + r.brokenAtSeq + ' (' + r.reason + ')'} entries=${r.checked} head=${r.head}`);
  if (!r.ok) bad++;
}
process.exit(bad ? 1 : 0);
