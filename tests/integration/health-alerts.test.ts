import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestRaw, loggedIn, makeFlowA, makeWorld, T0, type Flow, type World } from '../helpers.ts';
import { runHealthCycle } from '../../src/repo/health.ts';
import { listAlerts, registerDevice } from '../../src/repo/devices.ts';
import { getWorkOrder } from '../../src/repo/workorders.ts';
import { runJobs } from '../../src/jobs.ts';

let w: World, f: Flow;
const MIN = 60_000;
beforeAll(async () => { w = await makeWorld(); f = await makeFlowA(w); });
afterAll(() => w.rt.cleanup());
const sensorHealth = (id = f.sensorId) => w.rt.sys.get<{ health: string }>('SELECT health FROM sensors WHERE id = :i', { i: id })?.health;
const alerts = (state?: string) => listAlerts(w.ctx('a_admin'), state);
const send = (vals: [number, number][], id = f) => ingestRaw(w, id.deviceKey, id.secret, { readings: vals.map(([ts, value]) => ({ sensor: 'flow', ts, value })) });

describe('missing-reading detection (sensor interval 60 s, so 2x = 2 minutes)', () => {
  it('reports "reporting" while readings are fresh', () => {
    send([[w.rt.now - 10_000, 10]]); runHealthCycle(w.rt.db, w.rt.now);
    expect(sensorHealth()).toBe('reporting'); expect(alerts()).toHaveLength(0);
  });
  it('goes Late after 1.25x and Missing after 2x the interval, opening an alert with a work-order suggestion', () => {
    w.rt.advance(80 * MIN / 60); runHealthCycle(w.rt.db, w.rt.now); expect(sensorHealth()).toBe('late');
    expect(alerts().map((a) => a.kind)).toEqual(['sensor_late']); expect(alerts()[0]?.suggested_priority).toBeNull();
    w.rt.advance(60_000); runHealthCycle(w.rt.db, w.rt.now); expect(sensorHealth()).toBe('missing');
    const open = alerts('open');
    expect(open.map((a) => a.kind)).toEqual(['sensor_missing']); // the Late alert is superseded and resolved
    expect(alerts('resolved').map((a) => a.kind)).toEqual(['sensor_late']);
    const missing = open.find((a) => a.kind === 'sensor_missing');
    expect(missing).toMatchObject({ severity: 'high', suggested_priority: 'P3', asset_id: w.assetA, origin: 'real' });
    expect(missing?.detail).toMatch(/No reading for/);
  });
  it('does not duplicate alerts on repeated cycles (dedupe)', () => {
    const n = alerts().length; runHealthCycle(w.rt.db, w.rt.now); runHealthCycle(w.rt.db, w.rt.now + 1000); expect(alerts()).toHaveLength(n);
  });
  it('does NOT change the asset status automatically', () => {
    expect(w.rt.sys.get<{ status: string }>('SELECT status FROM assets WHERE id = :a', { a: w.assetA })?.status).toBe('operational');
  });
  it('a person can turn the suggestion into a sensor work order, once', async () => {
    const d = await loggedIn(w, 'a_dispatcher');
    const missing = alerts().find((a) => a.kind === 'sensor_missing');
    const r = await d.req('POST', `/console/alerts/${missing?.id}/workorder`, { form: { assignee: w.users['a_tech']?.id as string } });
    expect(r.status).toBe(303); expect(r.headers.get('location')).toMatch(/^\/console\/orders\//);
    const woId = r.headers.get('location')?.split('/').pop() as string;
    const wo = getWorkOrder(w.ctx('a_dispatcher'), woId);
    expect(wo).toMatchObject({ kind: 'sensor', priority: 'P3', status: 'assigned' }); expect(wo.title).toMatch(/Sensor check/);
    const again = await d.req('POST', `/console/alerts/${missing?.id}/workorder`, { form: {} }); expect(again.status).toBe(303);
    expect(w.rt.sys.all("SELECT id FROM work_orders WHERE kind = 'sensor'")).toHaveLength(1);
    expect(w.rt.sys.get<{ state: string }>('SELECT state FROM alerts WHERE id = :i', { i: missing?.id as string })?.state).toBe('acknowledged');
  });
  it('resolves automatically when readings resume', () => {
    send([[w.rt.now - 5_000, 11]]); const r = runHealthCycle(w.rt.db, w.rt.now);
    expect(sensorHealth()).toBe('reporting'); expect(r.resolved).toBeGreaterThanOrEqual(1);
    expect(alerts('open')).toHaveLength(0);
    expect(w.rt.sys.all("SELECT kind FROM alerts WHERE state = 'resolved'").length).toBeGreaterThan(0);
  });
  it('a late back-fill of old readings does not make a stale sensor look healthy', () => {
    w.rt.advance(10 * 60 * 1000);
    send([[w.rt.now - 9 * 60 * 1000, 12]]); runHealthCycle(w.rt.db, w.rt.now);
    expect(sensorHealth()).toBe('missing');
  });
});

describe('flat-lined and out-of-range detection', () => {
  it('flags a stuck sensor after N identical readings and clears when values vary', () => {
    w.rt.advance(60_000);
    send(Array.from({ length: 5 }, (_, i) => [w.rt.now - (5 - i) * 1000, 4.2] as [number, number]));
    runHealthCycle(w.rt.db, w.rt.now); expect(sensorHealth()).toBe('flatline');
    expect(alerts('open').find((a) => a.kind === 'sensor_flatline')).toMatchObject({ suggested_priority: 'P3' });
    send([[w.rt.now - 500, 4.9]]); runHealthCycle(w.rt.db, w.rt.now); expect(sensorHealth()).toBe('reporting');
    expect(alerts('open').find((a) => a.kind === 'sensor_flatline')).toBeUndefined();
  });
  it('flags a value outside the valid range', () => {
    send([[w.rt.now - 200, 9000]]); runHealthCycle(w.rt.db, w.rt.now);
    expect(sensorHealth()).toBe('out_of_range'); expect(alerts('open').find((a) => a.kind === 'sensor_out_of_range')?.detail).toMatch(/outside the valid range/);
    send([[w.rt.now - 100, 20]]); runHealthCycle(w.rt.db, w.rt.now); expect(sensorHealth()).toBe('reporting');
  });
  it('a pump-status sensor that stays "on" is not flat-lined', () => {
    const d = registerDevice(w.ctx('a_admin'), { name: 'Pump', asset_id: w.assetA, origin: 'real', sensors: [{ key: 'pump', kind: 'pump_status', unit: 'on/off', expected_interval_s: 60, stuck_count: 3 }] });
    ingestRaw(w, d.deviceKey, d.secret, { readings: Array.from({ length: 6 }, (_, i) => ({ sensor: 'pump', ts: w.rt.now - (i + 1) * 1000, value: 1 })) });
    runHealthCycle(w.rt.db, w.rt.now);
    expect(w.rt.sys.get<{ health: string }>("SELECT s.health FROM sensors s JOIN devices dv ON dv.id = s.device_id WHERE dv.id = :d", { d: d.id })?.health).toBe('reporting');
  });
});

describe('device telemetry, new sensors, simulated labelling', () => {
  it('battery-low and weak-signal alerts come from supplied telemetry only', () => {
    send([[w.rt.now - 50, 20]]);
    ingestRaw(w, f.deviceKey, f.secret, { device: { battery_pct: 12, rssi_dbm: -115 }, readings: [{ sensor: 'flow', ts: w.rt.now - 40, value: 21 }] });
    runHealthCycle(w.rt.db, w.rt.now);
    const kinds = alerts('open').map((a) => a.kind);
    expect(kinds).toContain('device_battery_low'); expect(kinds).toContain('device_signal_weak');
    expect(alerts('open').find((a) => a.kind === 'device_battery_low')?.suggested_priority).toBeNull();
    ingestRaw(w, f.deviceKey, f.secret, { device: { battery_pct: 90, rssi_dbm: -70 }, readings: [{ sensor: 'flow', ts: w.rt.now - 30, value: 22 }] });
    runHealthCycle(w.rt.db, w.rt.now); expect(alerts('open').map((a) => a.kind)).not.toContain('device_battery_low');
  });
  it('a newly registered sensor is "unknown" first, then Missing after 2x the interval with no data', () => {
    const d = registerDevice(w.ctx('a_admin'), { name: 'New', asset_id: w.assetA, origin: 'real', sensors: [{ key: 'flow', kind: 'flow', unit: 'm3/h', expected_interval_s: 60 }] });
    runHealthCycle(w.rt.db, w.rt.now);
    const sid = (w.rt.sys.get<{ id: string }>('SELECT id FROM sensors WHERE device_id = :d', { d: d.id }) as { id: string }).id;
    expect(sensorHealth(sid)).toBe('unknown');
    w.rt.advance(121_000); runHealthCycle(w.rt.db, w.rt.now); expect(sensorHealth(sid)).toBe('missing');
  });
  it('alerts for simulated devices carry origin=simulated and the UI shows the SIMULATED label', async () => {
    const d = registerDevice(w.ctx('a_admin'), { name: 'SIM-FL-77', asset_id: w.assetA, origin: 'simulated', sensors: [{ key: 'flow', kind: 'flow', unit: 'm3/h', expected_interval_s: 60 }] });
    void d; w.rt.advance(300_000); runHealthCycle(w.rt.db, w.rt.now);
    expect(alerts('open').filter((a) => a.origin === 'simulated').length).toBeGreaterThan(0);
    const page = await (await (await loggedIn(w, 'a_dispatcher')).get('/console/sensors')).text();
    expect(page).toContain('SIMULATED SENSOR — test environment'); expect(page).toContain('Real device');
    const api = (await (await (await loggedIn(w, 'a_auditor')).get('/api/v1/sensors')).json()) as { sensors: { simulated: boolean }[] };
    expect(api.sensors.some((s) => s.simulated)).toBe(true); expect(api.sensors.some((s) => !s.simulated)).toBe(true);
  });
  it('quality sensors are labelled "validation required"', async () => {
    registerDevice(w.ctx('a_admin'), { name: 'Probe', asset_id: w.assetA, origin: 'real', sensors: [{ key: 'turb', kind: 'quality', param: 'turbidity', unit: 'NTU', expected_interval_s: 300 }] });
    expect(await (await (await loggedIn(w, 'a_dispatcher')).get('/console/sensors')).text()).toContain('Validation required');
  });
  it('the manual health check endpoint and the background job both run the cycle', async () => {
    const d = await loggedIn(w, 'a_dispatcher');
    const r = (await (await d.req('POST', '/api/v1/sensors/health-check', { json: {} })).json()) as { sensors: number }; expect(r.sensors).toBeGreaterThan(3);
    const j = runJobs(w.rt); expect(j.health.sensors).toBeGreaterThan(3); expect(typeof j.planned).toBe('number');
  });
  it('acknowledging an alert changes its state and is audited', async () => {
    const open = alerts('open')[0]; const d = await loggedIn(w, 'a_dispatcher');
    expect((await d.req('POST', `/console/alerts/${open?.id}/ack`, { form: {} })).status).toBe(303);
    expect(w.rt.sys.get<{ state: string }>('SELECT state FROM alerts WHERE id = :i', { i: open?.id as string })?.state).toBe('acknowledged');
    expect(w.rt.sys.get("SELECT 1 AS x FROM audit_log WHERE action = 'alert.acknowledged'")).toBeTruthy();
  });
});
void T0;
