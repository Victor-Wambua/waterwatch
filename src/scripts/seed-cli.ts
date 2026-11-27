import { loadConfig } from '../core/config.ts';
import { openDb, SystemDb } from '../db/index.ts';
import { seedDemo } from './seed.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const rt = { db, sys: new SystemDb(db), cfg, clock: () => Date.now() };
if (rt.sys.get('SELECT 1 AS x FROM organisations LIMIT 1')) { console.log('Database already has data; not seeding.'); process.exit(0); }
const r = await seedDemo(rt, cfg.dataDir, cfg.seedPassword || undefined);
console.log('Seeded SYNTHETIC demonstration data.');
console.log('Password for all seeded users:', r.password);
console.log('Users:', JSON.stringify(r.users, null, 1));
console.log('Simulator credentials written to', r.deviceFile);
