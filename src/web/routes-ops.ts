import { html, raw } from '../core/html.ts';
import { toCsv } from '../core/csv.ts';
import { badRequest } from '../core/errors.ts';
import { verifyChain } from '../domain/audit.ts';
import { HEALTH_LABEL } from '../domain/health.ts';
import { can, ORG_ASSIGNABLE_ROLES, roleLabel } from '../domain/rbac.ts';
import { settingsSchema } from '../domain/settings.ts';
import { SENSOR_KINDS, type Role } from '../domain/types.ts';
import { buildAnalytics } from '../repo/analytics.ts';
import { listAssets } from '../repo/assets.ts';
import { audit, makeCtx, need, newId, type Ctx } from '../repo/ctx.ts';
import { ackAlert, addSensor, KIND_DEFAULT_UNIT, KIND_LABEL, listAlerts, listDevices, listSensors, registerDevice, revokeDevice, rotateDeviceSecret, sensorSeries } from '../repo/devices.ts';
import { handleIngest, signRequest } from '../repo/ingest.ts';
import { runHealthCycle } from '../repo/health.ts';
import { createWorkOrder } from '../repo/workorders.ts';
import { createOrganisation, createUser, issueInvite, listOrgUsers, updateOrgUser } from '../repo/system.ts';
import { decryptSecret, randomToken } from '../core/crypto.ts';
import { formAction, fnum, fstr, type Form } from './action.ts';
import { csrfToken, ctxOf, requireAuth, type AppT, type Deps } from './http.ts';
import { render } from './shell.ts';
import { ago, barChart, chip, csrf, emptyState, field, fmtDateTime, healthChip, hbarChart, ic, kes, lineChart, opt, originChip, simChip, sparkline, hrs } from './ui.ts';
import { parseKesToMinor } from '../repo/workorders.ts';

const dispatchers = requireAuth({ roles: ['dispatcher', 'org_admin'] });
const admins = requireAuth({ roles: ['org_admin'] });

export function opsRoutes(app: AppT, d: Deps): void {
  // ---------------- S5 Sensor health ----------------
  app.get('/console/sensors', requireAuth({ perm: 'sensor.read' }), (c) => {
    const ctx = ctxOf(c, d);
    const sensors = listSensors(ctx);
    const alerts = listAlerts(ctx).filter((a) => a.state !== 'resolved');
    const failing = alerts.filter((a) => a.kind.startsWith('sensor_') && a.kind !== 'sensor_late');
    const now = ctx.now;
    const canManage = can(ctx.actor.role, 'alert.manage');
    const techs = ctx.t.all<{ id: string; name: string }>("SELECT id, name FROM users WHERE org_id = :org AND role = 'technician' AND status = 'active'");
    const count = (h: string) => sensors.filter((s) => s.health === h).length;
    return render(c, d, { title: 'Sensor health', current: 'sensors', body: html`<div class="pagehead"><h1>Sensor health</h1><span class="spacer"></span>${canManage ? html`<form method="post" action="/console/sensors/check" class="inl">${csrf(csrfToken(c, d))}<button class="btn" type="submit">Run health check now</button></form>` : ''}</div>
      <div class="kpis"><div class="kpi"><b>${sensors.length}</b><span>Sensors</span></div><div class="kpi"><b>${count('reporting')}</b><span>Reporting</span></div><div class="kpi"><b>${count('late')}</b><span>Late</span></div><div class="kpi"><b>${count('missing')}</b><span>Missing readings</span></div><div class="kpi"><b>${count('flatline') + count('out_of_range')}</b><span>Flat-lined or out of range</span></div></div>
      ${failing.length ? html`<div class="alertbar warnbar" role="alert">${ic('alert')}<div><b>${failing.length} sensor${failing.length === 1 ? '' : 's'} need attention.</b> <span>Asset status is NOT changed automatically; inspect on site before acting.</span></div></div>` : ''}
      ${alerts.length ? html`<section class="card"><h2>Open alerts</h2><ul class="tl">${alerts.map((a) => html`<li><b>${a.title}</b> ${chip(a.severity === 'high' ? 'bad' : a.severity === 'medium' ? 'warn' : 'unknown', a.severity, 'alert')} ${a.origin === 'simulated' ? simChip() : ''}<div class="meta">${a.detail} · opened ${ago(a.opened_at, now)} · ${a.state}${a.wo_id ? ' · work order created' : ''}</div>
        ${canManage ? html`<div class="btnrow">${a.state === 'open' ? html`<form method="post" action="/console/alerts/${a.id}/ack" class="inl">${csrf(csrfToken(c, d))}<button class="btn sm" type="submit">Acknowledge</button></form>` : ''}${a.suggested_priority && !a.wo_id && ctx.actor.role !== 'auditor' ? html`<form method="post" action="/console/alerts/${a.id}/workorder" class="btnrow">${csrf(csrfToken(c, d))}<label class="sr" for="wt-${a.id}">Technician</label><select id="wt-${a.id}" name="assignee"><option value="">Assign later</option>${techs.map((t) => opt(t.id, t.name, false))}</select><button class="btn sm pri" type="submit">Create suggested work order (${a.suggested_priority})</button></form>` : ''}</div>` : ''}</li>`)}</ul></section>` : ''}
      <section class="card"><h2>Devices and sensors</h2>${sensors.length ? html`<div class="tablewrap"><table><thead><tr><th>Device</th><th>Asset</th><th>Kind</th><th>Health</th><th>Last reading</th><th>Last 24 h</th></tr></thead><tbody>${sensors.map((s) => { const pts = sensorSeries(ctx, s.id, now - 24 * 3600_000, now); return html`<tr><td>${s.device_name}<br>${s.origin === 'simulated' ? simChip() : html`<span class="chip ok">${ic('check')}Real device</span>`}</td><td>${s.asset_name ?? '-'}</td><td>${KIND_LABEL[s.kind]}${s.param ? ` (${s.param})` : ''}${s.validation_required ? html`<br><span class="chip warn">Validation required</span>` : ''}</td><td>${healthChip(s.health, HEALTH_LABEL[s.health as keyof typeof HEALTH_LABEL] ?? s.health)}${s.battery_pct !== null && s.battery_pct <= 20 ? html`<br><span class="chip warn">Battery ${s.battery_pct}%</span>` : ''}</td><td>${s.last_reading_at ? `${ago(s.last_reading_at, now)}` : 'never'}${s.last_value !== null ? html`<br><span class="num">${s.last_value} ${s.unit}</span>` : ''}</td><td>${sparkline(`${s.device_name} ${s.key}`, pts, now - 24 * 3600_000, now, s.health)}</td></tr>`; })}</tbody></table></div>` : emptyState('signal', 'No sensor installed', 'Register a device under Admin / Devices.')}
      <p class="hint">How ingestion works: devices send signed readings to <span class="tag">POST /ingest/v1/readings</span>. A sensor is Late after 1.25x its expected interval, Missing after 2x. Water-quality readings are indicative and need validation. See docs/DEVICE-INTEGRATION.md.</p></section>` });
  });
  formAction(app, d, '/console/sensors/check', requireAuth({ perm: 'alert.manage' }), (ctx) => { const r = runHealthCycle(ctx.db, ctx.rt.clock()); audit(ctx, 'health.manual_check', 'sensor', undefined, { ...r }); return { msg: `Checked ${r.sensors} sensors: ${r.opened} alert(s) opened, ${r.resolved} resolved.` }; });
  formAction(app, d, '/console/alerts/:id/ack', requireAuth({ perm: 'alert.manage' }), (ctx, _f, c) => { ackAlert(ctx, c.req.param('id') as string); return { msg: 'Alert acknowledged.' }; });
  formAction(app, d, '/console/alerts/:id/workorder', dispatchers, (ctx, f, c) => {
    const al = ctx.t.get<{ id: string; title: string; detail: string | null; asset_id: string | null; suggested_priority: string | null; wo_id: string | null }>('SELECT id, title, detail, asset_id, suggested_priority, wo_id FROM alerts WHERE org_id = :org AND id = :id', { id: c.req.param('id') as string });
    if (!al || !al.asset_id || !al.suggested_priority) throw badRequest('This alert has no suggested work order.');
    if (al.wo_id) throw badRequest('A work order was already created for this alert.');
    const id = createWorkOrder(ctx, { assetId: al.asset_id, title: `Sensor check: ${al.title}`, description: al.detail ?? '', priority: al.suggested_priority as 'P3', kind: 'sensor', assigneeId: fstr(f, 'assignee') || null });
    ctx.t.run("UPDATE alerts SET wo_id = :w, state = CASE WHEN state = 'open' THEN 'acknowledged' ELSE state END WHERE org_id = :org AND id = :id", { w: id, id: al.id });
    return { msg: 'Sensor work order created.', to: `/console/orders/${id}` };
  });

  // ---------------- Devices admin (design addendum 02) ----------------
  app.get('/console/admin/devices', admins, (c) => {
    const ctx = ctxOf(c, d);
    const devs = listDevices(ctx);
    const assets = listAssets(ctx);
    return render(c, d, { title: 'Devices', current: 'devices', body: html`<div class="pagehead"><h1>Device registry</h1></div>
      <p class="hint">Each device has its own credentials. The secret is shown once at registration or rotation and is stored encrypted. Devices sign every request (HMAC-SHA256). See docs/DEVICE-INTEGRATION.md.</p>
      <section class="card">${devs.length ? html`<div class="tablewrap"><table><thead><tr><th>Name</th><th>Device key</th><th>Asset</th><th>Origin</th><th>Status</th><th>Last seen</th><th>Battery / signal</th><th></th></tr></thead><tbody>${devs.map((v) => html`<tr><td>${v.name}<br><span class="hint">${v.sensor_count} sensor(s)</span></td><td class="mono">${v.device_key}</td><td>${v.asset_name ?? '-'}</td><td>${v.origin === 'simulated' ? simChip() : html`<span class="chip ok">Real</span>`}</td><td>${v.status}</td><td>${v.last_seen_at ? ago(v.last_seen_at, ctx.now) : 'never'}</td><td>${v.battery_pct ?? '-'}% / ${v.rssi_dbm ?? '-'} dBm</td>
        <td>${v.status === 'active' ? html`<div class="btnrow"><form method="post" action="/console/admin/devices/${v.id}/rotate" class="inl">${csrf(csrfToken(c, d))}<button class="btn sm" type="submit" data-confirm="Rotate the secret? The device stops working until it is updated.">Rotate secret</button></form>
          <form method="post" action="/console/admin/devices/${v.id}/revoke" class="inl">${csrf(csrfToken(c, d))}<button class="btn sm danger" type="submit" data-confirm="Revoke this device permanently?">Revoke</button></form>
          ${v.origin === 'simulated' && d.rt.cfg.allowSimulated ? html`<form method="post" action="/console/admin/devices/${v.id}/testreading" class="inl">${csrf(csrfToken(c, d))}<button class="btn sm" type="submit">Send simulated test reading</button></form>` : ''}</div>` : ''}</td></tr>`)}</tbody></table></div>` : emptyState('chip', 'No devices registered')}</section>
      <section class="card"><h2>Register a device</h2><form method="post" action="/console/admin/devices" class="stack">${csrf(csrfToken(c, d))}<div class="row3">${field('dn', 'Device name', html`<input id="dn" name="name" required maxlength="100">`)}${field('da', 'Asset', html`<select id="da" name="asset"><option value="">None</option>${assets.map((a) => opt(a.id, `${a.name} (${a.code})`, false))}</select>`)}${field('do', 'Origin', html`<select id="do" name="origin"><option value="real">Real device</option>${d.rt.cfg.allowSimulated ? html`<option value="simulated">Simulated (test environment only)</option>` : ''}</select>`)}</div>
      <fieldset class="card"><legend>First sensor</legend><div class="row3">${field('sk', 'Sensor key', html`<input id="sk" name="s_key" required value="flow" maxlength="40">`, 'Used in payloads, e.g. "flow"')}${field('sknd', 'Kind', html`<select id="sknd" name="s_kind">${SENSOR_KINDS.map((k) => opt(k, KIND_LABEL[k] ?? k, false))}</select>`, 'Water-quality needs a parameter and is marked "validation required".')}${field('sp', 'Parameter (quality only)', html`<input id="sp" name="s_param" maxlength="40" placeholder="turbidity">`)}</div>
      <div class="row3">${field('su', 'Unit', html`<input id="su" name="s_unit" required value="m³/h" maxlength="20">`, `Defaults: ${Object.entries(KIND_DEFAULT_UNIT).map(([k, v]) => `${k} ${v}`).join(', ')}`)}${field('si', 'Expected interval (seconds, min 10)', html`<input id="si" name="s_interval" type="number" min="10" max="86400" required value="900">`)}${field('sr', 'Role', html`<select id="sr" name="s_role"><option value="none">None</option><option value="production">Production meter</option><option value="distribution">Distribution meter</option></select>`)}</div>
      <div class="row3">${field('smn', 'Valid minimum', html`<input id="smn" name="s_min" inputmode="decimal">`)}${field('smx', 'Valid maximum', html`<input id="smx" name="s_max" inputmode="decimal">`)}${field('ssc', 'Flat-line after N identical readings', html`<input id="ssc" name="s_stuck" type="number" min="3" value="12">`)}</div></fieldset>
      <button class="btn pri" type="submit">Register device</button></form></section>` });
  });
  const credsPage = (c: Parameters<typeof render>[0], title: string, deviceKey: string, secret: string) => render(c, d, { title, current: 'devices', body: html`<div class="card stack"><h1>${title}</h1><p class="flash err">Copy the secret now. It is shown only once and cannot be retrieved later (only rotated).</p>
    <p>Device key</p><p class="secret">${deviceKey}</p><p>Secret</p><p class="secret">${secret}</p><a class="btn" href="/console/admin/devices">Back to devices</a></div>` });
  app.post('/console/admin/devices', admins, async (c) => {
    const f = (await c.req.parseBody()) as Form;
    const ctx = ctxOf(c, d);
    const numOrNull = (k: string) => (fstr(f, k) === '' ? null : Number(fstr(f, k)));
    try {
      const r = registerDevice(ctx, { name: fstr(f, 'name'), asset_id: fstr(f, 'asset') || null, origin: fstr(f, 'origin') as 'real', sensors: [{ key: fstr(f, 's_key'), kind: fstr(f, 's_kind') as 'flow', param: fstr(f, 's_param'), unit: fstr(f, 's_unit'), role: fstr(f, 's_role') as 'none', expected_interval_s: fnum(f, 's_interval'), min_valid: numOrNull('s_min'), max_valid: numOrNull('s_max'), stuck_count: fnum(f, 's_stuck') || 12 }] });
      const res = credsPage(c, 'Device registered', r.deviceKey, r.secret); res.headers.set('Cache-Control', 'no-store'); return res;
    } catch (e) { const m = e as { status?: number; message: string }; if (m.status === 400) { const { flash } = await import('./http.ts'); flash(c, 'err', m.message); return c.redirect('/console/admin/devices', 303); } throw e; }
  });
  app.post('/console/admin/devices/:id/rotate', admins, async (c) => {
    const ctx = ctxOf(c, d);
    const id = c.req.param('id') as string;
    const dev = ctx.t.get<{ device_key: string }>('SELECT device_key FROM devices WHERE org_id = :org AND id = :id', { id });
    const secret = rotateDeviceSecret(ctx, id);
    return credsPage(c, 'Secret rotated', dev?.device_key ?? '', secret);
  });
  formAction(app, d, '/console/admin/devices/:id/revoke', admins, (ctx, _f, c) => { revokeDevice(ctx, c.req.param('id') as string); return { msg: 'Device revoked.' }; });
  formAction(app, d, '/console/admin/devices/:id/sensors', admins, (ctx, f, c) => { addSensor(ctx, c.req.param('id') as string, { key: fstr(f, 's_key'), kind: fstr(f, 's_kind') as 'flow', param: fstr(f, 's_param'), unit: fstr(f, 's_unit'), role: 'none', expected_interval_s: fnum(f, 's_interval') }); return { msg: 'Sensor added.' }; });
  // Loopback test: sends a correctly SIGNED reading through the real ingestion path for a SIMULATED device (never for real devices).
  formAction(app, d, '/console/admin/devices/:id/testreading', admins, (ctx, _f, c) => {
    if (!d.rt.cfg.allowSimulated) throw badRequest('Simulated devices are disabled in this environment.');
    const dev = ctx.t.get<{ device_key: string; secret_enc: string; origin: string }>("SELECT device_key, secret_enc, origin FROM devices WHERE org_id = :org AND id = :id AND status = 'active'", { id: c.req.param('id') as string });
    if (!dev || dev.origin !== 'simulated') throw badRequest('Only simulated devices can send test readings from the console.');
    const sensors = ctx.t.all<{ key: string; min_valid: number | null; max_valid: number | null }>('SELECT key, min_valid, max_valid FROM sensors WHERE org_id = :org AND device_id = :d AND enabled = 1', { d: c.req.param('id') as string });
    const now = ctx.rt.clock();
    const body = JSON.stringify({ batch_id: `console-${now}`, origin: 'simulated', readings: sensors.map((s) => ({ sensor: s.key, ts: now, value: Math.round(((s.min_valid ?? 0) + ((s.max_valid ?? 100) - (s.min_valid ?? 0)) * 0.4 + Math.random()) * 100) / 100 })) });
    const ts = String(Math.floor(now / 1000)), nonce = randomToken(12);
    const sig = signRequest(decryptSecret(dev.secret_enc, ctx.rt.cfg.secretKey), dev.device_key, ts, nonce, body);
    const r = handleIngest(ctx.db, ctx.rt.cfg, { deviceKey: dev.device_key, timestamp: ts, nonce, signature: sig, rawBody: body, now });
    if (r.status !== 200) throw badRequest(`Test reading rejected: ${String(r.body['message'])}`);
    return { msg: `SIMULATED test reading accepted (${String(r.body['accepted'])} reading).` };
  });

  // ---------------- S6 Analytics ----------------
  app.get('/console/analytics', requireAuth({ perm: 'analytics.read' }), (c) => {
    const ctx = ctxOf(c, d);
    const weeks = Math.min(Math.max(Number(c.req.query('weeks') ?? 8) || 8, 1), 52);
    const a = buildAnalytics(ctx, { weeks });
    const demo = d.rt.sys.get<{ is_demo: number }>('SELECT is_demo FROM organisations WHERE id = :id', { id: ctx.orgId })?.is_demo;
    const showCost = ctx.actor.scopeOwner === null;
    return render(c, d, { title: 'Analytics', current: 'analytics', body: html`<div class="pagehead"><h1>Analytics</h1><span class="spacer"></span><form method="get" class="btnrow" data-autosubmit><label for="wk" class="sr">Window</label><select id="wk" name="weeks">${[4, 8, 12, 26].map((w) => opt(String(w), `Last ${w} weeks`, weeks === w))}</select><button class="btn" type="submit">Apply</button></form><a class="btn" href="/console/analytics.csv?weeks=${weeks}">Export CSV</a></div>
      ${demo ? html`<div class="alertbar warnbar" role="note">${ic('alert')}<div><b>Synthetic demonstration data.</b> <span>These figures are computed from synthetic records and do not describe any real utility's performance.</span></div></div>` : ''}
      <div class="kpis"><div class="kpi"><b>${a.totalOutageReports}</b><span>Outage reports (${weeks} wk)</span></div><div class="kpi"><b>${hrs(a.mttr.meanHours)}</b><span>Mean time to repair (${a.mttr.count} repairs)</span></div><div class="kpi"><b>${a.repeats.length}</b><span>Assets with repeat failures</span></div><div class="kpi"><b>${a.totalDowntimeHours.toFixed(0)} h</b><span>Asset downtime</span></div>${showCost ? html`<div class="kpi"><b>${kes(a.cost.totalMinor)}</b><span>Maintenance cost</span></div>` : ''}<div class="kpi"><b>${a.fleetAvailability === null ? 'n/a' : (a.fleetAvailability * 100).toFixed(1) + '%'}</b><span>Mean asset availability</span></div><div class="kpi"><b>${a.sla.pct === null ? 'n/a' : (a.sla.pct * 100).toFixed(0) + '%'}</b><span>SLA met (${a.sla.met}/${a.sla.judged})</span></div></div>
      <div class="charts">${barChart('Outage reports per week', a.outages.map((w) => ({ label: w.label, value: w.count })), ' reports')}${lineChart('Mean time to repair by completion week', a.mttr.weekly.map((w) => ({ label: w.label, value: w.meanHours })), 'hours')}
        ${hbarChart('Downtime by asset (hours)', a.downtime.slice(0, 8).map((x) => ({ label: x.assetName, value: x.hours, text: `${x.hours.toFixed(0)} h${x.ongoing ? ' (ongoing)' : ''}` })))}
        ${showCost ? hbarChart('Maintenance cost by category', a.cost.byCategory.map((x) => ({ label: x.category, value: x.minor, text: kes(x.minor) }))) : ''}</div>
      <section class="card"><h2>Repeat failures (last ${ctx.settings.repeatWindowDays} days)</h2>${a.repeats.length ? html`<table><thead><tr><th>Asset</th><th>Failures</th><th>Most common job</th></tr></thead><tbody>${a.repeats.map((r) => html`<tr><td>${r.assetName}</td><td class="num">${r.count}</td><td>${r.commonJob}</td></tr>`)}</tbody></table>` : html`<p class="hint">No asset failed more than once in this period.</p>`}</section>
      <section class="card"><h2>Availability by asset</h2>${a.downtime.length ? html`<table><thead><tr><th>Asset</th><th>Downtime</th><th>Availability</th></tr></thead><tbody>${a.downtime.map((x) => html`<tr><td>${x.assetName}</td><td class="num">${x.hours.toFixed(1)} h</td><td class="num">${(x.availability * 100).toFixed(1)}%</td></tr>`)}</tbody></table>` : html`<p class="hint">No downtime recorded.</p>`}<p class="hint">Downtime = time from the first report (or work order) to repair completion for reactive and contamination work orders; overlapping periods are merged. Availability = 1 - downtime / window.</p></section>
      <section class="card"><h2>Production and distribution readings</h2>${a.flows.length ? html`<table><thead><tr><th>Meter</th><th>Role</th><th>Source</th><th>Readings</th><th>Volume</th><th>Unmetered gaps</th></tr></thead><tbody>${a.flows.map((f) => html`<tr><td>${f.deviceName} / ${f.key}</td><td>${f.role}</td><td>${f.origin === 'simulated' ? simChip() : html`<span class="chip ok">Real</span>`}</td><td class="num">${f.readings}</td><td class="num">${f.totalM3.toFixed(0)} m³</td><td class="num">${f.gapHours.toFixed(1)} h</td></tr>`)}</tbody></table>` : html`<p class="hint">No production or distribution meters registered. Readings appear here only where a utility supplies them.</p>`}
        <p class="hint">Volume integrates flow readings (each reading holds until the next, capped at 2x the expected interval); gaps are reported, not estimated. Simulated meters are never mixed with real ones.</p></section>
      <p class="hint">Non-revenue water (NRW) is a whole-system utility metric that needs metered production and billed volumes. WaterWatch does not compute it. It supplies outage, leak and repair data that supports physical-loss reduction.</p>` });
  });
  app.get('/console/analytics.csv', requireAuth({ perm: 'export' }), (c) => {
    const ctx = ctxOf(c, d);
    const a = buildAnalytics(ctx, { weeks: Math.min(Math.max(Number(c.req.query('weeks') ?? 8) || 8, 1), 52) });
    const rows: unknown[][] = [['section', 'label', 'value'], ...a.outages.map((w) => ['outage_reports_per_week', w.label, w.count]), ...a.mttr.weekly.map((w) => ['mttr_hours_by_week', w.label, w.meanHours === null ? '' : w.meanHours.toFixed(2)]), ...a.downtime.map((x) => ['downtime_hours', x.assetName, x.hours.toFixed(2)]), ...a.repeats.map((r) => ['repeat_failures', r.assetName, r.count])];
    if (ctx.actor.scopeOwner === null) rows.push(...a.cost.byCategory.map((x) => ['cost_kes_by_category', x.category, (x.minor / 100).toFixed(2)]));
    return new Response(toCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="analytics.csv"', 'Cache-Control': 'no-store' } });
  });

  // ---------------- S7 Audit log ----------------
  app.get('/console/audit', requireAuth({ perm: 'audit.read' }), (c) => {
    const ctx = ctxOf(c, d);
    const prefix = (c.req.query('action') ?? '').replace(/[^a-z._]/g, '');
    const rows = ctx.t.all<{ seq: number; ts: number; actor_id: string | null; actor_role: string | null; action: string; object_type: string | null; object_id: string | null; detail: string; actor_name: string | null }>(
      `SELECT l.seq, l.ts, l.actor_id, l.actor_role, l.action, l.object_type, l.object_id, l.detail, u.name AS actor_name FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.org_id = :org ${prefix ? "AND l.action LIKE :p ESCAPE '\\'" : ''} ORDER BY l.seq DESC LIMIT 300`, prefix ? { p: prefix.replace(/_/g, '\\_') + '%' } : {});
    const v = c.req.query('verify') ? verifyChain(ctx.db, ctx.orgId) : null;
    return render(c, d, { title: 'Audit log', current: 'audit', body: html`<div class="pagehead"><h1>Audit log</h1><span class="spacer"></span><a class="btn" href="/console/audit?verify=1">Verify integrity</a></div>
      <p class="hint">Append-only and hash-chained: each entry includes the hash of the previous one, and the database rejects updates and deletes.</p>
      ${v ? html`<div class="flash ${v.ok ? 'ok' : 'err'}" role="status">${v.ok ? `Chain verified: ${v.checked} entries intact. Head ${v.head.slice(0, 16)}…` : `Chain BROKEN at entry ${v.brokenAtSeq}: ${v.reason}`}</div>` : ''}
      <form class="filters" method="get"><input name="action" placeholder="Action prefix, e.g. workorder" value="${prefix}" aria-label="Action prefix"><button class="btn" type="submit">Filter</button></form>
      ${rows.length ? html`<div class="tablewrap"><table><thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Object</th><th>Detail</th></tr></thead><tbody>${rows.map((r) => html`<tr><td class="num">${r.seq}</td><td class="mono">${fmtDateTime(r.ts)}</td><td>${r.actor_name ?? (r.actor_role ?? 'system')}</td><td class="mono">${r.action}</td><td class="mono">${r.object_type ?? ''} ${(r.object_id ?? '').slice(0, 12)}</td><td class="hint">${r.detail === '{}' ? '' : r.detail.slice(0, 160)}</td></tr>`)}</tbody></table></div>` : emptyState('log', 'No entries')}` });
  });

  // ---------------- Users admin (design addendum 03) ----------------
  app.get('/console/admin/users', admins, (c) => {
    const ctx = ctxOf(c, d);
    const users = listOrgUsers(d.rt.sys, ctx.orgId);
    return render(c, d, { title: 'Users', current: 'users', body: html`<div class="pagehead"><h1>Users</h1></div>
      <section class="card"><div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>MFA</th><th>Data</th><th></th></tr></thead><tbody>${users.map((u) => html`<tr><td>${u.name}${u.scope_owner ? html`<br><span class="hint">Scoped: ${u.scope_owner}</span>` : ''}</td><td>${u.email}</td><td>${roleLabel[u.role]}</td><td>${u.status}</td><td>${['dispatcher', 'org_admin'].includes(u.role) ? (u.mfa_enrolled ? 'enrolled' : 'required, not yet set') : 'n/a'}</td><td>${originChip(u.origin)}</td>
        <td><div class="btnrow">${u.id !== ctx.actor.id ? html`<form method="post" action="/console/admin/users/${u.id}" class="inl">${csrf(csrfToken(c, d))}<input type="hidden" name="op" value="${u.status === 'suspended' ? 'reactivate' : 'suspend'}"><button class="btn sm" type="submit">${u.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button></form>` : ''}${['dispatcher', 'org_admin'].includes(u.role) ? html`<form method="post" action="/console/admin/users/${u.id}" class="inl">${csrf(csrfToken(c, d))}<input type="hidden" name="op" value="resetmfa"><button class="btn sm" type="submit" data-confirm="Reset MFA for this user?">Reset MFA</button></form>` : ''}</div></td></tr>`)}</tbody></table></div></section>
      <section class="card"><h2>Add a user</h2><form method="post" action="/console/admin/users" class="stack">${csrf(csrfToken(c, d))}<div class="row3">${field('un', 'Full name', html`<input id="un" name="name" required maxlength="120">`)}${field('ue', 'Email', html`<input id="ue" name="email" type="email" required>`)}${field('ur', 'Role', html`<select id="ur" name="role">${ORG_ASSIGNABLE_ROLES.map((r) => opt(r, roleLabel[r], r === 'technician'))}</select>`)}</div><div class="row2">${field('up', 'Phone (reporters; visible to dispatchers only)', html`<input id="up" name="phone" maxlength="30">`)}${field('us', 'Restrict to owner (NGO monitor; auditors only)', html`<input id="us" name="scope_owner" maxlength="120" placeholder="e.g. NGO (programme)">`)}</div><button class="btn pri" type="submit">Create and show invitation link</button></form>
      <p class="hint">No email is sent. You receive a one-time invitation link (valid 7 days) to pass to the person yourself. Dispatchers and admins must set up an authenticator app on first sign-in.</p></section>` });
  });
  app.post('/console/admin/users', admins, async (c) => {
    const f = (await c.req.parseBody()) as Form;
    const ctx = ctxOf(c, d);
    try {
      const role = fstr(f, 'role') as Role;
      if (!ORG_ASSIGNABLE_ROLES.includes(role)) throw badRequest('That role cannot be assigned.');
      const r = await createUser(d.rt, ctx.actor, { orgId: ctx.orgId, email: fstr(f, 'email'), name: fstr(f, 'name'), phone: fstr(f, 'phone') || null, role, scopeOwner: role === 'auditor' ? fstr(f, 'scope_owner') || null : null });
      const url = `${new URL(c.req.url).origin}/invite/${r.inviteToken}`;
      return render(c, d, { title: 'Invitation', current: 'users', body: html`<div class="card stack"><h1>User created</h1><p class="flash err">Copy this one-time link now; it is not shown again.</p><p class="secret">${url}</p><a class="btn" href="/console/admin/users">Back to users</a></div>` });
    } catch (e) { const m = e as { status?: number; message: string }; if (m.status === 400 || m.status === 409) { const { flash } = await import('./http.ts'); flash(c, 'err', m.message); return c.redirect('/console/admin/users', 303); } throw e; }
  });
  formAction(app, d, '/console/admin/users/:id', admins, (ctx, f, c) => {
    const op = fstr(f, 'op'), id = c.req.param('id') as string;
    updateOrgUser(d.rt, ctx.actor, id, op === 'suspend' ? { status: 'suspended' } : op === 'reactivate' ? { status: 'active' } : op === 'resetmfa' ? { resetMfa: true } : {});
    return { msg: 'User updated.' };
  });

  // ---------------- Settings (design addendum 04) ----------------
  app.get('/console/admin/settings', requireAuth({ perm: 'settings.manage' }), (c) => {
    const s = ctxOf(c, d).settings;
    const n = (id: string, label: string, v: number, hint = '', step = '1') => field(id, label, html`<input id="${id}" name="${id}" type="number" step="${step}" value="${v}" required>`, hint);
    return render(c, d, { title: 'Settings', current: 'settings', body: html`<div class="pagehead"><h1>Organisation settings</h1></div><form class="card stack" method="post" action="/console/admin/settings">${csrf(csrfToken(c, d))}
      <h2>SLA targets (placeholders: set your own)</h2><div class="row3">${n('sla_P1', 'P1 urgent (minutes)', s.slaMinutes.P1)}${n('sla_P2', 'P2 high (minutes)', s.slaMinutes.P2)}${n('sla_P3', 'P3 routine (minutes)', s.slaMinutes.P3)}</div>
      <label><input type="checkbox" name="pause" value="1" ${s.slaPauseAwaitingParts ? raw('checked') : ''}> Pause the SLA clock while a work order is awaiting parts (applies to new work orders)</label>
      <h2>Service area (geolocation validation)</h2><div class="row2">${n('minLat', 'Min latitude', s.bounds.minLat, '', 'any')}${n('maxLat', 'Max latitude', s.bounds.maxLat, '', 'any')}${n('minLng', 'Min longitude', s.bounds.minLng, '', 'any')}${n('maxLng', 'Max longitude', s.bounds.maxLng, '', 'any')}</div>
      <h2>Sensor health</h2><div class="row3">${n('late', 'Late after (x interval)', s.healthLateFactor, '', 'any')}${n('missing', 'Missing after (x interval)', s.healthMissingFactor, '', 'any')}${n('battery', 'Battery low at (%)', s.batteryLowPct)}${n('rssi', 'Weak signal at (dBm)', s.rssiWeakDbm)}${n('skew', 'Ingest clock window (s)', s.ingestSkewSec)}${n('maxage', 'Accept late readings up to (days)', s.ingestMaxAgeDays)}</div>
      <h2>Reporting and analytics</h2><div class="row3">${n('rph', 'Reports per reporter per hour', s.reportsPerHour)}${n('dupw', 'Repeat-report window (min)', s.duplicateWindowMin)}${n('repeat', 'Repeat-failure window (days)', s.repeatWindowDays)}${n('tz', 'Timezone offset from UTC (minutes)', s.tzOffsetMin)}</div>
      <button class="btn pri" type="submit">Save settings</button></form>` });
  });
  formAction(app, d, '/console/admin/settings', requireAuth({ perm: 'settings.manage' }), (ctx, f) => {
    const v = (k: string) => Number(fstr(f, k));
    const parsed = settingsSchema.safeParse({ slaMinutes: { P1: v('sla_P1'), P2: v('sla_P2'), P3: v('sla_P3') }, slaPauseAwaitingParts: fstr(f, 'pause') === '1', bounds: { minLat: v('minLat'), maxLat: v('maxLat'), minLng: v('minLng'), maxLng: v('maxLng') }, tzOffsetMin: v('tz'), healthLateFactor: v('late'), healthMissingFactor: v('missing'), batteryLowPct: v('battery'), rssiWeakDbm: v('rssi'), ingestMaxAgeDays: v('maxage'), ingestSkewSec: v('skew'), reportsPerHour: v('rph'), duplicateWindowMin: v('dupw'), repeatWindowDays: v('repeat') });
    if (!parsed.success) throw badRequest('Settings invalid: ' + parsed.error.issues.slice(0, 2).map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
    ctx.t.run('UPDATE organisations SET settings = :s WHERE id = :org', { s: JSON.stringify(parsed.data) });
    audit(ctx, 'settings.updated', 'organisation', ctx.orgId, { settings: parsed.data });
    return { msg: 'Settings saved.' };
  });

  // ---------------- Notifications (design addendum 05) ----------------
  app.get('/notifications', requireAuth(), (c) => {
    const ctx = ctxOf(c, d);
    const rows = ctx.t.all<{ id: string; kind: string; title: string; link: string | null; created_at: number; read_at: number | null }>('SELECT id, kind, title, link, created_at, read_at FROM notifications WHERE org_id = :org AND user_id = :u ORDER BY created_at DESC LIMIT 100', { u: ctx.actor.id });
    return render(c, d, { title: 'Notifications', body: html`<div class="pagehead"><h1>Notifications</h1><span class="spacer"></span><form method="post" action="/notifications/read" class="inl">${csrf(csrfToken(c, d))}<button class="btn" type="submit">Mark all read</button></form></div>
      <p class="hint">In-app only. Email and SMS delivery are not configured (they need a provider account).</p>
      ${rows.length ? html`<ul class="list">${rows.map((n) => html`<li class="row">${n.read_at ? '' : html`<span class="chip bad">New</span>`}<span class="grow">${n.link ? html`<a href="${n.link}">${n.title}</a>` : n.title}<br><span class="sub">${ago(n.created_at, ctx.now)}</span></span></li>`)}</ul>` : emptyState('bell', 'No notifications')}` });
  });
  formAction(app, d, '/notifications/read', requireAuth(), (ctx) => { ctx.t.run('UPDATE notifications SET read_at = :now WHERE org_id = :org AND user_id = :u AND read_at IS NULL', { now: ctx.now, u: ctx.actor.id }); return { msg: 'All notifications marked read.', to: '/notifications' }; });

  // ---------------- Platform admin (design addendum 06) ----------------
  const platform = requireAuth({ roles: ['platform_admin'] });
  app.get('/platform', platform, (c) => {
    const orgs = d.rt.sys.all<{ id: string; name: string; kind: string; is_demo: number; users: number; created_at: number }>("SELECT o.id, o.name, o.kind, o.is_demo, o.created_at, (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS users FROM organisations o WHERE o.kind <> 'platform' ORDER BY o.created_at");
    return render(c, d, { title: 'Platform', body: html`<div class="pagehead"><h1>Platform administration</h1></div><p class="hint">Platform admins manage organisations and their first administrator. They cannot read an organisation's assets, reports, work orders or readings.</p>
      <section class="card"><table><thead><tr><th>Organisation</th><th>Kind</th><th>Users</th><th>Data</th></tr></thead><tbody>${orgs.map((o) => html`<tr><td>${o.name}</td><td>${o.kind}</td><td class="num">${o.users}</td><td>${o.is_demo ? html`<span class="chip sim">Synthetic demo</span>` : ''}</td></tr>`)}</tbody></table></section>
      <section class="card"><h2>Create organisation</h2><form method="post" action="/platform/orgs" class="stack">${csrf(csrfToken(c, d))}<div class="row2">${field('on', 'Organisation name', html`<input id="on" name="name" required maxlength="120">`)}${field('ok', 'Kind', html`<select id="ok" name="kind"><option value="utility">Utility</option><option value="county">County</option><option value="ngo">NGO</option></select>`)}</div><div class="row2">${field('an', 'First admin name', html`<input id="an" name="admin_name" required>`)}${field('ae', 'First admin email', html`<input id="ae" name="admin_email" type="email" required>`)}</div><button class="btn pri" type="submit">Create and show invitation link</button></form></section>` });
  });
  app.post('/platform/orgs', platform, async (c) => {
    const f = (await c.req.parseBody()) as Form;
    const a = c.get('auth');
    try {
      const kind = fstr(f, 'kind');
      if (!['utility', 'county', 'ngo'].includes(kind)) throw badRequest('Invalid organisation kind.');
      if (fstr(f, 'name').length < 2) throw badRequest('Organisation name is required.');
      const orgId = createOrganisation(d.rt, a?.actor ?? null, { name: fstr(f, 'name'), kind: kind as 'utility' });
      const r = await createUser(d.rt, a?.actor ?? null, { orgId, email: fstr(f, 'admin_email'), name: fstr(f, 'admin_name'), role: 'org_admin' });
      const url = `${new URL(c.req.url).origin}/invite/${r.inviteToken}`;
      return render(c, d, { title: 'Organisation created', body: html`<div class="card stack"><h1>Organisation created</h1><p class="flash err">Give this one-time invitation link to the first administrator.</p><p class="secret">${url}</p><a class="btn" href="/platform">Back</a></div>` });
    } catch (e) { const m = e as { status?: number; message: string }; if (m.status === 400 || m.status === 409) { const { flash } = await import('./http.ts'); flash(c, 'err', m.message); return c.redirect('/platform', 303); } throw e; }
  });
  void need; void makeCtx; void newId; void issueInvite; void parseKesToMinor; void hbarChart;
}
export type { Ctx };
