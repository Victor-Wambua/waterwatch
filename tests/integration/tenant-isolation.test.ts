import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../src/core/errors.ts';
import { TenantDb } from '../../src/db/index.ts';
import { Client, ingestRaw, loggedIn, makeFlowA, makeWorld, type Flow, type World } from '../helpers.ts';
import { addMaintenanceRecord, createAsset, getAsset, linkAssets, listAssets, maintenanceHistory, previewAssetCsv, setAssetStatus, updateAsset } from '../../src/repo/assets.ts';
import { getReport, listReports, markDuplicate, rejectReport, submitReport } from '../../src/repo/reports.ts';
import { addMaterial, assignWorkOrder, createFromReports, createSchedule, createWorkOrder, getWorkOrder, listSchedules, listWorkOrders, setScheduleActive, transitionWorkOrder } from '../../src/repo/workorders.ts';
import { ackAlert, addSensor, listAlerts, listDevices, listSensors, registerDevice, revokeDevice, rotateDeviceSecret, sensorSeries } from '../../src/repo/devices.ts';
import { readPhoto } from '../../src/repo/photos.ts';
import { buildAnalytics } from '../../src/repo/analytics.ts';
import { runHealthCycle } from '../../src/repo/health.ts';
import { updateOrgUser } from '../../src/repo/system.ts';
import { actorOf } from '../../src/repo/system.ts';
import { verifyChain } from '../../src/domain/audit.ts';

let w: World, f: Flow;
beforeAll(async () => { w = await makeWorld(); f = await makeFlowA(w); ingestRaw(w, f.deviceKey, f.secret, { readings: [{ sensor: 'flow', ts: w.rt.now - 1000, value: 12 }] }); });
afterAll(() => w.rt.cleanup());

const TABLES = ['assets', 'asset_links', 'work_orders', 'wo_events', 'wo_materials', 'reports', 'maintenance_records', 'maintenance_schedules', 'devices', 'sensors', 'readings', 'alerts', 'notifications', 'photos', 'users', 'organisations'] as const;
const snapshot = (org: string) => JSON.stringify(TABLES.map((t) => w.rt.sys.all(t === 'organisations' ? 'SELECT * FROM organisations WHERE id = :o' : `SELECT * FROM ${t} WHERE org_id = :o ORDER BY 1`, { o: org })));

describe('data-access layer: every cross-tenant operation by org B on org A ids is refused and changes nothing', () => {
  const B = () => w.ctx('b_admin'), BD = () => w.ctx('b_dispatcher'), BT = () => w.ctx('b_tech'), BR = () => w.ctx('b_reporter');
  const ops: [string, () => unknown][] = [
    ['getAsset', () => getAsset(B(), w.assetA)],
    ['updateAsset', () => updateAsset(B(), w.assetA, { code: 'HACK', name: 'Hacked', type: 'borehole', status: 'down', owner_type: 'utility', owner_name: 'x', lat: -1.3, lng: 36.8 })],
    ['setAssetStatus', () => setAssetStatus(B(), w.assetA, 'down', 'x')],
    ['addMaintenanceRecord', () => addMaintenanceRecord(B(), w.assetA, { performed_on: '2026-01-01', summary: 'bad', performed_by: 'x', cost_minor: 0 })],
    ['linkAssets (from foreign)', () => linkAssets(B(), w.assetA, w.assetB)],
    ['linkAssets (to foreign)', () => linkAssets(B(), w.assetB, w.assetA)],
    ['getReport', () => getReport(B(), f.reportId)],
    ['markDuplicate', () => markDuplicate(BD(), f.reportId, f.reportId)],
    ['rejectReport', () => rejectReport(BD(), f.reportId, 'cross tenant reject')],
    ['submitReport on foreign asset', () => submitReport(BR(), { category: 'no_water', asset_id: w.assetA }, null)],
    ['getWorkOrder', () => getWorkOrder(BD(), f.woId)],
    ['assignWorkOrder', () => assignWorkOrder(BD(), f.woId, w.users['b_tech']?.id as string)],
    ['assignWorkOrder to foreign tech', () => assignWorkOrder(w.ctx('a_dispatcher'), f.woId, w.users['b_tech']?.id as string)],
    ['transitionWorkOrder', () => transitionWorkOrder(BD(), f.woId, { to: 'cancelled', note: 'cross tenant cancel' })],
    ['transitionWorkOrder (tech)', () => transitionWorkOrder(BT(), f.woId, { to: 'in_progress' })],
    ['addMaterial', () => addMaterial(BD(), f.woId, { name: 'x', category: 'parts', qty: 1, unitCostMinor: 1 })],
    ['createFromReports (foreign report)', () => createFromReports(BD(), { reportIds: [f.reportId] })],
    ['createWorkOrder (foreign asset)', () => createWorkOrder(BD(), { assetId: w.assetA, title: 'Foreign', priority: 'P3', kind: 'reactive' })],
    ['createSchedule (foreign asset)', () => createSchedule(BD(), { assetId: w.assetA, title: 'Foreign', intervalDays: 7, firstDue: '2026-07-01', priority: 'P3' })],
    ['setScheduleActive', () => setScheduleActive(BD(), '00000000-0000-0000-0000-000000000000', false)],
    ['registerDevice (foreign asset)', () => registerDevice(B(), { name: 'Hack', asset_id: w.assetA, origin: 'real', sensors: [] })],
    ['rotateDeviceSecret', () => rotateDeviceSecret(B(), f.deviceId)],
    ['revokeDevice', () => revokeDevice(B(), f.deviceId)],
    ['addSensor', () => addSensor(B(), f.deviceId, { key: 'x', kind: 'flow', unit: 'm3', expected_interval_s: 60 })],
    ['sensorSeries', () => sensorSeries(B(), f.sensorId, 0, Date.now())],
    ['readPhoto', () => readPhoto(B(), f.photoId)],
    ['updateOrgUser', () => updateOrgUser(w.rt, actorOf(w.users['b_admin'] as never), w.users['a_tech']?.id as string, { status: 'suspended' })],
    ['ackAlert', () => ackAlert(B(), '00000000-0000-0000-0000-000000000000')]
  ];
  for (const [name, fn] of ops) {
    it(name, () => {
      const before = snapshot(w.orgA);
      let threw: unknown = null;
      try { fn(); } catch (e) { threw = e; }
      expect(threw, `${name} must be refused`).toBeInstanceOf(AppError);
      expect([400, 403, 404]).toContain((threw as AppError).status);
      expect(snapshot(w.orgA)).toBe(before);
    });
  }
});

describe('listings from org B never contain org A data', () => {
  it('assets, reports, work orders, devices, sensors, alerts, schedules, history', () => {
    runHealthCycle(w.rt.db, w.rt.now + 3 * 3600_000);
    const B = w.ctx('b_admin');
    expect(listAssets(B).map((a) => a.id)).toEqual([w.assetB]);
    expect(listReports(B)).toHaveLength(0); expect(listWorkOrders(B)).toHaveLength(0);
    expect(listDevices(B)).toHaveLength(0); expect(listSensors(B)).toHaveLength(0); expect(listAlerts(B)).toHaveLength(0); expect(listSchedules(B)).toHaveLength(0);
    expect(maintenanceHistory(B, w.assetA)).toHaveLength(0);
    expect(listAlerts(w.ctx('a_admin')).length).toBeGreaterThan(0); // org A did get an alert (the sensor went silent)
  });
  it('previewing a CSV in org B only checks org B codes (the same code may exist in both orgs)', () => {
    const p = previewAssetCsv(w.ctx('b_admin'), 'code,name,type,owner_type,owner_name,lat,lng\nA-001,Same code other org,borehole,utility,Org B,-1.3,36.9\n');
    expect(p.errors).toHaveLength(0);
    expect(() => createAsset(w.ctx('b_admin'), { code: 'A-001', name: 'Dup ok', type: 'borehole', status: 'unknown', owner_type: 'utility', owner_name: 'B', lat: -1.3, lng: 36.9 })).not.toThrow();
  });
  it('analytics for org B contain none of org A', () => {
    const a = buildAnalytics(w.ctx('b_admin'));
    expect(a.totalOutageReports).toBe(0); expect(a.cost.totalMinor).toBe(0); expect(a.flows).toHaveLength(0); expect(a.downtime).toHaveLength(0);
  });
  it('the health cycle raises alerts only inside the device owner\'s organisation', () => {
    expect(listAlerts(w.ctx('b_admin'))).toHaveLength(0);
    expect(w.rt.sys.all("SELECT org_id FROM alerts WHERE org_id <> :a", { a: w.orgA })).toHaveLength(0);
  });
  it('audit chains are separate and each verifies', () => {
    expect(verifyChain(w.rt.db, w.orgA).ok).toBe(true); expect(verifyChain(w.rt.db, w.orgB).ok).toBe(true);
    expect(w.rt.sys.all('SELECT 1 FROM audit_log WHERE chain = :c AND org_id <> :c', { c: w.orgA })).toHaveLength(0);
  });
});

describe('HTTP: org B users get 404/refusals for org A identifiers', () => {
  let b: Client, bd: Client, bt: Client;
  beforeAll(async () => { b = await loggedIn(w, 'b_admin'); bd = await loggedIn(w, 'b_dispatcher'); bt = await loggedIn(w, 'b_tech'); });
  it('GET pages and API', async () => {
    for (const [c, p] of [[b, `/console/assets/${w.assetA}`], [b, `/console/assets/${w.assetA}/edit`], [bd, `/console/orders/${f.woId}`], [bt, `/tech/${f.woId}`], [b, `/api/v1/assets/${w.assetA}`], [bd, `/api/v1/work-orders/${f.woId}`], [b, `/api/v1/sensors/${f.sensorId}/readings`], [b, `/photos/${f.photoId}`]] as [Client, string][]) {
      const r = await c.get(p); expect([404, 403], `${p} -> ${r.status}`).toContain(r.status);
    }
  });
  it('PUT/POST by id are refused and A is unchanged', async () => {
    const before = snapshot(w.orgA);
    expect((await b.req('PUT', `/api/v1/assets/${w.assetA}`, { json: { code: 'X' } })).status).toBeGreaterThanOrEqual(400);
    for (const [c, p, form] of [[b, `/console/assets/${w.assetA}/status`, { status: 'down', reason: 'x' }], [bd, `/console/orders/${f.woId}/assign`, { assignee: w.users['b_tech']?.id as string }], [bd, `/console/orders/${f.woId}/transition`, { to: 'cancelled', note: 'cross tenant' }], [bd, `/console/reports/${f.reportId}/reject`, { reason: 'cross tenant' }], [b, `/console/admin/devices/${f.deviceId}/rotate`, {}], [b, `/console/admin/devices/${f.deviceId}/revoke`, {}], [b, `/console/admin/users/${w.users['a_tech']?.id}`, { op: 'suspend' }]] as [Client, string, Record<string, string>][]) {
      const r = await c.req('POST', p, { form }); expect([303, 403, 404], `${p} -> ${r.status}`).toContain(r.status);
    }
    expect(snapshot(w.orgA)).toBe(before);
  });
  it('IDs of org A cannot be smuggled through list filters (SQL injection style)', async () => {
    for (const q of ["' OR org_id = '" + w.orgA + "' --", "%' OR 1=1 --", '\\', '%']) {
      const r = await b.get(`/console/assets?q=${encodeURIComponent(q)}`); expect(r.status).toBe(200);
      expect(await r.text()).not.toContain('Alpha Borehole');
    }
  });
});

describe('static guard: the repository layer only reaches tenant tables through TenantDb', () => {
  const dir = join(process.cwd(), 'src/repo');
  const files = readdirSync(dir).filter((x) => x.endsWith('.ts'));
  const SYSTEM_OK = new Set(['system.ts', 'ingest.ts', 'health.ts', 'ctx.ts']); // documented system-level modules
  it('TenantDb refuses statements that do not mention :org', () => {
    const t = new TenantDb(w.rt.db, w.orgA);
    expect(() => t.get('SELECT * FROM assets')).toThrow(/:org/);
    expect(() => t.all('SELECT * FROM assets WHERE org_id = 1')).toThrow(/:org/);
    expect(() => t.run('DELETE FROM assets')).toThrow(/:org/);
    expect(() => new TenantDb(w.rt.db, '')).toThrow();
  });
  it('tenant-scoped modules never use the raw database handle or SystemDb', () => {
    for (const file of files.filter((x) => !SYSTEM_OK.has(x))) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src, `${file} must not call .prepare(`).not.toMatch(/\.prepare\(/);
      expect(src, `${file} must not use rt.sys`).not.toMatch(/rt\.sys\./);
      expect(src, `${file} must not use .raw`).not.toMatch(/\.raw\b/);
    }
  });
  it('every SQL statement on a tenant table in tenant-scoped modules filters on :org', () => {
    const tables = TABLES.filter((t) => t !== 'organisations' && t !== 'users');
    for (const file of files.filter((x) => !SYSTEM_OK.has(x))) {
      const src = readFileSync(join(dir, file), 'utf8');
      for (const m of src.matchAll(/(['"`])((?:SELECT|UPDATE|INSERT INTO|DELETE FROM)\b[\s\S]*?)\1/g)) {
        const sql = m[2] as string;
        if (tables.some((t) => new RegExp(`\\b(FROM|UPDATE|INTO|JOIN)\\s+${t}\\b`, 'i').test(sql))) expect(sql, `${file}: ${sql.slice(0, 80)}`).toMatch(/:org\b/);
      }
    }
  });
  it('documented system modules only touch the database through org-keyed statements for tenant tables', () => {
    const src = readFileSync(join(dir, 'ingest.ts'), 'utf8') + readFileSync(join(dir, 'health.ts'), 'utf8');
    // device lookup by globally unique device key is the single intentional cross-tenant read; everything after it uses TenantDb
    expect(src.match(/FROM devices WHERE device_key/g)).toHaveLength(1);
  });
});
