import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, jpegWithExif, loggedIn, makeWorld, photoForm, plainPng, T0, type World } from '../helpers.ts';
import { submitReport, listReports, markDuplicate, rejectReport } from '../../src/repo/reports.ts';
import { addMaterial, assignWorkOrder, createFromReports, createSchedule, createWorkOrder, generatePlannedWork, getWorkOrder, listSchedules, listWorkOrders, parseKesToMinor, setScheduleActive, transitionWorkOrder, woMaterials } from '../../src/repo/workorders.ts';
import { savePhoto } from '../../src/repo/photos.ts';
import { setAssetStatus } from '../../src/repo/assets.ts';
import { buildAnalytics } from '../../src/repo/analytics.ts';
import { verifyChain } from '../../src/domain/audit.ts';
import { AppError } from '../../src/core/errors.ts';

let w: World;
const MIN = 60_000, HOUR = 3_600_000;
beforeAll(async () => { w = await makeWorld(); w.rt.sys.run('UPDATE organisations SET settings = :s WHERE id = :o', { s: JSON.stringify({ reportsPerHour: 200 }), o: w.orgA }); });
afterAll(() => w.rt.cleanup());
const uid = (k: string) => w.users[k]?.id as string;
const rep = () => w.ctx('a_reporter'), disp = () => w.ctx('a_dispatcher'), tech = () => w.ctx('a_tech');
const status = (id: string) => w.rt.sys.get<{ status: string }>('SELECT status FROM work_orders WHERE id = :i', { i: id })?.status;
const assetStatus = () => w.rt.sys.get<{ status: string }>('SELECT status FROM assets WHERE id = :a', { a: w.assetA })?.status;
const throwsApp = (fn: () => unknown, re: RegExp) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(AppError); expect((e as Error).message).toMatch(re); return; } throw new Error('expected an AppError'); };

describe('community report submission', () => {
  it('stores a valid report with location, text and language; marks it user-submitted', () => {
    const r = submitReport(rep(), { category: 'no_water', text: 'No water since 6am', lang: 'sw', asset_id: w.assetA, lat: -1.29, lng: 36.82, accuracy_m: 12 }, null);
    expect(r.ref).toMatch(/^R-\d+$/);
    const row = w.rt.sys.get<Record<string, unknown>>('SELECT * FROM reports WHERE id = :i', { i: r.id });
    expect(row).toMatchObject({ category: 'no_water', lang: 'sw', status: 'new', origin: 'user_submitted', asset_id: w.assetA, reporter_id: uid('a_reporter'), accuracy_m: 12 });
  });
  it('requires a category and a location (asset or GPS)', () => {
    throwsApp(() => submitReport(rep(), { category: 'nonsense' as never, asset_id: w.assetA }, null), /category/);
    throwsApp(() => submitReport(rep(), { category: 'leak' }, null), /water point or share your location/);
  });
  it('validates GPS: bounds, numbers, 0,0', () => {
    for (const [lat, lng] of [[0, 0], [10, 36], [-1.29, 10], ['x', 'y']] as const) throwsApp(() => submitReport(rep(), { category: 'leak', lat, lng }, null), /Latitude|outside|0,0/);
  });
  it('auto-links to the nearest asset within 200 m, otherwise leaves it unlinked', () => {
    const near = submitReport(rep(), { category: 'low_pressure', lat: -1.29005, lng: 36.82005 }, null);
    expect(w.rt.sys.get<{ asset_id: string }>('SELECT asset_id FROM reports WHERE id = :i', { i: near.id })?.asset_id).toBe(w.assetA);
    const far = submitReport(rep(), { category: 'low_pressure', lat: -1.5, lng: 37.0 }, null);
    expect(w.rt.sys.get<{ asset_id: string | null }>('SELECT asset_id FROM reports WHERE id = :i', { i: far.id })?.asset_id).toBeNull();
  });
  it('rejects text over 1000 chars and unknown/foreign assets', () => {
    throwsApp(() => submitReport(rep(), { category: 'leak', asset_id: w.assetA, text: 'x'.repeat(1001) }, null), /text/);
    throwsApp(() => submitReport(rep(), { category: 'leak', asset_id: 'nope' }, null), /Unknown water point/);
  });
  it('is idempotent on client_uid: offline retries never create duplicates', () => {
    const input = { category: 'pump_failure' as const, asset_id: w.assetA2, client_uid: 'offline-uid-0001' };
    const a = submitReport(rep(), input, null), b = submitReport(rep(), input, null), c = submitReport(rep(), { ...input, text: 'changed' }, null);
    expect(b.id).toBe(a.id); expect(c.id).toBe(a.id); expect(b.deduplicated).toBe(true);
    expect(w.rt.sys.all("SELECT 1 FROM reports WHERE client_uid = 'offline-uid-0001'")).toHaveLength(1);
    expect(submitReport(w.ctx('a_reporter2'), input, null).id).not.toBe(a.id); // a different reporter is independent
  });
  it('anti-spam: same reporter + asset + category inside the window is folded into the first report', () => {
    const a = submitReport(rep(), { category: 'damage', asset_id: w.assetA2 }, null), b = submitReport(rep(), { category: 'damage', asset_id: w.assetA2 }, null);
    expect(b.id).toBe(a.id); expect(b.queuedDuplicate).toBe(true);
    w.rt.advance(31 * MIN);
    expect(submitReport(rep(), { category: 'damage', asset_id: w.assetA2 }, null).id).not.toBe(a.id);
  });
  it('anti-spam: hourly cap per reporter (configurable), recovering after the hour', async () => {
    const s = await makeWorld(); const r = s.ctx('a_reporter');
    s.rt.sys.run('UPDATE organisations SET settings = :s WHERE id = :o', { s: JSON.stringify({ reportsPerHour: 3, duplicateWindowMin: 0 }), o: s.orgA });
    const rc = () => s.ctx('a_reporter');
    for (let i = 0; i < 3; i++) submitReport(rc(), { category: 'leak', asset_id: s.assetA }, null);
    throwsApp(() => submitReport(rc(), { category: 'leak', asset_id: s.assetA }, null), /many reports/);
    s.rt.advance(61 * MIN); expect(() => submitReport(rc(), { category: 'leak', asset_id: s.assetA }, null)).not.toThrow();
    void r; s.rt.cleanup();
  });
  it('offline reports keep their original observation time (bounded: not in the future, max 7 days old)', () => {
    const t = w.rt.now - 3 * HOUR;
    const a = submitReport(rep(), { category: 'access', asset_id: w.assetA, observed_at: t }, null);
    const b = submitReport(w.ctx('a_reporter2'), { category: 'access', asset_id: w.assetA, observed_at: w.rt.now + 3600_000 }, null);
    const c = submitReport(w.ctx('a_reporter2'), { category: 'leak', asset_id: w.assetA, observed_at: w.rt.now - 30 * 24 * HOUR }, null);
    const o = (i: string) => w.rt.sys.get<{ observed_at: number }>('SELECT observed_at FROM reports WHERE id = :i', { i })?.observed_at;
    expect(o(a.id)).toBe(t); expect(o(b.id)).toBe(w.rt.now); expect(o(c.id)).toBe(w.rt.now);
  });
  it('only reporters may submit', () => {
    for (const k of ['a_tech', 'a_dispatcher', 'a_admin', 'a_auditor', 'platform']) { if (k === 'platform') continue; expect(() => submitReport(w.ctx(k), { category: 'leak', asset_id: w.assetA }, null)).toThrow(/Not permitted/); }
  });
});

describe('contamination escalation', () => {
  it('raises a precautionary alert: asset status, P1 work order, notifications, audit', () => {
    const r = submitReport(rep(), { category: 'contamination', text: 'Brown water, smells of fuel', asset_id: w.assetA2 }, null);
    expect(r.contamination).toBe(true);
    expect(w.rt.sys.get<{ status: string }>('SELECT status FROM assets WHERE id = :a', { a: w.assetA2 })?.status).toBe('contamination');
    const notes = w.rt.sys.all<{ user_id: string; title: string }>("SELECT user_id, title FROM notifications WHERE kind = 'contamination'");
    expect(notes.map((n) => n.user_id).sort()).toEqual([uid('a_admin'), uid('a_dispatcher')].sort()); expect(notes[0]?.title).toMatch(/high priority/i);
    expect(w.rt.sys.get("SELECT 1 AS x FROM audit_log WHERE action = 'report.contamination_escalated'")).toBeTruthy();
    const wo = createFromReports(disp(), { reportIds: [r.id], priority: 'P3' }); // dispatcher tries to downgrade
    expect(getWorkOrder(disp(), wo)).toMatchObject({ priority: 'P1', kind: 'contamination', sla_minutes: 120 });
  });
  it('the contamination status cannot be cleared without a recorded reason; with one it is audited', () => {
    throwsApp(() => setAssetStatus(disp(), w.assetA2, 'operational', ''), /reason/);
    throwsApp(() => setAssetStatus(disp(), w.assetA2, 'operational', 'ok'), /reason/);
    setAssetStatus(disp(), w.assetA2, 'operational', 'Lab ref KEMRI-LAB-001: sample clear');
    expect(w.rt.sys.get("SELECT 1 AS x FROM audit_log WHERE action = 'asset.contamination_cleared'")).toBeTruthy();
  });
  it('contamination reports cannot be rejected', () => {
    const r = submitReport(w.ctx('a_reporter2'), { category: 'contamination', asset_id: w.assetA2 }, null);
    throwsApp(() => rejectReport(disp(), r.id, 'looks fake to me'), /cannot be rejected/);
  });
  it('contamination reports are pinned first in triage', () => {
    const rows = listReports(disp(), { status: 'new' }); expect(rows[0]?.category).toBe('contamination');
  });
  it('the report page and the done screen show safety guidance and the disclaimer', async () => {
    const c = await loggedIn(w, 'a_reporter');
    const page = await (await c.get('/report')).text();
    expect(page).toContain('Do not drink, cook with or give this water'); expect(page).toContain('not laboratory results');
    expect(await (await c.get('/report/done?ref=R-1&c=1')).text()).toContain('Do not drink');
    expect(await (await c.get('/report?lang=sw')).text()).toContain('Usinywe, usipikie');
  });
});

describe('triage', () => {
  it('dispatcher links reports to one work order, marks duplicates, rejects with a reason', () => {
    const a = submitReport(w.ctx('a_reporter2'), { category: 'low_pressure', asset_id: w.assetA2 }, null), b = submitReport(rep(), { category: 'low_pressure', asset_id: w.assetA2 }, null);
    markDuplicate(disp(), b.id, a.id);
    expect(w.rt.sys.get<{ status: string; duplicate_of: string }>('SELECT status, duplicate_of FROM reports WHERE id = :i', { i: b.id })).toMatchObject({ status: 'duplicate', duplicate_of: a.id });
    throwsApp(() => markDuplicate(disp(), b.id, a.id), /Only new/); throwsApp(() => markDuplicate(disp(), a.id, a.id), /itself/);
    const c = submitReport(rep(), { category: 'leak', asset_id: w.assetA }, null);
    throwsApp(() => rejectReport(disp(), c.id, 'no'), /5 characters/);
    rejectReport(disp(), c.id, 'Not a WaterWatch asset');
    expect(w.rt.sys.get<{ status: string }>('SELECT status FROM reports WHERE id = :i', { i: c.id })?.status).toBe('rejected');
  });
  it('requires reports for a single asset and only new reports', () => {
    const a = submitReport(rep(), { category: 'leak', asset_id: w.assetA }, null), b = submitReport(w.ctx('a_reporter2'), { category: 'leak', asset_id: w.assetA2 }, null);
    throwsApp(() => createFromReports(disp(), { reportIds: [a.id, b.id] }), /same asset/);
    throwsApp(() => createFromReports(disp(), { reportIds: [] }), /at least one/);
    const id = createFromReports(disp(), { reportIds: [a.id] });
    throwsApp(() => createFromReports(disp(), { reportIds: [a.id] }), /Only new/);
    expect(w.rt.sys.get<{ work_order_id: string; status: string }>('SELECT work_order_id, status FROM reports WHERE id = :i', { i: a.id })).toMatchObject({ work_order_id: id, status: 'linked' });
  });
  it('the work-order fault start is the earliest linked report time (SLA clock starts at the report)', () => {
    const t1 = w.rt.now - 5 * HOUR, t2 = w.rt.now - HOUR;
    const a = submitReport(rep(), { category: 'no_water', asset_id: w.assetA, observed_at: t1, client_uid: 'tri-uid-000001' }, null), b = submitReport(w.ctx('a_reporter2'), { category: 'no_water', asset_id: w.assetA, observed_at: t2, client_uid: 'tri-uid-000002' }, null);
    const id = createFromReports(disp(), { reportIds: [b.id, a.id], priority: 'P2' });
    const wo = getWorkOrder(disp(), id); expect(wo.fault_started_at).toBe(t1); expect(wo.sla.state).toBe('ok'); expect(wo.sla.remainingMin).toBe(1440 - 300);
  });
});

describe('work-order lifecycle (report -> assignment -> repair -> confirmation)', () => {
  let woId: string, repId: string;
  it('create from a report, unassigned (New)', () => {
    const r = submitReport(rep(), { category: 'pump_failure', text: 'Pump silent', asset_id: w.assetA, client_uid: 'life-uid-000001' }, null); repId = r.id;
    woId = createFromReports(disp(), { reportIds: [r.id], priority: 'P2' });
    expect(status(woId)).toBe('new'); expect(getWorkOrder(disp(), woId).sla_minutes).toBe(1440);
  });
  it('a technician cannot see or act on an unassigned work order', () => {
    throwsApp(() => getWorkOrder(tech(), woId), /not found/i);
    throwsApp(() => transitionWorkOrder(tech(), woId, { to: 'in_progress' }), /not found/i);
  });
  it('assignment requires an active technician of the same organisation', () => {
    throwsApp(() => assignWorkOrder(disp(), woId, uid('a_reporter')), /technician/); throwsApp(() => assignWorkOrder(disp(), woId, uid('b_tech')), /technician/); throwsApp(() => assignWorkOrder(disp(), woId, 'nope'), /technician/);
    assignWorkOrder(disp(), woId, uid('a_tech')); expect(status(woId)).toBe('assigned');
    expect(w.rt.sys.get("SELECT 1 AS x FROM notifications WHERE user_id = :u AND kind = 'assignment'", { u: uid('a_tech') })).toBeTruthy();
  });
  it('technician starts work; cannot cancel, confirm or skip states', () => {
    transitionWorkOrder(tech(), woId, { to: 'in_progress' }); expect(status(woId)).toBe('in_progress');
    for (const to of ['cancelled', 'closed', 'assigned', 'new'] as const) throwsApp(() => transitionWorkOrder(tech(), woId, { to, note: 'a valid reason here' }), /Cannot move|may not|Not permitted/);
  });
  it('awaiting parts and resume; SLA clock pause only if enabled (default: keeps running)', () => {
    transitionWorkOrder(tech(), woId, { to: 'awaiting_parts' }); w.rt.advance(2 * HOUR); transitionWorkOrder(tech(), woId, { to: 'in_progress' });
    expect(getWorkOrder(disp(), woId).sla.pausedMin).toBe(0);
  });
  it('costs: integer minor units; KES parsing is strict; bad input rejected', () => {
    expect(parseKesToMinor('1850')).toBe(185000); expect(parseKesToMinor('1,850.5')).toBe(185050); expect(parseKesToMinor('0.07')).toBe(7);
    for (const bad of ['', '-5', '1e3', 'abc', '12.345', '1.', '.5', '99999999999']) expect(() => parseKesToMinor(bad), bad).toThrow();
    addMaterial(tech(), woId, { name: 'Contactor 40A', category: 'parts', qty: 2, unitCostMinor: 185050 });
    addMaterial(tech(), woId, { name: 'Labour', category: 'labour', qty: 1, unitCostMinor: 100000 });
    expect(getWorkOrder(disp(), woId).cost_minor).toBe(2 * 185050 + 100000);
    throwsApp(() => addMaterial(tech(), woId, { name: 'x', category: 'parts', qty: 1, unitCostMinor: 1 }), /2-120/); throwsApp(() => addMaterial(tech(), woId, { name: 'Valid', category: 'parts', qty: 0, unitCostMinor: 1 }), /Quantity/);
    throwsApp(() => addMaterial(tech(), woId, { name: 'Valid', category: 'parts', qty: 1, unitCostMinor: -1 }), /Unit cost/); throwsApp(() => addMaterial(tech(), woId, { name: 'Valid', category: 'gold', qty: 1, unitCostMinor: 1 }), /category/);
    expect(woMaterials(disp(), woId)).toHaveLength(2);
  });
  it('completion requires a completion photo uploaded by the technician', async () => {
    throwsApp(() => transitionWorkOrder(tech(), woId, { to: 'completed' }), /photo is required/);
    const reportPhoto = await savePhoto(rep(), 'report', await plainPng());
    throwsApp(() => transitionWorkOrder(tech(), woId, { to: 'completed', photoId: reportPhoto }), /Invalid completion photo/); // a report photo is not a completion photo
    const otherTechPhoto = await savePhoto(w.ctx('a_tech2'), 'completion', await plainPng());
    throwsApp(() => transitionWorkOrder(tech(), woId, { to: 'completed', photoId: otherTechPhoto }), /Invalid completion photo/);
    const ph = await savePhoto(tech(), 'completion', await jpegWithExif());
    w.rt.advance(HOUR);
    transitionWorkOrder(tech(), woId, { to: 'completed', photoId: ph, completionNotes: 'Replaced contactor' });
    expect(status(woId)).toBe('completed');
    expect(w.rt.sys.get<{ completion_photo_id: string }>('SELECT completion_photo_id FROM work_orders WHERE id = :i', { i: woId })?.completion_photo_id).toBe(ph);
    expect(w.rt.sys.get<{ cost_minor: number; asset_id: string }>('SELECT cost_minor, asset_id FROM maintenance_records WHERE work_order_id = :w', { w: woId })).toMatchObject({ cost_minor: 470100, asset_id: w.assetA });
  });
  it('dispatcher can send it back with a reason, technician sees the reason, then it completes again', async () => {
    throwsApp(() => transitionWorkOrder(disp(), woId, { to: 'in_progress', note: 'no' }), /5 characters/);
    transitionWorkOrder(disp(), woId, { to: 'in_progress', note: 'Photo does not show the repaired part' });
    expect(status(woId)).toBe('in_progress'); expect(w.rt.sys.get<{ completed_at: number | null }>('SELECT completed_at FROM work_orders WHERE id = :i', { i: woId })?.completed_at).toBeNull();
    expect(w.rt.sys.get("SELECT 1 AS x FROM notifications WHERE user_id = :u AND kind = 'reopened'", { u: uid('a_tech') })).toBeTruthy();
    const c = await loggedIn(w, 'a_tech'); expect(await (await c.get(`/tech/${woId}`)).text()).toContain('Photo does not show the repaired part');
    const ph = await savePhoto(tech(), 'completion', await plainPng()); transitionWorkOrder(tech(), woId, { to: 'completed', photoId: ph });
    expect(w.rt.sys.all('SELECT 1 FROM maintenance_records WHERE work_order_id = :w', { w: woId })).toHaveLength(1); // upserted, not duplicated
  });
  it('only dispatchers/admins confirm; costs can still change before confirmation and flow into the history', () => {
    throwsApp(() => transitionWorkOrder(tech(), woId, { to: 'closed' }), /may not|Not permitted/);
    addMaterial(disp(), woId, { name: 'Transport', category: 'transport', qty: 1, unitCostMinor: 5000 });
    expect(w.rt.sys.get<{ cost_minor: number }>('SELECT cost_minor FROM maintenance_records WHERE work_order_id = :w', { w: woId })?.cost_minor).toBe(475100);
    setAssetStatus(disp(), w.assetA, 'down', 'pump failed');
    transitionWorkOrder(disp(), woId, { to: 'closed', restoreStatus: 'operational' });
    expect(status(woId)).toBe('closed'); expect(assetStatus()).toBe('operational');
    expect(w.rt.sys.get<{ closed_by: string }>('SELECT closed_by FROM work_orders WHERE id = :i', { i: woId })?.closed_by).toBe(uid('a_dispatcher'));
    throwsApp(() => addMaterial(disp(), woId, { name: 'Late cost', category: 'parts', qty: 1, unitCostMinor: 1 }), /closed/);
    throwsApp(() => transitionWorkOrder(disp(), woId, { to: 'in_progress', note: 'reopen closed job' }), /Cannot move/);
  });
  it('analytics reflect the repair (outage report, MTTR, downtime, cost, history)', () => {
    const a = buildAnalytics(w.ctx('a_dispatcher'), { weeks: 4 });
    expect(a.totalOutageReports).toBeGreaterThan(0); expect(a.mttr.count).toBe(1);
    const hours = (w.rt.sys.get<{ c: number; f: number }>('SELECT completed_at AS c, fault_started_at AS f FROM work_orders WHERE id = :i', { i: woId }) as { c: number; f: number });
    expect(a.mttr.meanHours).toBeCloseTo((hours.c - hours.f) / HOUR, 6);
    expect(a.cost.totalMinor).toBe(475100); expect(a.cost.byCategory.map((x) => x.category)).toEqual(['parts', 'labour', 'transport']);
    expect(a.downtime.find((d) => d.assetName.includes('A-001'))?.hours).toBeGreaterThan(0);
    void repId;
  });
  it('a completed repair confirms against SLA (met/missed evaluated at completion, not now)', () => {
    const wo = getWorkOrder(disp(), woId); expect(['met', 'missed']).toContain(wo.sla.state);
  });
  it('every step left an audit record and the chain is intact', () => {
    const acts = w.rt.sys.all<{ action: string }>("SELECT action FROM audit_log WHERE object_id = :i", { i: woId }).map((r) => r.action);
    for (const a of ['workorder.created', 'workorder.assigned', 'workorder.in_progress', 'workorder.awaiting_parts', 'workorder.cost_added', 'workorder.completed', 'workorder.closed']) expect(acts, a).toContain(a);
    expect(verifyChain(w.rt.db, w.orgA)).toMatchObject({ ok: true });
  });
});

describe('cancel, manual orders, SLA pause setting', () => {
  it('cancel needs a reason and is terminal', () => {
    const id = createWorkOrder(disp(), { assetId: w.assetA, title: 'Inspect valve', priority: 'P3', kind: 'planned' });
    throwsApp(() => transitionWorkOrder(disp(), id, { to: 'cancelled' }), /reason/); transitionWorkOrder(disp(), id, { to: 'cancelled', note: 'Asset decommissioned' });
    expect(status(id)).toBe('cancelled'); throwsApp(() => transitionWorkOrder(disp(), id, { to: 'assigned' }), /Cannot move/);
  });
  it('title and priority are validated; manual orders start unassigned', () => {
    throwsApp(() => createWorkOrder(disp(), { assetId: w.assetA, title: 'ab', priority: 'P3', kind: 'reactive' }), /Title/); throwsApp(() => createWorkOrder(disp(), { assetId: w.assetA, title: 'Valid title', priority: 'P9' as never, kind: 'reactive' }), /priority/);
    expect(getWorkOrder(disp(), createWorkOrder(disp(), { assetId: w.assetA, title: 'Valid title', priority: 'P2', kind: 'reactive' })).status).toBe('new');
  });
  it('with the pause setting on, awaiting-parts time extends the SLA', async () => {
    const s = await makeWorld(); s.rt.sys.run('UPDATE organisations SET settings = :s WHERE id = :o', { s: JSON.stringify({ slaPauseAwaitingParts: true, slaMinutes: { P1: 120, P2: 1440, P3: 4320 } }), o: s.orgA });
    const id = createWorkOrder(s.ctx('a_dispatcher'), { assetId: s.assetA, title: 'Pause test', priority: 'P1', kind: 'reactive', assigneeId: s.users['a_tech']?.id as string });
    transitionWorkOrder(s.ctx('a_tech'), id, { to: 'in_progress' }); s.rt.advance(30 * MIN); transitionWorkOrder(s.ctx('a_tech'), id, { to: 'awaiting_parts' });
    s.rt.advance(60 * MIN); transitionWorkOrder(s.ctx('a_tech'), id, { to: 'in_progress' });
    const wo = getWorkOrder(s.ctx('a_dispatcher'), id); expect(wo.sla.pausedMin).toBe(60); expect(wo.sla.remainingMin).toBe(120 - 30); expect(wo.sla.state).toBe('ok');
    s.rt.cleanup();
  });
  it('SLA placeholders are copied at creation, so later setting changes do not shift existing orders', async () => {
    const s = await makeWorld(); const id = createWorkOrder(s.ctx('a_dispatcher'), { assetId: s.assetA, title: 'Frozen SLA', priority: 'P1', kind: 'reactive' });
    s.rt.sys.run('UPDATE organisations SET settings = :s WHERE id = :o', { s: JSON.stringify({ slaMinutes: { P1: 30, P2: 60, P3: 90 } }), o: s.orgA });
    expect(getWorkOrder(s.ctx('a_dispatcher'), id).sla_minutes).toBe(120);
    expect(getWorkOrder(s.ctx('a_dispatcher'), createWorkOrder(s.ctx('a_dispatcher'), { assetId: s.assetA, title: 'New SLA', priority: 'P1', kind: 'reactive' })).sla_minutes).toBe(30);
    s.rt.cleanup();
  });
  it('a breached P1 shows as breached with how long ago', () => {
    const id = createWorkOrder(disp(), { assetId: w.assetA, title: 'Late P1', priority: 'P1', kind: 'reactive' }); w.rt.advance(150 * MIN);
    const wo = getWorkOrder(disp(), id); expect(wo.sla.state).toBe('breached'); expect(wo.sla.remainingMin).toBe(-30);
    expect(listWorkOrders(disp()).filter((x) => x.sla.state === 'breached').length).toBeGreaterThan(0);
  });
});

describe('planned maintenance scheduling', () => {
  it('generates work orders 7 days before due, idempotently, and advances the schedule', () => {
    const s = w.ctx('a_dispatcher');
    const today = new Date(w.rt.now + 3 * HOUR).toISOString().slice(0, 10);
    const due = new Date(Date.parse(today + 'T00:00:00Z') + 5 * 86400000).toISOString().slice(0, 10);
    const sid = createSchedule(s, { assetId: w.assetA, title: 'Quarterly pump service', intervalDays: 90, firstDue: due, priority: 'P3' });
    expect(generatePlannedWork(s)).toBe(1); expect(generatePlannedWork(s)).toBe(0); expect(generatePlannedWork(s)).toBe(0);
    const wos = w.rt.sys.all<{ kind: string; schedule_due: string; priority: string }>('SELECT kind, schedule_due, priority FROM work_orders WHERE schedule_id = :s', { s: sid });
    expect(wos).toEqual([{ kind: 'planned', schedule_due: due, priority: 'P3' }]);
    const next = new Date(Date.parse(due + 'T00:00:00Z') + 90 * 86400000).toISOString().slice(0, 10);
    expect(listSchedules(s).find((x) => x.id === sid)?.next_due).toBe(next);
  });
  it('paused schedules generate nothing; far-future schedules wait; validation applies', () => {
    const s = w.ctx('a_dispatcher'); const far = new Date(w.rt.now + 60 * 86400000).toISOString().slice(0, 10), past = new Date(w.rt.now - 86400000).toISOString().slice(0, 10);
    const sid = createSchedule(s, { assetId: w.assetA2, title: 'Tank clean', intervalDays: 30, firstDue: past, priority: 'P3' }); setScheduleActive(s, sid, false);
    createSchedule(s, { assetId: w.assetA2, title: 'Far future', intervalDays: 30, firstDue: far, priority: 'P3' });
    expect(generatePlannedWork(s)).toBe(0); setScheduleActive(s, sid, true); expect(generatePlannedWork(s)).toBe(1);
    throwsApp(() => createSchedule(s, { assetId: w.assetA, title: 'x', intervalDays: 30, firstDue: far, priority: 'P3' }), /Title/); throwsApp(() => createSchedule(s, { assetId: w.assetA, title: 'Valid', intervalDays: 0, firstDue: far, priority: 'P3' }), /Interval/);
    throwsApp(() => createSchedule(s, { assetId: w.assetA, title: 'Valid', intervalDays: 7, firstDue: '31/12/2026', priority: 'P3' }), /YYYY-MM-DD/);
  });
  it('planned work does not count as downtime, MTTR or repeat failures', () => {
    const a = buildAnalytics(w.ctx('a_dispatcher'), { weeks: 4 }); void a;
    expect(w.rt.sys.all("SELECT 1 FROM work_orders WHERE kind = 'planned'").length).toBeGreaterThan(0);
    expect(buildAnalytics(w.ctx('a_dispatcher'), { weeks: 4 }).mttr.count).toBe(1);
  });
  it('the schedule page is visible to dispatchers and the manual generate button works', async () => {
    const c = await loggedIn(w, 'a_dispatcher'); expect(await (await c.get('/console/schedule')).text()).toContain('Quarterly pump service');
    expect((await c.req('POST', '/console/schedule/generate', { form: {} })).status).toBe(303);
  });
});

describe('HTTP workflow: photo upload + completion through the technician UI', () => {
  it('rejects completion without a photo or with a non-image, accepts a real photo', async () => {
    const r = submitReport(rep(), { category: 'leak', asset_id: w.assetA, client_uid: 'http-uid-000001' }, null);
    const id = createFromReports(disp(), { reportIds: [r.id], assigneeId: uid('a_tech') });
    const t = await loggedIn(w, 'a_tech');
    await t.req('POST', `/tech/${id}/transition`, { form: { to: 'in_progress' } });
    const none = await t.req('POST', `/tech/${id}/complete`, { multipart: new FormData() }); expect(none.headers.get('location')).toBe(`/tech/${id}`); expect(status(id)).toBe('in_progress');
    const php = await t.req('POST', `/tech/${id}/complete`, { multipart: photoForm(new TextEncoder().encode('<?php echo 1; ?>'), 'shell.php.jpg') }); expect(php.headers.get('location')).toBe(`/tech/${id}`); expect(status(id)).toBe('in_progress');
    const ok = await t.req('POST', `/tech/${id}/complete`, { multipart: photoForm(await jpegWithExif(), 'x.jpg', 'image/jpeg', { notes: 'Fixed' }) }); expect(ok.headers.get('location')).toBe('/tech');
    expect(status(id)).toBe('completed');
    const d = await loggedIn(w, 'a_dispatcher');
    const confirm = await d.req('POST', `/console/orders/${id}/transition`, { form: { to: 'closed', restore: 'operational' } }); expect(confirm.status).toBe(303); expect(status(id)).toBe('closed');
  });
});

describe('HTTP: report API and no-JS form', () => {
  it('POST /api/v1/reports (multipart) returns 201 then 200 for the idempotent retry', async () => {
    const c = await loggedIn(w, 'a_reporter2');
    const mk = () => photoForm(new Uint8Array(0), 'p.jpg'); void mk;
    const fd = () => { const f = new FormData(); f.set('category', 'low_pressure'); f.set('asset_id', w.assetA); f.set('client_uid', 'api-uid-0000001'); f.set('text', 'Trickle'); return f; };
    const a = await c.req('POST', '/api/v1/reports', { multipart: fd() }); expect(a.status).toBe(201);
    const b = await c.req('POST', '/api/v1/reports', { multipart: fd() }); expect(b.status).toBe(200); expect(((await b.json()) as { deduplicated: boolean }).deduplicated).toBe(true);
  });
  it('rejects invalid report API input with 400 and a message', async () => {
    const c = await loggedIn(w, 'a_reporter2'); const fd = new FormData(); fd.set('category', 'leak');
    const r = await c.req('POST', '/api/v1/reports', { multipart: fd }); expect(r.status).toBe(400); expect(((await r.json()) as { message: string }).message).toMatch(/water point/);
  });
  it('the no-JS HTML form works and shows the contamination safety text on the confirmation page', async () => {
    const c = await loggedIn(w, 'a_reporter2'); const fd = new FormData(); fd.set('category', 'contamination'); fd.set('asset_id', w.assetA); fd.set('lang', 'en'); fd.set('client_uid', 'form-uid-000001');
    const r = await c.req('POST', '/report', { multipart: fd }); expect(r.status).toBe(303); expect(r.headers.get('location')).toMatch(/c=1/);
    expect(await (await c.get(r.headers.get('location') as string)).text()).toContain('Do not drink');
  });
  it('ignores and neutralises client-supplied extra fields (mass assignment): status, origin, reporter', async () => {
    const c = await loggedIn(w, 'a_reporter2'); const fd = new FormData(); fd.set('category', 'access'); fd.set('asset_id', w.assetA); fd.set('status', 'linked'); fd.set('origin', 'verified_live'); fd.set('reporter_id', uid('a_admin')); fd.set('org_id', w.orgB); fd.set('client_uid', 'mass-uid-000001');
    const r = (await (await c.req('POST', '/api/v1/reports', { multipart: fd })).json()) as { id: string };
    expect(w.rt.sys.get('SELECT status, origin, reporter_id, org_id FROM reports WHERE id = :i', { i: r.id })).toMatchObject({ status: 'new', origin: 'user_submitted', reporter_id: uid('a_reporter2'), org_id: w.orgA });
  });
});
void Client; void T0;
