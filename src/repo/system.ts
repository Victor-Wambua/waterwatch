import { SystemDb, tx } from '../db/index.ts';
import { hashPassword, verifyPassword, passwordProblem, randomToken, sha256hex, encryptSecret, decryptSecret, newTotpSecret, verifyTotp, otpauthUri } from '../core/crypto.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../core/errors.ts';
import { appendAudit } from '../domain/audit.ts';
import { mfaRequired, ORG_ASSIGNABLE_ROLES } from '../domain/rbac.ts';
import type { Actor, Role } from '../domain/types.ts';
import { newId, type Runtime } from './ctx.ts';

export type UserRow = {
  id: string; org_id: string | null; email: string; name: string; phone: string | null; role: Role; password_hash: string | null; status: string;
  mfa_secret_enc: string | null; mfa_enrolled: number; mfa_last_step: number; failed_attempts: number; locked_until: number; scope_owner: string | null;
};
export type SessionRow = { id: string; user_id: string; created_at: number; last_seen_at: number; expires_at: number; mfa_verified: number; csrf: string };

export const SESSION_IDLE_MS = 8 * 3600_000;
export const SESSION_ABSOLUTE_MS = 12 * 3600_000;
export const PRE_MFA_MS = 10 * 60_000;
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60_000;
export const INVITE_TTL_MS = 7 * 24 * 3600_000;

export const actorOf = (u: UserRow, ip?: string): Actor => ({ id: u.id, orgId: u.org_id, role: u.role, name: u.name, scopeOwner: u.scope_owner, ip });

export function createOrganisation(rt: Runtime, actor: Actor | null, input: { name: string; kind: 'utility' | 'county' | 'ngo' | 'platform'; isDemo?: boolean }): string {
  const id = newId();
  rt.sys.run('INSERT INTO organisations (id, name, kind, is_demo, settings, created_at) VALUES (:id,:n,:k,:d,:s,:now)', { id, n: input.name, k: input.kind, d: input.isDemo ? 1 : 0, s: '{}', now: rt.clock() });
  appendAudit(rt.db, rt.clock(), { orgId: id, actor, action: 'org.created', objectType: 'organisation', objectId: id, detail: { name: input.name, kind: input.kind } });
  return id;
}

export async function createUser(rt: Runtime, actor: Actor | null, input: { orgId: string | null; email: string; name: string; phone?: string | null; role: Role; password?: string; scopeOwner?: string | null; origin?: string }): Promise<{ id: string; inviteToken?: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw badRequest('A valid email address is required.');
  if (input.name.trim().length < 2 || input.name.length > 120) throw badRequest('Name must be 2-120 characters.');
  if (rt.sys.get('SELECT 1 AS x FROM users WHERE email = :e', { e: email })) throw conflict('A user with that email already exists.');
  if (input.role === 'platform_admin' ? input.orgId !== null : input.orgId === null) throw badRequest('Role and organisation do not match.');
  const id = newId();
  let hash: string | null = null;
  if (input.password) {
    const prob = passwordProblem(input.password);
    if (prob) throw badRequest(prob);
    hash = await hashPassword(input.password);
  }
  rt.sys.run(`INSERT INTO users (id, org_id, email, name, phone, role, password_hash, status, scope_owner, origin, created_at)
    VALUES (:id,:org,:e,:n,:p,:r,:h,:s,:so,:o,:now)`, { id, org: input.orgId, e: email, n: input.name.trim(), p: input.phone ?? null, r: input.role, h: hash, s: hash ? 'active' : 'invited', so: input.scopeOwner ?? null, o: input.origin ?? 'user_submitted', now: rt.clock() });
  appendAudit(rt.db, rt.clock(), { orgId: input.orgId, actor, action: 'user.created', objectType: 'user', objectId: id, detail: { role: input.role } });
  if (hash) return { id };
  return { id, inviteToken: issueInvite(rt, id) };
}

export function issueInvite(rt: Runtime, userId: string): string {
  const token = randomToken(32);
  rt.sys.run('INSERT INTO invites (id, user_id, token_hash, expires_at) VALUES (:id,:u,:h,:e)', { id: newId(), u: userId, h: sha256hex(token), e: rt.clock() + INVITE_TTL_MS });
  return token;
}

export function inviteInfo(rt: Runtime, token: string): { userId: string; name: string; email: string } | null {
  const r = rt.sys.get<{ user_id: string; name: string; email: string }>('SELECT i.user_id, u.name, u.email FROM invites i JOIN users u ON u.id = i.user_id WHERE i.token_hash = :h AND i.used_at IS NULL AND i.expires_at > :now', { h: sha256hex(token), now: rt.clock() });
  return r ? { userId: r.user_id, name: r.name, email: r.email } : null;
}

export async function acceptInvite(rt: Runtime, token: string, password: string): Promise<void> {
  const info = inviteInfo(rt, token);
  if (!info) throw badRequest('This invitation link is invalid or has expired.');
  const prob = passwordProblem(password);
  if (prob) throw badRequest(prob);
  const hash = await hashPassword(password);
  tx(rt.db, () => {
    rt.sys.run('UPDATE invites SET used_at = :now WHERE token_hash = :h', { now: rt.clock(), h: sha256hex(token) });
    rt.sys.run("UPDATE users SET password_hash = :h, status = 'active', failed_attempts = 0, locked_until = 0 WHERE id = :id AND status <> 'suspended'", { h: hash, id: info.userId });
    rt.sys.run('DELETE FROM sessions WHERE user_id = :id', { id: info.userId });
  });
  const u = rt.sys.get<UserRow>('SELECT * FROM users WHERE id = :id', { id: info.userId });
  appendAudit(rt.db, rt.clock(), { orgId: u?.org_id ?? null, actor: u ? { id: u.id, role: u.role } : null, action: 'user.invite_accepted', objectType: 'user', objectId: info.userId });
}

// Verifies against a dummy hash when the user is unknown so response time does not reveal which emails exist.
let dummyHash: string | null = null;
export async function login(rt: Runtime, emailIn: string, password: string, meta: { ip?: string; ua?: string }): Promise<{ token: string; user: UserRow; needsMfa: boolean }> {
  const email = emailIn.trim().toLowerCase();
  const now = rt.clock();
  const u = rt.sys.get<UserRow>('SELECT * FROM users WHERE email = :e', { e: email });
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  if (!u || !u.password_hash) { await verifyPassword(password, dummyHash); throw unauthorized('Incorrect email or password.'); }
  if (u.locked_until > now) throw unauthorized('Account temporarily locked after repeated failed sign-ins. Try again later.');
  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) {
    const failed = u.failed_attempts + 1;
    rt.sys.run('UPDATE users SET failed_attempts = :f, locked_until = :l WHERE id = :id', { f: failed >= MAX_FAILED ? 0 : failed, l: failed >= MAX_FAILED ? now + LOCK_MS : 0, id: u.id });
    appendAudit(rt.db, now, { orgId: u.org_id, actor: { id: u.id, role: u.role }, action: failed >= MAX_FAILED ? 'auth.locked' : 'auth.login_failed', objectType: 'user', objectId: u.id, detail: { ip: meta.ip } });
    throw unauthorized('Incorrect email or password.');
  }
  if (u.status !== 'active') throw forbidden('This account is not active.');
  rt.sys.run('UPDATE users SET failed_attempts = 0, locked_until = 0, last_login_at = :now WHERE id = :id', { now, id: u.id });
  const needsMfa = mfaRequired(u.role);
  const token = randomToken(32);
  rt.sys.run('INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, mfa_verified, csrf, ip, ua) VALUES (:id,:u,:now,:now,:exp,:m,:c,:ip,:ua)',
    { id: sha256hex(token), u: u.id, now, exp: now + (needsMfa ? PRE_MFA_MS : SESSION_ABSOLUTE_MS), m: needsMfa ? 0 : 1, c: randomToken(24), ip: meta.ip ?? null, ua: (meta.ua ?? '').slice(0, 200) });
  appendAudit(rt.db, now, { orgId: u.org_id, actor: { id: u.id, role: u.role }, action: 'auth.login', objectType: 'user', objectId: u.id, detail: { ip: meta.ip, mfaPending: needsMfa } });
  return { token, user: u, needsMfa };
}

export type SessionInfo = { session: SessionRow; user: UserRow; mfaPending: boolean };
export function loadSession(rt: Runtime, token: string | undefined): SessionInfo | null {
  if (!token) return null;
  const now = rt.clock();
  const s = rt.sys.get<SessionRow>('SELECT * FROM sessions WHERE id = :id', { id: sha256hex(token) });
  if (!s) return null;
  if (s.expires_at <= now || now - s.last_seen_at > SESSION_IDLE_MS) { rt.sys.run('DELETE FROM sessions WHERE id = :id', { id: s.id }); return null; }
  const user = rt.sys.get<UserRow>('SELECT * FROM users WHERE id = :id', { id: s.user_id });
  if (!user || user.status !== 'active') { rt.sys.run('DELETE FROM sessions WHERE id = :id', { id: s.id }); return null; }
  if (now - s.last_seen_at > 60_000) rt.sys.run('UPDATE sessions SET last_seen_at = :now WHERE id = :id', { now, id: s.id });
  return { session: s, user, mfaPending: mfaRequired(user.role) && s.mfa_verified === 0 };
}
export const destroySession = (rt: Runtime, token: string) => { rt.sys.run('DELETE FROM sessions WHERE id = :id', { id: sha256hex(token) }); };

/** Begin MFA enrolment: stores an unconfirmed secret and returns it for display (shown only during enrolment). */
export function beginMfaEnrolment(rt: Runtime, user: UserRow): { secret: string; uri: string } {
  if (user.mfa_enrolled) throw conflict('MFA is already enrolled.');
  let secret: string;
  if (user.mfa_secret_enc) secret = decryptSecret(user.mfa_secret_enc, rt.cfg.secretKey);
  else { secret = newTotpSecret(); rt.sys.run('UPDATE users SET mfa_secret_enc = :s WHERE id = :id', { s: encryptSecret(secret, rt.cfg.secretKey), id: user.id }); }
  return { secret, uri: otpauthUri(secret, user.email) };
}

export function verifyMfaCode(rt: Runtime, user: UserRow, sessionId: string, code: string): void {
  const fresh = rt.sys.get<UserRow>('SELECT * FROM users WHERE id = :id', { id: user.id });
  if (!fresh?.mfa_secret_enc) throw badRequest('MFA is not set up.');
  const now = rt.clock();
  if (fresh.locked_until > now) throw unauthorized('Too many failed codes. Try again later.');
  const secret = decryptSecret(fresh.mfa_secret_enc, rt.cfg.secretKey);
  const step = verifyTotp(secret, code.trim(), now, fresh.mfa_last_step);
  if (step === null) {
    const failed = fresh.failed_attempts + 1;
    rt.sys.run('UPDATE users SET failed_attempts = :f, locked_until = :l WHERE id = :id', { f: failed >= MAX_FAILED ? 0 : failed, l: failed >= MAX_FAILED ? now + LOCK_MS : 0, id: fresh.id });
    appendAudit(rt.db, now, { orgId: fresh.org_id, actor: { id: fresh.id, role: fresh.role }, action: 'auth.mfa_failed', objectType: 'user', objectId: fresh.id });
    throw unauthorized('That code is not valid.');
  }
  tx(rt.db, () => {
    rt.sys.run('UPDATE users SET mfa_enrolled = 1, mfa_last_step = :s, failed_attempts = 0 WHERE id = :id', { s: step, id: fresh.id });
    rt.sys.run('UPDATE sessions SET mfa_verified = 1, expires_at = :exp WHERE id = :sid', { exp: now + SESSION_ABSOLUTE_MS, sid: sessionId });
  });
  appendAudit(rt.db, now, { orgId: fresh.org_id, actor: { id: fresh.id, role: fresh.role }, action: fresh.mfa_enrolled ? 'auth.mfa_verified' : 'auth.mfa_enrolled', objectType: 'user', objectId: fresh.id });
}

export async function changePassword(rt: Runtime, user: UserRow, current: string, next: string): Promise<void> {
  if (!user.password_hash || !(await verifyPassword(current, user.password_hash))) throw unauthorized('Current password is incorrect.');
  const prob = passwordProblem(next);
  if (prob) throw badRequest(prob);
  const h = await hashPassword(next);
  rt.sys.run('UPDATE users SET password_hash = :h WHERE id = :id', { h, id: user.id });
  rt.sys.run('DELETE FROM sessions WHERE user_id = :id', { id: user.id });
  appendAudit(rt.db, rt.clock(), { orgId: user.org_id, actor: { id: user.id, role: user.role }, action: 'user.password_changed', objectType: 'user', objectId: user.id });
}

// ---- org-admin user management (tenant-scoped via org id on every statement) ----
export function listOrgUsers(sys: SystemDb, orgId: string) {
  return sys.all<{ id: string; email: string; name: string; role: Role; status: string; mfa_enrolled: number; scope_owner: string | null; phone: string | null; origin: string; last_login_at: number | null }>(
    'SELECT id, email, name, role, status, mfa_enrolled, scope_owner, phone, origin, last_login_at FROM users WHERE org_id = :org ORDER BY role, name', { org: orgId });
}
export function updateOrgUser(rt: Runtime, actor: Actor, userId: string, patch: { status?: 'active' | 'suspended'; role?: Role; resetMfa?: boolean; scopeOwner?: string | null }): void {
  if (!actor.orgId) throw forbidden();
  const u = rt.sys.get<UserRow>('SELECT * FROM users WHERE id = :id AND org_id = :org', { id: userId, org: actor.orgId });
  if (!u) throw notFound('User not found');
  if (u.id === actor.id && (patch.status === 'suspended' || (patch.role && patch.role !== u.role))) throw badRequest('You cannot suspend or change the role of your own account.');
  if (patch.role && !ORG_ASSIGNABLE_ROLES.includes(patch.role)) throw badRequest('That role cannot be assigned.');
  const adminsLeft = rt.sys.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE org_id = :org AND role = 'org_admin' AND status = 'active' AND id <> :id", { org: actor.orgId, id: u.id })?.n ?? 0;
  if (u.role === 'org_admin' && adminsLeft === 0 && (patch.status === 'suspended' || (patch.role && patch.role !== 'org_admin'))) throw badRequest('At least one active utility admin must remain.');
  tx(rt.db, () => {
    if (patch.status) rt.sys.run('UPDATE users SET status = :s WHERE id = :id', { s: patch.status, id: u.id });
    if (patch.role) rt.sys.run('UPDATE users SET role = :r WHERE id = :id', { r: patch.role, id: u.id });
    if (patch.scopeOwner !== undefined) rt.sys.run('UPDATE users SET scope_owner = :s WHERE id = :id', { s: patch.scopeOwner || null, id: u.id });
    if (patch.resetMfa) rt.sys.run('UPDATE users SET mfa_secret_enc = NULL, mfa_enrolled = 0, mfa_last_step = -1 WHERE id = :id', { id: u.id });
    if (patch.status === 'suspended' || patch.role || patch.resetMfa) rt.sys.run('DELETE FROM sessions WHERE user_id = :id', { id: u.id });
  });
  appendAudit(rt.db, rt.clock(), { orgId: actor.orgId, actor, action: 'user.updated', objectType: 'user', objectId: u.id, detail: { ...patch } });
}
