import { serve } from '@hono/node-server';
import { loadConfig } from './core/config.ts';
import { openDb, SystemDb } from './db/index.ts';
import { createApp } from './web/app.ts';
import { startJobs } from './jobs.ts';
import { seedDemo } from './scripts/seed.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const rt = { db, sys: new SystemDb(db), cfg, clock: () => Date.now() };

if (cfg.seedOnStart && !rt.sys.get('SELECT 1 AS x FROM organisations LIMIT 1')) {
  if (cfg.env === 'production') throw new Error('Refusing to load synthetic demo data in production');
  const r = await seedDemo(rt, cfg.dataDir, cfg.seedPassword || undefined);
  console.log('Seeded SYNTHETIC demonstration data. Users: see docs/USER-GUIDE.md (seed password is the one you configured or the one printed by npm run seed).');
  if (!cfg.seedPassword) console.log('Generated seed password:', r.password);
}

const app = createApp(rt);
const timer = startJobs(rt);
const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (i) => console.log(`WaterWatch listening on http://${cfg.host}:${i.port} (env=${cfg.env})`));
const stop = () => { if (timer) clearInterval(timer); server.close(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* ignore */ } process.exit(0); }); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
