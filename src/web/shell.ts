import type { Context } from 'hono';
import type { Part } from '../core/html.ts';
import { consoleNav, page } from './ui.ts';
import { csrfToken, takeFlash, type Deps, type Env } from './http.ts';
import { can } from '../domain/rbac.ts';

export const homeFor = (role: string) => (role === 'reporter' ? '/report' : role === 'technician' ? '/tech' : role === 'platform_admin' ? '/platform' : '/console/map');

/** Renders a full page with navigation appropriate to the signed-in role. */
export function render(c: Context<Env>, d: Deps, o: { title: string; current?: string; body: Part; status?: 200 | 400 | 403 | 404 | 409; wide?: boolean; extraHead?: Part; scripts?: string[]; lang?: string; noNav?: boolean }): Response {
  const a = c.get('auth');
  let nav, orgName = '', isDemo = false, unread = 0;
  if (a && !a.mfaPending) {
    const sys = d.rt.sys;
    if (a.actor.orgId) {
      const org = sys.get<{ name: string; is_demo: number }>('SELECT name, is_demo FROM organisations WHERE id = :id', { id: a.actor.orgId });
      orgName = org?.name ?? ''; isDemo = !!org?.is_demo;
      unread = sys.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE org_id = :org AND user_id = :u AND read_at IS NULL', { org: a.actor.orgId, u: a.actor.id })?.n ?? 0;
    }
    if (!o.noNav && ['dispatcher', 'org_admin', 'auditor'].includes(a.actor.role) && a.actor.orgId) {
      const reports = can(a.actor.role, 'report.read') ? (sys.get<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE org_id = :org AND status = 'new'", { org: a.actor.orgId })?.n ?? 0) : 0;
      const alerts = sys.get<{ n: number }>("SELECT COUNT(*) AS n FROM alerts WHERE org_id = :org AND state = 'open' AND kind LIKE 'sensor_%' AND kind <> 'sensor_late'", { org: a.actor.orgId })?.n ?? 0;
      nav = consoleNav(a.actor.role, { reports, alerts });
    }
  }
  const html = page({ title: o.title, role: a && !a.mfaPending ? a.actor.role : null, userName: a?.actor.name, orgName, isDemo, nav, current: o.current, csrf: csrfToken(c, d), flash: takeFlash(c), simulatedEnv: d.rt.cfg.allowSimulated && d.rt.cfg.env !== 'production', unread, extraHead: o.extraHead, scripts: o.scripts, lang: o.lang }, o.body);
  return c.html(html, o.status ?? 200);
}
