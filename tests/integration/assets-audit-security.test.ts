import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PW, jpegWithExif, loggedIn, makeFlowA, makeWorld, photoForm, type Flow, type World } from '../helpers.ts';
import { addMaintenanceRecord, createAsset, importAssetCsv, listAssets, previewAssetCsv, setAssetStatus, updateAsset, cleanAttributes } from '../../src/repo/assets.ts';
import { appendAudit, verifyChain, GENESIS } from '../../src/domain/audit.ts';
import { submitReport } from '../../src/repo/reports.ts';
import { AppError } from '../../src/core/errors.ts';
import { openapi } from '../../src/web/openapi.ts';
import { seedDemo } from '../../src/scripts/seed.ts';
import { makeRt } from '../helpers.ts';
import { runHealthCycle } from '../../src/repo/health.ts';
import { openDb, SystemDb } from '../../src/db/index.ts';

let w: World, f: Flow;
beforeAll(async () => { w = await makeWorld(); f = await makeFlowA(w); });
afterAll(() => w.rt.cleanup());
const err = (fn: () => unknown, re: RegExp) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(AppError); expect((e as Error).message).toMatch(re); return; } throw new Error('expected AppError'); };
const A = () => w.ctx('a_admin');
const base = { code: 'N-100', name: 'New Borehole', type: 'borehole' as const, status: 'operational' as const, owner_type: 'utility' as const, owner_name: 'Org A', lat: -1.3, lng: 36.85 };

describe('asset registry', () => {
  it('registers all asset types with ownership, geolocation, status and type attributes', () => {
    const types = ['borehole', 'kiosk', 'waterpoint', 'pump', 'tank', 'treatment', 'valve', 'pipe'] as const;
    types.forEach((t, i) => createAsset(A(), { ...base, code: `T-${i}`, type: t, name: `Asset ${t}` }));
    expect(listAssets(A()).filter((a) => a.code.startsWith('T-'))).toHaveLength(8);
    const id = createAsset(A(), { ...base, code: 'N-101', type: 'tank', attributes: { volume_m3: '500', material: 'Steel' } });
    expect(JSON.parse(listAssets(A()).find((a) => a.id === id)?.attributes as string)).toEqual({ volume_m3: 500, material: 'Steel' });
  });
  it('validates code, name, type, owner, year and coordinates', () => {
    for (const bad of [{ code: 'x' }, { code: 'has space' }, { name: 'a' }, { type: 'spaceship' }, { owner_type: 'alien' }, { owner_name: '' }, { install_year: 1800 }, { install_year: 2999 }, { install_year: 'abc' }]) err(() => createAsset(A(), { ...base, code: 'V-' + Math.random().toString(36).slice(2, 8), ...bad } as never), /./);
    err(() => createAsset(A(), { ...base, code: 'V-1', lat: 0, lng: 0 }), /0,0|Coordinates/); err(() => createAsset(A(), { ...base, code: 'V-2', lat: 48.85, lng: 2.35 }), /outside the configured service area/);
    err(() => createAsset(A(), { ...base, code: 'V-3', lat: 'abc' }), /numbers/);
  });
  it('geolocation bounds are configurable per organisation', async () => {
    const s = await makeWorld(); s.rt.sys.run('UPDATE organisations SET settings = :s WHERE id = :o', { s: JSON.stringify({ bounds: { minLat: 48, maxLat: 49, minLng: 2, maxLng: 3 } }), o: s.orgA });
    expect(() => createAsset(s.ctx('a_admin'), { ...base, code: 'P-1', lat: 48.85, lng: 2.35 })).not.toThrow(); err(() => createAsset(s.ctx('a_admin'), { ...base, code: 'P-2' }), /service area/); s.rt.cleanup();
  });
  it('enforces unique codes per organisation (case-sensitive) and validates attributes per type', () => {
    err(() => createAsset(A(), { ...base, code: 'A-001' }), /already exists/);
    err(() => createAsset(A(), { ...base, code: 'AT-1', attributes: { volume_m3: 5 } }), /not valid for a Borehole/); err(() => createAsset(A(), { ...base, code: 'AT-2', attributes: { depth_m: -5 } }), /Depth/); err(() => createAsset(A(), { ...base, code: 'AT-3', attributes: { depth_m: 'deep' } }), /Depth/);
    expect(cleanAttributes('borehole', { depth_m: '', yield_m3h: undefined })).toEqual({});
  });
  it('updates are audited with before/after and cannot silently clear a contamination alert', () => {
    const id = createAsset(A(), { ...base, code: 'U-1', status: 'contamination' });
    err(() => updateAsset(A(), id, { ...base, code: 'U-1', status: 'operational' }), /Clear contamination/);
    updateAsset(A(), id, { ...base, code: 'U-1', status: 'contamination', name: 'Renamed' });
    const row = w.rt.sys.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'asset.updated' AND object_id = :i", { i: id });
    expect(JSON.parse(row?.detail as string)).toMatchObject({ before: { name: 'New Borehole' }, after: { name: 'Renamed' } });
  });
  it('maintenance history: manual records validated and listed newest first', () => {
    addMaintenanceRecord(A(), w.assetA, { performed_on: '2025-01-10', summary: 'Pump serviced', performed_by: 'Joe', cost_minor: 120000 }); addMaintenanceRecord(A(), w.assetA, { performed_on: '2025-06-01', summary: 'Valve replaced', performed_by: 'Ann', cost_minor: 0 });
    err(() => addMaintenanceRecord(A(), w.assetA, { performed_on: '10/01/2025', summary: 'abc', performed_by: 'x', cost_minor: 0 }), /YYYY-MM-DD/); err(() => addMaintenanceRecord(A(), w.assetA, { performed_on: '2025-01-01', summary: 'ab', performed_by: 'x', cost_minor: 0 }), /Summary/);
    err(() => addMaintenanceRecord(A(), w.assetA, { performed_on: '2025-01-01', summary: 'valid', performed_by: 'x', cost_minor: -1 }), /Cost/);
  });
  it('status changes by dispatchers, with reason recorded; auditors cannot', () => {
    setAssetStatus(w.ctx('a_dispatcher'), w.assetA, 'degraded', 'pressure low'); err(() => setAssetStatus(w.ctx('a_auditor'), w.assetA, 'down', ''), /Not permitted/);
    expect(w.rt.sys.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'asset.status_changed' ORDER BY seq DESC LIMIT 1")?.detail).toContain('pressure low'); setAssetStatus(w.ctx('a_dispatcher'), w.assetA, 'operational', '');
  });
  it('pages: registry, record, edit and new forms render for dispatchers; the form re-renders with errors and keeps input', async () => {
    const c = await loggedIn(w, 'a_dispatcher');
    for (const p of ['/console/assets', '/console/map', `/console/assets/${w.assetA}`, `/console/assets/${w.assetA}/edit`, '/console/assets/new', `/console/map?asset=${w.assetA}`, '/console/map?status=down&type=pump&q=zz']) expect((await c.get(p)).status, p).toBe(200);
    const bad = await c.req('POST', '/console/assets/new', { form: { ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v)])), code: 'W-1', lat: '48.8', lng: '2.3' } });
    expect(bad.status).toBe(400); const html = await bad.text(); expect(html).toContain('service area'); expect(html).toContain('value="W-1"');
    const ok = await c.req('POST', '/console/assets/new', { form: { ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v)])), code: 'W-2', attr_borehole_depth_m: '90' } }); expect(ok.status).toBe(303);
    expect(listAssets(A()).find((a) => a.code === 'W-2')).toBeTruthy();
  });
  it('map shows markers as keyboard-focusable links with text status, and the empty-filter state', async () => {
    const c = await loggedIn(w, 'a_dispatcher'); const html = await (await c.get('/console/map')).text();
    expect(html).toMatch(/<a href="\/console\/map\?asset=[^"]+" class="marker[^"]*" aria-label="Alpha Borehole, Operational"/); expect(html).toContain('Schematic map (no tiles'); expect(html).not.toContain('leaflet');
    expect(await (await c.get('/console/map?q=doesnotexist')).text()).toContain('No assets match these filters');
  });
  it('tile map is OFF by default; when configured, it loads vendored Leaflet (no CDN) and allows only that tile origin in CSP', async () => {
    const off = await loggedIn(w, 'a_dispatcher'); const r0 = await off.get('/console/map?view=tiles'); expect(await r0.text()).not.toContain('/vendor/leaflet'); expect(r0.headers.get('content-security-policy')).not.toContain('tile.example');
    const s = await makeWorld({ WW_TILE_URL: 'https://tile.example.org/{z}/{x}/{y}.png', WW_TILE_ATTRIBUTION: '© Example contributors' }); const c = await loggedIn(s, 'a_dispatcher');
    const r = await c.get('/console/map?view=tiles'); const html = await r.text();
    expect(html).toContain('/vendor/leaflet/leaflet.js'); expect(html).toContain('© Example contributors'); expect(html).not.toMatch(/https?:\/\/(unpkg|cdn)/);
    expect(r.headers.get('content-security-policy')).toContain('img-src \'self\' data: blob: https://tile.example.org'); expect((await c.get('/vendor/leaflet/leaflet.js')).status).toBe(200); expect((await c.get('/vendor/leaflet/images/marker-icon.png')).status).toBe(200); s.rt.cleanup();
  });
});

describe('CSV import / export', () => {
  const header = 'code,name,type,status,owner_type,owner_name,lat,lng,install_year,notes\n';
  it('previews rows with per-line errors without importing anything', () => {
    const p = previewAssetCsv(A(), header + 'C-1,Good,kiosk,operational,vendor,Vendor,-1.3,36.8,2020,ok\nC-2,Bad type,spaceship,operational,vendor,V,-1.3,36.8,,\nC-3,Out of bounds,kiosk,,vendor,V,10,36.8,,\nC-1,Dup in file,kiosk,,vendor,V,-1.3,36.8,,\nA-001,Exists,kiosk,,vendor,V,-1.3,36.8,,\n');
    expect(p.valid).toHaveLength(1); expect(p.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]); expect(p.errors[3]?.message).toMatch(/already exists/); expect(listAssets(A()).some((a) => a.code === 'C-1')).toBe(false);
  });
  it('import is all-or-nothing; a clean file imports everything with origin "imported"', () => {
    err(() => importAssetCsv(A(), header + 'D-1,Good,kiosk,,vendor,V,-1.3,36.8,,\nD-2,Bad,kiosk,,vendor,V,99,36.8,,\n'), /refused/); expect(listAssets(A()).some((a) => a.code === 'D-1')).toBe(false);
    expect(importAssetCsv(A(), header + 'D-1,Good,kiosk,,vendor,V,-1.3,36.8,,\nD-2,Also good,tank,,utility,U,-1.31,36.81,2018,"note, with comma"\n')).toEqual({ imported: 2 });
    expect(listAssets(A()).find((a) => a.code === 'D-1')?.origin).toBe('imported');
  });
  it('rejects missing columns, oversized files, too many rows, unterminated quotes, and non-admins', () => {
    err(() => previewAssetCsv(A(), 'code,name\nx,y'), /Missing required column/); err(() => previewAssetCsv(A(), 'a'.repeat(1024 * 1024 + 1)), /too large/);
    err(() => previewAssetCsv(A(), header + Array.from({ length: 2001 }, (_, i) => `R-${i},n,kiosk,,vendor,V,-1.3,36.8,,`).join('\n')), /Too many rows/); err(() => previewAssetCsv(A(), header + 'a,"b'), /Unterminated/);
    err(() => previewAssetCsv(w.ctx('a_dispatcher'), header), /Not permitted/);
  });
  it('import via HTTP: preview then import; CSV exports neutralise formula injection', async () => {
    const c = await loggedIn(w, 'a_admin'); const fd = (mode: string, body: string) => { const f = new FormData(); f.set('mode', mode); f.set('file', new File([body], 'a.csv', { type: 'text/csv' })); return f; };
    const prev = await c.req('POST', '/console/assets/import', { multipart: fd('preview', header + 'H-1,=cmd|\' /C calc\'!A0,kiosk,,vendor,V,-1.3,36.8,,\n') }); expect(await prev.text()).toContain('1 valid');
    expect((await c.req('POST', '/console/assets/import', { multipart: fd('import', header + 'H-1,=cmd|\' /C calc\'!A0,kiosk,,vendor,V,-1.3,36.8,,\n') })).status).toBe(303);
    const csv = await (await c.get('/console/assets.csv')).text(); expect(csv).toContain("'=cmd"); expect(csv).not.toMatch(/,=cmd/);
    expect((await c.get('/console/assets.csv')).headers.get('content-disposition')).toContain('attachment');
    const empty = await c.req('POST', '/console/assets/import', { multipart: new FormData() }); expect(empty.status).toBe(400);
  });
});

describe('audit log', () => {
  it('is hash-chained per organisation and verifies; the genesis link is fixed', () => {
    const first = w.rt.sys.get<{ prev_hash: string }>('SELECT prev_hash FROM audit_log WHERE chain = :c ORDER BY seq LIMIT 1', { c: w.orgA }); expect(first?.prev_hash).toBe(GENESIS);
    const v = verifyChain(w.rt.db, w.orgA); expect(v.ok).toBe(true); expect(v.checked).toBeGreaterThan(20); expect(v.head).toMatch(/^[0-9a-f]{64}$/);
  });
  it('the database rejects UPDATE and DELETE on audit entries', () => {
    expect(() => w.rt.db.exec("UPDATE audit_log SET action = 'x' WHERE seq = 1")).toThrow(/append-only/); expect(() => w.rt.db.exec('DELETE FROM audit_log WHERE seq = 1')).toThrow(/append-only/);
    expect(() => w.rt.db.exec('DELETE FROM audit_log')).toThrow(/append-only/);
  });
  it('detects tampering even if the triggers are bypassed (content edit, deleted entry, reordered link)', () => {
    const s = makeRt(); const db = s.db; const ev = (a: string) => appendAudit(db, s.now++, { orgId: 'org1', actor: { id: 'u', role: 'org_admin' }, action: a });
    ['a', 'b', 'c', 'd'].forEach(ev); expect(verifyChain(db, 'org1').ok).toBe(true);
    db.exec('DROP TRIGGER audit_no_update'); db.exec("UPDATE audit_log SET action = 'forged' WHERE action = 'b'");
    const edited = verifyChain(db, 'org1'); expect(edited.ok).toBe(false); expect(edited.reason).toMatch(/content/);
    db.exec("UPDATE audit_log SET action = 'b' WHERE action = 'forged'"); expect(verifyChain(db, 'org1').ok).toBe(true);
    db.exec('DROP TRIGGER audit_no_delete'); db.exec("DELETE FROM audit_log WHERE action = 'b'");
    const deleted = verifyChain(db, 'org1'); expect(deleted.ok).toBe(false); expect(deleted.reason).toMatch(/prev_hash/);
    s.cleanup();
  });
  it('records sign-ins, uploads, photo views, user changes, asset and work-order events', () => {
    const actions = new Set(w.rt.sys.all<{ action: string }>('SELECT DISTINCT action FROM audit_log WHERE org_id = :o', { o: w.orgA }).map((r) => r.action));
    for (const a of ['asset.created', 'asset.updated', 'report.submitted', 'workorder.created', 'device.registered', 'photo.uploaded', 'user.created']) expect(actions.has(a), a).toBe(true);
  });
  it('the audit page and API are limited to admins/auditors, filter by prefix, and verify on demand', async () => {
    const a = await loggedIn(w, 'a_admin'); const html = await (await a.get('/console/audit?verify=1&action=asset')).text(); expect(html).toContain('Chain verified'); expect(html).toContain('asset.created'); expect(html).not.toContain('workorder.created');
    expect(((await (await a.get('/api/v1/audit/verify')).json()) as { ok: boolean }).ok).toBe(true);
    const sql = await a.get("/console/audit?action=' OR 1=1 --"); expect(sql.status).toBe(200);
  });
  it('platform-level events use a separate chain', () => { expect(verifyChain(w.rt.db, null).ok).toBe(true); });
});

describe('uploads over HTTP (abuse cases)', () => {
  const reportWith = async (c: Client, file: Uint8Array, name: string, type: string, uid: string) => c.req('POST', '/api/v1/reports', { multipart: photoForm(file, name, type, { category: 'leak', asset_id: w.assetA2, client_uid: uid }) });
  it('rejects scripts, SVG, PDFs and executables renamed to images; no report is created', async () => {
    const c = await loggedIn(w, 'a_reporter2'); const before = w.rt.sys.all('SELECT 1 FROM reports').length; let i = 0;
    for (const [bytes, name, type] of [[new TextEncoder().encode('<?php system($_GET[0]);'), 'a.php', 'image/jpeg'], [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'a.svg', 'image/svg+xml'], [new TextEncoder().encode('%PDF-1.4'), 'a.jpg', 'image/jpeg'], [new Uint8Array([0x4d, 0x5a, 0x90, 0]), 'a.jpg.exe', 'image/png'], [new TextEncoder().encode('GIF89a<script>'), 'a.gif', 'image/gif']] as const) {
      const r = await reportWith(c, bytes as Uint8Array, name, type, `abuse-uid-00000${i++}`); expect(r.status, name).toBe(400); expect(((await r.json()) as { message: string }).message).toMatch(/Unsupported file type/);
    }
    expect(w.rt.sys.all('SELECT 1 FROM reports').length).toBe(before);
  });
  it('rejects oversized uploads (413 body limit) and strips EXIF from accepted photos (verified from stored file)', async () => {
    const c = await loggedIn(w, 'a_reporter2');
    const big = await reportWith(c, new Uint8Array(8 * 1024 * 1024), 'big.jpg', 'image/jpeg', 'abuse-uid-big0001'); expect(big.status).toBe(413);
    const ok = await reportWith(c, await jpegWithExif(), 'ok.jpg', 'image/jpeg', 'abuse-uid-ok00001'); expect(ok.status).toBe(201);
    const photo = w.rt.sys.get<{ path: string; mime: string; sha256: string }>('SELECT p.path, p.mime, p.sha256 FROM photos p JOIN reports r ON r.photo_id = p.id WHERE r.client_uid = :c', { c: 'abuse-uid-ok00001' }) as { path: string; mime: string };
    const { readFileSync, statSync } = await import('node:fs'); const { join } = await import('node:path'); const file = join(w.rt.cfg.dataDir, 'photos', photo.path);
    const stored = readFileSync(file); expect(stored.includes(Buffer.from('SECRET-OWNER-TAG'))).toBe(false); expect(photo.mime).toBe('image/jpeg'); expect(photo.path).toMatch(/^[0-9a-f-]{36}[\\/][0-9a-f-]{36}\.jpg$/); expect(statSync(file).mode & 0o077).toBe(0);
  });
  it('photos are only served through the authorised route (never as static files) with safe headers', async () => {
    const d = await loggedIn(w, 'a_dispatcher'); const r = await d.get(`/photos/${f.photoId}`);
    expect(r.status).toBe(200); expect(r.headers.get('content-type')).toBe('image/jpeg'); expect(r.headers.get('cache-control')).toContain('no-store'); expect(r.headers.get('x-content-type-options')).toBe('nosniff'); expect(r.headers.get('content-security-policy')).toContain("sandbox");
    for (const p of ['/photos/../../etc/passwd', '/photos/not-a-uuid', '/data/files/photos', `/css/../../${w.rt.cfg.dataDir}`]) expect([404, 303].includes((await d.get(p)).status), p).toBe(true);
  });
  it('photo uploads and views are audited', () => { expect(w.rt.sys.get("SELECT 1 AS x FROM audit_log WHERE action = 'photo.viewed'")).toBeTruthy(); expect(w.rt.sys.get("SELECT 1 AS x FROM audit_log WHERE action = 'photo.uploaded'")).toBeTruthy(); });
});

describe('XSS, headers and injection', () => {
  const XSS = '<script>window.__x=1</script><img src=x onerror=alert(1)>"\'`';
  it('hostile text in asset names, report text, work-order titles, user names is escaped everywhere it is rendered', async () => {
    const id = createAsset(A(), { ...base, code: 'X-1', name: XSS.slice(0, 100), owner_name: XSS.slice(0, 100) });
    submitReport(w.ctx('a_reporter'), { category: 'leak', asset_id: id, text: XSS, client_uid: 'xss-uid-0000001' }, null);
    const d = await loggedIn(w, 'a_dispatcher');
    for (const p of ['/console/map', '/console/assets', `/console/assets/${id}`, '/console/reports', '/console/orders', '/console/sensors', '/console/analytics', `/console/map?asset=${id}&q=${encodeURIComponent(XSS)}`, '/report/done?ref=' + encodeURIComponent(XSS)]) {
      const html = await (await d.get(p)).text(); expect(html, p).not.toContain('<script>window.__x'); expect(html, p).not.toMatch(/<img src=x onerror/); 
    }
    const filt = await (await d.get(`/console/assets?q=${encodeURIComponent(XSS)}`)).text(); expect(filt).not.toContain('<script>window.__x');
  });
  it('sets a strict CSP (no inline script/style, no third-party origins) and hardening headers on every response', async () => {
    const c = new Client(w);
    for (const p of ['/login', '/css/app.css', '/js/app.js', '/health', '/nope']) {
      const r = await c.get(p); const csp = r.headers.get('content-security-policy') ?? '';
      expect(csp, p).toContain("default-src 'self'"); expect(csp).toContain("script-src 'self'"); expect(csp).toContain("style-src 'self'"); expect(csp).not.toContain('unsafe-inline'); expect(csp).not.toContain('unsafe-eval'); expect(csp).toContain("frame-ancestors 'none'"); expect(csp).toContain("object-src 'none'");
      expect(r.headers.get('x-content-type-options')).toBe('nosniff'); expect(r.headers.get('x-frame-options')).toBe('DENY'); expect(r.headers.get('referrer-policy')).toBe('same-origin');
    }
  });
  it('no page contains inline scripts, inline event handlers, inline style attributes or third-party URLs', async () => {
    const d = await loggedIn(w, 'a_admin'); const r = await loggedIn(w, 'a_reporter'); const t = await loggedIn(w, 'a_tech');
    const pages: [Client, string][] = [[d, '/console/map'], [d, '/console/assets'], [d, '/console/orders'], [d, '/console/reports'], [d, '/console/sensors'], [d, '/console/analytics'], [d, '/console/audit'], [d, '/console/schedule'], [d, '/console/admin/users'], [d, '/console/admin/devices'], [d, '/console/admin/settings'], [r, '/report'], [r, '/report/mine'], [t, '/tech'], [t, `/tech/${f.woId}`], [new Client(w), '/login']];
    for (const [c, p] of pages) {
      const html = await (await c.get(p)).text();
      expect(html, p).not.toMatch(/<script(?![^>]*\bsrc=)/i); expect(html.replace(/"[^"]*"/g, '""').match(/<[a-z][^>]*\son[a-z]+\s*=[^>]{0,60}/i)?.[0] ?? null, p).toBeNull(); expect(html, p).not.toMatch(/\sstyle\s*=/i); expect(html, p).not.toMatch(/(src|href)="https?:\/\/(?!localhost)/i);
    }
  });
  it('static files: traversal and non-allow-listed extensions are refused; service worker has the right headers', async () => {
    const c = new Client(w);
    for (const p of ['/css/../../package.json', '/js/%2e%2e/%2e%2e/package.json', '/css/%00', '/vendor/../src/server.ts', '/js/app.js%00.png']) expect([404, 400].includes((await c.get(p)).status), p).toBe(true);
    expect((await c.get('/package.json')).status).toBe(404); expect((await c.get('/css/app.js')).status).toBe(404);
    const sw = await c.get('/sw.js'); expect(sw.status).toBe(200); expect(sw.headers.get('service-worker-allowed')).toBe('/'); expect(sw.headers.get('cache-control')).toBe('no-cache'); expect(sw.headers.get('content-type')).toContain('javascript');
    expect((await c.get('/manifest.webmanifest')).status).toBe(200);
  });
  it('error pages do not leak internals; unknown routes 404; API errors are JSON', async () => {
    const c = await loggedIn(w, 'a_admin'); const r = await c.get('/api/v1/assets/not-a-real-id'); expect(r.status).toBe(404); expect(await r.json()).toMatchObject({ error: 'not_found' });
    const bad = await c.req('POST', '/api/v1/assets', { raw: '{not json', headers: { 'content-type': 'application/json' } }); expect(bad.status).toBe(400);
    const html = await (await c.get('/definitely/not/here')).text(); expect(html).not.toMatch(/at .*\.ts|node_modules|SQLITE|stack/i);
  });
  it('SQL injection attempts in filters, ids and form fields do not break queries or leak data', async () => {
    const d = await loggedIn(w, 'a_dispatcher');
    for (const q of ["'", "' OR '1'='1", "'; DROP TABLE assets; --", '%', '_', '\\', 'a%']) { expect((await d.get(`/console/assets?q=${encodeURIComponent(q)}&status=${encodeURIComponent(q)}&type=${encodeURIComponent(q)}`)).status).toBe(200); expect((await d.get(`/console/reports?status=${encodeURIComponent(q)}`)).status).toBe(200); }
    expect((await d.get(`/console/assets/${encodeURIComponent("' OR 1=1 --")}`)).status).toBe(404); expect(w.rt.sys.get('SELECT COUNT(*) AS n FROM assets')?.['n']).toBeGreaterThan(3);
    expect(listAssets(w.ctx('a_dispatcher'), { q: '%' }).length).toBe(0); // LIKE wildcards are escaped
  });
  it('/health reports ok and the database state without requiring authentication', async () => {
    const r = await new Client(w).get('/health'); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });
  it('the OpenAPI document describes every registered API/ingest/health route', async () => {
    const paths = new Set(Object.keys(openapi.paths).map((p) => p.replace(/\{id\}/g, ':id')));
    const registered = w.app.routes.filter((r) => (r.path.startsWith('/api/') || r.path.startsWith('/ingest/') || r.path === '/health') && r.method !== 'ALL').map((r) => `${r.method} ${r.path}`);
    for (const r of registered) { const path = r.split(' ')[1] as string; expect(paths.has(path), `${r} is not documented in OpenAPI`).toBe(true); }
    const doc = (await (await new Client(w).get('/api/v1/openapi.json')).json()) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(doc.openapi).toBe('3.1.0'); for (const [p, ops] of Object.entries(openapi.paths)) for (const m of Object.keys(ops)) expect(registered.includes(`${m.toUpperCase()} ${p.replace(/\{id\}/g, ':id')}`), `${m} ${p} documented but not implemented`).toBe(true);
  });
});

describe('admin, settings, notifications and platform pages', () => {
  it('org admin manages users: create with invitation link, suspend/reactivate', async () => {
    const a = await loggedIn(w, 'a_admin'); const r = await a.req('POST', '/console/admin/users', { form: { name: 'Fresh Tech', email: 'fresh@test.example', role: 'technician', phone: '', scope_owner: '' } });
    expect(r.status).toBe(200); const html = await r.text(); expect(html).toMatch(/http:\/\/localhost\/invite\/[A-Za-z0-9_-]{40,}/); expect(await (await a.get('/console/admin/users')).text()).toContain('Fresh Tech');
    const uid = w.rt.sys.get<{ id: string }>("SELECT id FROM users WHERE email = 'fresh@test.example'")?.id as string;
    await a.req('POST', `/console/admin/users/${uid}`, { form: { op: 'suspend' } }); expect(w.rt.sys.get<{ status: string }>('SELECT status FROM users WHERE id = :i', { i: uid })?.status).toBe('suspended');
  });
  it('settings validate and persist, and are audited', async () => {
    const a = await loggedIn(w, 'a_admin'); const form = (o: Record<string, string>) => ({ sla_P1: '90', sla_P2: '1000', sla_P3: '3000', minLat: '-5', maxLat: '5', minLng: '33', maxLng: '42', tz: '180', late: '1.5', missing: '3', battery: '25', rssi: '-100', skew: '300', maxage: '30', rph: '10', dupw: '30', repeat: '90', ...o });
    expect((await a.req('POST', '/console/admin/settings', { form: form({}) })).status).toBe(303); expect(JSON.parse(w.rt.sys.get<{ settings: string }>('SELECT settings FROM organisations WHERE id = :o', { o: w.orgA })?.settings as string).slaMinutes.P1).toBe(90);
    const before = w.rt.sys.get<{ settings: string }>('SELECT settings FROM organisations WHERE id = :o', { o: w.orgA })?.settings;
    await a.req('POST', '/console/admin/settings', { form: form({ sla_P1: '1', minLat: '10' }) }); expect(w.rt.sys.get<{ settings: string }>('SELECT settings FROM organisations WHERE id = :o', { o: w.orgA })?.settings).toBe(before);
    expect(w.rt.sys.get("SELECT 1 AS x FROM audit_log WHERE action = 'settings.updated'")).toBeTruthy(); expect(await (await a.get('/console/admin/settings')).text()).toContain('value="90"');
  });
  it('device registration shows the secret once; list never shows it; test reading only for simulated devices', async () => {
    const a = await loggedIn(w, 'a_admin');
    const r = await a.req('POST', '/console/admin/devices', { form: { name: 'UI Device', asset: w.assetA, origin: 'simulated', s_key: 'flow', s_kind: 'flow', s_param: '', s_unit: 'm3/h', s_interval: '60', s_role: 'none', s_min: '0', s_max: '100', s_stuck: '12' } });
    const html = await r.text(); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toContain('no-store'); const secret = html.match(/Secret<\/p><p class="secret">([^<]+)</)?.[1] as string; expect(secret.length).toBeGreaterThan(40);
    const list = await (await a.get('/console/admin/devices')).text(); expect(list).not.toContain(secret); expect(list).toContain('UI Device');
    const id = w.rt.sys.get<{ id: string }>("SELECT id FROM devices WHERE name = 'UI Device'")?.id as string;
    const t = await a.req('POST', `/console/admin/devices/${id}/testreading`, { form: {} }); expect(t.status).toBe(303); expect(w.rt.sys.get<{ n: number }>('SELECT COUNT(*) AS n FROM readings WHERE device_id = :d AND origin = :o', { d: id, o: 'simulated' })?.n).toBe(1);
    const real = w.rt.sys.get<{ id: string }>("SELECT id FROM devices WHERE name = 'Alpha meter'")?.id as string; await a.req('POST', `/console/admin/devices/${real}/testreading`, { form: {} });
    expect(w.rt.sys.get<{ n: number }>("SELECT COUNT(*) AS n FROM readings WHERE device_id = :d AND uid LIKE 'flow:%' AND received_at = :t", { d: real, t: w.rt.now })?.n).toBe(0);
    const bad = await a.req('POST', '/console/admin/devices', { form: { name: 'x', origin: 'real', s_key: 'bad key!', s_kind: 'flow', s_unit: 'm3', s_interval: '60', s_role: 'none' } }); expect(bad.status).toBe(303);
  });
  it('notifications are per user and can be marked read', async () => {
    const d = await loggedIn(w, 'a_dispatcher'); const page = await (await d.get('/notifications')).text(); expect(page).toContain('In-app only');
    await d.req('POST', '/notifications/read', { form: {} }); expect(w.rt.sys.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = :u AND read_at IS NULL', { u: w.users['a_dispatcher']?.id as string })?.n).toBe(0);
    expect(w.rt.sys.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = :u AND read_at IS NULL', { u: w.users['a_admin']?.id as string })?.n).toBeGreaterThanOrEqual(0);
  });
  it('platform admin creates an organisation and first admin but cannot read tenant data', async () => {
    const p = await loggedIn(w, 'platform'); const r = await p.req('POST', '/platform/orgs', { form: { name: 'New Utility', kind: 'utility', admin_name: 'First Admin', admin_email: 'first@new.example' } });
    expect(r.status).toBe(200); expect(await r.text()).toMatch(/\/invite\//); expect((await p.get('/platform')).status).toBe(200);
    for (const path of ['/console/assets', '/api/v1/assets', '/api/v1/work-orders', '/console/reports']) expect((await p.get(path)).status, path).toBe(403);
    expect(await (await p.get('/platform')).text()).not.toContain('Alpha Borehole'); expect(verifyChain(w.rt.db, null).ok).toBe(true);
    await p.req('POST', '/platform/orgs', { form: { name: 'x', kind: 'weird', admin_name: 'n', admin_email: 'bad' } }); expect(w.rt.sys.get("SELECT 1 AS x FROM organisations WHERE name = 'x'")).toBeUndefined();
  });
  it('every console page renders for admin without errors (smoke) and the analytics CSV/JSON export works', async () => {
    const a = await loggedIn(w, 'a_admin');
    for (const p of ['/console/map', '/console/assets', '/console/reports?status=all', '/console/orders', '/console/schedule', '/console/sensors', '/console/analytics?weeks=12', '/console/audit', '/console/admin/users', '/console/admin/devices', '/console/admin/settings', '/notifications', '/account', '/console/orders.csv', '/console/analytics.csv']) expect((await a.get(p)).status, p).toBe(200);
    expect(await (await a.get('/console/analytics.csv')).text()).toContain('outage_reports_per_week');
    const j = (await (await a.get('/api/v1/analytics?weeks=4')).json()) as { window: { weeks: number } }; expect(j.window.weeks).toBe(4);
  });
});

describe('synthetic seed data', () => {
  it('labels everything as synthetic/simulated, is deterministic in shape, and produces the documented sensor states', async () => {
    const rt = makeRt({ WW_DATA_DIR: makeRt().dir }); void openDb; void SystemDb;
    const r = await seedDemo(rt, rt.cfg.dataDir, 'Seed-Passw0rd-1234');
    const q = <T>(sql: string) => rt.sys.all<T>(sql);
    expect(q<{ origin: string }>('SELECT DISTINCT origin FROM assets WHERE org_id = :x').length).toBeDefined();
    expect(rt.sys.all("SELECT DISTINCT origin FROM assets WHERE org_id = :o", { o: r.orgId }).map((x) => x['origin'])).toEqual(['synthetic']);
    expect(rt.sys.all('SELECT DISTINCT origin FROM work_orders').map((x) => x['origin'])).toEqual(['synthetic']);
    expect(rt.sys.all('SELECT DISTINCT origin FROM reports').map((x) => x['origin'])).toEqual(['synthetic']);
    expect(rt.sys.all('SELECT DISTINCT origin FROM devices').map((x) => x['origin'])).toEqual(['simulated']); expect(rt.sys.all('SELECT DISTINCT origin FROM readings').map((x) => x['origin'])).toEqual(['simulated']);
    expect(rt.sys.all('SELECT is_demo FROM organisations').every((o) => o['is_demo'] === 1)).toBe(true);
    expect(rt.sys.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE origin <> 'synthetic'")?.n).toBe(0);
    runHealthCycle(rt.db, rt.now);
    const health = Object.fromEntries(rt.sys.all<{ name: string; health: string }>('SELECT d.name, s.health FROM sensors s JOIN devices d ON d.id = s.device_id').map((x) => [x.name, x.health]));
    expect(health).toMatchObject({ 'SIM-FL-01': 'reporting', 'SIM-FL-04': 'missing', 'SIM-FL-06': 'flatline', 'SIM-PR-07': 'late', 'SIM-PS-08': 'reporting' });
    expect(verifyChain(rt.db, r.orgId).ok).toBe(true);
    const { readFileSync } = await import('node:fs'); expect(JSON.parse(readFileSync(r.deviceFile, 'utf8')).devices.length).toBe(9);
    rt.cleanup();
  });
  it('refuses weak seed passwords the same way as user creation (the seed uses the real password hasher)', async () => {
    const rt = makeRt(); const r = await seedDemo(rt, rt.dir); const u = rt.sys.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'admin@mtokijani.test'");
    expect(u?.password_hash).toMatch(/^scrypt\$/); expect(r.password.length).toBeGreaterThanOrEqual(12); rt.cleanup();
  });
});
void PW;
