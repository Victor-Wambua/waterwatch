import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PW, loggedIn, makeWorld, type World } from '../helpers.ts';
import { totpCode } from '../../src/core/crypto.ts';
import { createUser, issueInvite, MAX_FAILED, LOCK_MS, SESSION_IDLE_MS } from '../../src/repo/system.ts';
import { verifyChain } from '../../src/domain/audit.ts';

let w: World;
beforeAll(async () => { w = await makeWorld(); });
afterAll(() => w.rt.cleanup());

describe('login', () => {
  it('rejects wrong password and unknown users with the same message', async () => {
    const c = new Client(w);
    const bad = await c.req('POST', '/login', { form: { email: 'a_reporter@test.example', password: 'wrong' } }); const t1 = await bad.text();
    const unk = await c.req('POST', '/login', { form: { email: 'nobody@test.example', password: 'wrong' } }); const t2 = await unk.text();
    expect(bad.status).toBe(400); expect(unk.status).toBe(400);
    expect(t1).toContain('Incorrect email or password.'); expect(t2).toContain('Incorrect email or password.');
  });
  it('signs a reporter in without MFA and redirects to the report page', async () => {
    const c = new Client(w); const r = await c.login('a_reporter');
    expect(r.status).toBe(303); expect(r.headers.get('location')).toBe('/report');
    expect((await c.get('/report')).status).toBe(200);
  });
  it('sets HttpOnly SameSite=Lax session cookies and stores only a hash of the token', async () => {
    const c = new Client(w); await c.refreshCsrf();
    const res = await c.req('POST', '/login', { form: { email: 'a_reporter@test.example', password: PW } });
    const sid = res.headers.getSetCookie().find((s) => s.startsWith('ww_sid='));
    expect(sid).toMatch(/HttpOnly/i); expect(sid).toMatch(/SameSite=Lax/i);
    const token = (sid as string).split(';')[0]?.split('=')[1] as string;
    expect(w.rt.sys.get('SELECT 1 AS x FROM sessions WHERE id = :t', { t: token })).toBeUndefined();
  });
  it('marks the cookie Secure when configured', async () => {
    const s = await makeWorld({ WW_COOKIE_SECURE: '1' });
    const c = new Client(s); await c.refreshCsrf();
    const res = await c.req('POST', '/login', { form: { email: 'a_reporter@test.example', password: PW } });
    expect(res.headers.getSetCookie().find((x) => x.startsWith('ww_sid='))).toMatch(/Secure/i);
    expect(res.headers.get('strict-transport-security')).toContain('max-age');
    s.rt.cleanup();
  });
  it('locks the account after repeated failures and records it in the audit log', async () => {
    const s = await makeWorld();
    const c = new Client(s);
    for (let i = 0; i < MAX_FAILED; i++) await c.req('POST', '/login', { form: { email: 'a_tech@test.example', password: 'nope' } });
    const locked = await c.req('POST', '/login', { form: { email: 'a_tech@test.example', password: PW } });
    expect(locked.status).toBe(400); expect(await locked.text()).toContain('temporarily locked');
    s.rt.advance(LOCK_MS + 1000);
    expect((await c.req('POST', '/login', { form: { email: 'a_tech@test.example', password: PW } })).status).toBe(303);
    const actions = s.rt.sys.all<{ action: string }>('SELECT action FROM audit_log WHERE org_id = :o', { o: s.orgA }).map((r) => r.action);
    expect(actions).toContain('auth.locked'); expect(actions).toContain('auth.login_failed');
    s.rt.cleanup();
  });
  it('rate limits login attempts per IP when the limiter is enabled', async () => {
    const s = await makeWorld({ WW_RATE_LIMIT_DISABLED: '0' });
    const c = new Client(s); await c.refreshCsrf();
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await c.req('POST', '/login', { form: { email: `x${i}@test.example`, password: 'nope' } })).status;
    expect(last).toBe(429);
    s.rt.cleanup();
  });
  it('does not allow suspended users to sign in or keep a session', async () => {
    const s = await makeWorld(); const c = await loggedIn(s, 'a_reporter');
    expect((await c.get('/report')).status).toBe(200);
    s.rt.sys.run("UPDATE users SET status = 'suspended' WHERE id = :id", { id: s.users['a_reporter']?.id as string });
    const r = await c.get('/report'); expect(r.status).toBe(303); expect(r.headers.get('location')).toContain('/login');
    expect((await new Client(s).login('a_reporter')).status).toBe(400);
    s.rt.cleanup();
  });
  it('open-redirect safe: ignores external next parameters', async () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const c = new Client(w); await c.refreshCsrf();
      const r = await c.req('POST', '/login', { form: { email: 'a_reporter@test.example', password: PW, next } });
      expect(r.headers.get('location')).toBe('/report');
    }
  });
  it('logout destroys the session server-side', async () => {
    const c = await loggedIn(w, 'a_reporter');
    const sid = c.jar.get('ww_sid') as string;
    expect((await c.req('POST', '/logout', { form: {} })).status).toBe(303);
    const c2 = new Client(w); c2.jar.set('ww_sid', sid);
    expect((await c2.get('/report')).status).toBe(303);
  });
  it('idle sessions expire', async () => {
    const s = await makeWorld(); const c = await loggedIn(s, 'a_reporter');
    s.rt.advance(SESSION_IDLE_MS + 1000);
    expect((await c.get('/report')).status).toBe(303);
    s.rt.cleanup();
  });
});

describe('MFA (TOTP)', () => {
  it('privileged roles cannot reach the console before verifying a code', async () => {
    const s = await makeWorld(); const c = new Client(s); await c.refreshCsrf();
    const r = await c.req('POST', '/login', { form: { email: 'a_dispatcher@test.example', password: PW } });
    expect(r.headers.get('location')).toBe('/login/mfa');
    const m = await c.get('/console/map'); expect(m.status).toBe(303); expect(m.headers.get('location')).toBe('/login/mfa');
    expect((await c.get('/api/v1/assets')).status).toBe(401);
    s.rt.cleanup();
  });
  it('enrols on first sign-in, then requires a code, rejects wrong codes and replayed codes', async () => {
    const s = await makeWorld();
    const c1 = new Client(s); await c1.refreshCsrf();
    await c1.req('POST', '/login', { form: { email: 'a_admin@test.example', password: PW } }); c1.csrfTok = ''; await c1.refreshCsrf();
    const page = await (await c1.get('/login/mfa')).text();
    const secret = page.match(/id="totp-secret">([A-Z2-7]+)</)?.[1] as string; expect(secret).toBeTruthy();
    const bad = await c1.req('POST', '/login/mfa', { form: { code: '000000' } }); expect(bad.headers.get('location')).toBe('/login/mfa');
    expect((await c1.get('/console/map')).status).toBe(303);
    s.rt.advance(31_000);
    const code = totpCode(secret, s.rt.now);
    const ok = await c1.req('POST', '/login/mfa', { form: { code } }); expect(ok.headers.get('location')).toBe('/console/map');
    expect((await c1.get('/console/map')).status).toBe(200);
    // second sign-in: the same code (same step) must be rejected as a replay
    const c2 = new Client(s); await c2.refreshCsrf();
    await c2.req('POST', '/login', { form: { email: 'a_admin@test.example', password: PW } }); c2.csrfTok = ''; await c2.refreshCsrf();
    expect(await (await c2.get('/login/mfa')).text()).not.toContain('totp-secret'); // already enrolled: no secret shown again
    const replay = await c2.req('POST', '/login/mfa', { form: { code } }); expect(replay.headers.get('location')).toBe('/login/mfa');
    expect((await c2.get('/console/map')).status).toBe(303);
    s.rt.advance(31_000);
    expect((await c2.req('POST', '/login/mfa', { form: { code: totpCode(secret, s.rt.now) } })).headers.get('location')).toBe('/console/map');
    s.rt.cleanup();
  });
  it('stores the TOTP secret encrypted at rest', async () => {
    const s = await makeWorld(); await loggedIn(s, 'a_admin');
    const row = s.rt.sys.get<{ mfa_secret_enc: string }>('SELECT mfa_secret_enc FROM users WHERE id = :id', { id: s.users['a_admin']?.id as string });
    expect(row?.mfa_secret_enc).toMatch(/^v1\./); expect(row?.mfa_secret_enc).not.toMatch(/^[A-Z2-7]{32}$/);
    s.rt.cleanup();
  });
  it('locks MFA attempts after repeated wrong codes', async () => {
    const s = await makeWorld(); const c = new Client(s); await c.refreshCsrf();
    await c.req('POST', '/login', { form: { email: 'a_admin@test.example', password: PW } }); c.csrfTok = ''; await c.refreshCsrf(); await c.get('/login/mfa');
    for (let i = 0; i < MAX_FAILED + 1; i++) await c.req('POST', '/login/mfa', { form: { code: '111111' } });
    const row = s.rt.sys.get<{ locked_until: number }>('SELECT locked_until FROM users WHERE id = :id', { id: s.users['a_admin']?.id as string });
    expect((row?.locked_until ?? 0) > s.rt.now).toBe(true);
    s.rt.cleanup();
  });
  it('an admin MFA reset forces re-enrolment and ends the sessions', async () => {
    const s = await makeWorld(); const admin = await loggedIn(s, 'a_admin'); const disp = await loggedIn(s, 'a_dispatcher');
    expect((await disp.get('/console/map')).status).toBe(200);
    const r = await admin.req('POST', `/console/admin/users/${s.users['a_dispatcher']?.id}`, { form: { op: 'resetmfa' } });
    expect(r.status).toBe(303);
    expect((await disp.get('/console/map')).status).toBe(303);
    expect(s.rt.sys.get<{ mfa_enrolled: number }>('SELECT mfa_enrolled FROM users WHERE id = :id', { id: s.users['a_dispatcher']?.id as string })?.mfa_enrolled).toBe(0);
    s.rt.cleanup();
  });
});

describe('CSRF', () => {
  it('rejects unsafe requests without a token, with a wrong token, and cross-origin', async () => {
    const c = await loggedIn(w, 'a_dispatcher');
    expect((await c.req('POST', '/notifications/read', { csrf: false, form: {} })).status).toBe(403);
    expect((await c.req('POST', '/notifications/read', { csrf: false, form: { _csrf: 'deadbeef' } })).status).toBe(403);
    expect((await c.req('POST', '/notifications/read', { headers: { origin: 'https://evil.example' }, form: {} })).status).toBe(403);
    expect((await c.req('POST', '/notifications/read', { form: {} })).status).toBe(303);
    expect((await c.req('POST', '/notifications/read', { headers: { origin: 'http://localhost' }, form: {} })).status).toBe(303);
  });
  it('API writes need the X-CSRF-Token header', async () => {
    const c = await loggedIn(w, 'a_admin');
    expect((await c.req('POST', '/api/v1/assets', { csrf: false, json: {} })).status).toBe(403);
  });
  it('login form is protected by a pre-session token', async () => {
    const c = new Client(w); await c.get('/login');
    expect((await c.req('POST', '/login', { csrf: false, form: { email: 'a_reporter@test.example', password: PW } })).status).toBe(403);
    expect((await new Client(w).req('POST', '/login', { csrf: false, form: { _csrf: 'x', email: 'a_reporter@test.example', password: PW } })).status).toBe(403);
  });
  it('a CSRF token from one session is not valid for another', async () => {
    const a = await loggedIn(w, 'a_dispatcher'); const b = await loggedIn(w, 'b_dispatcher');
    expect((await b.req('POST', '/notifications/read', { csrf: false, form: { _csrf: a.csrfTok } })).status).toBe(403);
  });
});

describe('invitations and passwords', () => {
  it('an invitation sets the first password once, then is dead', async () => {
    const s = await makeWorld();
    const r = await createUser(s.rt, null, { orgId: s.orgA, email: 'new.tech@test.example', name: 'New Tech', role: 'technician' });
    const tok = r.inviteToken as string;
    const c = new Client(s); expect((await c.get(`/invite/${tok}`)).status).toBe(200);
    await c.refreshCsrf();
    const weak = await c.req('POST', `/invite/${tok}`, { form: { password: 'short' } }); expect(weak.headers.get('location')).toBe(`/invite/${tok}`);
    const ok = await c.req('POST', `/invite/${tok}`, { form: { password: 'Brand-New-Passw0rd' } }); expect(ok.headers.get('location')).toBe('/login');
    expect((await c.get(`/invite/${tok}`)).status).toBe(404);
    const lc = new Client(s); await lc.refreshCsrf();
    expect((await lc.req('POST', '/login', { form: { email: 'new.tech@test.example', password: 'Brand-New-Passw0rd' } })).headers.get('location')).toBe('/tech');
    s.rt.cleanup();
  });
  it('expired and unknown invitations are refused', async () => {
    const s = await makeWorld();
    const r = await createUser(s.rt, null, { orgId: s.orgA, email: 'late@test.example', name: 'Late User', role: 'technician' });
    s.rt.advance(8 * 24 * 3600_000);
    expect((await new Client(s).get(`/invite/${r.inviteToken}`)).status).toBe(404);
    expect((await new Client(s).get('/invite/not-a-token')).status).toBe(404);
    s.rt.cleanup();
  });
  it('changing a password signs out all sessions', async () => {
    const s = await makeWorld(); const a = await loggedIn(s, 'a_reporter'); const b = await loggedIn(s, 'a_reporter');
    const r = await a.req('POST', '/account/password', { form: { current: PW, next: 'Another-Passw0rd-9' } }); expect(r.headers.get('location')).toBe('/login');
    expect((await b.get('/report')).status).toBe(303);
    s.rt.cleanup();
  });
  it('rejects the wrong current password and weak new passwords', async () => {
    const s = await makeWorld(); const a = await loggedIn(s, 'a_reporter');
    await a.req('POST', '/account/password', { form: { current: 'bad', next: 'Another-Passw0rd-9' } });
    expect((await new Client(s).login('a_reporter')).status).toBe(303); // password unchanged
    await a.req('POST', '/account/password', { form: { current: PW, next: 'weak' } });
    expect((await new Client(s).login('a_reporter')).status).toBe(303);
    s.rt.cleanup();
  });
  it('creating users validates input and uniqueness', async () => {
    const s = await makeWorld();
    await expect(createUser(s.rt, null, { orgId: s.orgA, email: 'not-an-email', name: 'X Y', role: 'technician' })).rejects.toThrow(/email/i);
    await expect(createUser(s.rt, null, { orgId: s.orgA, email: 'a_tech@test.example', name: 'Dup', role: 'technician' })).rejects.toThrow(/already exists/);
    await expect(createUser(s.rt, null, { orgId: s.orgA, email: 'p@test.example', name: 'Pl', role: 'platform_admin' })).rejects.toThrow(/do not match/);
    await expect(createUser(s.rt, null, { orgId: s.orgA, email: 'w@test.example', name: 'Weak', role: 'technician', password: 'weak' })).rejects.toThrow(/12 characters/);
    expect(issueInvite(s.rt, s.users['a_tech']?.id as string).length).toBeGreaterThan(30);
    s.rt.cleanup();
  });
  it('org admins cannot suspend themselves or remove the last admin; roles are limited', async () => {
    const s = await makeWorld(); const a = await loggedIn(s, 'a_admin');
    await a.req('POST', `/console/admin/users/${s.users['a_admin']?.id}`, { form: { op: 'suspend' } });
    expect(s.rt.sys.get<{ status: string }>('SELECT status FROM users WHERE id = :id', { id: s.users['a_admin']?.id as string })?.status).toBe('active');
    const r = await a.req('POST', '/console/admin/users', { form: { name: 'Escalate Me', email: 'esc@test.example', role: 'platform_admin' } });
    expect(r.status).toBe(303); expect(s.rt.sys.get('SELECT 1 AS x FROM users WHERE email = :e', { e: 'esc@test.example' })).toBeUndefined();
    s.rt.cleanup();
  });
  it('the audit chain stays valid after all of the above', () => { expect(verifyChain(w.rt.db, w.orgA).ok).toBe(true); });
});
