import { z } from 'zod';
import { badRequest, conflict, notFound } from '../core/errors.ts';
import { parseCsv } from '../core/csv.ts';
import { validateCoords } from '../core/geo.ts';
import { ASSET_STATUSES, ASSET_TYPES, type AssetStatus, type AssetType } from '../domain/types.ts';
import { audit, need, newId, type Ctx } from './ctx.ts';

export const OWNER_TYPES = ['utility', 'county', 'community', 'vendor', 'ngo', 'private'] as const;
export const ASSET_TYPE_LABEL: Record<AssetType, string> = { borehole: 'Borehole', kiosk: 'Water kiosk', waterpoint: 'Community water point', pump: 'Pump station', tank: 'Storage tank', treatment: 'Treatment works', valve: 'Valve / distribution node', pipe: 'Pipeline segment' };
export const STATUS_LABEL: Record<AssetStatus, string> = { operational: 'Operational', degraded: 'Degraded', down: 'Out of service', contamination: 'Contamination alert', unknown: 'Status unknown' };

type AttrField = { key: string; label: string; kind: 'number' | 'text'; max: number };
export const ATTR_FIELDS: Record<AssetType, AttrField[]> = {
  borehole: [{ key: 'depth_m', label: 'Depth (m)', kind: 'number', max: 3000 }, { key: 'yield_m3h', label: 'Yield (m³/h)', kind: 'number', max: 2000 }, { key: 'pump_kw', label: 'Pump power (kW)', kind: 'number', max: 5000 }],
  kiosk: [{ key: 'operator', label: 'Operator / vendor', kind: 'text', max: 120 }, { key: 'taps', label: 'Number of taps', kind: 'number', max: 100 }],
  waterpoint: [{ key: 'source', label: 'Source (e.g. hand pump, spring)', kind: 'text', max: 80 }, { key: 'users_served', label: 'People served (estimate)', kind: 'number', max: 1000000 }],
  pump: [{ key: 'power_kw', label: 'Power (kW)', kind: 'number', max: 5000 }, { key: 'head_m', label: 'Head (m)', kind: 'number', max: 2000 }],
  tank: [{ key: 'volume_m3', label: 'Volume (m³)', kind: 'number', max: 1000000 }, { key: 'material', label: 'Material', kind: 'text', max: 60 }],
  treatment: [{ key: 'capacity_m3_day', label: 'Capacity (m³/day)', kind: 'number', max: 10000000 }, { key: 'process', label: 'Process', kind: 'text', max: 120 }],
  valve: [{ key: 'size_mm', label: 'Size (mm)', kind: 'number', max: 3000 }],
  pipe: [{ key: 'length_m', label: 'Length (m)', kind: 'number', max: 1000000 }, { key: 'diameter_mm', label: 'Diameter (mm)', kind: 'number', max: 3000 }, { key: 'material', label: 'Material', kind: 'text', max: 60 }]
};

export function cleanAttributes(type: AssetType, raw: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const fields = ATTR_FIELDS[type];
  for (const [k, v] of Object.entries(raw)) {
    if (v === '' || v === undefined || v === null) continue;
    const f = fields.find((x) => x.key === k);
    if (!f) throw badRequest(`Attribute "${k}" is not valid for a ${ASSET_TYPE_LABEL[type]}.`);
    if (f.kind === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > f.max) throw badRequest(`${f.label} must be a number between 0 and ${f.max}.`);
      out[k] = n;
    } else {
      const s = String(v).trim();
      if (s.length > f.max) throw badRequest(`${f.label} is too long.`);
      out[k] = s;
    }
  }
  return out;
}

export const assetInput = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/, 'Code must be 2-32 letters, digits, dash or underscore'),
  name: z.string().trim().min(2).max(120),
  type: z.enum(ASSET_TYPES),
  status: z.enum(ASSET_STATUSES).default('unknown'),
  owner_type: z.enum(OWNER_TYPES),
  owner_name: z.string().trim().min(1).max(120),
  lat: z.union([z.number(), z.string()]),
  lng: z.union([z.number(), z.string()]),
  install_year: z.union([z.number(), z.string()]).optional().transform((v) => (v === undefined || v === '' ? null : Number(v))),
  notes: z.string().trim().max(1000).optional().default(''),
  attributes: z.record(z.string(), z.unknown()).optional().default({})
});
export type AssetInput = z.input<typeof assetInput>;

export type AssetRow = {
  id: string; org_id: string; code: string; name: string; type: AssetType; status: AssetStatus; owner_type: string; owner_name: string; lat: number; lng: number;
  install_year: number | null; attributes: string; notes: string | null; origin: string; created_at: number; updated_at: number;
};
export type AssetListRow = AssetRow & { has_sensor: number; last_maintenance: string | null; open_reports: number };

function ownerScope(ctx: Ctx): { sql: string; p: Record<string, string> } {
  return ctx.actor.scopeOwner ? { sql: ' AND a.owner_name = :scope', p: { scope: ctx.actor.scopeOwner } } : { sql: '', p: {} };
}

export type AssetFilter = { q?: string; status?: string; type?: string };
export function listAssets(ctx: Ctx, f: AssetFilter = {}): AssetListRow[] {
  need(ctx, 'asset.read');
  const sc = ownerScope(ctx);
  let sql = `SELECT a.*,
    EXISTS (SELECT 1 FROM sensors s WHERE s.org_id = :org AND s.asset_id = a.id AND s.enabled = 1) AS has_sensor,
    (SELECT MAX(m.performed_on) FROM maintenance_records m WHERE m.org_id = :org AND m.asset_id = a.id) AS last_maintenance,
    (SELECT COUNT(*) FROM reports r WHERE r.org_id = :org AND r.asset_id = a.id AND r.status IN ('new','linked')) AS open_reports
    FROM assets a WHERE a.org_id = :org${sc.sql}`;
  const p: Record<string, string> = { ...sc.p };
  if (f.status && (ASSET_STATUSES as readonly string[]).includes(f.status)) { sql += ' AND a.status = :status'; p['status'] = f.status; }
  if (f.type && (ASSET_TYPES as readonly string[]).includes(f.type)) { sql += ' AND a.type = :type'; p['type'] = f.type; }
  if (f.q?.trim()) { sql += " AND (LOWER(a.name) LIKE :q ESCAPE '\\' OR LOWER(a.code) LIKE :q ESCAPE '\\')"; p['q'] = `%${f.q.trim().toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`; }
  sql += ' ORDER BY a.code';
  return ctx.t.all<AssetListRow>(sql, p);
}

export function getAsset(ctx: Ctx, id: string): AssetRow {
  const sc = ownerScope(ctx);
  const a = ctx.t.get<AssetRow>(`SELECT a.* FROM assets a WHERE a.org_id = :org AND a.id = :id${sc.sql}`, { id, ...sc.p });
  if (!a) throw notFound('Asset not found');
  return a;
}

/** Technicians may view assets they hold work orders for; everyone else needs asset.read. */
export function getAssetForViewer(ctx: Ctx, id: string): AssetRow {
  if (ctx.actor.role === 'technician') {
    const ok = ctx.t.get('SELECT 1 AS x FROM work_orders WHERE org_id = :org AND asset_id = :id AND assignee_id = :u', { id, u: ctx.actor.id });
    if (!ok) throw notFound('Asset not found');
    return ctx.t.get<AssetRow>('SELECT * FROM assets WHERE org_id = :org AND id = :id', { id }) as AssetRow;
  }
  need(ctx, 'asset.read');
  return getAsset(ctx, id);
}

function normalise(ctx: Ctx, raw: AssetInput) {
  const parsed = assetInput.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const d = parsed.data;
  const c = validateCoords(d.lat, d.lng, ctx.settings.bounds);
  if (!c.ok) throw badRequest(c.error);
  if (d.install_year !== null && (!Number.isInteger(d.install_year) || d.install_year < 1900 || d.install_year > new Date(ctx.now).getUTCFullYear() + 1)) throw badRequest('Install year is not valid.');
  return { ...d, lat: c.lat, lng: c.lng, attributes: cleanAttributes(d.type, d.attributes) };
}

export function createAsset(ctx: Ctx, raw: AssetInput, origin = 'user_submitted'): string {
  need(ctx, 'asset.write');
  const d = normalise(ctx, raw);
  if (ctx.t.get('SELECT 1 AS x FROM assets WHERE org_id = :org AND code = :c', { c: d.code })) throw conflict(`An asset with code ${d.code} already exists.`);
  const id = newId();
  ctx.t.run(`INSERT INTO assets (id, org_id, code, name, type, status, owner_type, owner_name, lat, lng, install_year, attributes, notes, origin, created_at, updated_at)
    VALUES (:id,:org,:code,:name,:type,:status,:ot,:on,:lat,:lng,:iy,:attr,:notes,:origin,:now,:now)`,
    { id, code: d.code, name: d.name, type: d.type, status: d.status, ot: d.owner_type, on: d.owner_name, lat: d.lat, lng: d.lng, iy: d.install_year, attr: JSON.stringify(d.attributes), notes: d.notes, origin, now: ctx.now });
  audit(ctx, 'asset.created', 'asset', id, { code: d.code, type: d.type });
  return id;
}

export function updateAsset(ctx: Ctx, id: string, raw: AssetInput): void {
  need(ctx, 'asset.write');
  const cur = getAsset(ctx, id);
  const d = normalise(ctx, raw);
  if (d.code !== cur.code && ctx.t.get('SELECT 1 AS x FROM assets WHERE org_id = :org AND code = :c AND id <> :id', { c: d.code, id })) throw conflict(`An asset with code ${d.code} already exists.`);
  if (d.status !== cur.status) {
    if (cur.status === 'contamination') throw badRequest('Use "Clear contamination alert" (with a recorded reason) to change a contamination status.');
  }
  ctx.t.run(`UPDATE assets SET code=:code, name=:name, type=:type, status=:status, owner_type=:ot, owner_name=:on, lat=:lat, lng=:lng, install_year=:iy, attributes=:attr, notes=:notes, updated_at=:now
    WHERE org_id = :org AND id = :id`, { id, code: d.code, name: d.name, type: d.type, status: d.status, ot: d.owner_type, on: d.owner_name, lat: d.lat, lng: d.lng, iy: d.install_year, attr: JSON.stringify(d.attributes), notes: d.notes, now: ctx.now });
  audit(ctx, 'asset.updated', 'asset', id, { before: { name: cur.name, status: cur.status, lat: cur.lat, lng: cur.lng, owner: cur.owner_name }, after: { name: d.name, status: d.status, lat: d.lat, lng: d.lng, owner: d.owner_name } });
}

/** Status change with a recorded reason. Leaving "contamination" requires a reason of at least 5 characters (optional lab reference). */
export function setAssetStatus(ctx: Ctx, id: string, status: AssetStatus, reason: string, opts: { system?: boolean } = {}): void {
  if (!opts.system) need(ctx, 'asset.write');
  const cur = getAsset(ctx, id);
  if (!(ASSET_STATUSES as readonly string[]).includes(status)) throw badRequest('Unknown status');
  if (cur.status === status) return;
  if (cur.status === 'contamination' && reason.trim().length < 5) throw badRequest('A recorded reason (at least 5 characters) is required to clear a contamination alert.');
  ctx.t.run('UPDATE assets SET status = :s, updated_at = :now WHERE org_id = :org AND id = :id', { s: status, now: ctx.now, id });
  audit(ctx, cur.status === 'contamination' ? 'asset.contamination_cleared' : 'asset.status_changed', 'asset', id, { from: cur.status, to: status, reason: reason.trim().slice(0, 300) });
}

export const maintenanceHistory = (ctx: Ctx, assetId: string) =>
  ctx.t.all<{ id: string; performed_on: string; summary: string; performed_by: string; cost_minor: number; work_order_id: string | null; origin: string }>(
    'SELECT id, performed_on, summary, performed_by, cost_minor, work_order_id, origin FROM maintenance_records WHERE org_id = :org AND asset_id = :a ORDER BY performed_on DESC, created_at DESC', { a: assetId });

export function addMaintenanceRecord(ctx: Ctx, assetId: string, input: { performed_on: string; summary: string; performed_by: string; cost_minor: number }): void {
  need(ctx, 'asset.write');
  getAsset(ctx, assetId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.performed_on) || Number.isNaN(Date.parse(input.performed_on))) throw badRequest('Date must be YYYY-MM-DD.');
  if (input.summary.trim().length < 3 || input.summary.length > 300) throw badRequest('Summary must be 3-300 characters.');
  if (!Number.isInteger(input.cost_minor) || input.cost_minor < 0) throw badRequest('Cost must be zero or more.');
  const id = newId();
  ctx.t.run('INSERT INTO maintenance_records (id, org_id, asset_id, performed_on, summary, performed_by, cost_minor, created_at) VALUES (:id,:org,:a,:d,:s,:p,:c,:now)',
    { id, a: assetId, d: input.performed_on, s: input.summary.trim(), p: input.performed_by.trim().slice(0, 120) || ctx.actor.name, c: input.cost_minor, now: ctx.now });
  audit(ctx, 'maintenance.recorded', 'asset', assetId, { record: id });
}

export const assetLinks = (ctx: Ctx) => ctx.t.all<{ from_asset: string; to_asset: string }>('SELECT from_asset, to_asset FROM asset_links WHERE org_id = :org');
export function linkAssets(ctx: Ctx, from: string, to: string): void {
  need(ctx, 'asset.write');
  getAsset(ctx, from); getAsset(ctx, to);
  if (from === to) throw badRequest('An asset cannot link to itself.');
  ctx.t.run('INSERT INTO asset_links (id, org_id, from_asset, to_asset) VALUES (:id,:org,:f,:t)', { id: newId(), f: from, t: to });
  audit(ctx, 'asset.linked', 'asset', from, { to });
}

// ---- CSV import ----
export const CSV_COLUMNS = ['code', 'name', 'type', 'status', 'owner_type', 'owner_name', 'lat', 'lng', 'install_year', 'notes'] as const;
export const CSV_MAX_BYTES = 1024 * 1024;
export const CSV_MAX_ROWS = 2000;
export type ImportPreview = { rows: number; valid: { line: number; input: AssetInput }[]; errors: { line: number; message: string }[] };

export function previewAssetCsv(ctx: Ctx, text: string): ImportPreview {
  need(ctx, 'asset.import');
  if (text.length > CSV_MAX_BYTES) throw badRequest('CSV file is too large (limit 1 MB).');
  let rows: string[][];
  try { rows = parseCsv(text); } catch (e) { throw badRequest((e as Error).message); }
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !['status', 'install_year', 'notes'].includes(c) && !header.includes(c));
  if (missing.length) throw badRequest(`Missing required column(s): ${missing.join(', ')}`);
  if (rows.length > CSV_MAX_ROWS) throw badRequest(`Too many rows (limit ${CSV_MAX_ROWS}).`);
  const valid: ImportPreview['valid'] = [];
  const errors: ImportPreview['errors'] = [];
  const seen = new Set<string>();
  rows.forEach((r, idx) => {
    const line = idx + 2;
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = (r[i] ?? '').trim(); });
    try {
      const input: AssetInput = { code: rec['code'] ?? '', name: rec['name'] ?? '', type: (rec['type'] ?? '') as AssetType, status: ((rec['status'] || 'unknown') as AssetStatus), owner_type: (rec['owner_type'] ?? '') as (typeof OWNER_TYPES)[number], owner_name: rec['owner_name'] ?? '', lat: rec['lat'] ?? '', lng: rec['lng'] ?? '', install_year: rec['install_year'] ?? '', notes: rec['notes'] ?? '', attributes: {} };
      const d = normalise(ctx, input);
      if (seen.has(d.code)) throw badRequest(`Duplicate code ${d.code} in file.`);
      if (ctx.t.get('SELECT 1 AS x FROM assets WHERE org_id = :org AND code = :c', { c: d.code })) throw badRequest(`Code ${d.code} already exists.`);
      seen.add(d.code);
      valid.push({ line, input });
    } catch (e) { errors.push({ line, message: (e as Error).message }); }
  });
  return { rows: rows.length, valid, errors };
}

/** All-or-nothing import of the valid rows once the file has no errors. */
export function importAssetCsv(ctx: Ctx, text: string): { imported: number } {
  need(ctx, 'asset.import');
  const p = previewAssetCsv(ctx, text);
  if (p.errors.length) throw badRequest(`Import refused: ${p.errors.length} row(s) have errors. Fix the file and retry.`, p.errors);
  ctx.t.tx(() => { for (const v of p.valid) createAsset(ctx, v.input, 'imported'); });
  audit(ctx, 'asset.imported', 'asset', undefined, { count: p.valid.length });
  return { imported: p.valid.length };
}
