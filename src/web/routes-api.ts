import { z } from 'zod';
import type { Context } from 'hono';
import { badRequest } from '../core/errors.ts';
import { verifyChain } from '../domain/audit.ts';
import { PRIORITIES } from '../domain/types.ts';
import { buildAnalytics } from '../repo/analytics.ts';
import { createAsset, getAsset, listAssets, updateAsset } from '../repo/assets.ts';
import { listSensors, sensorSeries, listAlerts } from '../repo/devices.ts';
import { handleIngest } from '../repo/ingest.ts';
import { runHealthCycle } from '../repo/health.ts';
import { savePhoto } from '../repo/photos.ts';
import { listReports, submitReport } from '../repo/reports.ts';
import { assignWorkOrder, createFromReports, getWorkOrder, listWorkOrders, transitionWorkOrder, woEvents, woMaterials } from '../repo/workorders.ts';
import { need } from '../repo/ctx.ts';
import { body, clientIp, csrfToken, ctxOf, limit, requireAuth, type AppT, type Deps, type Env } from './http.ts';
import { ffile, type Form } from './action.ts';
import { formToReport } from './routes-field.ts';
import { openapi } from './openapi.ts';

const json = (c: Context, data: unknown, status: 200 | 201 = 200) => c.json(data as Record<string, unknown>, status);

export function apiRoutes(app: AppT, d: Deps): void {
  app.get('/health', (c) => {
    let db = 'ok';
    try { d.rt.sys.get('SELECT 1 AS x'); } catch { db = 'error'; }
    return c.json({ status: db === 'ok' ? 'ok' : 'degraded', db, env: d.rt.cfg.env, time: new Date(d.rt.clock()).toISOString(), version: '0.1.0' }, db === 'ok' ? 200 : 503);
  });
  app.get('/api/v1/openapi.json', (c) => c.json(openapi as unknown as Record<string, unknown>));
  app.get('/api/v1/csrf', requireAuth(), (c) => json(c, { csrf: csrfToken(c as Context<Env>, d) }));

  // ---- ingestion (device auth, not session auth) ----
  app.post('/ingest/v1/readings', body(1024 * 1024 + 4096), async (c) => {
    const ip = clientIp(c, d.rt.cfg.trustProxy);
    const devKey = c.req.header('x-ww-device') ?? null;
    const lim = d.limiter.hit(`ingest:${devKey ?? ip}`, 120, 60_000);
    if (!lim.ok) { c.header('Retry-After', String(lim.retryAfterSec)); return c.json({ error: 'rate_limited', message: 'Too many requests for this device.' }, 429); }
    const raw = await c.req.text();
    const r = handleIngest(d.rt.db, d.rt.cfg, { deviceKey: devKey, timestamp: c.req.header('x-ww-timestamp') ?? null, nonce: c.req.header('x-ww-nonce') ?? null, signature: c.req.header('x-ww-signature') ?? null, rawBody: raw, now: d.rt.clock() });
    return c.json(r.body, r.status as 200);
  });

  // ---- reports ----
  app.post('/api/v1/reports', requireAuth({ perm: 'report.create' }), body(7 * 1024 * 1024), async (c) => {
    const ctx = ctxOf(c, d);
    limit(d, c, `upload:${ctx.actor.id}`, 40, 10 * 60_000);
    const ct = c.req.header('content-type') ?? '';
    let input; let photoId: string | null = null;
    if (ct.includes('application/json')) input = (await c.req.json()) as Parameters<typeof submitReport>[1];
    else { const f = (await c.req.parseBody()) as Form; input = formToReport(f); const file = ffile(f, 'photo'); if (file) photoId = await savePhoto(ctx, 'report', new Uint8Array(await file.arrayBuffer())); }
    const r = submitReport(ctx, input, photoId);
    return json(c, { id: r.id, ref: r.ref, contamination: r.contamination, deduplicated: r.deduplicated, repeat: r.queuedDuplicate }, r.deduplicated || r.queuedDuplicate ? 200 : 201);
  });
  app.get('/api/v1/reports', requireAuth(), (c) => {
    const rows = listReports(ctxOf(c, d), { status: c.req.query('status') });
    return json(c, { reports: rows.map((r) => ({ id: r.id, ref: r.ref, category: r.category, status: r.status, text: r.text, asset_id: r.asset_id, work_order: r.wo_ref, created_at: r.created_at, origin: r.origin, photo_id: r.photo_id, reporter: r.reporter_name ? { name: r.reporter_name, phone: r.reporter_phone } : undefined })) });
  });

  // ---- assets ----
  app.get('/api/v1/assets', requireAuth({ perm: 'asset.read' }), (c) => json(c, { assets: listAssets(ctxOf(c, d), { q: c.req.query('q'), status: c.req.query('status'), type: c.req.query('type') }) }));
  app.get('/api/v1/assets/:id', requireAuth({ perm: 'asset.read' }), (c) => json(c, { asset: getAsset(ctxOf(c, d), c.req.param('id') as string) }));
  app.post('/api/v1/assets', requireAuth({ perm: 'asset.write' }), body(32 * 1024), async (c) => json(c, { id: createAsset(ctxOf(c, d), (await c.req.json()) as never) }, 201));
  app.put('/api/v1/assets/:id', requireAuth({ perm: 'asset.write' }), body(32 * 1024), async (c) => { updateAsset(ctxOf(c, d), c.req.param('id') as string, (await c.req.json()) as never); return json(c, { ok: true }); });

  // ---- work orders ----
  app.get('/api/v1/work-orders', requireAuth(), (c) => {
    const ctx = ctxOf(c, d);
    return json(c, { work_orders: listWorkOrders(ctx, { status: c.req.query('status') }).map(woJson(ctx.actor.role !== 'technician' && ctx.actor.scopeOwner === null)) });
  });
  app.get('/api/v1/work-orders/:id', requireAuth(), (c) => {
    const ctx = ctxOf(c, d); const w = getWorkOrder(ctx, c.req.param('id') as string);
    return json(c, { work_order: woJson(ctx.actor.scopeOwner === null)(w), events: woEvents(ctx, w.id), materials: ctx.actor.scopeOwner === null ? woMaterials(ctx, w.id) : [] });
  });
  const createWo = z.object({ report_ids: z.array(z.string()).min(1).max(20), priority: z.enum(PRIORITIES).optional(), assignee_id: z.string().nullable().optional(), title: z.string().max(160).optional() });
  app.post('/api/v1/work-orders', requireAuth({ perm: 'wo.create' }), body(32 * 1024), async (c) => {
    const p = createWo.safeParse(await c.req.json());
    if (!p.success) throw badRequest(p.error.issues.map((i) => i.message).join('; '));
    return json(c, { id: createFromReports(ctxOf(c, d), { reportIds: p.data.report_ids, priority: p.data.priority, assigneeId: p.data.assignee_id, title: p.data.title }) }, 201);
  });
  app.post('/api/v1/work-orders/:id/assign', requireAuth({ perm: 'wo.assign' }), body(8 * 1024), async (c) => { const j = (await c.req.json()) as { assignee_id?: string }; assignWorkOrder(ctxOf(c, d), c.req.param('id') as string, j.assignee_id ?? ''); return json(c, { ok: true }); });
  app.post('/api/v1/work-orders/:id/transition', requireAuth(), body(8 * 1024), async (c) => {
    const j = (await c.req.json()) as { to?: string; note?: string };
    transitionWorkOrder(ctxOf(c, d), c.req.param('id') as string, { to: j.to as 'assigned', note: j.note });
    return json(c, { ok: true });
  });

  // ---- sensors, analytics, audit ----
  app.get('/api/v1/sensors', requireAuth({ perm: 'sensor.read' }), (c) => json(c, { sensors: listSensors(ctxOf(c, d)).map((s) => ({ ...s, simulated: s.origin === 'simulated' })), alerts: listAlerts(ctxOf(c, d), 'open') }));
  app.get('/api/v1/sensors/:id/readings', requireAuth({ perm: 'sensor.read' }), (c) => {
    const ctx = ctxOf(c, d); const to = Number(c.req.query('to') ?? ctx.now), from = Number(c.req.query('from') ?? to - 24 * 3600_000);
    return json(c, { readings: sensorSeries(ctx, c.req.param('id') as string, from, to, 1000) });
  });
  app.post('/api/v1/sensors/health-check', requireAuth({ perm: 'alert.manage' }), (c) => { const ctx = ctxOf(c, d); need(ctx, 'alert.manage'); return json(c, runHealthCycle(ctx.db, ctx.rt.clock())); });
  app.get('/api/v1/analytics', requireAuth({ perm: 'analytics.read' }), (c) => json(c, buildAnalytics(ctxOf(c, d), { weeks: Number(c.req.query('weeks') ?? 8) || 8 })));
  app.get('/api/v1/audit/verify', requireAuth({ perm: 'audit.read' }), (c) => { const ctx = ctxOf(c, d); return json(c, verifyChain(ctx.db, ctx.orgId)); });
}

const woJson = (showCost: boolean) => (w: ReturnType<typeof getWorkOrder>) => ({ id: w.id, ref: w.ref, asset_id: w.asset_id, asset: w.asset_name, title: w.title, priority: w.priority, status: w.status, kind: w.kind, assignee: w.assignee_name, sla: w.sla, created_at: w.created_at, completed_at: w.completed_at, origin: w.origin, ...(showCost ? { cost_minor: w.cost_minor } : {}) });
