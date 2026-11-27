import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn, makeFlowA, makeWorld, type Flow, type World } from '../helpers.ts';

let w: World, f: Flow;
const clients: Record<string, Client> = {};
const ROLES = ['reporter', 'technician', 'dispatcher', 'admin', 'auditor', 'ngo', 'platform', 'anon'] as const;
type R = (typeof ROLES)[number];
const KEY: Record<string, string> = { reporter: 'a_reporter', technician: 'a_tech', dispatcher: 'a_dispatcher', admin: 'a_admin', auditor: 'a_auditor', ngo: 'a_ngo', platform: 'platform' };

beforeAll(async () => {
  w = await makeWorld(); f = await makeFlowA(w);
  for (const r of ROLES) clients[r] = r === 'anon' ? new Client(w) : await loggedIn(w, KEY[r] as string);
});
afterAll(() => w.rt.cleanup());

const set = (...r: R[]) => new Set<R>(r);
const STAFF = set('dispatcher', 'admin', 'auditor', 'ngo');
const WRITERS = set('dispatcher', 'admin');
const ADMIN = set('admin');
// GET pages: path -> roles allowed (200). Everyone else gets 403 (signed in) or a redirect to /login (anonymous).
const PAGES: [string, Set<R>][] = [
  ['/console/map', STAFF], ['/console/assets', STAFF], ['/console/assets.csv', STAFF], ['/console/assets/new', WRITERS], ['/console/assets/import', ADMIN],
  ['/console/reports', STAFF], ['/console/orders', STAFF], ['/console/orders.csv', STAFF], ['/console/schedule', WRITERS], ['/console/sensors', STAFF],
  ['/console/analytics', STAFF], ['/console/analytics.csv', STAFF], ['/console/audit', set('admin', 'auditor', 'ngo')],
  ['/console/admin/users', ADMIN], ['/console/admin/devices', ADMIN], ['/console/admin/settings', ADMIN],
  ['/platform', set('platform')], ['/report', set('reporter')], ['/report/mine', set('reporter')], ['/tech', set('technician')],
  ['/account', set('reporter', 'technician', 'dispatcher', 'admin', 'auditor', 'ngo', 'platform')],
  ['/notifications', set('reporter', 'technician', 'dispatcher', 'admin', 'auditor', 'ngo')]
];

describe('page access by role (deny by default)', () => {
  for (const [path, allowed] of PAGES) {
    for (const role of ROLES) {
      it(`${role.padEnd(10)} GET ${path} -> ${allowed.has(role) ? '200' : role === 'anon' ? 'redirect to login' : '403'}`, async () => {
        const res = await (clients[role] as Client).get(path);
        if (allowed.has(role)) expect(res.status).toBe(200);
        else if (role === 'anon') { expect(res.status).toBe(303); expect(res.headers.get('location')).toContain('/login'); }
        else expect(res.status).toBe(403);
      });
    }
  }
});

describe('detail pages by role', () => {
  it('asset / work order detail', async () => {
    for (const role of ROLES) {
      const c = clients[role] as Client;
      const asset = await c.get(`/console/assets/${w.assetA}`); const wo = await c.get(`/console/orders/${f.woId}`);
      const ok = role === 'ngo' ? [403, 404] : null; // NGO is scoped to NGO-owned assets only
      if (STAFF.has(role)) { if (ok) { expect(ok).toContain(asset.status); expect(ok).toContain(wo.status); } else { expect(asset.status).toBe(200); expect(wo.status).toBe(200); } }
      else if (role === 'anon') expect(asset.status).toBe(303); else expect([403]).toContain(asset.status);
    }
  });
  it('technician sees only their own job; another technician gets 404', async () => {
    expect((await (clients['technician'] as Client).get(`/tech/${f.woId}`)).status).toBe(200);
    const t2 = await loggedIn(w, 'a_tech2');
    expect((await t2.get(`/tech/${f.woId}`)).status).toBe(404);
    expect((await t2.get(`/api/v1/work-orders/${f.woId}`)).status).toBe(404);
    expect(((await (await t2.get('/api/v1/work-orders')).json()) as { work_orders: unknown[] }).work_orders).toHaveLength(0);
  });
});

// API: [method, path, body, allowed roles]
type Api = [string, string, unknown, Set<R>];
const API: Api[] = [
  ['GET', '/api/v1/assets', undefined, set('dispatcher', 'admin', 'auditor', 'ngo')],
  ['GET', '/api/v1/work-orders', undefined, set('technician', 'dispatcher', 'admin', 'auditor', 'ngo')],
  ['GET', '/api/v1/reports', undefined, set('reporter', 'dispatcher', 'admin', 'auditor', 'ngo')],
  ['GET', '/api/v1/sensors', undefined, set('dispatcher', 'admin', 'auditor', 'ngo')],
  ['GET', '/api/v1/analytics', undefined, set('dispatcher', 'admin', 'auditor', 'ngo')],
  ['GET', '/api/v1/audit/verify', undefined, set('admin', 'auditor', 'ngo')],
  ['POST', '/api/v1/sensors/health-check', {}, WRITERS],
  ['POST', '/api/v1/assets', { code: 'ZZ-1' }, WRITERS], // allowed roles get 400 (validation), not 403
  ['POST', '/api/v1/work-orders', { report_ids: ['x'] }, WRITERS],
  ['GET', '/api/v1/csrf', undefined, set('reporter', 'technician', 'dispatcher', 'admin', 'auditor', 'ngo', 'platform')]
];
describe('API access by role', () => {
  for (const [method, path, body, allowed] of API) for (const role of ROLES) {
    it(`${role.padEnd(10)} ${method} ${path}`, async () => {
      const c = clients[role] as Client;
      const res = method === 'GET' ? await c.get(path) : await c.req('POST', path, { json: body });
      if (allowed.has(role)) expect([200, 201, 400, 404], `${res.status}`).toContain(res.status);
      else expect(res.status).toBe(role === 'anon' ? 401 : 403);
    });
  }
});

describe('privacy: reporter identity and costs', () => {
  it('reporter contact is only visible to dispatcher/admin', async () => {
    for (const role of ROLES) {
      if (!['dispatcher', 'admin', 'auditor', 'ngo'].includes(role)) continue;
      const page = await (await (clients[role] as Client).get('/console/reports?status=all')).text();
      const api = JSON.stringify(await (await (clients[role] as Client).get('/api/v1/reports')).json());
      const sees = role === 'dispatcher' || role === 'admin';
      expect(page.includes('User a_reporter')).toBe(sees); expect(api.includes('User a_reporter')).toBe(sees);
    }
  });
  it('technicians never see reporter identity in their job view', async () => {
    const t = await (await (clients['technician'] as Client).get(`/tech/${f.woId}`)).text();
    expect(t).not.toContain('User a_reporter'); expect(t).not.toContain('a_reporter@test.example');
  });
  it('reporters see only their own reports, in the UI and API', async () => {
    const r2 = await loggedIn(w, 'a_reporter2');
    expect(((await (await r2.get('/api/v1/reports')).json()) as { reports: unknown[] }).reports).toHaveLength(0);
    expect(((await (await (clients['reporter'] as Client).get('/api/v1/reports')).json()) as { reports: unknown[] }).reports).toHaveLength(1);
  });
  it('costs are hidden from technicians (API) and from scoped NGO monitors', async () => {
    expect(JSON.stringify(await (await (clients['technician'] as Client).get('/api/v1/work-orders')).json())).not.toContain('cost_minor');
    expect(JSON.stringify(await (await (clients['dispatcher'] as Client).get('/api/v1/work-orders')).json())).toContain('cost_minor');
    const ngo = await (await (clients['ngo'] as Client).get('/api/v1/work-orders')).json();
    expect(JSON.stringify(ngo)).not.toContain('cost_minor');
  });
  it('NGO monitor only sees NGO-owned assets', async () => {
    const list = (await (await (clients['ngo'] as Client).get('/api/v1/assets')).json()) as { assets: { code: string }[] };
    expect(list.assets.map((a) => a.code)).toEqual(['A-002']);
    expect((await (clients['ngo'] as Client).get(`/console/assets/${w.assetA}`)).status).toBe(404);
  });
});

describe('mutations by role', () => {
  const post = (role: R, path: string, form: Record<string, string> = {}) => (clients[role] as Client).req('POST', path, { form });
  it('reporters/technicians/auditors cannot create work orders, assign, change asset status or cancel', async () => {
    for (const role of ['reporter', 'technician', 'auditor', 'ngo', 'platform'] as const) {
      expect((await post(role, '/console/orders/new', { asset: w.assetA, title: 'Illegal', priority: 'P3' })).status).toBe(403);
      expect((await post(role, `/console/orders/${f.woId}/assign`, { assignee: w.users['a_tech']?.id as string })).status).toBe(403);
      expect((await post(role, `/console/assets/${w.assetA}/status`, { status: 'down' })).status).toBe(403);
      expect((await post(role, `/console/orders/${f.woId}/transition`, { to: 'cancelled', note: 'not allowed' })).status).toBe(403);
    }
    expect(w.rt.sys.get<{ status: string }>('SELECT status FROM assets WHERE id = :id', { id: w.assetA })?.status).toBe('operational');
  });
  it('dispatchers cannot manage users, devices, settings, imports or read the audit log', async () => {
    for (const p of ['/console/admin/users', '/console/admin/devices', '/console/admin/settings', '/console/assets/import']) expect((await post('dispatcher', p)).status).toBe(403);
    expect((await (clients['dispatcher'] as Client).get('/console/audit')).status).toBe(403);
  });
  it('reporters cannot submit reports as another role endpoint and cannot read photos of others', async () => {
    const r2 = await loggedIn(w, 'a_reporter2');
    expect((await r2.get(`/photos/${f.photoId}`)).status).toBe(403);
    expect((await (clients['reporter'] as Client).get(`/photos/${f.photoId}`)).status).toBe(200);
    expect((await (clients['dispatcher'] as Client).get(`/photos/${f.photoId}`)).status).toBe(200);
    expect((await (clients['technician'] as Client).get(`/photos/${f.photoId}`)).status).toBe(200); // assigned to the linked work order
    expect((await (await loggedIn(w, 'a_tech2')).get(`/photos/${f.photoId}`)).status).toBe(403);
    expect((await (clients['anon'] as Client).get(`/photos/${f.photoId}`)).status).toBe(303);
    expect((await (clients['ngo'] as Client).get(`/photos/${f.photoId}`)).status).toBe(403);
  });
});
