import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadConfig, type Config } from '../src/core/config.ts';
import { totpCode } from '../src/core/crypto.ts';
import { openDb, SystemDb } from '../src/db/index.ts';
import { createApp } from '../src/web/app.ts';
import { makeCtx, type Ctx, type Runtime } from '../src/repo/ctx.ts';
import { actorOf, createOrganisation, createUser, type UserRow } from '../src/repo/system.ts';
import { createAsset } from '../src/repo/assets.ts';
import type { Role } from '../src/domain/types.ts';

export const PW = 'Test-Passw0rd-12345';
export const T0 = Date.UTC(2026, 5, 1, 9, 0, 0); // 2026-06-01 09:00 UTC (12:00 Nairobi)

export type TestRt = Runtime & { now: number; advance: (ms: number) => void; dir: string; cleanup: () => void };

export function makeRt(over: Record<string, string> = {}): TestRt {
  const dir = mkdtempSync(join(tmpdir(), 'ww-test-'));
  const cfg: Config = loadConfig({ WW_SECRET_KEY: 'test-secret-key-test-secret-key-0000', WW_ENV: 'test', WW_DATA_DIR: dir, WW_DB_PATH: ':memory:', WW_RATE_LIMIT_DISABLED: '1', ...over });
  const db = openDb(':memory:');
  const rt = { db, sys: new SystemDb(db), cfg, clock: () => rt.now, now: T0, advance: (ms: number) => { rt.now += ms; }, dir, cleanup: () => { try { db.close(); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); } } as TestRt;
  return rt;
}

export type World = {
  rt: TestRt; app: ReturnType<typeof createApp>;
  orgA: string; orgB: string;
  users: Record<string, UserRow>;
  assetA: string; assetA2: string; assetB: string;
  ctx: (key: string) => Ctx;
};

const ROLE_SET: [string, Role][] = [['admin', 'org_admin'], ['dispatcher', 'dispatcher'], ['tech', 'technician'], ['tech2', 'technician'], ['reporter', 'reporter'], ['reporter2', 'reporter'], ['auditor', 'auditor']];

/** Two organisations (A and B) each with a full set of roles, one platform admin, and a couple of assets. */
export async function makeWorld(over: Record<string, string> = {}): Promise<World> {
  const rt = makeRt(over);
  const app = createApp(rt);
  const orgA = createOrganisation(rt, null, { name: 'Org A Water', kind: 'utility' });
  const orgB = createOrganisation(rt, null, { name: 'Org B Water', kind: 'county' });
  const users: Record<string, UserRow> = {};
  const add = async (key: string, org: string | null, role: Role, extra: { scope?: string } = {}) => {
    const email = `${key}@test.example`;
    await createUser(rt, null, { orgId: org, email, name: `User ${key}`, role, password: PW, scopeOwner: extra.scope ?? null });
    users[key] = rt.sys.get<UserRow>('SELECT * FROM users WHERE email = :e', { e: email }) as UserRow;
  };
  for (const [k, r] of ROLE_SET) { await add(`a_${k}`, orgA, r); await add(`b_${k}`, orgB, r); }
  await add('a_ngo', orgA, 'auditor', { scope: 'NGO (programme)' });
  await add('platform', null, 'platform_admin');
  const w = { rt, app, orgA, orgB, users, assetA: '', assetA2: '', assetB: '', ctx: (key: string) => makeCtx(rt, actorOf(users[key] as UserRow)) } as World;
  const asset = (ctx: Ctx, code: string, name: string, type = 'borehole', lat = -1.29, lng = 36.82, owner = 'Utility') => createAsset(ctx, { code, name, type: type as 'borehole', status: 'operational', owner_type: 'utility', owner_name: owner, lat, lng, install_year: 2015 });
  w.assetA = asset(w.ctx('a_admin'), 'A-001', 'Alpha Borehole');
  w.assetA2 = asset(w.ctx('a_admin'), 'A-002', 'Alpha Kiosk', 'kiosk', -1.2905, 36.8205, 'NGO (programme)');
  w.assetB = asset(w.ctx('b_admin'), 'B-001', 'Bravo Borehole', 'borehole', -1.31, 36.9);
  return w;
}

// ---- HTTP client with cookie jar + CSRF + TOTP ----
export class Client {
  w: World;
  jar = new Map<string, string>();
  csrfTok = '';
  constructor(w: World) { this.w = w; }
  private store(res: Response) { for (const sc of res.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = (kv as string).indexOf('='); const k = (kv as string).slice(0, i), v = (kv as string).slice(i + 1); if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(sc) || v === '') this.jar.delete(k); else this.jar.set(k, v); } }
  private cookie() { return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method: string, path: string, init: { form?: Record<string, string>; json?: unknown; headers?: Record<string, string>; raw?: BodyInit; multipart?: FormData; csrf?: boolean } = {}): Promise<Response> {
    const unsafe = method !== 'GET' && method !== 'HEAD';
    if (unsafe && init.csrf !== false && !this.csrfTok) await this.refreshCsrf();
    const headers: Record<string, string> = { host: 'localhost', ...(init.headers ?? {}) };
    const c = this.cookie(); if (c) headers['cookie'] = c;
    let body: BodyInit | undefined = init.raw;
    if (unsafe && init.csrf !== false) headers['x-csrf-token'] ??= this.csrfTok;
    if (init.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams({ ...(unsafe && init.csrf !== false ? { _csrf: this.csrfTok } : {}), ...init.form }).toString(); }
    if (init.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(init.json); }
    if (init.multipart) { if (unsafe && init.csrf !== false) init.multipart.set('_csrf', this.csrfTok); body = init.multipart; }
    const res = await this.w.app.request(path, { method, headers, body });
    this.store(res);
    return res;
  }
  get = (p: string) => this.req('GET', p);
  async refreshCsrf() {
    if (this.jar.has('ww_sid')) { const r = await this.w.app.request('/api/v1/csrf', { headers: { host: 'localhost', cookie: this.cookie() } }); if (r.ok) { this.csrfTok = ((await r.json()) as { csrf: string }).csrf; return; } }
    const page = await this.w.app.request('/login', { headers: { host: 'localhost', cookie: this.cookie() } }); this.store(page);
    const m = (await page.text()).match(/name="_csrf" value="([A-Za-z0-9_-]+)"/); this.csrfTok = m?.[1] ?? '';
  }
  /** Full login including TOTP enrolment / verification for MFA roles. */
  async login(userKey: string, pw = PW): Promise<Response> {
    const u = this.w.users[userKey] as UserRow;
    await this.refreshCsrf();
    let res = await this.req('POST', '/login', { form: { email: u.email, password: pw } });
    if (res.status === 303 && res.headers.get('location') === '/login/mfa') {
      this.csrfTok = ''; await this.refreshCsrf(); // the session now has its own CSRF token
      const page = await (await this.get('/login/mfa')).text();
      const secret = page.match(/id="totp-secret">([A-Z2-7]+)</)?.[1] ?? secretOf(this.w, u.id);
      this.w.rt.advance(31_000); // fresh TOTP step each time (replay protection)
      res = await this.req('POST', '/login/mfa', { form: { code: totpCode(secret, this.w.rt.now) } });
    }
    this.csrfTok = ''; await this.refreshCsrf();
    return res;
  }
}
import { decryptSecret } from '../src/core/crypto.ts';
function secretOf(w: World, uid: string): string {
  const r = w.rt.sys.get<{ mfa_secret_enc: string }>('SELECT mfa_secret_enc FROM users WHERE id = :id', { id: uid });
  return decryptSecret((r as { mfa_secret_enc: string }).mfa_secret_enc, w.rt.cfg.secretKey);
}
export async function loggedIn(w: World, key: string): Promise<Client> { const c = new Client(w); const r = await c.login(key); if (r.status !== 303) throw new Error(`login failed for ${key}: ${r.status}`); return c; }

// ---- images ----
export const jpegWithExif = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#3a7' } }).withExif({ IFD0: { Copyright: 'SECRET-OWNER-TAG', Make: 'TestCam' } }).jpeg().toBuffer();
export const plainPng = () => sharp({ create: { width: 32, height: 32, channels: 3, background: '#06c' } }).png().toBuffer();
export function photoForm(buf: Uint8Array, name = 'photo.jpg', type = 'image/jpeg', fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set('photo', new File([buf as BlobPart], name, { type }));
  return fd;
}

// ---- common flows used by integration tests ----
import { submitReport } from '../src/repo/reports.ts';
import { createFromReports, assignWorkOrder } from '../src/repo/workorders.ts';
import { registerDevice } from '../src/repo/devices.ts';
import { savePhoto } from '../src/repo/photos.ts';
import { handleIngest, signRequest } from '../src/repo/ingest.ts';

export type Flow = { reportId: string; reportRef: string; woId: string; deviceId: string; deviceKey: string; secret: string; sensorId: string; photoId: string };
/** Org A: a report with a photo, a work order assigned to a_tech, and an active device with one sensor and a reading. */
export async function makeFlowA(w: World): Promise<Flow> {
  const rep = w.ctx('a_reporter');
  const photoId = await savePhoto(rep, 'report', await jpegWithExif());
  const r = submitReport(rep, { category: 'no_water', text: 'Dry since morning', asset_id: w.assetA, lang: 'en' }, photoId);
  const disp = w.ctx('a_dispatcher');
  const woId = createFromReports(disp, { reportIds: [r.id], priority: 'P2', assigneeId: (w.users['a_tech'] as UserRow).id });
  const dev = registerDevice(w.ctx('a_admin'), { name: 'Alpha meter', asset_id: w.assetA, origin: 'real', sensors: [{ key: 'flow', kind: 'flow', unit: 'm³/h', expected_interval_s: 60, min_valid: 0, max_valid: 500, stuck_count: 5, role: 'production' }] });
  const sensorId = (w.rt.sys.get<{ id: string }>('SELECT id FROM sensors WHERE device_id = :d', { d: dev.id }) as { id: string }).id;
  void assignWorkOrder;
  return { reportId: r.id, reportRef: r.ref, woId, deviceId: dev.id, deviceKey: dev.deviceKey, secret: dev.secret, sensorId, photoId };
}

export function ingestRaw(w: World, deviceKey: string, secret: string, payload: unknown, o: { ts?: number; nonce?: string; sig?: string; now?: number; rawBody?: string } = {}) {
  const now = o.now ?? w.rt.now;
  const rawBody = o.rawBody ?? JSON.stringify(payload);
  const ts = String(o.ts ?? Math.floor(now / 1000)), nonce = o.nonce ?? Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return handleIngest(w.rt.db, w.rt.cfg, { deviceKey, timestamp: ts, nonce, signature: o.sig ?? signRequest(secret, deviceKey, ts, nonce, rawBody), rawBody, now });
}
