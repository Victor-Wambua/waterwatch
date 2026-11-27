import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { encryptSecret, randomToken } from '../core/crypto.ts';
import { badRequest, notFound } from '../core/errors.ts';
import { HEALTH_LABEL } from '../domain/health.ts';
import { SENSOR_KINDS } from '../domain/types.ts';
import { getAsset } from './assets.ts';
import { audit, need, newId, type Ctx } from './ctx.ts';

export const KIND_LABEL: Record<string, string> = { flow: 'Flow', level: 'Tank level', pump_status: 'Pump status', pressure: 'Pressure', quality: 'Water quality' };
export const KIND_DEFAULT_UNIT: Record<string, string> = { flow: 'm³/h', level: '% full', pump_status: 'on/off', pressure: 'bar', quality: '' };
export { HEALTH_LABEL };

export const sensorInput = z.object({
  key: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,40}$/, 'Sensor key: letters, digits, . _ - (max 40)'),
  kind: z.enum(SENSOR_KINDS),
  param: z.string().trim().max(40).optional().default(''),
  unit: z.string().trim().min(1).max(20),
  role: z.enum(['none', 'production', 'distribution']).default('none'),
  expected_interval_s: z.number().int().min(10).max(86400),
  min_valid: z.number().nullable().optional().default(null),
  max_valid: z.number().nullable().optional().default(null),
  stuck_count: z.number().int().min(3).max(1000).default(12),
  asset_id: z.string().nullable().optional().default(null)
}).refine((s) => s.min_valid === null || s.max_valid === null || s.min_valid < s.max_valid, 'min_valid must be below max_valid')
  .refine((s) => s.kind !== 'quality' || s.param.length > 0, 'Water-quality sensors need a parameter name (e.g. turbidity)');
export type SensorInput = z.input<typeof sensorInput>;

export const deviceInput = z.object({ name: z.string().trim().min(2).max(100), asset_id: z.string().nullable().optional().default(null), origin: z.enum(['real', 'simulated']).default('real'), sensors: z.array(z.unknown()).max(20).default([]) });

const newDeviceKey = () => 'dev_' + randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').toLowerCase();
const newSecret = () => randomToken(32);

export function registerDevice(ctx: Ctx, raw: z.input<typeof deviceInput>): { id: string; deviceKey: string; secret: string } {
  need(ctx, 'device.manage');
  const p = deviceInput.safeParse(raw);
  if (!p.success) throw badRequest(p.error.issues.map((i) => i.message).join('; '));
  const d = p.data;
  if (d.origin === 'simulated' && !ctx.rt.cfg.allowSimulated) throw badRequest('Simulated devices are not allowed in this environment.');
  if (d.asset_id) getAsset({ ...ctx, actor: { ...ctx.actor, scopeOwner: null } }, d.asset_id);
  const sensors = d.sensors.map((s) => { const r = sensorInput.safeParse(s); if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; ')); return r.data; });
  const id = newId(), deviceKey = newDeviceKey(), secret = newSecret();
  ctx.t.tx(() => {
    ctx.t.run('INSERT INTO devices (id, org_id, device_key, name, asset_id, origin, secret_enc, created_at) VALUES (:id,:org,:k,:n,:a,:o,:s,:now)',
      { id, k: deviceKey, n: d.name, a: d.asset_id, o: d.origin, s: encryptSecret(secret, ctx.rt.cfg.secretKey), now: ctx.now });
    for (const s of sensors) insertSensor(ctx, id, d.asset_id, s);
    audit(ctx, 'device.registered', 'device', id, { name: d.name, origin: d.origin, sensors: sensors.length });
  });
  return { id, deviceKey, secret };
}

function insertSensor(ctx: Ctx, deviceId: string, deviceAsset: string | null, s: z.output<typeof sensorInput>): string {
  const id = newId();
  const assetId = s.asset_id ?? deviceAsset;
  if (assetId) getAsset({ ...ctx, actor: { ...ctx.actor, scopeOwner: null } }, assetId);
  ctx.t.run(`INSERT INTO sensors (id, org_id, device_id, asset_id, key, kind, param, unit, role, expected_interval_s, min_valid, max_valid, stuck_count, validation_required, created_at)
    VALUES (:id,:org,:d,:a,:key,:kind,:param,:unit,:role,:iv,:mn,:mx,:sc,:vr,:now)`,
    { id, d: deviceId, a: assetId, key: s.key, kind: s.kind, param: s.param || null, unit: s.unit, role: s.role, iv: s.expected_interval_s, mn: s.min_valid, mx: s.max_valid, sc: s.stuck_count, vr: s.kind === 'quality' ? 1 : 0, now: ctx.now });
  return id;
}

export function addSensor(ctx: Ctx, deviceId: string, raw: SensorInput): string {
  need(ctx, 'device.manage');
  const dev = ctx.t.get<{ asset_id: string | null }>('SELECT asset_id FROM devices WHERE org_id = :org AND id = :id', { id: deviceId });
  if (!dev) throw notFound('Device not found');
  const r = sensorInput.safeParse(raw);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  if (ctx.t.get('SELECT 1 AS x FROM sensors WHERE org_id = :org AND device_id = :d AND key = :k', { d: deviceId, k: r.data.key })) throw badRequest('A sensor with that key already exists on this device.');
  const id = insertSensor(ctx, deviceId, dev.asset_id, r.data);
  audit(ctx, 'sensor.added', 'sensor', id, { device: deviceId, kind: r.data.kind });
  return id;
}

/** Issues a new secret (shown once). The old secret stops working immediately. */
export function rotateDeviceSecret(ctx: Ctx, deviceId: string): string {
  need(ctx, 'device.manage');
  const secret = newSecret();
  const r = ctx.t.run("UPDATE devices SET secret_enc = :s, secret_version = secret_version + 1 WHERE org_id = :org AND id = :id AND status = 'active'", { s: encryptSecret(secret, ctx.rt.cfg.secretKey), id: deviceId });
  if (r.changes === 0) throw notFound('Active device not found');
  audit(ctx, 'device.secret_rotated', 'device', deviceId);
  return secret;
}
export function revokeDevice(ctx: Ctx, deviceId: string): void {
  need(ctx, 'device.manage');
  const r = ctx.t.run("UPDATE devices SET status = 'revoked', revoked_at = :now WHERE org_id = :org AND id = :id AND status = 'active'", { now: ctx.now, id: deviceId });
  if (r.changes === 0) throw notFound('Active device not found');
  audit(ctx, 'device.revoked', 'device', deviceId);
}

export type DeviceListRow = { id: string; device_key: string; name: string; asset_id: string | null; asset_name: string | null; origin: 'real' | 'simulated'; status: string; battery_pct: number | null; rssi_dbm: number | null; last_seen_at: number | null; secret_version: number; sensor_count: number };
export const listDevices = (ctx: Ctx): DeviceListRow[] => {
  need(ctx, 'sensor.read');
  return ctx.t.all<DeviceListRow>(`SELECT d.id, d.device_key, d.name, d.asset_id, a.name AS asset_name, d.origin, d.status, d.battery_pct, d.rssi_dbm, d.last_seen_at, d.secret_version,
    (SELECT COUNT(*) FROM sensors s WHERE s.org_id = :org AND s.device_id = d.id) AS sensor_count
    FROM devices d LEFT JOIN assets a ON a.id = d.asset_id AND a.org_id = :org WHERE d.org_id = :org ORDER BY d.created_at`);
};

export type SensorListRow = { id: string; device_id: string; device_name: string; device_key: string; origin: 'real' | 'simulated'; asset_id: string | null; asset_name: string | null; key: string; kind: string; param: string | null; unit: string; role: string; expected_interval_s: number; validation_required: number; last_reading_at: number | null; last_value: number | null; health: string; battery_pct: number | null; rssi_dbm: number | null; enabled: number };
export const listSensors = (ctx: Ctx): SensorListRow[] => {
  need(ctx, 'sensor.read');
  const sc = ctx.actor.scopeOwner ? ' AND a.owner_name = :scope' : '';
  return ctx.t.all<SensorListRow>(`SELECT s.id, s.device_id, d.name AS device_name, d.device_key, d.origin, s.asset_id, a.name AS asset_name, s.key, s.kind, s.param, s.unit, s.role, s.expected_interval_s, s.validation_required,
    s.last_reading_at, s.last_value, s.health, d.battery_pct, d.rssi_dbm, s.enabled FROM sensors s JOIN devices d ON d.id = s.device_id AND d.org_id = :org
    LEFT JOIN assets a ON a.id = s.asset_id AND a.org_id = :org WHERE s.org_id = :org AND d.status = 'active'${sc} ORDER BY s.key`, ctx.actor.scopeOwner ? { scope: ctx.actor.scopeOwner } : {});
};
export function sensorSeries(ctx: Ctx, sensorId: string, from: number, to: number, limit = 500): { ts: number; value: number }[] {
  need(ctx, 'sensor.read');
  if (!ctx.t.get('SELECT 1 AS x FROM sensors WHERE org_id = :org AND id = :id', { id: sensorId })) throw notFound('Sensor not found');
  return ctx.t.all<{ ts: number; value: number }>('SELECT ts, value FROM readings WHERE org_id = :org AND sensor_id = :s AND ts BETWEEN :f AND :t ORDER BY ts DESC LIMIT :l', { s: sensorId, f: from, t: to, l: limit }).reverse();
}

// ---- alerts ----
export type AlertRow = { id: string; kind: string; severity: string; sensor_id: string | null; device_id: string | null; asset_id: string | null; state: string; title: string; detail: string | null; suggested_priority: string | null; wo_id: string | null; opened_at: number; resolved_at: number | null; origin: string };
export function listAlerts(ctx: Ctx, state?: string): AlertRow[] {
  need(ctx, 'sensor.read');
  return ctx.t.all<AlertRow>(`SELECT id, kind, severity, sensor_id, device_id, asset_id, state, title, detail, suggested_priority, wo_id, opened_at, resolved_at, origin FROM alerts WHERE org_id = :org ${state ? 'AND state = :st' : ''} ORDER BY opened_at DESC LIMIT 300`, state ? { st: state } : {});
}
export function ackAlert(ctx: Ctx, id: string): void {
  need(ctx, 'alert.manage');
  const r = ctx.t.run("UPDATE alerts SET state = 'acknowledged', acked_by = :u WHERE org_id = :org AND id = :id AND state = 'open'", { u: ctx.actor.id, id });
  if (r.changes === 0) throw notFound('Open alert not found');
  audit(ctx, 'alert.acknowledged', 'alert', id);
}
