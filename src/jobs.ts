import { runHealthCycle } from './repo/health.ts';
import { generatePlannedWork } from './repo/workorders.ts';
import { makeCtx, type Runtime } from './repo/ctx.ts';

/** Periodic background work: sensor health evaluation and planned-maintenance generation. Safe to call repeatedly (idempotent). */
export function runJobs(rt: Runtime): { health: ReturnType<typeof runHealthCycle>; planned: number } {
  const now = rt.clock();
  const health = runHealthCycle(rt.db, now);
  let planned = 0;
  for (const o of rt.sys.all<{ id: string }>('SELECT id FROM organisations')) {
    planned += generatePlannedWork(makeCtx(rt, { id: 'system', orgId: o.id, role: 'org_admin', name: 'System', scopeOwner: null }));
  }
  return { health, planned };
}

export function startJobs(rt: Runtime): NodeJS.Timeout | null {
  if (rt.cfg.healthIntervalMs <= 0) return null;
  const t = setInterval(() => { try { runJobs(rt); } catch (e) { console.error('job failed', e instanceof Error ? e.message : e); } }, rt.cfg.healthIntervalMs);
  t.unref();
  return t;
}
