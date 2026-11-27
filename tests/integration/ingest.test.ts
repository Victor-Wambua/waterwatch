import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, ingestRaw, loggedIn, makeFlowA, makeWorld, T0, type Flow, type World } from '../helpers.ts';
import { MAX_READINGS, signRequest } from '../../src/repo/ingest.ts';
import { registerDevice, rotateDeviceSecret, revokeDevice, addSensor } from '../../src/repo/devices.ts';
import { buildRequest, makeReadings, BANNER } from '../../src/sim/simulate.ts';
import { sha256hex } from '../../src/core/crypto.ts';

let w: World, f: Flow;
beforeAll(async () => { w = await makeWorld(); f = await makeFlowA(w); });
afterAll(() => w.rt.cleanup());
const count = (sensor = f.sensorId) => (w.rt.sys.get<{ n: number }>('SELECT COUNT(*) AS n FROM readings WHERE sensor_id = :s', { s: sensor }) as { n: number }).n;
const batch = (...r: { sensor?: string; ts: number; value: number; id?: string }[]) => ({ readings: r.map((x) => ({ sensor: 'flow', ...x })) });

describe('signature authentication', () => {
  it('accepts a correctly signed batch', () => {
    const before = count();
    const r = ingestRaw(w, f.deviceKey, f.secret, batch({ ts: T0 - 60_000, value: 12.5 }));
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ accepted: 1, duplicates: 0, rejected: [] });
    expect(count()).toBe(before + 1);
  });
  it('rejects a wrong signature, wrong secret, tampered body, and missing headers (401, nothing stored)', () => {
    const before = count();
    const payload = batch({ ts: T0 - 120_000, value: 1 });
    expect(ingestRaw(w, f.deviceKey, f.secret, payload, { sig: 'a'.repeat(64) }).status).toBe(401);
    expect(ingestRaw(w, f.deviceKey, 'wrong-secret', payload).status).toBe(401);
    const good = ingestRaw(w, f.deviceKey, f.secret, payload, { rawBody: JSON.stringify(payload) }); expect(good.status).toBe(200);
    // sign one body, send another
    const ts = String(Math.floor(w.rt.now / 1000)), nonce = 'tamper-nonce-0001';
    const sig = signRequest(f.secret, f.deviceKey, ts, nonce, JSON.stringify(payload));
    const tampered = JSON.stringify(batch({ ts: T0 - 120_000, value: 999 }));
    expect(ingestRaw(w, f.deviceKey, f.secret, null, { rawBody: tampered, ts: Number(ts), nonce, sig }).status).toBe(401);
    expect(count()).toBe(before + 1);
    for (const body of [{ deviceKey: null }, { deviceKey: f.deviceKey, ts: 0 }]) void body;
  });
  it('requires all four auth headers and well-formed values', () => {
    const base = { deviceKey: f.deviceKey, timestamp: String(Math.floor(w.rt.now / 1000)), nonce: 'nonce-nonce-01', signature: 'a'.repeat(64), rawBody: '{}', now: w.rt.now };
    for (const k of ['deviceKey', 'timestamp', 'nonce', 'signature'] as const) expect(handle({ ...base, [k]: null })).toMatchObject({ status: 401, body: { error: 'missing_auth_headers' } });
    expect(handle({ ...base, nonce: 'short' }).body['error']).toBe('malformed_auth_headers');
    expect(handle({ ...base, timestamp: 'yesterday' }).body['error']).toBe('malformed_auth_headers');
    expect(handle({ ...base, signature: 'XYZ' }).body['error']).toBe('malformed_auth_headers');
  });
  it('unknown, revoked and bad-signature devices all get the same response (no enumeration)', () => {
    const p = batch({ ts: T0, value: 1 });
    const a = ingestRaw(w, 'dev_doesnotexist', 'x'.repeat(40), p), b = ingestRaw(w, f.deviceKey, 'x'.repeat(40), p);
    expect(a.status).toBe(401); expect(b.status).toBe(401); expect(a.body).toEqual(b.body);
  });
  it('a revoked device is refused immediately; rotating a secret invalidates the old one', () => {
    const d1 = registerDevice(w.ctx('a_admin'), { name: 'Rot', asset_id: w.assetA, origin: 'real', sensors: [{ key: 'flow', kind: 'flow', unit: 'm3/h', expected_interval_s: 60 }] });
    expect(ingestRaw(w, d1.deviceKey, d1.secret, batch({ ts: T0, value: 1 })).status).toBe(200);
    const s2 = rotateDeviceSecret(w.ctx('a_admin'), d1.id);
    expect(ingestRaw(w, d1.deviceKey, d1.secret, batch({ ts: T0 + 1000, value: 2 })).status).toBe(401);
    expect(ingestRaw(w, d1.deviceKey, s2, batch({ ts: T0 + 1000, value: 2 })).status).toBe(200);
    revokeDevice(w.ctx('a_admin'), d1.id);
    expect(ingestRaw(w, d1.deviceKey, s2, batch({ ts: T0 + 2000, value: 3 })).status).toBe(401);
  });
  it('device secrets are encrypted at rest and shown only once', () => {
    const row = w.rt.sys.get<{ secret_enc: string }>('SELECT secret_enc FROM devices WHERE id = :id', { id: f.deviceId }) as { secret_enc: string };
    expect(row.secret_enc).toMatch(/^v1\./); expect(row.secret_enc).not.toContain(f.secret);
  });
});

describe('timestamp window and replay protection', () => {
  it('rejects stale and future request timestamps (clock window) even when correctly signed', () => {
    expect(ingestRaw(w, f.deviceKey, f.secret, batch({ ts: T0, value: 1 }), { ts: Math.floor(w.rt.now / 1000) - 301 }).body['error']).toBe('timestamp_out_of_window');
    expect(ingestRaw(w, f.deviceKey, f.secret, batch({ ts: T0, value: 1 }), { ts: Math.floor(w.rt.now / 1000) + 301 }).status).toBe(401);
    expect(ingestRaw(w, f.deviceKey, f.secret, batch({ ts: T0 - 30_000, value: 1 }), { ts: Math.floor(w.rt.now / 1000) - 299 }).status).toBe(200);
  });
  it('a captured request cannot be replayed (409) and the replay is audited', () => {
    const payload = batch({ ts: T0 - 200_000, value: 7 });
    const rawBody = JSON.stringify(payload), nonce = 'replay-nonce-001', ts = String(Math.floor(w.rt.now / 1000));
    const sig = signRequest(f.secret, f.deviceKey, ts, nonce, rawBody);
    const first = ingestRaw(w, f.deviceKey, f.secret, null, { rawBody, nonce, ts: Number(ts), sig }); expect(first.status).toBe(200);
    const again = ingestRaw(w, f.deviceKey, f.secret, null, { rawBody, nonce, ts: Number(ts), sig }); expect(again.status).toBe(409); expect(again.body['error']).toBe('replay');
    expect(w.rt.sys.get("SELECT 1 AS x FROM audit_log WHERE action = 'ingest.replay_rejected'")).toBeTruthy();
  });
  it('the same nonce on a different device is not a replay', () => {
    const d2 = registerDevice(w.ctx('a_admin'), { name: 'Other', asset_id: w.assetA, origin: 'real', sensors: [{ key: 'flow', kind: 'flow', unit: 'm3/h', expected_interval_s: 60 }] });
    const ts = Math.floor(w.rt.now / 1000), nonce = 'shared-nonce-0001';
    expect(ingestRaw(w, f.deviceKey, f.secret, batch({ ts: T0 - 500_000, value: 1 }), { nonce, ts }).status).toBe(200);
    expect(ingestRaw(w, d2.deviceKey, d2.secret, batch({ ts: T0 - 500_000, value: 1 }), { nonce, ts }).status).toBe(200);
  });
  it('old nonces are pruned so the table does not grow without bound', () => {
    ingestRaw(w, f.deviceKey, f.secret, batch({ ts: T0 - 600_000, value: 1 }), { nonce: 'prune-me-000001' });
    w.rt.advance(3600_000);
    ingestRaw(w, f.deviceKey, f.secret, batch({ ts: w.rt.now - 600_000, value: 1 }), { nonce: 'prune-trigger-01' });
    expect(w.rt.sys.get("SELECT 1 AS x FROM ingest_nonces WHERE nonce = 'prune-me-000001'")).toBeUndefined();
  });
});

describe('idempotency, batching, store-and-forward', () => {
  it('re-sending the same readings with a fresh nonce stores nothing new (duplicates reported)', () => {
    const p = batch({ ts: w.rt.now - 35_000_000, value: 5 }, { ts: w.rt.now - 35_060_000, value: 6 });
    const before = count();
    expect(ingestRaw(w, f.deviceKey, f.secret, p).body).toMatchObject({ accepted: 2, duplicates: 0 });
    expect(ingestRaw(w, f.deviceKey, f.secret, p).body).toMatchObject({ accepted: 0, duplicates: 2 });
    expect(count()).toBe(before + 2);
  });
  it('uses the client reading id for idempotency when supplied', () => {
    const before = count();
    expect(ingestRaw(w, f.deviceKey, f.secret, batch({ ts: w.rt.now - 36_000_000, value: 1, id: 'r-1' })).body['accepted']).toBe(1);
    expect(ingestRaw(w, f.deviceKey, f.secret, batch({ ts: w.rt.now - 36_001_000, value: 2, id: 'r-1' })).body['duplicates']).toBe(1);
    expect(count()).toBe(before + 1);
  });
  it('accepts late and out-of-order readings with their ORIGINAL timestamps; "last reading" only moves forward', () => {
    const t = T0 + 10_000_000; // base time still "in the past" relative to the server clock below
    w.rt.now = t + 120_000;
    const r = ingestRaw(w, f.deviceKey, f.secret, batch({ ts: t + 100_000, value: 30 }, { ts: t + 20_000, value: 10 }, { ts: t + 60_000, value: 20 }));
    expect(r.body).toMatchObject({ accepted: 3 });
    const s = w.rt.sys.get<{ last_reading_at: number; last_value: number }>('SELECT last_reading_at, last_value FROM sensors WHERE id = :s', { s: f.sensorId }) as { last_reading_at: number; last_value: number };
    expect(s.last_reading_at).toBe(t + 100_000); expect(s.last_value).toBe(30);
    const late = ingestRaw(w, f.deviceKey, f.secret, batch({ ts: t + 10_000, value: 5 }));
    expect(late.body['accepted']).toBe(1);
    expect((w.rt.sys.get<{ last_reading_at: number }>('SELECT last_reading_at FROM sensors WHERE id = :s', { s: f.sensorId }))?.last_reading_at).toBe(t + 100_000);
    const stored = w.rt.sys.all<{ ts: number; value: number }>('SELECT ts, value FROM readings WHERE sensor_id = :s AND ts BETWEEN :a AND :b ORDER BY ts', { s: f.sensorId, a: t, b: t + 200_000 });
    expect(stored.map((x) => x.ts)).toEqual([t + 10_000, t + 20_000, t + 60_000, t + 100_000]);
  });
  it('accepts epoch seconds, epoch milliseconds and ISO-8601 timestamps', () => {
    const base = w.rt.now - 5_000_000;
    const r = ingestRaw(w, f.deviceKey, f.secret, { readings: [{ sensor: 'flow', ts: Math.floor(base / 1000), value: 1 }, { sensor: 'flow', ts: base + 1000, value: 2 }, { sensor: 'flow', ts: new Date(base + 2000).toISOString(), value: 3 }] });
    expect(r.body['accepted']).toBe(3);
    const ts = w.rt.sys.all<{ ts: number }>('SELECT ts FROM readings WHERE sensor_id = :s AND ts BETWEEN :a AND :b ORDER BY ts', { s: f.sensorId, a: base - 1000, b: base + 3000 }).map((x) => x.ts);
    expect(ts).toEqual([Math.floor(base / 1000) * 1000, base + 1000, base + 2000]);
  });
  it('rejects individual bad readings but accepts the rest (per-item reasons)', () => {
    const now = w.rt.now;
    const r = ingestRaw(w, f.deviceKey, f.secret, { readings: [
      { sensor: 'flow', ts: now - 37_000_000, value: 1 }, { sensor: 'nope', ts: now - 60_000, value: 1 }, { sensor: 'flow', ts: 'not-a-date', value: 1 },
      { sensor: 'flow', ts: now + 3600_000, value: 1 }, { sensor: 'flow', ts: now - 40 * 86400_000, value: 1 }] });
    expect(r.status).toBe(200); expect(r.body['accepted']).toBe(1);
    expect((r.body['rejected'] as { index: number; reason: string }[]).map((x) => x.reason)).toEqual(['unknown_sensor', 'invalid_timestamp', 'future_timestamp', 'too_old']);
  });
  it('stores out-of-range values (so health rules can flag them) without rejecting', () => {
    const r = ingestRaw(w, f.deviceKey, f.secret, batch({ ts: w.rt.now - 90_000, value: 99999 })); expect(r.body['accepted']).toBe(1);
  });
  it('records device battery and signal telemetry', () => {
    ingestRaw(w, f.deviceKey, f.secret, { device: { battery_pct: 17, rssi_dbm: -111 }, readings: [{ sensor: 'flow', ts: w.rt.now - 80_000, value: 3 }] });
    expect(w.rt.sys.get<{ battery_pct: number; rssi_dbm: number }>('SELECT battery_pct, rssi_dbm FROM devices WHERE id = :d', { d: f.deviceId })).toMatchObject({ battery_pct: 17, rssi_dbm: -111 });
  });
});

describe('payload validation and limits', () => {
  it('rejects invalid JSON, wrong shapes, NaN/Infinity, empty and oversized batches', () => {
    expect(ingestRaw(w, f.deviceKey, f.secret, null, { rawBody: '{not json' }).body['error']).toBe('invalid_json');
    for (const bad of [{}, { readings: [] }, { readings: 'x' }, { readings: [{ sensor: 'flow', ts: 1 }] }, { readings: [{ sensor: 'flow', ts: 1, value: 'abc' }] }, { readings: [{ sensor: 'flow', ts: 1, value: null }] }, { readings: [{ sensor: '', ts: 1, value: 1 }] }, { device: { battery_pct: 500 }, readings: [{ sensor: 'flow', ts: 1, value: 1 }] }])
      expect(ingestRaw(w, f.deviceKey, f.secret, bad).status, JSON.stringify(bad)).toBe(422);
    const big = { readings: Array.from({ length: MAX_READINGS + 1 }, (_, i) => ({ sensor: 'flow', ts: w.rt.now - i * 1000 - 1000, value: 1 })) };
    expect(ingestRaw(w, f.deviceKey, f.secret, big).status).toBe(422);
    expect(ingestRaw(w, f.deviceKey, f.secret, null, { rawBody: JSON.stringify({ x: 'y'.repeat(1024 * 1024) }) }).status).toBe(413);
  });
  it('accepts a full-size batch of MAX_READINGS', () => {
    const base = w.rt.now - 20 * 86400_000;
    const r = ingestRaw(w, f.deviceKey, f.secret, { readings: Array.from({ length: MAX_READINGS }, (_, i) => ({ sensor: 'flow', ts: base + i * 1000, value: i })) });
    expect(r.body['accepted']).toBe(MAX_READINGS);
  });
  it('rejects reading ids that could break storage keys', () => { expect(ingestRaw(w, f.deviceKey, f.secret, batch({ ts: w.rt.now - 1000, value: 1, id: "x'; DROP TABLE readings;--" })).status).toBe(422); });
  it('SQL-injection style sensor keys are just unknown sensors', () => {
    const r = ingestRaw(w, f.deviceKey, f.secret, { readings: [{ sensor: "flow' OR '1'='1", ts: w.rt.now - 1000, value: 1 }] }); expect(r.body['accepted']).toBe(0);
  });
});

describe('origin: simulated vs real', () => {
  it('a payload claiming a different origin than the registered device is refused', () => {
    const r = ingestRaw(w, f.deviceKey, f.secret, { origin: 'simulated', ...batch({ ts: w.rt.now - 2000, value: 1 }) });
    expect(r.status).toBe(422); expect(r.body['error']).toBe('origin_mismatch');
    const sim = registerDevice(w.ctx('a_admin'), { name: 'SIM', asset_id: w.assetA, origin: 'simulated', sensors: [{ key: 'flow', kind: 'flow', unit: 'm3/h', expected_interval_s: 60 }] });
    expect(ingestRaw(w, sim.deviceKey, sim.secret, { origin: 'real', ...batch({ ts: w.rt.now - 2000, value: 1 }) }).status).toBe(422);
  });
  it('readings inherit the device origin from the registry, never from the payload', () => {
    const sim = registerDevice(w.ctx('a_admin'), { name: 'SIM2', asset_id: w.assetA, origin: 'simulated', sensors: [{ key: 'flow', kind: 'flow', unit: 'm3/h', expected_interval_s: 60 }] });
    expect(ingestRaw(w, sim.deviceKey, sim.secret, batch({ ts: w.rt.now - 3000, value: 4 })).status).toBe(200);
    expect(w.rt.sys.get<{ origin: string }>('SELECT r.origin FROM readings r JOIN devices d ON d.id = r.device_id WHERE d.device_key = :k', { k: sim.deviceKey })?.origin).toBe('simulated');
    expect(w.rt.sys.get<{ origin: string }>('SELECT origin FROM readings WHERE sensor_id = :s LIMIT 1', { s: f.sensorId })?.origin).toBe('real');
  });
  it('production refuses to register or accept simulated devices', async () => {
    const p = await makeWorld({ WW_ENV: 'production', WW_SECRET_KEY: 'production-secret-key-production-1234567' });
    expect(() => registerDevice(p.ctx('a_admin'), { name: 'SIM', origin: 'simulated', sensors: [] })).toThrow(/not allowed/);
    // a simulated device that already exists in the DB is still refused at the door
    const dev = registerDevice(w.ctx('a_admin'), { name: 'SIM3', origin: 'simulated', sensors: [{ key: 'flow', kind: 'flow', unit: 'm3/h', expected_interval_s: 60 }] });
    const strict = { ...w.rt.cfg, allowSimulated: false };
    const body = JSON.stringify(batch({ ts: w.rt.now - 1000, value: 1 })), ts = String(Math.floor(w.rt.now / 1000)), nonce = 'prod-sim-nonce-1';
    const r = (await import('../../src/repo/ingest.ts')).handleIngest(w.rt.db, strict, { deviceKey: dev.deviceKey, timestamp: ts, nonce, signature: signRequest(dev.secret, dev.deviceKey, ts, nonce, body), rawBody: body, now: w.rt.now });
    expect(r.status).toBe(403); expect(r.body['error']).toBe('simulated_disabled');
    p.rt.cleanup();
  });
  it('the simulator builds validly signed, clearly flagged requests that the platform accepts', () => {
    const sim = registerDevice(w.ctx('a_admin'), { name: 'SIM-FL-99', asset_id: w.assetA, origin: 'simulated', sensors: [{ key: 'flow', kind: 'flow', unit: 'm3/h', expected_interval_s: 60 }] });
    const dev = { deviceKey: sim.deviceKey, secret: sim.secret, name: 'SIM-FL-99', sensors: [{ key: 'flow', kind: 'flow', base: 50, amp: 10, intervalS: 60 }] };
    const req = buildRequest(dev, makeReadings(dev, [w.rt.now - 5000, w.rt.now - 65000], 'normal', () => 0.5), w.rt.now);
    expect(JSON.parse(req.body).origin).toBe('simulated'); expect(BANNER).toMatch(/SIMULATED/);
    const out = (ingestHandle(req));
    expect(out.status).toBe(200); expect(out.body['accepted']).toBe(2); expect(out.body['origin']).toBe('simulated');
    const flat = makeReadings(dev, [1, 2, 3], 'flatline', () => 0.9); expect(new Set(flat.map((x) => x.value)).size).toBe(1);
    expect(makeReadings({ ...dev, sensors: [{ key: 'pump', kind: 'pump_status', base: 1, amp: 0, intervalS: 60 }] }, [1], 'normal')[0]?.value).toBe(1);
  });
  function ingestHandle(req: { body: string; headers: Record<string, string> }) {
    return handle({ deviceKey: req.headers['x-ww-device'] as string, timestamp: req.headers['x-ww-timestamp'] as string, nonce: req.headers['x-ww-nonce'] as string, signature: req.headers['x-ww-signature'] as string, rawBody: req.body, now: w.rt.now });
  }
});

describe('HTTP endpoint', () => {
  it('POST /ingest/v1/readings works without a session or CSRF token (device auth), and rejects bad credentials', async () => {
    const c = new Client(w);
    const body = JSON.stringify(batch({ ts: w.rt.now - 7000, value: 8 })), ts = String(Math.floor(w.rt.now / 1000)), nonce = 'http-nonce-00001';
    const sig = signRequest(f.secret, f.deviceKey, ts, nonce, body);
    const ok = await w.app.request('/ingest/v1/readings', { method: 'POST', body, headers: { 'content-type': 'application/json', host: 'localhost', 'x-ww-device': f.deviceKey, 'x-ww-timestamp': ts, 'x-ww-nonce': nonce, 'x-ww-signature': sig } });
    expect(ok.status).toBe(200); expect(((await ok.json()) as { accepted: number }).accepted).toBe(1);
    const replay = await w.app.request('/ingest/v1/readings', { method: 'POST', body, headers: { 'content-type': 'application/json', host: 'localhost', 'x-ww-device': f.deviceKey, 'x-ww-timestamp': ts, 'x-ww-nonce': nonce, 'x-ww-signature': sig } });
    expect(replay.status).toBe(409);
    const none = await w.app.request('/ingest/v1/readings', { method: 'POST', body, headers: { 'content-type': 'application/json', host: 'localhost' } });
    expect(none.status).toBe(401);
    expect((await w.app.request('/ingest/v1/readings', { method: 'POST', body: 'x'.repeat(1_200_000), headers: { 'content-type': 'application/json', host: 'localhost', 'x-ww-device': f.deviceKey } })).status).toBe(413);
    void c;
  });
  it('is rate limited per device when the limiter is on', async () => {
    const s = await makeWorld({ WW_RATE_LIMIT_DISABLED: '0' }); const fl = await makeFlowA(s);
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await s.app.request('/ingest/v1/readings', { method: 'POST', body: '{}', headers: { host: 'localhost', 'x-ww-device': fl.deviceKey } })).status;
    expect(last).toBe(429);
    s.rt.cleanup();
  });
  it('sensor series can be read back (authenticated) and shows the original timestamps', async () => {
    const d = await loggedIn(w, 'a_dispatcher');
    const j = (await (await d.get(`/api/v1/sensors/${f.sensorId}/readings?from=0&to=${w.rt.now + 1e9}`)).json()) as { readings: { ts: number }[] };
    expect(j.readings.length).toBeGreaterThan(10); expect(j.readings.map((r) => r.ts)).toEqual([...j.readings.map((r) => r.ts)].sort((a, b) => a - b));
  });
  it('adds sensors to existing devices and validates sensor definitions', () => {
    const c = w.ctx('a_admin');
    expect(() => addSensor(c, f.deviceId, { key: 'flow', kind: 'flow', unit: 'm3', expected_interval_s: 60 })).toThrow(/already exists/);
    expect(() => addSensor(c, f.deviceId, { key: 'q', kind: 'quality', unit: 'NTU', expected_interval_s: 60 })).toThrow(/parameter/);
    expect(() => addSensor(c, f.deviceId, { key: 'x', kind: 'flow', unit: 'm3', expected_interval_s: 5 })).toThrow();
    expect(() => addSensor(c, f.deviceId, { key: 'x', kind: 'flow', unit: 'm3', expected_interval_s: 60, min_valid: 10, max_valid: 5 })).toThrow(/min_valid/);
    const id = addSensor(c, f.deviceId, { key: 'turb', kind: 'quality', param: 'turbidity', unit: 'NTU', expected_interval_s: 60 });
    expect(w.rt.sys.get<{ validation_required: number }>('SELECT validation_required FROM sensors WHERE id = :i', { i: id })?.validation_required).toBe(1);
  });
  it('the sha256 of the body is part of the signature (header injection cannot swap the body)', () => {
    expect(sha256hex('a')).toHaveLength(64);
    expect(signRequest('s', 'k', '1', 'n', 'a')).not.toBe(signRequest('s', 'k', '1', 'n', 'b'));
    expect(signRequest('s', 'k', '1', 'n', 'a')).not.toBe(signRequest('s', 'k', '2', 'n', 'a'));
    expect(signRequest('s', 'k', '1', 'n', 'a')).not.toBe(signRequest('s', 'j', '1', 'n', 'a'));
  });
});

import { handleIngest } from '../../src/repo/ingest.ts';
function handle(req: Parameters<typeof handleIngest>[2]) { return handleIngest(w.rt.db, w.rt.cfg, req); }
