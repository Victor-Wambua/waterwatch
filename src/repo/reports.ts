import { z } from 'zod';
import { badRequest, notFound, tooMany } from '../core/errors.ts';
import { haversineM, validateCoords } from '../core/geo.ts';
import { REPORT_CATEGORIES, type ReportCategory } from '../domain/types.ts';
import { setAssetStatus, getAsset } from './assets.ts';
import { audit, need, newId, nextRef, notify, usersWithRoles, type Ctx } from './ctx.ts';

export const CATEGORY_LABEL: Record<ReportCategory, { en: string; sw: string; icon: string }> = {
  no_water: { en: 'No water', sw: 'Hakuna maji', icon: 'drop-off' },
  low_pressure: { en: 'Low pressure', sw: 'Maji yanatoka polepole', icon: 'gauge' },
  leak: { en: 'Leak / burst pipe', sw: 'Bomba linavuja', icon: 'leak' },
  pump_failure: { en: 'Pump not working', sw: 'Pampu haifanyi kazi', icon: 'wrench' },
  contamination: { en: 'Water looks / smells unsafe', sw: 'Maji yanaonekana au kunuka vibaya', icon: 'alert' },
  damage: { en: 'Damaged facility', sw: 'Kituo kimeharibika', icon: 'damage' },
  access: { en: 'Access problem', sw: 'Tatizo la kufikia maji', icon: 'lock' }
};

export const reportInput = z.object({
  category: z.enum(REPORT_CATEGORIES),
  text: z.string().trim().max(1000).default(''),
  lang: z.enum(['en', 'sw']).default('en'),
  asset_id: z.string().trim().max(64).optional().nullable().transform((v) => v || null),
  lat: z.union([z.number(), z.string()]).optional().nullable(),
  lng: z.union([z.number(), z.string()]).optional().nullable(),
  accuracy_m: z.union([z.number(), z.string()]).optional().nullable(),
  client_uid: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/).optional().nullable().transform((v) => v || null),
  observed_at: z.union([z.number(), z.string()]).optional().nullable()
});
export type ReportInput = z.input<typeof reportInput>;

export type ReportRow = {
  id: string; org_id: string; ref: string; asset_id: string | null; category: ReportCategory; text: string; lang: string; lat: number | null; lng: number | null; accuracy_m: number | null;
  reporter_id: string | null; client_uid: string | null; status: string; work_order_id: string | null; duplicate_of: string | null; reject_reason: string | null; photo_id: string | null;
  origin: string; observed_at: number; created_at: number;
};
export type SubmitResult = { id: string; ref: string; contamination: boolean; deduplicated: boolean; queuedDuplicate: boolean };

const MAX_OFFLINE_AGE = 7 * 24 * 3600_000;

export function submitReport(ctx: Ctx, raw: ReportInput, photoId: string | null): SubmitResult {
  need(ctx, 'report.create');
  const parsed = reportInput.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const d = parsed.data;

  // Idempotent re-submission (offline queue retries): same reporter + client_uid returns the original report.
  if (d.client_uid) {
    const ex = ctx.t.get<ReportRow>('SELECT * FROM reports WHERE org_id = :org AND reporter_id = :u AND client_uid = :c', { u: ctx.actor.id, c: d.client_uid });
    if (ex) return { id: ex.id, ref: ex.ref, contamination: ex.category === 'contamination', deduplicated: true, queuedDuplicate: false };
  }
  // Anti-spam: per-reporter hourly cap.
  const recent = ctx.t.get<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE org_id = :org AND reporter_id = :u AND created_at > :since', { u: ctx.actor.id, since: ctx.now - 3600_000 })?.n ?? 0;
  if (recent >= ctx.settings.reportsPerHour) throw tooMany('You have sent many reports in the last hour. Please wait before sending more.');

  let lat: number | null = null, lng: number | null = null;
  if (d.lat !== undefined && d.lat !== null && d.lat !== '' && d.lng !== undefined && d.lng !== null && d.lng !== '') {
    const c = validateCoords(d.lat, d.lng, ctx.settings.bounds);
    if (!c.ok) throw badRequest(c.error);
    lat = c.lat; lng = c.lng;
  }
  let assetId = d.asset_id;
  if (assetId) {
    try { getAsset({ ...ctx, actor: { ...ctx.actor, role: 'dispatcher', scopeOwner: null } }, assetId); } catch { throw badRequest('Unknown water point.'); }
  }
  if (!assetId && lat !== null && lng !== null) {
    const all = ctx.t.all<{ id: string; lat: number; lng: number }>('SELECT id, lat, lng FROM assets WHERE org_id = :org');
    let best: { id: string; d: number } | null = null;
    for (const a of all) { const m = haversineM({ lat, lng }, a); if (m <= 200 && (!best || m < best.d)) best = { id: a.id, d: m }; }
    assetId = best?.id ?? null;
  }
  if (!assetId && lat === null) throw badRequest('Choose the water point or share your location.');

  // Same reporter, same asset and category inside the window: treat as a repeat of the same report.
  if (assetId && ctx.settings.duplicateWindowMin > 0) {
    const ex = ctx.t.get<ReportRow>('SELECT * FROM reports WHERE org_id = :org AND reporter_id = :u AND asset_id = :a AND category = :c AND created_at > :since ORDER BY created_at DESC LIMIT 1',
      { u: ctx.actor.id, a: assetId, c: d.category, since: ctx.now - ctx.settings.duplicateWindowMin * 60_000 });
    if (ex) return { id: ex.id, ref: ex.ref, contamination: ex.category === 'contamination', deduplicated: false, queuedDuplicate: true };
  }

  let observed = ctx.now;
  if (d.observed_at !== undefined && d.observed_at !== null && d.observed_at !== '') {
    const o = typeof d.observed_at === 'number' ? d.observed_at : Date.parse(String(d.observed_at));
    if (Number.isFinite(o) && o <= ctx.now + 300_000 && o >= ctx.now - MAX_OFFLINE_AGE) observed = o;
  }
  const acc = d.accuracy_m === undefined || d.accuracy_m === null || d.accuracy_m === '' ? null : Number(d.accuracy_m);
  const id = newId();
  const ref = nextRef(ctx, 'R');
  ctx.t.tx(() => {
    ctx.t.run(`INSERT INTO reports (id, org_id, ref, asset_id, category, text, lang, lat, lng, accuracy_m, reporter_id, client_uid, status, photo_id, origin, observed_at, created_at)
      VALUES (:id,:org,:ref,:a,:c,:t,:l,:lat,:lng,:acc,:u,:cu,'new',:p,'user_submitted',:obs,:now)`,
      { id, ref, a: assetId, c: d.category, t: d.text, l: d.lang, lat, lng, acc: acc !== null && Number.isFinite(acc) && acc >= 0 ? acc : null, u: ctx.actor.id, cu: d.client_uid, p: photoId, obs: observed, now: ctx.now });
    audit(ctx, 'report.submitted', 'report', id, { ref, category: d.category, asset: assetId });
    if (d.category === 'contamination') {
      if (assetId) {
        const a = getAsset({ ...ctx, actor: { ...ctx.actor, scopeOwner: null } }, assetId);
        if (a.status !== 'contamination') setAssetStatus({ ...ctx, actor: { ...ctx.actor, role: 'dispatcher' } }, assetId, 'contamination', 'Precautionary alert raised automatically by a community contamination report (not a lab result).', { system: true });
      }
      audit(ctx, 'report.contamination_escalated', 'report', id, { ref, priority: 'P1' });
      notify(ctx, usersWithRoles(ctx, ['dispatcher', 'org_admin']), 'contamination', `Contamination report ${ref}: high priority, create a P1 work order`, '/console/reports');
    }
  });
  return { id, ref, contamination: d.category === 'contamination', deduplicated: false, queuedDuplicate: false };
}

export type ReportListRow = ReportRow & { asset_name: string | null; asset_code: string | null; wo_ref: string | null; reporter_name: string | null; reporter_phone: string | null };
export function listReports(ctx: Ctx, f: { status?: string } = {}): ReportListRow[] {
  const seeAll = ctx.actor.role === 'dispatcher' || ctx.actor.role === 'org_admin' || ctx.actor.role === 'auditor';
  if (seeAll) need(ctx, 'report.read'); else need(ctx, 'report.read_own');
  const contact = ctx.actor.role === 'dispatcher' || ctx.actor.role === 'org_admin';
  let sql = `SELECT r.*, a.name AS asset_name, a.code AS asset_code, w.ref AS wo_ref, ${contact ? 'u.name' : 'NULL'} AS reporter_name, ${contact ? 'u.phone' : 'NULL'} AS reporter_phone
    FROM reports r LEFT JOIN assets a ON a.id = r.asset_id AND a.org_id = :org LEFT JOIN work_orders w ON w.id = r.work_order_id AND w.org_id = :org
    LEFT JOIN users u ON u.id = r.reporter_id AND u.org_id = :org WHERE r.org_id = :org`;
  const p: Record<string, string> = {};
  if (!seeAll) { sql += ' AND r.reporter_id = :me'; p['me'] = ctx.actor.id; }
  if (ctx.actor.scopeOwner) { sql += ' AND a.owner_name = :scope'; p['scope'] = ctx.actor.scopeOwner; }
  if (f.status && ['new', 'linked', 'duplicate', 'rejected'].includes(f.status)) { sql += ' AND r.status = :st'; p['st'] = f.status; }
  sql += " ORDER BY (r.category = 'contamination' AND r.status = 'new') DESC, r.created_at DESC LIMIT 500";
  return ctx.t.all<ReportListRow>(sql, p);
}

export function getReport(ctx: Ctx, id: string): ReportRow {
  const r = ctx.t.get<ReportRow>('SELECT * FROM reports WHERE org_id = :org AND id = :id', { id });
  if (!r) throw notFound('Report not found');
  return r;
}

export function markDuplicate(ctx: Ctx, id: string, duplicateOfId: string): void {
  need(ctx, 'report.triage');
  const r = getReport(ctx, id);
  const o = getReport(ctx, duplicateOfId);
  if (r.id === o.id) throw badRequest('A report cannot duplicate itself.');
  if (r.status !== 'new') throw badRequest('Only new reports can be marked as duplicates.');
  ctx.t.run("UPDATE reports SET status = 'duplicate', duplicate_of = :d, work_order_id = :wo WHERE org_id = :org AND id = :id", { id, d: o.id, wo: o.work_order_id });
  audit(ctx, 'report.marked_duplicate', 'report', id, { of: o.ref });
}

export function rejectReport(ctx: Ctx, id: string, reason: string): void {
  need(ctx, 'report.triage');
  const r = getReport(ctx, id);
  if (reason.trim().length < 5) throw badRequest('A reason of at least 5 characters is required.');
  if (r.status !== 'new') throw badRequest('Only new reports can be rejected.');
  if (r.category === 'contamination') throw badRequest('Contamination reports cannot be rejected; create a work order and record the outcome.');
  ctx.t.run("UPDATE reports SET status = 'rejected', reject_reason = :why WHERE org_id = :org AND id = :id", { id, why: reason.trim().slice(0, 300) });
  audit(ctx, 'report.rejected', 'report', id, { reason: reason.trim().slice(0, 300) });
}
