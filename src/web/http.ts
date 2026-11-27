import { Hono, type Context, type Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { hmacHex, randomToken, safeEqual } from '../core/crypto.ts';
import { AppError, forbidden, tooMany, unauthorized } from '../core/errors.ts';
import { html, raw, esc } from '../core/html.ts';
import { RateLimiter } from '../core/ratelimit.ts';
import { can, type Permission } from '../domain/rbac.ts';
import type { Actor, Role } from '../domain/types.ts';
import { makeCtx, type Ctx, type Runtime } from '../repo/ctx.ts';
import { actorOf, loadSession, type UserRow } from '../repo/system.ts';
import { page } from './ui.ts';

export type Auth = { user: UserRow; sessionId: string; csrf: string; mfaPending: boolean; actor: Actor };
export type Env = { Variables: { auth: Auth | null } };
export type Deps = { rt: Runtime; limiter: RateLimiter };
export type AppT = Hono<Env>;

export const SID = 'ww_sid';
const PRE = 'ww_pre';
const FLASH = 'ww_flash';

export const clientIp = (c: Context, trustProxy: boolean): string => {
  if (trustProxy) { const x = c.req.header('x-forwarded-for')?.split(',')[0]?.trim(); if (x) return x; }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'local';
};
export const isApiPath = (p: string) => p.startsWith('/api/') || p.startsWith('/ingest/');

export function securityHeaders(d: Deps) {
  const tile = d.rt.cfg.tileUrl ? (() => { try { return new URL(d.rt.cfg.tileUrl.replace(/\{[a-z]\}/g, 'a')).origin; } catch { return ''; } })() : '';
  const csp = `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:${tile ? ' ' + tile : ''}; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'`;
  return async (c: Context, next: Next) => {
    await next();
    if (!c.res.headers.has('Content-Security-Policy')) c.res.headers.set('Content-Security-Policy', csp);
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'same-origin');
    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    c.res.headers.set('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    if (d.rt.cfg.cookieSecure) c.res.headers.set('Strict-Transport-Security', 'max-age=31536000');
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  };
}

export function sessionLoader(d: Deps) {
  return async (c: Context<Env>, next: Next) => {
    const s = loadSession(d.rt, getCookie(c, SID));
    c.set('auth', s ? { user: s.user, sessionId: s.session.id, csrf: s.session.csrf, mfaPending: s.mfaPending, actor: actorOf(s.user, clientIp(c, d.rt.cfg.trustProxy)) } : null);
    await next();
  };
}

const issuedNonce = new WeakMap<object, string>();
const preNonce = (c: Context): string => {
  let n = getCookie(c, PRE) ?? issuedNonce.get(c.req);
  if (!n) { n = randomToken(16); issuedNonce.set(c.req, n); setCookie(c, PRE, n, { httpOnly: true, sameSite: 'Lax', path: '/', secure: false, maxAge: 3600 }); }
  return n;
};
export const csrfToken = (c: Context<Env>, d: Deps): string => {
  const a = c.get('auth');
  return a ? a.csrf : hmacHex(d.rt.cfg.secretKey, 'pre:' + preNonce(c));
};

/** CSRF: synchroniser token (session-bound, or HMAC of a pre-login cookie) on every unsafe request, plus same-origin check. */
export function csrfGuard(d: Deps) {
  return async (c: Context<Env>, next: Next) => {
    const m = c.req.method;
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || c.req.path.startsWith('/ingest/')) return next();
    const origin = c.req.header('origin');
    if (origin) { try { if (new URL(origin).host !== c.req.header('host')) throw forbidden('Cross-origin request blocked.'); } catch (e) { if (e instanceof AppError) throw e; throw forbidden('Bad origin.'); } }
    let token = c.req.header('x-csrf-token') ?? '';
    if (!token) {
      const ct = c.req.header('content-type') ?? '';
      if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) { const b = await c.req.parseBody(); token = typeof b['_csrf'] === 'string' ? b['_csrf'] : ''; }
    }
    const a = c.get('auth');
    const expected = a ? a.csrf : hmacHex(d.rt.cfg.secretKey, 'pre:' + (getCookie(c, PRE) ?? 'none'));
    if (!token || !safeEqual(token, expected)) throw forbidden('Security check failed (CSRF). Reload the page and try again.');
    return next();
  };
}

export function globalRateLimit(d: Deps) {
  return async (c: Context<Env>, next: Next) => {
    const ip = clientIp(c, d.rt.cfg.trustProxy);
    const r = d.limiter.hit(`ip:${ip}`, 900, 60_000);
    if (!r.ok) { c.header('Retry-After', String(r.retryAfterSec)); throw tooMany(); }
    await next();
  };
}
export function limit(d: Deps, c: Context<Env>, key: string, max: number, windowMs: number): void {
  const r = d.limiter.hit(key, max, windowMs);
  if (!r.ok) { c.header('Retry-After', String(r.retryAfterSec)); throw tooMany(`Too many attempts. Try again in ${r.retryAfterSec}s.`); }
}

export function body(limitBytes: number) {
  return bodyLimit({ maxSize: limitBytes, onError: (c) => c.json({ error: 'payload_too_large', message: 'Request body is too large.' }, 413) });
}

// ---- auth guards ----
export function requireAuth(opts: { perm?: Permission; roles?: Role[] } = {}) {
  return async (c: Context<Env>, next: Next) => {
    const a = c.get('auth');
    const api = isApiPath(c.req.path);
    if (!a) { if (api) throw unauthorized(); return c.redirect('/login?next=' + encodeURIComponent(c.req.path), 303); }
    if (a.mfaPending) { if (api) throw unauthorized('MFA verification required'); return c.redirect('/login/mfa', 303); }
    if (opts.roles && !opts.roles.includes(a.actor.role)) throw forbidden();
    if (opts.perm && !can(a.actor.role, opts.perm)) throw forbidden();
    await next();
  };
}
export const ctxOf = (c: Context<Env>, d: Deps): Ctx => makeCtx(d.rt, (c.get('auth') as Auth).actor);

// ---- flash messages ----
export function flash(c: Context, kind: 'ok' | 'err', text: string): void {
  setCookie(c, FLASH, Buffer.from(JSON.stringify({ kind, text: text.slice(0, 300) })).toString('base64url'), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 });
}
export function takeFlash(c: Context): { kind: 'ok' | 'err'; text: string } | null {
  const v = getCookie(c, FLASH);
  if (!v) return null;
  deleteCookie(c, FLASH, { path: '/' });
  try { const j = JSON.parse(Buffer.from(v, 'base64url').toString()) as { kind: 'ok' | 'err'; text: string }; return j.kind === 'ok' || j.kind === 'err' ? { kind: j.kind, text: String(j.text) } : null; } catch { return null; }
}

export const str = (b: Record<string, unknown>, k: string): string => { const v = b[k]; return typeof v === 'string' ? v : ''; };
export const num = (b: Record<string, unknown>, k: string): number => Number(str(b, k));

export function setSessionCookie(c: Context, d: Deps, token: string): void {
  setCookie(c, SID, token, { httpOnly: true, sameSite: 'Lax', path: '/', secure: d.rt.cfg.cookieSecure, maxAge: 12 * 3600 });
}

// ---- static files (own implementation: allow-listed extensions, no path traversal) ----
const MIME: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
export function staticHandler(publicDir: string) {
  const root = resolve(publicDir);
  return (c: Context) => {
    let p: string;
    try { p = decodeURIComponent(c.req.path); } catch { return c.notFound(); }
    const file = resolve(join(root, p));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return c.notFound();
    const type = MIME[extname(file).toLowerCase()];
    if (!type) return c.notFound();
    const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': p === '/sw.js' ? 'no-cache' : 'public, max-age=300' };
    if (p === '/sw.js') headers['Service-Worker-Allowed'] = '/';
    return new Response(readFileSync(file), { headers });
  };
}

export function errorPage(status: number, message: string): string {
  const title = status === 404 ? 'Not found' : status === 403 ? 'Not permitted' : status === 401 ? 'Sign in required' : status === 429 ? 'Slow down' : 'Something went wrong';
  return page({ title, bare: false }, html`<div class="authcard"><h1>${title}</h1><p>${esc(message)}</p><p><a class="btn" href="/">Go to start</a></p></div>`);
}
export { raw };
