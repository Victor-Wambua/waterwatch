import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { decryptSecret, hmacHex, safeEqual, sha256hex } from '../core/crypto.ts';
import { SystemDb, TenantDb, tx } from '../db/index.ts';
import { parseSettings, type OrgSettings } from '../domain/settings.ts';
import { appendAudit } from '../domain/audit.ts';
import type { Config } from '../core/config.ts';

export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_READINGS = 500;

/** signature = hex(HMAC-SHA256(secret, `${deviceKey}\n${timestamp}\n${nonce}\n${sha256hex(rawBody)}`)) */
export const signingString = (deviceKey: string, ts: string, nonce: string, rawBody: string | Uint8Array) => `${deviceKey}\n${ts}\n${nonce}\n${sha256hex(rawBody)}`;
export const signRequest = (secret: string, deviceKey: string, ts: string, nonce: string, rawBody: string | Uint8Array) => hmacHex(secret, signingString(deviceKey, ts, nonce, rawBody));

const batchSchema = z.object({
  batch_id: z.string().max(80).optional(),
  origin: z.enum(['real', 'simulated']).optional(),
  device: z.object({ battery_pct: z.number().min(0).max(100).optional(), rssi_dbm: z.number().min(-200).max(0).optional() }).optional(),
  readings: z.array(z.object({
    sensor: z.string().min(1).max(40),
    ts: z.union([z.number(), z.string()]),
    value: z.number(),
    id: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/).optional()
  })).min(1).max(MAX_READINGS)
});

export type IngestRequest = { deviceKey: string | null; timestamp: string | null; nonce: string | null; signature: string | null; rawBody: string; now: number };
export type IngestResponse = { status: number; body: Record<string, unknown> };

type DeviceRow = { id: string; org_id: string; device_key: string; status: string; origin: 'real' | 'simulated'; secret_enc: string };

function parseTs(v: number | string): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e11 ? Math.round(v * 1000) : Math.round(v)) : null; // seconds or milliseconds
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function logEvent(db: DatabaseSync, now: number, orgId: string | null, deviceId: string | null, outcome: string, a = 0, d = 0, r = 0, detail?: string) {
  db.prepare('INSERT INTO ingest_events (org_id, device_id, ts, outcome, accepted, duplicates, rejected, detail) VALUES (?,?,?,?,?,?,?,?)').run(orgId, deviceId, now, outcome, a, d, r, detail ?? null);
}

/** Authenticates (HMAC, timestamp window, nonce replay) and stores a batch. Never trusts payload-supplied identity or origin. */
export function handleIngest(db: DatabaseSync, cfg: Config, req: IngestRequest): IngestResponse {
  const sys = new SystemDb(db);
  const reject = (status: number, code: string, message: string, org: string | null = null, dev: string | null = null): IngestResponse => {
    logEvent(db, req.now, org, dev, code);
    return { status, body: { error: code, message } };
  };
  if (Buffer.byteLength(req.rawBody) > MAX_BODY_BYTES) return reject(413, 'payload_too_large', 'Body exceeds 1 MB.');
  if (!req.deviceKey || !req.timestamp || !req.nonce || !req.signature) return reject(401, 'missing_auth_headers', 'X-WW-Device, X-WW-Timestamp, X-WW-Nonce and X-WW-Signature are required.');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(req.nonce) || !/^\d{9,13}$/.test(req.timestamp) || !/^[0-9a-f]{64}$/.test(req.signature)) return reject(401, 'malformed_auth_headers', 'Malformed authentication headers.');

  const dev = sys.get<DeviceRow>('SELECT id, org_id, device_key, status, origin, secret_enc FROM devices WHERE device_key = :k', { k: req.deviceKey });
  // Same response for unknown/revoked devices and bad signatures (no device enumeration).
  const secret = dev && dev.status === 'active' ? decryptSecret(dev.secret_enc, cfg.secretKey) : 'x'.repeat(32);
  const expected = signRequest(secret, req.deviceKey, req.timestamp, req.nonce, req.rawBody);
  if (!dev || dev.status !== 'active' || !safeEqual(expected, req.signature)) return reject(401, 'invalid_credentials', 'Device credentials are invalid.', dev?.org_id ?? null, dev?.id ?? null);

  const orgRow = sys.get<{ settings: string }>('SELECT settings FROM organisations WHERE id = :id', { id: dev.org_id });
  const settings: OrgSettings = parseSettings(orgRow?.settings);
  const tsMs = Number(req.timestamp) < 1e11 ? Number(req.timestamp) * 1000 : Number(req.timestamp);
  if (Math.abs(req.now - tsMs) > settings.ingestSkewSec * 1000) return reject(401, 'timestamp_out_of_window', `Request timestamp is outside the allowed ±${settings.ingestSkewSec}s window. Sync the device clock.`, dev.org_id, dev.id);

  if (dev.origin === 'simulated' && !cfg.allowSimulated) return reject(403, 'simulated_disabled', 'Simulated devices are not accepted in this environment.', dev.org_id, dev.id);

  let json: unknown;
  try { json = JSON.parse(req.rawBody); } catch { return reject(400, 'invalid_json', 'Body is not valid JSON.', dev.org_id, dev.id); }
  const parsed = batchSchema.safeParse(json);
  if (!parsed.success) return reject(422, 'invalid_payload', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), dev.org_id, dev.id);
  const b = parsed.data;
  if (b.origin && b.origin !== dev.origin) return reject(422, 'origin_mismatch', `Payload origin "${b.origin}" does not match the device's registered origin "${dev.origin}".`, dev.org_id, dev.id);

  // Replay protection: a nonce may be used once per device inside the window. Done in the same transaction as the writes.
  const t = new TenantDb(db, dev.org_id);
  try {
    return tx(db, () => {
      const ins = db.prepare('INSERT OR IGNORE INTO ingest_nonces (device_id, nonce, ts) VALUES (?, ?, ?)').run(dev.id, req.nonce, req.now);
      if (Number(ins.changes) === 0) throw new ReplayError();
      db.prepare('DELETE FROM ingest_nonces WHERE ts < ?').run(req.now - 2 * settings.ingestSkewSec * 1000 - 60000);

      const sensors = new Map(t.all<{ id: string; key: string; last_reading_at: number | null }>('SELECT id, key, last_reading_at FROM sensors WHERE org_id = :org AND device_id = :d AND enabled = 1', { d: dev.id }).map((s) => [s.key, s]));
      let accepted = 0, duplicates = 0;
      const rejected: { index: number; reason: string }[] = [];
      const maxAge = settings.ingestMaxAgeDays * 86400_000, skew = settings.ingestSkewSec * 1000;
      b.readings.forEach((r, index) => {
        const s = sensors.get(r.sensor);
        if (!s) return void rejected.push({ index, reason: 'unknown_sensor' });
        const ts = parseTs(r.ts);
        if (ts === null) return void rejected.push({ index, reason: 'invalid_timestamp' });
        if (ts > req.now + skew) return void rejected.push({ index, reason: 'future_timestamp' });
        if (ts < req.now - maxAge) return void rejected.push({ index, reason: 'too_old' });
        const uid = r.id ?? `${r.sensor}:${ts}`;
        const res = t.run('INSERT OR IGNORE INTO readings (org_id, sensor_id, device_id, ts, value, uid, origin, received_at) VALUES (:org, :s, :d, :ts, :v, :uid, :o, :now)', { s: s.id, d: dev.id, ts, v: r.value, uid, o: dev.origin, now: req.now });
        if (res.changes === 0) { duplicates++; return; }
        accepted++;
        // late/out-of-order readings are stored with their original timestamp; "last reading" only moves forward
        if (s.last_reading_at === null || ts > s.last_reading_at) {
          t.run('UPDATE sensors SET last_reading_at = :ts, last_value = :v WHERE org_id = :org AND id = :id', { ts, v: r.value, id: s.id });
          s.last_reading_at = ts;
        }
      });
      t.run('UPDATE devices SET last_seen_at = :now, battery_pct = COALESCE(:b, battery_pct), rssi_dbm = COALESCE(:r, rssi_dbm) WHERE org_id = :org AND id = :id', { now: req.now, b: b.device?.battery_pct ?? null, r: b.device?.rssi_dbm ?? null, id: dev.id });
      logEvent(db, req.now, dev.org_id, dev.id, 'ok', accepted, duplicates, rejected.length, b.batch_id);
      return { status: 200, body: { accepted, duplicates, rejected, server_time: new Date(req.now).toISOString(), origin: dev.origin } };
    });
  } catch (e) {
    if (e instanceof ReplayError) {
      appendAudit(db, req.now, { orgId: dev.org_id, actor: null, action: 'ingest.replay_rejected', objectType: 'device', objectId: dev.id });
      return reject(409, 'replay', 'This nonce has already been used. Use a fresh nonce for each request (retry with the same reading ids is safe).', dev.org_id, dev.id);
    }
    throw e;
  }
}
class ReplayError extends Error {}
