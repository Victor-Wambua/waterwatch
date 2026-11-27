import type { Context } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';
import { html, raw } from '../core/html.ts';
import { AppError } from '../core/errors.ts';
import { acceptInvite, beginMfaEnrolment, changePassword, destroySession, inviteInfo, login, verifyMfaCode } from '../repo/system.ts';
import { body, csrfToken, flash, limit, requireAuth, SID, setSessionCookie, str, type AppT, type Deps, type Env, clientIp } from './http.ts';
import { homeFor, render } from './shell.ts';
import { csrf, field } from './ui.ts';
import { appendAudit } from '../domain/audit.ts';

const safeNext = (n: string | undefined | null) => (n && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : null);

export function authRoutes(app: AppT, d: Deps): void {
  const loginForm = (c: Context<Env>, next: string | null, err?: string, email = '') =>
    render(c, d, { title: 'Sign in', noNav: true, status: err ? 400 : 200, body: html`<div class="authcard"><h1>Sign in to WaterWatch</h1>${err ? html`<p class="err" role="alert">${err}</p>` : ''}
      <form method="post" action="/login" autocomplete="on">${csrf(csrfToken(c, d))}<input type="hidden" name="next" value="${next ?? ''}">
      ${field('email', 'Email', html`<input id="email" name="email" type="email" autocomplete="username" required value="${email}">`)}
      ${field('password', 'Password', html`<input id="password" name="password" type="password" autocomplete="current-password" required>`)}
      <button class="btn pri big" type="submit">Sign in</button></form>
      <p class="hint">Utility managers, dispatchers and admins are asked for a one-time code (authenticator app) after the password. Accounts are created by your utility administrator; there is no public sign-up.</p></div>`
      });

  app.get('/login', (c) => {
    const a = c.get('auth');
    if (a && !a.mfaPending) return c.redirect(homeFor(a.actor.role), 303);
    return loginForm(c, safeNext(c.req.query('next')));
  });

  app.post('/login', body(16 * 1024), async (c) => {
    const f = await c.req.parseBody();
    const email = str(f, 'email'), pw = str(f, 'password'), next = safeNext(str(f, 'next'));
    const ip = clientIp(c, d.rt.cfg.trustProxy);
    limit(d, c, `login:ip:${ip}`, 20, 10 * 60_000);
    limit(d, c, `login:acct:${email.toLowerCase()}`, 10, 10 * 60_000);
    try {
      const r = await login(d.rt, email, pw, { ip, ua: c.req.header('user-agent') });
      const old = getCookie(c, SID); if (old) destroySession(d.rt, old); // never reuse a pre-login session id
      setSessionCookie(c, d, r.token);
      return c.redirect(r.needsMfa ? '/login/mfa' : (next ?? homeFor(r.user.role)), 303);
    } catch (e) {
      if (e instanceof AppError && (e.status === 401 || e.status === 403)) return loginForm(c, next, e.message, email);
      throw e;
    }
  });

  app.get('/login/mfa', (c) => {
    const a = c.get('auth');
    if (!a) return c.redirect('/login', 303);
    if (!a.mfaPending) return c.redirect(homeFor(a.actor.role), 303);
    const enrol = !a.user.mfa_enrolled ? beginMfaEnrolment(d.rt, a.user) : null;
    return render(c, d, { title: 'Verification code', noNav: true, body: html`<div class="authcard"><h1>${enrol ? 'Set up two-step verification' : 'Enter your verification code'}</h1>
      ${enrol ? html`<p>Your role requires two-step verification. In an authenticator app (any TOTP app), add an account using this key, then enter the 6-digit code.</p>
        <p class="secret" id="totp-secret">${enrol.secret}</p><p class="hint">Key type: time-based, 6 digits, 30 seconds, SHA-1. Account: ${a.user.email}. Setup URI: <span class="tag">${enrol.uri}</span></p>` : html`<p>Open your authenticator app and enter the current 6-digit code.</p>`}
      <form method="post" action="/login/mfa">${csrf(csrfToken(c, d))}${field('code', '6-digit code', html`<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>`)}
      <button class="btn pri big" type="submit">Verify</button></form></div>` });
  });
  app.post('/login/mfa', body(8 * 1024), async (c) => {
    const a = c.get('auth');
    if (!a) return c.redirect('/login', 303);
    limit(d, c, `mfa:${a.user.id}`, 10, 10 * 60_000);
    const f = await c.req.parseBody();
    try { verifyMfaCode(d.rt, a.user, a.sessionId, str(f, 'code')); } catch (e) {
      if (e instanceof AppError && (e.status === 401 || e.status === 400)) { flash(c, 'err', e.message); return c.redirect('/login/mfa', 303); }
      throw e;
    }
    return c.redirect(homeFor(a.actor.role), 303);
  });

  app.post('/logout', async (c) => {
    const tok = getCookie(c, SID);
    const a = c.get('auth');
    if (tok) destroySession(d.rt, tok);
    if (a) appendAudit(d.rt.db, d.rt.clock(), { orgId: a.actor.orgId, actor: a.actor, action: 'auth.logout', objectType: 'user', objectId: a.actor.id });
    deleteCookie(c, SID, { path: '/' });
    return c.redirect('/login', 303);
  });

  app.get('/invite/:token', (c) => {
    const info = inviteInfo(d.rt, c.req.param('token'));
    if (!info) return render(c, d, { title: 'Invitation', noNav: true, status: 404, body: html`<div class="authcard"><h1>Invitation not valid</h1><p>This invitation link is invalid, used or expired. Ask your administrator for a new one.</p></div>` });
    return render(c, d, { title: 'Set your password', noNav: true, body: html`<div class="authcard"><h1>Welcome, ${info.name}</h1><p>Choose a password for ${info.email}.</p>
      <form method="post" action="/invite/${c.req.param('token')}">${csrf(csrfToken(c, d))}${field('pw', 'New password', html`<input id="pw" name="password" type="password" autocomplete="new-password" minlength="12" required>`, 'At least 12 characters with upper case, lower case and a digit.')}
      <button class="btn pri big" type="submit">Save password</button></form></div>` });
  });
  app.post('/invite/:token', body(8 * 1024), async (c) => {
    limit(d, c, `invite:${clientIp(c, d.rt.cfg.trustProxy)}`, 20, 10 * 60_000);
    const f = await c.req.parseBody();
    try { await acceptInvite(d.rt, c.req.param('token'), str(f, 'password')); } catch (e) {
      if (e instanceof AppError && e.status === 400) { flash(c, 'err', e.message); return c.redirect(`/invite/${c.req.param('token')}`, 303); }
      throw e;
    }
    flash(c, 'ok', 'Password saved. You can sign in now.');
    return c.redirect('/login', 303);
  });

  app.get('/account', requireAuth(), (c) => {
    const a = c.get('auth');
    if (!a) return c.redirect('/login', 303);
    return render(c, d, { title: 'Account', body: html`<div class="stack"><div class="card"><h1>Your account</h1><p>${a.user.name} · ${a.user.email}</p><p>Two-step verification: <b>${a.user.mfa_enrolled ? 'enrolled' : ['dispatcher', 'org_admin', 'platform_admin'].includes(a.user.role) ? 'required' : 'not required for your role'}</b></p></div>
      <div class="card"><h2>Change password</h2><form method="post" action="/account/password">${csrf(csrfToken(c, d))}${field('cur', 'Current password', html`<input id="cur" name="current" type="password" autocomplete="current-password" required>`)}${field('new', 'New password', html`<input id="new" name="next" type="password" autocomplete="new-password" minlength="12" required>`, 'Changing your password signs you out everywhere.')}<button class="btn pri" type="submit">Change password</button></form></div></div>` });
  });
  app.post('/account/password', requireAuth(), body(8 * 1024), async (c) => {
    const a = c.get('auth');
    if (!a) return c.redirect('/login', 303);
    const f = await c.req.parseBody();
    try { await changePassword(d.rt, a.user, str(f, 'current'), str(f, 'next')); } catch (e) {
      if (e instanceof AppError && (e.status === 400 || e.status === 401)) { flash(c, 'err', e.message); return c.redirect('/account', 303); }
      throw e;
    }
    deleteCookie(c, SID, { path: '/' });
    flash(c, 'ok', 'Password changed. Please sign in again.');
    return c.redirect('/login', 303);
  });
  void raw;
}
