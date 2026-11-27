import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword, encryptSecret } from '../core/crypto.ts';
import { appendAudit } from '../domain/audit.ts';
import { tx } from '../db/index.ts';
import type { Runtime } from '../repo/ctx.ts';

/** SYNTHETIC DEMONSTRATION DATA: fictional utility "Mto Kijani Water Company" in fictional "Kijani County". Every record carries origin = 'synthetic'. */
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
export type SeedResult = { password: string; orgId: string; org2Id: string; users: Record<string, string>; deviceFile: string };

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const ASSETS: [string, string, string, number, number, string, string, string, number | null, Record<string, number | string>][] = [
  ['A-001', 'Mto Kijani Treatment Works', 'treatment', 50, 20, 'operational', 'utility', 'Mto Kijani Water Company', 2009, { capacity_m3_day: 5000, process: 'Coagulation, filtration, chlorination' }],
  ['A-002', 'Ridge Tank 1 (500 m³)', 'tank', 44, 34, 'operational', 'utility', 'Mto Kijani Water Company', 2012, { volume_m3: 500, material: 'Concrete' }],
  ['A-003', 'Ridge Pump Station', 'pump', 48, 28, 'degraded', 'utility', 'Mto Kijani Water Company', 2012, { power_kw: 45, head_m: 120 }],
  ['A-004', 'Soko Kiosk', 'kiosk', 30, 46, 'operational', 'vendor', 'Vendor lease', 2018, { operator: 'Soko vendor (synthetic)', taps: 4 }],
  ['A-005', 'Maji Mapya Borehole', 'borehole', 72, 40, 'down', 'community', 'Community committee', 2016, { depth_m: 160, yield_m3h: 14, pump_kw: 11 }],
  ['A-006', 'Kwa Mama Njeri Water Point', 'waterpoint', 18, 62, 'contamination', 'community', 'Community committee', 2015, { source: 'Hand pump', users_served: 600 }],
  ['A-007', 'Njiwa Kiosk', 'kiosk', 60, 58, 'operational', 'vendor', 'Vendor lease', 2019, { taps: 3 }],
  ['A-008', 'Mlima Tank 2 (200 m³)', 'tank', 68, 26, 'operational', 'utility', 'Mto Kijani Water Company', 2014, { volume_m3: 200, material: 'Steel' }],
  ['A-009', 'Kisima Borehole', 'borehole', 82, 66, 'degraded', 'county', 'County government', 2011, { depth_m: 120, yield_m3h: 9 }],
  ['A-010', 'Shule Water Point', 'waterpoint', 36, 72, 'operational', 'community', 'Community committee', 2020, { source: 'Piped tap stand', users_served: 400 }],
  ['A-011', 'Bridge Valve V-12', 'valve', 54, 44, 'operational', 'utility', 'Mto Kijani Water Company', 2012, { size_mm: 200 }],
  ['A-012', 'Market Kiosk 2', 'kiosk', 44, 60, 'unknown', 'vendor', 'Vendor lease', 2021, { taps: 2 }],
  ['A-013', 'Kivuko Pump Station', 'pump', 26, 30, 'operational', 'ngo', 'NGO (programme)', 2022, { power_kw: 15, head_m: 60 }],
  ['A-014', 'Mwamba Water Point', 'waterpoint', 86, 48, 'operational', 'community', 'Community committee', 2017, { source: 'Hand pump', users_served: 350 }],
  ['A-015', 'Eastgate Valve V-31', 'valve', 74, 56, 'degraded', 'utility', 'Mto Kijani Water Company', 2013, { size_mm: 150 }],
  ['A-016', 'Ridge Main (DN300)', 'pipe', 58, 34, 'operational', 'utility', 'Mto Kijani Water Company', 2012, { length_m: 2400, diameter_mm: 300, material: 'Ductile iron' }]
];
const LINKS = [['A-001', 'A-003'], ['A-003', 'A-002'], ['A-002', 'A-011'], ['A-011', 'A-007'], ['A-011', 'A-005'], ['A-001', 'A-008'], ['A-008', 'A-005'], ['A-005', 'A-015'], ['A-015', 'A-009'], ['A-015', 'A-014'], ['A-007', 'A-012'], ['A-012', 'A-010'], ['A-011', 'A-004'], ['A-004', 'A-006'], ['A-013', 'A-004'], ['A-013', 'A-003']];
// Fictional coordinates in a small box (the demo "Kijani County"), within the default Kenya service-area bounds.
const geo = (x: number, y: number): [number, number] => [Math.round((-1.25 - (y / 100) * 0.08) * 1e5) / 1e5, Math.round((36.8 + (x / 100) * 0.14) * 1e5) / 1e5];

export async function seedDemo(rt: Runtime, dataDirForFile: string, passwordIn?: string): Promise<SeedResult> {
  const db: DatabaseSync = rt.db;
  const now = rt.clock();
  const password = passwordIn || 'Demo-' + randomBytes(9).toString('base64url') + '9a';
  const hash = await hashPassword(password);
  const R = rng(20260601);
  const id = () => crypto.randomUUID();
  const orgId = id(), org2Id = id(), platformUser = id();
  const users: Record<string, string> = {};

  tx(db, () => {
    const ins = (sql: string, ...a: (string | number | null)[]) => db.prepare(sql).run(...a);
    ins("INSERT INTO organisations (id, name, kind, is_demo, settings, created_at) VALUES (?,?,?,?,?,?)", orgId, 'Mto Kijani Water Company', 'utility', 1, '{}', now - 90 * DAY);
    ins("INSERT INTO organisations (id, name, kind, is_demo, settings, created_at) VALUES (?,?,?,?,?,?)", org2Id, 'Bahari County Water Programme', 'county', 1, '{}', now - 60 * DAY);
    const user = (key: string, org: string | null, email: string, name: string, role: string, extra: { scope?: string; phone?: string } = {}) => {
      const uid = key === 'platform' ? platformUser : id();
      users[key] = email;
      ins("INSERT INTO users (id, org_id, email, name, phone, role, password_hash, status, scope_owner, origin, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", uid, org, email, name, extra.phone ?? null, role, hash, 'active', extra.scope ?? null, 'synthetic', now - 80 * DAY);
      return uid;
    };
    user('platform', null, 'platform@waterwatch.test', 'Platform Admin (synthetic)', 'platform_admin');
    user('admin', orgId, 'admin@mtokijani.test', 'Esther Admin (synthetic)', 'org_admin');
    const disp = user('dispatcher', orgId, 'dispatcher@mtokijani.test', 'Mary Dispatcher (synthetic)', 'dispatcher');
    const techIds = [
      user('tech1', orgId, 'peter@mtokijani.test', 'Peter Otieno (synthetic)', 'technician'),
      user('tech2', orgId, 'amina@mtokijani.test', 'Amina Wekesa (synthetic)', 'technician'),
      user('tech3', orgId, 'joseph@mtokijani.test', 'Joseph Kiprono (synthetic)', 'technician'),
      user('tech4', orgId, 'grace@mtokijani.test', 'Grace Mutua (synthetic)', 'technician')
    ];
    const rep1 = user('reporter', orgId, 'wanjiru@mtokijani.test', 'Wanjiru (synthetic reporter)', 'reporter', { phone: '+254700000118' });
    const rep2 = user('reporter2', orgId, 'otieno.r@mtokijani.test', 'Verified reporter R-044 (synthetic)', 'reporter', { phone: '+254700000044' });
    user('auditor', orgId, 'auditor@mtokijani.test', 'Read-only Auditor (synthetic)', 'auditor');
    user('ngo', orgId, 'ngo@mtokijani.test', 'NGO programme monitor (synthetic)', 'auditor', { scope: 'NGO (programme)' });
    user('admin2', org2Id, 'admin@bahari.test', 'Bahari Admin (synthetic)', 'org_admin');
    user('dispatcher2', org2Id, 'dispatcher@bahari.test', 'Bahari Dispatcher (synthetic)', 'dispatcher');
    user('tech5', org2Id, 'tech@bahari.test', 'Bahari Technician (synthetic)', 'technician');
    user('reporter3', org2Id, 'reporter@bahari.test', 'Bahari reporter (synthetic)', 'reporter');

    // assets
    const aid: Record<string, string> = {};
    for (const [code, name, type, x, y, status, ot, on, yr, attr] of ASSETS) {
      const [lat, lng] = geo(x, y);
      const i = id(); aid[code] = i;
      ins("INSERT INTO assets (id, org_id, code, name, type, status, owner_type, owner_name, lat, lng, install_year, attributes, notes, origin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", i, orgId, code, name, type, status, ot, on, lat, lng, yr, JSON.stringify(attr), null, 'synthetic', now - 85 * DAY, now - 2 * DAY);
    }
    for (const [a, b] of LINKS) ins('INSERT INTO asset_links (id, org_id, from_asset, to_asset) VALUES (?,?,?,?)', id(), orgId, aid[a as string] as string, aid[b as string] as string);
    const b1 = id(), b2 = id();
    ins("INSERT INTO assets (id, org_id, code, name, type, status, owner_type, owner_name, lat, lng, install_year, attributes, origin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", b1, org2Id, 'B-001', 'Pwani Borehole (synthetic)', 'borehole', 'operational', 'county', 'Bahari County', -4.05, 39.67, 2018, '{}', 'synthetic', now - 50 * DAY, now - 50 * DAY);
    ins("INSERT INTO assets (id, org_id, code, name, type, status, owner_type, owner_name, lat, lng, install_year, attributes, origin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", b2, org2Id, 'B-002', 'Bandari Kiosk (synthetic)', 'kiosk', 'degraded', 'county', 'Bahari County', -4.06, 39.68, 2020, '{}', 'synthetic', now - 50 * DAY, now - 50 * DAY);

    // reports and work orders (history + current)
    let rn = 1000, wn = 1000;
    const woIns = (assetCode: string, title: string, pri: string, status: string, kind: string, tech: string | null, createdAgo: number, mttrH: number | null, cost: [string, string, number, number][], faultAgo?: number) => {
      const wid = id(), created = now - createdAgo, fault = now - (faultAgo ?? createdAgo);
      const done = mttrH !== null ? fault + mttrH * HOUR : null;
      const sla = pri === 'P1' ? 120 : pri === 'P2' ? 1440 : 4320;
      ins("INSERT INTO work_orders (id, org_id, ref, asset_id, title, description, priority, status, kind, assignee_id, sla_minutes, sla_pause_awaiting, fault_started_at, created_by, created_at, started_at, completed_at, closed_at, closed_by, origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        wid, orgId, `WO-${++wn}`, aid[assetCode] as string, title, 'Synthetic demonstration work order', pri, status, kind, tech, sla, 0, fault, disp, created, done ? created + 2 * HOUR : null, done, status === 'closed' ? done : null, status === 'closed' ? disp : null, 'synthetic');
      ins('INSERT INTO wo_events (id, org_id, wo_id, ts, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?,?,?,?)', id(), orgId, wid, created, disp, null, tech ? 'assigned' : 'new', 'Created');
      if (done) ins('INSERT INTO wo_events (id, org_id, wo_id, ts, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?,?,?,?)', id(), orgId, wid, done, tech, 'in_progress', status, null);
      let total = 0;
      for (const [n, cat, q, u] of cost) { ins('INSERT INTO wo_materials (id, org_id, wo_id, name, category, qty, unit_cost_minor, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', id(), orgId, wid, n, cat, q, u, tech, done ?? created); total += q * u; }
      if (done) ins("INSERT INTO maintenance_records (id, org_id, asset_id, work_order_id, performed_on, summary, performed_by, cost_minor, origin, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", id(), orgId, aid[assetCode] as string, wid, new Date(done + 3 * HOUR).toISOString().slice(0, 10), `WO-${wn}: ${title}`, 'Synthetic technician', total, 'synthetic', done);
      return wid;
    };
    const rep = (assetCode: string, cat: string, text: string, lang: string, ago: number, by: string, status: string, wo: string | null, lat: number, lng: number, acc: number) => {
      ins("INSERT INTO reports (id, org_id, ref, asset_id, category, text, lang, lat, lng, accuracy_m, reporter_id, status, work_order_id, origin, observed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id(), orgId, `R-${++rn}`, aid[assetCode] as string, cat, text, lang, lat, lng, acc, by, status, wo, 'synthetic', now - ago, now - ago);
    };
    // 8 weeks of history: repeated failures at A-005, A-009, A-015, A-003 plus others
    const hist: [string, string, string, string, number, number, number, [string, string, number, number][]][] = [
      ['A-005', 'Starter contactor replaced', 'P2', 'tech2', 52, 21, 0, [['Contactor 40A', 'parts', 1, 180000], ['Labour', 'labour', 1, 150000]]],
      ['A-005', 'Pump motor rewound', 'P2', 'tech2', 38, 30, 0, [['Motor rewind (contractor)', 'contractor', 1, 960000]]],
      ['A-005', 'Starter contactor replaced', 'P2', 'tech2', 21, 19, 0, [['Contactor 40A', 'parts', 1, 180000], ['Transport', 'transport', 1, 25000]]],
      ['A-005', 'Starter contactor replaced', 'P2', 'tech2', 9, 24, 0, [['Contactor 40A', 'parts', 1, 180000], ['Labour', 'labour', 1, 150000]]],
      ['A-009', 'Pump pulled, bearing replaced', 'P2', 'tech2', 47, 33, 0, [['Bearing set', 'parts', 1, 210000], ['Crane hire', 'contractor', 1, 300000]]],
      ['A-009', 'Rising main joint repaired', 'P2', 'tech2', 28, 22, 0, [['Coupling DN80', 'parts', 2, 38000], ['Labour', 'labour', 1, 90000]]],
      ['A-009', 'Rising main joint repaired', 'P2', 'tech2', 12, 26, 0, [['Coupling DN80', 'parts', 1, 38000]]],
      ['A-015', 'Valve chamber leak: replace gland packing', 'P2', 'tech1', 40, 20, 0, [['Gland packing 10 mm', 'parts', 2, 18000]]],
      ['A-015', 'Valve chamber leak: replace gland packing', 'P2', 'tech1', 25, 18, 0, [['Gland packing 10 mm', 'parts', 2, 18000], ['Labour', 'labour', 1, 40000]]],
      ['A-015', 'Valve chamber leak: replace gland packing', 'P2', 'tech1', 6, 17, 0, [['Gland packing 10 mm', 'parts', 2, 18000]]],
      ['A-003', 'VFD fault reset', 'P2', 'tech4', 33, 14, 0, [['Labour', 'labour', 1, 60000]]],
      ['A-003', 'Suction strainer cleaned', 'P3', 'tech4', 14, 16, 0, [['Labour', 'labour', 1, 15000]]],
      ['A-014', 'Hand-pump seal replacement', 'P3', 'tech3', 20, 40, 0, [['Seal kit', 'parts', 1, 65000]]],
      ['A-012', 'Kiosk tap replacement', 'P3', 'tech3', 5, 30, 0, [['Brass tap', 'parts', 2, 24000]]],
      ['A-001', 'Chlorinator dosing pump service (planned)', 'P3', 'tech4', 16, 6, 0, [['Diaphragm kit', 'parts', 1, 320000], ['Labour', 'labour', 1, 100000]]]
    ];
    const techByKey: Record<string, string> = { tech1: techIds[0] as string, tech2: techIds[1] as string, tech3: techIds[2] as string, tech4: techIds[3] as string };
    for (const [code, title, pri, t, daysAgo, hrs, , cost] of hist) {
      const planned = title.includes('(planned)');
      const w = woIns(code, title, pri, 'closed', planned ? 'planned' : 'reactive', techByKey[t] as string, daysAgo * DAY, hrs, cost);
      if (!planned) rep(code, code === 'A-005' ? 'pump_failure' : code === 'A-015' ? 'leak' : code === 'A-009' ? 'low_pressure' : 'no_water', `Synthetic report for ${title}`, 'en', daysAgo * DAY + 30 * MIN, R() > 0.5 ? rep1 : rep2, 'linked', w, -1.29, 36.9, 12);
    }
    // current open work and reports (mirrors the design fixtures)
    const w320 = woIns('A-006', 'Contamination response: isolate & sample', 'P1', 'new', 'contamination', null, 22 * MIN, null, []);
    rep('A-006', 'contamination', 'Water is brown with a strong smell since this morning. Children drank some.', 'en', 22 * MIN, rep1, 'linked', w320, -1.2931, 36.821, 12);
    const w319 = woIns('A-005', 'Borehole pump not running: inspect starter & motor', 'P1', 'assigned', 'reactive', techByKey['tech2'] as string, 65 * MIN, null, []);
    rep('A-005', 'no_water', 'Hakuna maji tangu jana jioni. Pampu haisikiki.', 'sw', 65 * MIN, rep2, 'linked', w319, -1.2804, 36.9011, 8);
    rep('A-005', 'pump_failure', 'Pump house is silent and the panel light is off.', 'en', 130 * MIN, rep1, 'linked', w319, -1.2806, 36.9013, 15);
    const w318 = woIns('A-015', 'Valve chamber leak: replace gland packing', 'P2', 'in_progress', 'reactive', techByKey['tech1'] as string, 26 * HOUR, null, [['Gland packing 10 mm', 'parts', 2, 18000]]);
    rep('A-015', 'leak', 'Water flowing onto road beside the valve chamber.', 'en', 26 * HOUR, rep2, 'linked', w318, -1.295, 36.912, 9);
    woIns('A-003', 'Evening pressure drop: check VFD & suction', 'P2', 'in_progress', 'reactive', techByKey['tech4'] as string, 14 * HOUR, null, []);
    const w316 = woIns('A-009', 'Low yield: pull pump, check rising main', 'P2', 'awaiting_parts', 'reactive', techByKey['tech2'] as string, 5 * HOUR, null, []);
    rep('A-009', 'low_pressure', 'Only a trickle at the tap since Monday.', 'en', 5 * HOUR, rep1, 'linked', w316, -1.3102, 36.921, 20);
    rep('A-012', 'damage', 'Tap handle broken, kiosk locked by vendor?', 'en', 20 * HOUR, rep2, 'new', null, -1.2999, 36.871, 10);
    rep('A-010', 'access', 'Gate to the water point is locked in the morning.', 'en', 3 * HOUR, rep1, 'new', null, -1.3075, 36.85, 14);
    // planned maintenance schedules
    ins("INSERT INTO maintenance_schedules (id, org_id, asset_id, title, interval_days, next_due, priority, created_by, created_at, origin) VALUES (?,?,?,?,?,?,?,?,?,?)", id(), orgId, aid['A-001'] as string, 'Chlorinator dosing pump service', 90, new Date(now + 5 * DAY).toISOString().slice(0, 10), 'P3', disp, now - 60 * DAY, 'synthetic');
    ins("INSERT INTO maintenance_schedules (id, org_id, asset_id, title, interval_days, next_due, priority, created_by, created_at, origin) VALUES (?,?,?,?,?,?,?,?,?,?)", id(), orgId, aid['A-002'] as string, 'Tank inspection and cleaning', 180, new Date(now + 30 * DAY).toISOString().slice(0, 10), 'P3', disp, now - 60 * DAY, 'synthetic');
    ins("INSERT INTO counters (org_id, name, value) VALUES (?,?,?)", orgId, 'R', rn - 1000);
    ins("INSERT INTO counters (org_id, name, value) VALUES (?,?,?)", orgId, 'WO', wn - 1000);

    // SIMULATED devices and readings (origin = simulated, never presented as real)
    const creds: { deviceKey: string; secret: string; name: string; sensors: { key: string; kind: string; base: number; amp: number; intervalS: number; unit: string }[] }[] = [];
    type Sim = { name: string; asset: string; key: string; kind: string; unit: string; role: string; ivS: number; base: number; amp: number; mn: number | null; mx: number | null; mode: 'ok' | 'missing' | 'flat' | 'late' | 'droppress' | 'pump'; param?: string };
    const sims: Sim[] = [
      { name: 'SIM-FL-01', asset: 'A-001', key: 'flow', kind: 'flow', unit: 'm³/h', role: 'production', ivS: 900, base: 210, amp: 30, mn: 0, mx: 600, mode: 'ok' },
      { name: 'SIM-LV-02', asset: 'A-002', key: 'level', kind: 'level', unit: '% full', role: 'none', ivS: 900, base: 68, amp: 12, mn: 0, mx: 100, mode: 'ok' },
      { name: 'SIM-PR-03', asset: 'A-003', key: 'pressure', kind: 'pressure', unit: 'bar', role: 'none', ivS: 900, base: 3.1, amp: 0.6, mn: 0, mx: 10, mode: 'droppress' },
      { name: 'SIM-FL-04', asset: 'A-005', key: 'flow', kind: 'flow', unit: 'm³/h', role: 'distribution', ivS: 900, base: 14, amp: 3, mn: 0, mx: 100, mode: 'missing' },
      { name: 'SIM-LV-05', asset: 'A-008', key: 'level', kind: 'level', unit: '% full', role: 'none', ivS: 900, base: 74, amp: 9, mn: 0, mx: 100, mode: 'ok' },
      { name: 'SIM-FL-06', asset: 'A-009', key: 'flow', kind: 'flow', unit: 'm³/h', role: 'distribution', ivS: 900, base: 9, amp: 2, mn: 0, mx: 100, mode: 'flat' },
      { name: 'SIM-PR-07', asset: 'A-013', key: 'pressure', kind: 'pressure', unit: 'bar', role: 'none', ivS: 3600, base: 2.6, amp: 0.3, mn: 0, mx: 10, mode: 'late' },
      { name: 'SIM-PS-08', asset: 'A-003', key: 'pump', kind: 'pump_status', unit: 'on/off', role: 'none', ivS: 900, base: 1, amp: 0, mn: 0, mx: 1, mode: 'pump' },
      { name: 'SIM-Q-09', asset: 'A-001', key: 'turbidity', kind: 'quality', unit: 'NTU', role: 'none', ivS: 900, base: 1.2, amp: 0.4, mn: 0, mx: 1000, mode: 'ok', param: 'turbidity' }
    ];
    const insR = db.prepare('INSERT OR IGNORE INTO readings (org_id, sensor_id, device_id, ts, value, uid, origin, received_at) VALUES (?,?,?,?,?,?,?,?)');
    for (const s of sims) {
      const did = id(), sid = id(), key = 'dev_' + randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').toLowerCase(), secret = randomBytes(32).toString('base64url');
      creds.push({ deviceKey: key, secret, name: s.name, sensors: [{ key: s.key, kind: s.kind, base: s.base, amp: s.amp, intervalS: s.ivS, unit: s.unit }] });
      const hours = 48, step = s.ivS * 1000;
      let last: number | null = null, lastV: number | null = null;
      const pending: [number, number][] = [];
      const cutoff = s.mode === 'missing' ? now - 24 * HOUR : s.mode === 'late' ? now - 95 * MIN : now - 3 * MIN;
      const n = Math.floor((hours * HOUR) / step);
      for (let k = n; k >= 0; k--) {
        const ts = now - k * step - (s.mode === 'late' ? 95 * MIN : 3 * MIN);
        if (ts > cutoff) continue;
        let v = s.base + s.amp * Math.sin(k / 3.2) + (R() - 0.5) * s.amp * 0.3;
        if (s.mode === 'droppress' && k < 24) v -= 1.3;
        if (s.mode === 'flat' && k < 14) v = 4.2;
        if (s.mode === 'pump') v = 1;
        if (s.kind === 'level' || s.kind === 'quality' || s.kind === 'flow') v = Math.max(0, v);
        v = Math.round(v * 100) / 100;
        pending.push([ts, v]);
        last = ts; lastV = v;
      }
      ins("INSERT INTO devices (id, org_id, device_key, name, asset_id, origin, status, secret_enc, battery_pct, rssi_dbm, last_seen_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", did, orgId, key, s.name, aid[s.asset] as string, 'simulated', 'active', encryptSecret(secret, rt.cfg.secretKey), s.mode === 'late' ? 17 : 80, s.mode === 'late' ? -108 : -84, last, now - 30 * DAY);
      ins("INSERT INTO sensors (id, org_id, device_id, asset_id, key, kind, param, unit, role, expected_interval_s, min_valid, max_valid, stuck_count, validation_required, last_reading_at, last_value, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        sid, orgId, did, aid[s.asset] as string, s.key, s.kind, s.param ?? null, s.unit, s.role, s.ivS, s.mn, s.mx, 12, s.kind === 'quality' ? 1 : 0, last, lastV, now - 30 * DAY);
      for (const [ts, v] of pending) insR.run(orgId, sid, did, ts, v, `${s.key}:${ts}`, 'simulated', ts + 20000);
    }
    const file = join(dataDirForFile, 'simulator-devices.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ note: 'SIMULATED devices (synthetic test environment). Never commit.', orgId, devices: creds }, null, 2), { mode: 0o600 });

    appendAudit(db, now, { orgId, actor: null, action: 'seed.synthetic_data_loaded', detail: { note: 'Synthetic demonstration data' } });
    appendAudit(db, now, { orgId: org2Id, actor: null, action: 'seed.synthetic_data_loaded' });
  });
  return { password, orgId, org2Id, users, deviceFile: join(dataDirForFile, 'simulator-devices.json') };
}
