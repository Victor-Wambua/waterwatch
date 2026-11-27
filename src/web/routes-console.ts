import { html, raw, type Raw } from '../core/html.ts';
import { toCsv } from '../core/csv.ts';
import { forbidden } from '../core/errors.ts';
import { ASSET_STATUSES, ASSET_TYPES, PRIORITIES, COST_CATEGORIES, type AssetStatus, type AssetType, type Priority } from '../domain/types.ts';
import { ASSET_TYPE_LABEL, ATTR_FIELDS, OWNER_TYPES, STATUS_LABEL, addMaintenanceRecord, assetLinks, createAsset, getAsset, importAssetCsv, linkAssets, listAssets, maintenanceHistory, previewAssetCsv, setAssetStatus, updateAsset, CSV_COLUMNS } from '../repo/assets.ts';
import { CATEGORY_LABEL, listReports, markDuplicate, rejectReport } from '../repo/reports.ts';
import { STATUS_LABEL_WO, addMaterial, assignWorkOrder, createFromReports, createSchedule, createWorkOrder, formatKes, generatePlannedWork, getWorkOrder, listSchedules, listWorkOrders, parseKesToMinor, setScheduleActive, transitionWorkOrder, woEvents, woMaterials, woReports } from '../repo/workorders.ts';
import { listSensors } from '../repo/devices.ts';
import { need } from '../repo/ctx.ts';
import { ctxOf, requireAuth, type AppT, type Deps } from './http.ts';
import { formAction, fnum, fstr, type Form } from './action.ts';
import { render } from './shell.ts';
import { ago, chip, csrf, emptyState, field, fmtDate, fmtDateTime, healthChip, ic, kes, mapLegend, opt, originChip, priChip, schematicMap, simChip, slaText, sparkline, statusChip, stIcon, STATUS_TEXT, woChip, type MapAsset } from './ui.ts';
import { csrfToken } from './http.ts';
import { HEALTH_LABEL } from '../domain/health.ts';
import { sensorSeries } from '../repo/devices.ts';
import { sensorKindLabel } from './labels.ts';
import type { Ctx } from '../repo/ctx.ts';

const staff = requireAuth({ roles: ['dispatcher', 'org_admin', 'auditor'] });
const dispatchers = requireAuth({ roles: ['dispatcher', 'org_admin'] });
const anyOrgUser = requireAuth();
const tplDialog = (id: string, inner: Raw) => html`<template id="${id}">${inner}</template>`;

function technicians(ctx: Ctx) {
  return ctx.t.all<{ id: string; name: string }>("SELECT id, name FROM users WHERE org_id = :org AND role = 'technician' AND status = 'active' ORDER BY name");
}

export function consoleRoutes(app: AppT, d: Deps): void {
  // ---------------- S1 Map & assets ----------------
  app.get('/console/map', staff, (c) => {
    const ctx = ctxOf(c, d);
    const q = { asset: c.req.query('asset') ?? '', status: c.req.query('status') ?? '', type: c.req.query('type') ?? '', q: c.req.query('q') ?? '', view: c.req.query('view') ?? '' };
    const all = listAssets(ctx);
    const shown = listAssets(ctx, { status: q.status, type: q.type, q: q.q });
    const dim = new Set(all.filter((a) => !shown.some((s) => s.id === a.id)).map((a) => a.id));
    const sel = all.find((a) => a.id === q.asset) ?? null;
    const links = assetLinks(ctx);
    const count = (s: AssetStatus) => all.filter((a) => a.status === s).length;
    const wos = listWorkOrders(ctx);
    const pastSla = wos.filter((w) => !['closed', 'cancelled', 'completed'].includes(w.status) && w.sla.state === 'breached').length;
    const contam = all.filter((a) => a.status === 'contamination');
    const tiles = !!d.rt.cfg.tileUrl && q.view === 'tiles';
    const sensors = sel ? listSensors(ctx).filter((s) => s.asset_id === sel.id) : [];
    const body = html`<div class="pagehead"><h1>Map & assets</h1>${ctx.actor.scopeOwner ? html`<span class="chip unknown">Scoped to: ${ctx.actor.scopeOwner}</span>` : ''}</div>
      <div class="kpis"><div class="kpi"><b>${all.length}</b><span>Registered assets</span></div><div class="kpi"><b>${count('operational')}</b><span>Operational</span></div><div class="kpi"><b>${count('degraded') + count('down')}</b><span>Degraded or out of service</span></div><div class="kpi"><b>${count('contamination')}</b><span>Contamination alert</span></div><div class="kpi"><b>${pastSla}</b><span>Work orders past SLA</span></div></div>
      ${contam.map((a) => html`<div class="alertbar" role="alert">${ic('alert')}<div><b>Contamination alert at ${a.name} (${a.code}).</b> <span>Precautionary alert from a community report; not lab-confirmed.</span> <a href="/console/reports">Open triage</a></div></div>`)}
      <div class="split"><section aria-label="Map">
        <form class="filters" method="get" action="/console/map" data-autosubmit><input type="hidden" name="asset" value="${q.asset}">
          <div><label for="fs" class="sr">Status</label><select id="fs" name="status"><option value="">All statuses</option>${ASSET_STATUSES.map((s) => opt(s, STATUS_LABEL[s], q.status === s))}</select></div>
          <div><label for="ft" class="sr">Type</label><select id="ft" name="type"><option value="">All asset types</option>${ASSET_TYPES.map((s) => opt(s, ASSET_TYPE_LABEL[s], q.type === s))}</select></div>
          <div><label for="fq" class="sr">Search</label><input id="fq" name="q" type="search" placeholder="Search name or code" value="${q.q}"></div>
          <button class="btn" type="submit">Filter</button>${d.rt.cfg.tileUrl ? html`<a class="btn" href="/console/map?view=${tiles ? 'schematic' : 'tiles'}">${tiles ? 'Schematic view' : 'Tile map'}</a>` : ''}</form>
        <div class="mapwrap">${tiles ? html`<div id="leaflet" class="leafmap" role="group" aria-label="Interactive map" data-tile="${d.rt.cfg.tileUrl}" data-attribution="${d.rt.cfg.tileAttribution}" data-assets="${JSON.stringify(shown.map((a) => ({ id: a.id, name: a.name, status: STATUS_TEXT[a.status], lat: a.lat, lng: a.lng })))}"></div>` : schematicMap(all as MapAsset[], links, sel?.id ?? null, dim)}
          <span class="mapnote">${tiles ? `Map data ${d.rt.cfg.tileAttribution}` : 'Schematic map (no tiles, no external requests). Tile provider is OFF unless configured.'}</span></div>${mapLegend()}</section>
        <section aria-label="Asset list and detail">${sel ? html`<div class="card stack"><h2>${stIcon(sel.status, 22)} ${sel.name}</h2><p>${statusChip(sel.status)} <span class="tag">${sel.code}</span> ${originChip(sel.origin)}</p>
          <p>${ASSET_TYPE_LABEL[sel.type]} · Owner: ${sel.owner_name}<br>Installed ${sel.install_year ?? 'unknown'} · Last maintenance ${sel.last_maintenance ?? 'none recorded'} · Open reports: ${sel.open_reports}</p>
          ${sensors.length ? html`<p>${sensors.map((s) => html`${healthChip(s.health, HEALTH_LABEL[s.health as keyof typeof HEALTH_LABEL] ?? s.health)} ${s.origin === 'simulated' ? simChip() : ''} `)}</p>` : html`<p class="hint">No sensor installed.</p>`}
          <a class="btn pri" href="/console/assets/${sel.id}">Open asset record</a></div>` : ''}
          <h2>${shown.length} asset${shown.length === 1 ? '' : 's'}</h2>
          ${shown.length ? html`<ul class="list">${shown.map((x) => html`<li><a class="row" href="/console/map?asset=${x.id}&status=${q.status}&type=${q.type}&q=${q.q}" ${x.id === q.asset ? raw('aria-current="true"') : ''}>${stIcon(x.status, 22)}<span class="grow"><b>${x.name}</b><br><span class="sub">${x.code} · ${ASSET_TYPE_LABEL[x.type]} · ${STATUS_TEXT[x.status]}</span></span></a></li>`)}</ul>` : html`<div class="empty card">${ic('map')}<p><b>No assets match these filters.</b></p><a class="btn" href="/console/map">Clear filters</a></div>`}
        </section></div>`;
    return render(c, d, { title: 'Map & assets', current: 'map', body, extraHead: tiles ? html`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">` : '', scripts: tiles ? ['/vendor/leaflet/leaflet.js', '/js/map.js'] : [] });
  });

  // ---------------- Assets registry ----------------
  app.get('/console/assets', staff, (c) => {
    const ctx = ctxOf(c, d);
    const f = { q: c.req.query('q') ?? '', status: c.req.query('status') ?? '', type: c.req.query('type') ?? '' };
    const rows = listAssets(ctx, f);
    return render(c, d, { title: 'Assets', current: 'assets', body: html`<div class="pagehead"><h1>Asset registry</h1><span class="spacer"></span>
      ${ctx.actor.role !== 'auditor' ? html`<a class="btn pri" href="/console/assets/new">${ic('drop')} Register asset</a>` : ''}${ctx.actor.role === 'org_admin' ? html`<a class="btn" href="/console/assets/import">Import CSV</a>` : ''}<a class="btn" href="/console/assets.csv">Export CSV</a></div>
      <form class="filters" method="get" data-autosubmit><input name="q" type="search" placeholder="Search name or code" value="${f.q}" aria-label="Search"><select name="type" aria-label="Type"><option value="">All types</option>${ASSET_TYPES.map((s) => opt(s, ASSET_TYPE_LABEL[s], f.type === s))}</select><select name="status" aria-label="Status"><option value="">All statuses</option>${ASSET_STATUSES.map((s) => opt(s, STATUS_LABEL[s], f.status === s))}</select><button class="btn" type="submit">Filter</button></form>
      ${rows.length ? html`<div class="tablewrap"><table><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Status</th><th>Owner</th><th>Last maintenance</th><th>Data</th></tr></thead><tbody>${rows.map((a) => html`<tr><td class="mono">${a.code}</td><td><a href="/console/assets/${a.id}">${a.name}</a></td><td>${ASSET_TYPE_LABEL[a.type]}</td><td>${statusChip(a.status)}</td><td>${a.owner_name}</td><td>${a.last_maintenance ?? 'none'}</td><td>${originChip(a.origin)}</td></tr>`)}</tbody></table></div>` : emptyState('map', 'No assets match', 'Register an asset or import a CSV file.')}` });
  });
  app.get('/console/assets.csv', requireAuth({ perm: 'export' }), (c) => {
    const rows = listAssets(ctxOf(c, d));
    const csv = toCsv([[...CSV_COLUMNS, 'origin'], ...rows.map((a) => [a.code, a.name, a.type, a.status, a.owner_type, a.owner_name, a.lat, a.lng, a.install_year ?? '', a.notes ?? '', a.origin])]);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="assets.csv"', 'Cache-Control': 'no-store' } });
  });

  const assetForm = (c: Parameters<typeof csrfToken>[0], vals: Record<string, string>, action: string, err?: string) => {
    const type = (vals['type'] || 'borehole') as AssetType;
    const b = d.rt.sys.get<{ settings: string }>('SELECT settings FROM organisations WHERE id = :o', { o: c.get('auth')?.actor.orgId ?? '' });
    void b;
    return html`<div class="pagehead"><h1>${action.endsWith('new') ? 'Register asset' : 'Edit asset'}</h1></div>${err ? html`<p class="err" role="alert">${err}</p>` : ''}
      <form class="card" method="post" action="${action}">${csrf(csrfToken(c, d))}
      <div class="row3">${field('code', 'Asset code', html`<input id="code" name="code" required value="${vals['code'] ?? ''}" maxlength="32">`, 'Unique within your organisation, e.g. A-017')}${field('name', 'Name', html`<input id="name" name="name" required value="${vals['name'] ?? ''}" maxlength="120">`)}
      ${field('type', 'Type', html`<select id="type" name="type" data-type-switch>${ASSET_TYPES.map((t) => opt(t, ASSET_TYPE_LABEL[t], type === t))}</select>`)}</div>
      <div class="row3">${field('status', 'Status', html`<select id="status" name="status">${ASSET_STATUSES.map((t) => opt(t, STATUS_LABEL[t], (vals['status'] || 'unknown') === t))}</select>`)}
      ${field('owner_type', 'Ownership', html`<select id="owner_type" name="owner_type">${OWNER_TYPES.map((t) => opt(t, t[0]?.toUpperCase() + t.slice(1), (vals['owner_type'] || 'utility') === t))}</select>`)}${field('owner_name', 'Owner name', html`<input id="owner_name" name="owner_name" required value="${vals['owner_name'] ?? ''}" maxlength="120">`)}</div>
      <div class="row3">${field('lat', 'Latitude', html`<input id="lat" name="lat" inputmode="decimal" required value="${vals['lat'] ?? ''}">`, 'Decimal degrees, e.g. -1.2921. Must be inside the configured service area.')}${field('lng', 'Longitude', html`<input id="lng" name="lng" inputmode="decimal" required value="${vals['lng'] ?? ''}">`)}${field('install_year', 'Install year', html`<input id="install_year" name="install_year" inputmode="numeric" value="${vals['install_year'] ?? ''}">`)}</div>
      ${ASSET_TYPES.map((t) => html`<fieldset data-for-type="${t}" class="card"><legend>${ASSET_TYPE_LABEL[t]} details</legend><div class="row3">${ATTR_FIELDS[t].map((f) => field(`attr_${t}_${f.key}`, f.label, html`<input id="attr_${t}_${f.key}" name="attr_${t}_${f.key}" value="${vals[`attr_${t}_${f.key}`] ?? ''}">`))}</div></fieldset>`)}
      ${field('notes', 'Notes', html`<textarea id="notes" name="notes" maxlength="1000" rows="3">${vals['notes'] ?? ''}</textarea>`)}
      <div class="btnrow"><button class="btn pri" type="submit">Save asset</button><a class="btn" href="/console/assets">Cancel</a></div></form>`;
  };
  const formVals = (f: Form): Record<string, string> => Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const assetInputFrom = (f: Form) => {
    const type = fstr(f, 'type') as AssetType;
    const attributes: Record<string, string> = {};
    for (const fld of ATTR_FIELDS[type] ?? []) attributes[fld.key] = fstr(f, `attr_${type}_${fld.key}`);
    return { code: fstr(f, 'code'), name: fstr(f, 'name'), type, status: (fstr(f, 'status') || 'unknown') as AssetStatus, owner_type: fstr(f, 'owner_type') as (typeof OWNER_TYPES)[number], owner_name: fstr(f, 'owner_name'), lat: fstr(f, 'lat'), lng: fstr(f, 'lng'), install_year: fstr(f, 'install_year'), notes: fstr(f, 'notes'), attributes };
  };
  app.get('/console/assets/new', dispatchers, (c) => render(c, d, { title: 'Register asset', current: 'assets', body: assetForm(c, {}, '/console/assets/new') }));
  app.post('/console/assets/new', dispatchers, async (c) => {
    const f = (await c.req.parseBody()) as Form;
    try { const id = createAsset(ctxOf(c, d), assetInputFrom(f)); return c.redirect(`/console/assets/${id}`, 303); } catch (e) {
      const m = e as { status?: number; message: string }; if (m.status === 400 || m.status === 409) return render(c, d, { title: 'Register asset', current: 'assets', status: 400, body: assetForm(c, formVals(f), '/console/assets/new', m.message) }); throw e;
    }
  });
  app.get('/console/assets/import', requireAuth({ perm: 'asset.import' }), (c) => render(c, d, { title: 'Import assets', current: 'assets', body: html`<div class="pagehead"><h1>Import assets from CSV</h1></div>
    <form class="card" method="post" action="/console/assets/import" enctype="multipart/form-data">${csrf(csrfToken(c, d))}<p>Required columns: <span class="tag">${CSV_COLUMNS.join(', ')}</span>. Optional: status, install_year, notes. Max 1 MB, 2000 rows. The file is validated first; nothing is imported unless every row is valid.</p>
    ${field('file', 'CSV file', html`<input id="file" name="file" type="file" accept=".csv,text/csv" required>`)}<div class="btnrow"><button class="btn pri" name="mode" value="preview" type="submit">Validate file</button><button class="btn" name="mode" value="import" type="submit">Import</button></div></form>` }));
  app.post('/console/assets/import', requireAuth({ perm: 'asset.import' }), async (c) => {
    const f = (await c.req.parseBody()) as Form;
    const file = f['file'];
    const ctx = ctxOf(c, d);
    if (!(file instanceof File) || file.size === 0) return render(c, d, { title: 'Import assets', current: 'assets', status: 400, body: html`<p class="err" role="alert">Choose a CSV file.</p>` });
    if (file.size > 1024 * 1024) return render(c, d, { title: 'Import assets', current: 'assets', status: 400, body: html`<p class="err" role="alert">File is too large (limit 1 MB).</p>` });
    const text = await file.text();
    try {
      if (fstr(f, 'mode') === 'import') { const r = importAssetCsv(ctx, text); const { flash } = await import('./http.ts'); flash(c, 'ok', `Imported ${r.imported} assets.`); return c.redirect('/console/assets', 303); }
      const p = previewAssetCsv(ctx, text);
      return render(c, d, { title: 'Import preview', current: 'assets', body: html`<div class="pagehead"><h1>Import preview</h1></div><p>${p.rows} rows: <b>${p.valid.length} valid</b>, <b>${p.errors.length} with errors</b>.</p>
        ${p.errors.length ? html`<div class="tablewrap"><table><thead><tr><th>Line</th><th>Problem</th></tr></thead><tbody>${p.errors.map((e) => html`<tr><td>${e.line}</td><td>${e.message}</td></tr>`)}</tbody></table></div>` : html`<p class="flash ok">All rows are valid. Upload the same file again and choose Import.</p>`}<a class="btn" href="/console/assets/import">Back</a>` });
    } catch (e) { const m = e as { status?: number; message: string }; if (m.status === 400) return render(c, d, { title: 'Import assets', current: 'assets', status: 400, body: html`<p class="err" role="alert">${m.message}</p><a class="btn" href="/console/assets/import">Back</a>` }); throw e; }
  });

  // ---------------- S2 Asset record ----------------
  app.get('/console/assets/:id/edit', dispatchers, (c) => {
    const a = getAsset(ctxOf(c, d), (c.req.param('id') as string));
    const attrs = JSON.parse(a.attributes) as Record<string, string | number>;
    const vals: Record<string, string> = { code: a.code, name: a.name, type: a.type, status: a.status, owner_type: a.owner_type, owner_name: a.owner_name, lat: String(a.lat), lng: String(a.lng), install_year: String(a.install_year ?? ''), notes: a.notes ?? '' };
    for (const f of ATTR_FIELDS[a.type]) vals[`attr_${a.type}_${f.key}`] = String(attrs[f.key] ?? '');
    return render(c, d, { title: 'Edit asset', current: 'assets', body: assetForm(c, vals, `/console/assets/${a.id}/edit`) });
  });
  app.post('/console/assets/:id/edit', dispatchers, async (c) => {
    const f = (await c.req.parseBody()) as Form;
    try { updateAsset(ctxOf(c, d), (c.req.param('id') as string), assetInputFrom(f)); return c.redirect(`/console/assets/${(c.req.param('id') as string)}`, 303); } catch (e) {
      const m = e as { status?: number; message: string }; if (m.status === 400 || m.status === 409) return render(c, d, { title: 'Edit asset', current: 'assets', status: 400, body: assetForm(c, formVals(f), `/console/assets/${(c.req.param('id') as string)}/edit`, m.message) }); throw e;
    }
  });
  app.get('/console/assets/:id', staff, (c) => {
    const ctx = ctxOf(c, d);
    const a = getAsset(ctx, (c.req.param('id') as string));
    const attrs = JSON.parse(a.attributes) as Record<string, string | number>;
    const hist = maintenanceHistory(ctx, a.id);
    const sensors = listSensors(ctx).filter((s) => s.asset_id === a.id);
    const reports = listReports(ctx).filter((r) => r.asset_id === a.id).slice(0, 10);
    const orders = listWorkOrders(ctx).filter((w) => w.asset_id === a.id).slice(0, 10);
    const canWrite = ctx.actor.role === 'dispatcher' || ctx.actor.role === 'org_admin';
    const now = ctx.now;
    const series = sensors.map((s) => ({ s, pts: sensorSeries(ctx, s.id, now - 24 * 3600_000, now) }));
    return render(c, d, { title: a.name, current: 'assets', body: html`<div class="pagehead"><h1>${stIcon(a.status, 26)} ${a.name}</h1>${statusChip(a.status)} ${originChip(a.origin)}<span class="spacer"></span>${canWrite ? html`<a class="btn" href="/console/assets/${a.id}/edit">Edit</a>` : ''}</div>
      <div class="grid2"><div class="stack"><section class="card"><h2>Registry</h2><div class="tablewrap"><table><tbody>
        <tr><th scope="row">Code</th><td class="mono">${a.code}</td></tr><tr><th scope="row">Type</th><td>${ASSET_TYPE_LABEL[a.type]}</td></tr><tr><th scope="row">Ownership</th><td>${a.owner_type} · ${a.owner_name}</td></tr>
        <tr><th scope="row">Location</th><td class="mono">${a.lat}, ${a.lng}</td></tr><tr><th scope="row">Installed</th><td>${a.install_year ?? 'unknown'}</td></tr>
        ${ATTR_FIELDS[a.type].filter((f) => attrs[f.key] !== undefined).map((f) => html`<tr><th scope="row">${f.label}</th><td>${attrs[f.key]}</td></tr>`)}${a.notes ? html`<tr><th scope="row">Notes</th><td>${a.notes}</td></tr>` : ''}</tbody></table></div>
        <p class="hint">Attribute names are WaterWatch-specific. Mapping to the WPDx standard fields has not been verified against the current standard document.</p></section>
        ${canWrite ? html`<section class="card"><h2>Status</h2>${a.status === 'contamination' ? html`<form method="post" action="/console/assets/${a.id}/status" class="stack">${csrf(csrfToken(c, d))}<input type="hidden" name="status" value="operational"><p class="flash err">Contamination alert is active. Clearing it requires a recorded reason (for example a lab reference or inspection result).</p>${field('reason', 'Reason / lab reference (min 5 characters)', html`<input id="reason" name="reason" required minlength="5" maxlength="300">`)}<button class="btn" type="submit">Clear contamination alert</button></form>`
          : html`<form method="post" action="/console/assets/${a.id}/status" class="btnrow">${csrf(csrfToken(c, d))}<label for="st" class="sr">Status</label><select id="st" name="status">${ASSET_STATUSES.map((s) => opt(s, STATUS_LABEL[s], a.status === s))}</select><input name="reason" placeholder="Reason (optional)" aria-label="Reason" maxlength="300"><button class="btn" type="submit">Update status</button></form>`}</section>` : ''}
        </div><div class="stack">
        <section class="card"><h2>Sensors</h2>${series.length ? series.map(({ s, pts }) => html`<div><b>${sensorKindLabel(s.kind)}${s.param ? ` (${s.param})` : ''}</b> · ${s.device_name} ${s.origin === 'simulated' ? simChip() : ''} ${healthChip(s.health, HEALTH_LABEL[s.health as keyof typeof HEALTH_LABEL] ?? s.health)}${s.validation_required ? html` <span class="chip warn">Validation required</span>` : ''}${sparkline(`${s.device_name} ${s.key}, last 24 hours`, pts, now - 24 * 3600_000, now, s.health)}<p class="hint">Last reading ${s.last_reading_at ? ago(s.last_reading_at, now) : 'never'}${s.last_value !== null ? ` · ${s.last_value} ${s.unit}` : ''}</p></div>`) : html`<p class="hint">No sensor installed.</p>`}</section>
        <section class="card"><h2>Maintenance history</h2>${hist.length ? html`<ul class="tl">${hist.map((h) => html`<li><b>${h.performed_on}</b> · ${h.summary}<div class="meta">${h.performed_by} · ${h.cost_minor ? kes(h.cost_minor) : 'no cost recorded'} ${originChip(h.origin)}</div></li>`)}</ul>` : html`<p class="hint">No maintenance recorded yet.</p>`}
          ${canWrite ? html`<details><summary>Add a maintenance record</summary><form method="post" action="/console/assets/${a.id}/maintenance" class="stack">${csrf(csrfToken(c, d))}<div class="row2">${field('md', 'Date', html`<input id="md" name="performed_on" type="date" required>`)}${field('mc', 'Cost (KES)', html`<input id="mc" name="cost" inputmode="decimal" value="0">`)}</div>${field('ms', 'What was done', html`<input id="ms" name="summary" required maxlength="300">`)}${field('mb', 'Done by', html`<input id="mb" name="performed_by" maxlength="120" value="${ctx.actor.name}">`)}<button class="btn pri" type="submit">Save record</button></form></details>` : ''}</section>
        <section class="card"><h2>Linked reports</h2>${reports.length ? html`<ul class="tl">${reports.map((r) => html`<li><b>${r.ref}</b> ${CATEGORY_LABEL[r.category].en} · ${r.status}<div class="meta">${ago(r.created_at, now)}${r.wo_ref ? ` · ${r.wo_ref}` : ''}</div></li>`)}</ul>` : html`<p class="hint">No reports for this asset.</p>`}</section>
        <section class="card"><h2>Work orders</h2>${orders.length ? html`<ul class="tl">${orders.map((w) => html`<li><a href="/console/orders/${w.id}">${w.ref}</a> ${w.title} ${woChip(w.status, STATUS_LABEL_WO[w.status])}</li>`)}</ul>` : html`<p class="hint">No work orders.</p>`}</section></div></div>` });
  });
  formAction(app, d, '/console/assets/:id/status', dispatchers, (ctx, f, c) => { setAssetStatus(ctx, c.req.param('id') as string, fstr(f, 'status') as AssetStatus, fstr(f, 'reason')); return { msg: 'Status updated.' }; });
  formAction(app, d, '/console/assets/:id/maintenance', dispatchers, (ctx, f, c) => { addMaintenanceRecord(ctx, c.req.param('id') as string, { performed_on: fstr(f, 'performed_on'), summary: fstr(f, 'summary'), performed_by: fstr(f, 'performed_by'), cost_minor: parseKesToMinor(fstr(f, 'cost') || '0') }); return { msg: 'Maintenance record saved.' }; });
  formAction(app, d, '/console/assets/:id/link', dispatchers, (ctx, f, c) => { linkAssets(ctx, c.req.param('id') as string, fstr(f, 'to')); return { msg: 'Assets linked.' }; });

  // ---------------- S3 Outage reports ----------------
  app.get('/console/reports', staff, (c) => {
    const ctx = ctxOf(c, d);
    const st = c.req.query('status') ?? 'new';
    const rows = listReports(ctx, st === 'all' ? {} : { status: st });
    const techs = technicians(ctx);
    const canTriage = ctx.actor.role !== 'auditor';
    const newOnes = listReports(ctx, { status: 'new' });
    const contam = newOnes.filter((r) => r.category === 'contamination');
    return render(c, d, { title: 'Outage reports', current: 'reports', body: html`<div class="pagehead"><h1>Outage reports</h1><span class="spacer"></span><span class="hint">Reports are community observations, not lab results.</span></div>
      ${contam.length ? html`<div class="alertbar" role="alert">${ic('alert')}<div><b>${contam.length} contamination report${contam.length === 1 ? '' : 's'} awaiting action.</b> <span>Create a P1 work order and follow your utility's notification procedure (water-quality officer, public-health contact).</span></div></div>` : ''}
      <nav class="tabs" aria-label="Report filter">${['new', 'linked', 'duplicate', 'rejected', 'all'].map((s) => html`<a href="/console/reports?status=${s}" ${st === s ? raw('aria-current="page"') : ''}>${s[0]?.toUpperCase()}${s.slice(1)}</a>`)}</nav>
      ${rows.length ? rows.map((r) => html`<article class="report ${r.category === 'contamination' ? 'contam' : ''}" id="r-${r.ref}"><div class="btnrow"><b class="mono">${r.ref}</b>${r.category === 'contamination' ? html`<span class="chip contam">${ic('alert')}High priority — contamination</span>` : html`<span class="chip unknown">${ic(CATEGORY_LABEL[r.category].icon)}${CATEGORY_LABEL[r.category].en}</span>`}${chip(r.status === 'new' ? 'new' : r.status === 'linked' ? 'linked' : 'unknown', r.status, r.status === 'linked' ? 'check' : 'clock')}${originChip(r.origin)}${r.wo_ref ? html`<span class="tag">${r.wo_ref}</span>` : ''}</div>
        <p>${r.text || html`<i>No description</i>`}</p><p class="meta">${r.asset_name ? html`${r.asset_name} (${r.asset_code})` : 'No asset matched'} · ${ago(r.created_at, ctx.now)} · language ${r.lang.toUpperCase()}${r.lat !== null ? ` · GPS ${r.lat.toFixed(4)}, ${r.lng?.toFixed(4)}${r.accuracy_m ? ` (±${Math.round(r.accuracy_m)} m)` : ''}` : ''}${r.reporter_name ? html` · Reporter: ${r.reporter_name}${r.reporter_phone ? ' ' + r.reporter_phone : ''}` : ''}</p>
        ${r.photo_id ? html`<p><a href="/photos/${r.photo_id}"><img class="photoimg" src="/photos/${r.photo_id}" alt="Photo submitted with report ${r.ref}" width="160"></a></p>` : ''}
        ${r.status === 'new' && canTriage ? html`<div class="btnrow"><button class="btn pri sm" type="button" data-dialog="mk-${r.id}">Create work order</button><button class="btn sm" type="button" data-dialog="dup-${r.id}">Mark duplicate</button>${r.category !== 'contamination' ? html`<button class="btn sm danger" type="button" data-dialog="rej-${r.id}">Reject</button>` : ''}</div>
        ${tplDialog(`mk-${r.id}`, html`<form class="dlgf" method="post" action="/console/reports/${r.id}/workorder">${csrf(csrfToken(c, d))}<h2>Create work order from ${r.ref}</h2>
          ${field('p' + r.id, 'Priority', html`<select id="p${r.id}" name="priority">${PRIORITIES.map((p) => opt(p, p === 'P1' ? 'P1 urgent' : p === 'P2' ? 'P2 high' : 'P3 routine', p === (r.category === 'contamination' ? 'P1' : 'P2')))}</select>`, r.category === 'contamination' ? 'Contamination is always P1.' : '')}
          ${field('t' + r.id, 'Technician', html`<select id="t${r.id}" name="assignee"><option value="">Assign later</option>${techs.map((t) => opt(t.id, t.name, false))}</select>`)}
          ${r.category === 'contamination' ? html`<p class="safety">Contamination: also notify the water-quality officer and public-health contact by your procedure. Do not state a cause until it is tested.</p>` : ''}
          <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri" type="submit">Create work order</button></div></form>`)}
        ${tplDialog(`dup-${r.id}`, html`<form class="dlgf" method="post" action="/console/reports/${r.id}/duplicate">${csrf(csrfToken(c, d))}<h2>Mark ${r.ref} as duplicate</h2>${field('d' + r.id, 'Duplicate of', html`<select id="d${r.id}" name="of">${rows.filter((o) => o.id !== r.id).map((o) => opt(o.id, `${o.ref} · ${CATEGORY_LABEL[o.category].en}`, false))}</select>`)}<div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri" type="submit">Mark duplicate</button></div></form>`)}
        ${tplDialog(`rej-${r.id}`, html`<form class="dlgf" method="post" action="/console/reports/${r.id}/reject">${csrf(csrfToken(c, d))}<h2>Reject ${r.ref}</h2>${field('j' + r.id, 'Reason (min 5 characters)', html`<input id="j${r.id}" name="reason" required minlength="5" maxlength="300">`)}<div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn danger" type="submit">Reject report</button></div></form>`)}` : ''}</article>`) : emptyState('check', 'No reports in this view', 'New community reports will appear here.')}` });
  });
  formAction(app, d, '/console/reports/:id/workorder', dispatchers, (ctx, f, c) => { const id = createFromReports(ctx, { reportIds: [c.req.param('id') as string], priority: fstr(f, 'priority') as Priority, assigneeId: fstr(f, 'assignee') || null }); return { msg: 'Work order created.', to: `/console/orders/${id}` }; });
  formAction(app, d, '/console/reports/:id/duplicate', dispatchers, (ctx, f, c) => { markDuplicate(ctx, c.req.param('id') as string, fstr(f, 'of')); return { msg: 'Marked as duplicate.' }; });
  formAction(app, d, '/console/reports/:id/reject', dispatchers, (ctx, f, c) => { rejectReport(ctx, c.req.param('id') as string, fstr(f, 'reason')); return { msg: 'Report rejected.' }; });

  // ---------------- S4 Work orders ----------------
  app.get('/console/orders', staff, (c) => {
    const ctx = ctxOf(c, d);
    const all = listWorkOrders(ctx);
    const techs = technicians(ctx);
    const cols: { key: string; label: string; match: (s: string) => boolean }[] = [{ key: 'new', label: 'New', match: (s) => s === 'new' }, { key: 'assigned', label: 'Assigned', match: (s) => s === 'assigned' }, { key: 'in_progress', label: 'In progress', match: (s) => s === 'in_progress' }, { key: 'awaiting_parts', label: 'Awaiting parts', match: (s) => s === 'awaiting_parts' }, { key: 'completed', label: 'Completed', match: (s) => s === 'completed' || s === 'closed' }];
    const canWrite = ctx.actor.role !== 'auditor';
    const assets = canWrite ? listAssets(ctx) : [];
    const showCost = ctx.actor.scopeOwner === null;
    return render(c, d, { title: 'Work orders', current: 'orders', body: html`<div class="pagehead"><h1>Work orders</h1><span class="spacer"></span>${canWrite ? html`<button class="btn pri" type="button" data-dialog="new-wo">New work order</button> <a class="btn" href="/console/orders.csv">Export CSV</a>` : ''}</div>
      <div class="board">${cols.map((col) => { const items = all.filter((w) => col.match(w.status) && !(w.status === 'closed' && ctx.now - (w.closed_at ?? 0) > 14 * 86400000)); return html`<section class="col" aria-label="${col.label}"><h3>${col.label} <span class="num">${items.length}</span></h3>
        ${items.map((w) => html`<article class="wo ${w.priority}"><div class="btnrow">${priChip(w.priority)}${w.kind === 'planned' ? html`<span class="chip unknown">${ic('cal')}Planned</span>` : ''}${w.status === 'closed' ? woChip('closed', 'Confirmed') : w.status === 'completed' ? html`<span class="chip warn">Awaiting confirmation</span>` : ''}</div>
          <a href="/console/orders/${w.id}"><b>${w.ref}</b> ${w.title}</a><span class="sub">${w.asset_name} (${w.asset_code})</span>${slaText(w.sla, w.status)}<span class="sub">${w.assignee_name ?? 'Unassigned'}${showCost && w.cost_minor ? ` · ${kes(w.cost_minor)}` : ''}</span>
          ${canWrite && ['new', 'assigned', 'in_progress', 'awaiting_parts'].includes(w.status) ? html`<form method="post" action="/console/orders/${w.id}/assign" class="stack">${csrf(csrfToken(c, d))}<label for="as-${w.id}" class="sr">Assign ${w.ref}</label><select id="as-${w.id}" name="assignee"><option value="">Choose technician</option>${techs.map((t) => opt(t.id, t.name, t.id === w.assignee_id))}</select><button class="btn sm" type="submit">${w.assignee_id ? 'Reassign' : 'Assign'}</button></form>` : ''}</article>`)}${items.length ? '' : html`<p class="hint">Nothing here.</p>`}</section>`; })}</div>
      ${canWrite ? tplDialog('new-wo', html`<form class="dlgf" method="post" action="/console/orders/new">${csrf(csrfToken(c, d))}<h2>New work order</h2>${field('nwa', 'Asset', html`<select id="nwa" name="asset" required>${assets.map((a) => opt(a.id, `${a.name} (${a.code})`, false))}</select>`)}${field('nwt', 'Title', html`<input id="nwt" name="title" required minlength="3" maxlength="160">`)}${field('nwd', 'Description', html`<textarea id="nwd" name="description" maxlength="2000"></textarea>`)}<div class="row2">${field('nwp', 'Priority', html`<select id="nwp" name="priority">${PRIORITIES.map((p) => opt(p, p, p === 'P3'))}</select>`)}${field('nwk', 'Kind', html`<select id="nwk" name="kind"><option value="reactive">Repair (reactive)</option><option value="planned">Planned maintenance</option><option value="sensor">Sensor / instrument check</option></select>`)}</div>${field('nws', 'Scheduled for (optional)', html`<input id="nws" name="scheduled" type="date">`)}${field('nwtech', 'Technician', html`<select id="nwtech" name="assignee"><option value="">Assign later</option>${techs.map((t) => opt(t.id, t.name, false))}</select>`)}<div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri" type="submit">Create</button></div></form>`) : ''}` });
  });
  app.get('/console/orders.csv', requireAuth({ perm: 'export' }), (c) => {
    const ctx = ctxOf(c, d);
    const rows = listWorkOrders(ctx);
    const showCost = ctx.actor.scopeOwner === null;
    const csv = toCsv([['ref', 'asset_code', 'title', 'priority', 'status', 'kind', 'assignee', 'created', 'completed', 'sla_state', ...(showCost ? ['cost_kes'] : []), 'origin'], ...rows.map((w) => [w.ref, w.asset_code, w.title, w.priority, w.status, w.kind, w.assignee_name ?? '', new Date(w.created_at).toISOString(), w.completed_at ? new Date(w.completed_at).toISOString() : '', w.sla.state, ...(showCost ? [(w.cost_minor / 100).toFixed(2)] : []), w.origin])]);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="work-orders.csv"', 'Cache-Control': 'no-store' } });
  });
  formAction(app, d, '/console/orders/new', dispatchers, (ctx, f) => {
    const sched = fstr(f, 'scheduled');
    const id = createWorkOrder(ctx, { assetId: fstr(f, 'asset'), title: fstr(f, 'title'), description: fstr(f, 'description'), priority: fstr(f, 'priority') as Priority, kind: (fstr(f, 'kind') || 'reactive') as 'reactive', assigneeId: fstr(f, 'assignee') || null, scheduledFor: sched ? Date.parse(sched + 'T00:00:00Z') - ctx.settings.tzOffsetMin * 60000 : null });
    return { msg: 'Work order created.', to: `/console/orders/${id}` };
  });
  formAction(app, d, '/console/orders/:id/assign', dispatchers, (ctx, f, c) => { assignWorkOrder(ctx, c.req.param('id') as string, fstr(f, 'assignee')); return { msg: 'Technician assigned.' }; });
  formAction(app, d, '/console/orders/:id/transition', dispatchers, (ctx, f, c) => {
    const to = fstr(f, 'to') as 'in_progress' | 'closed' | 'cancelled';
    transitionWorkOrder(ctx, c.req.param('id') as string, { to, note: fstr(f, 'note'), restoreStatus: (fstr(f, 'restore') || 'keep') as 'keep', clearReason: fstr(f, 'clear_reason') });
    return { msg: 'Work order updated.' };
  });
  formAction(app, d, '/console/orders/:id/cost', dispatchers, (ctx, f, c) => { addMaterial(ctx, c.req.param('id') as string, { name: fstr(f, 'name'), category: fstr(f, 'category'), qty: fnum(f, 'qty'), unitCostMinor: parseKesToMinor(fstr(f, 'unit_cost') || '0') }); return { msg: 'Cost line added.' }; });

  app.get('/console/orders/:id', staff, (c) => {
    const ctx = ctxOf(c, d);
    const w = getWorkOrder(ctx, (c.req.param('id') as string));
    const evs = woEvents(ctx, w.id), mats = woMaterials(ctx, w.id), reps = woReports(ctx, w.id);
    const canWrite = ctx.actor.role !== 'auditor';
    const asset = getAsset(ctx, w.asset_id);
    const techs = technicians(ctx);
    const showCost = ctx.actor.scopeOwner === null;
    return render(c, d, { title: w.ref, current: 'orders', body: html`<div class="pagehead"><h1>${w.ref}: ${w.title}</h1>${priChip(w.priority)} ${woChip(w.status, STATUS_LABEL_WO[w.status])} ${originChip(w.origin)}</div>
      <div class="grid2"><div class="stack"><section class="card"><h2>Summary</h2><div class="tablewrap"><table><tbody><tr><th scope="row">Asset</th><td><a href="/console/assets/${w.asset_id}">${w.asset_name} (${w.asset_code})</a> ${statusChip(asset.status)}</td></tr><tr><th scope="row">Kind</th><td>${w.kind}</td></tr><tr><th scope="row">Assignee</th><td>${w.assignee_name ?? 'Unassigned'}</td></tr>
        <tr><th scope="row">Fault started</th><td>${fmtDateTime(w.fault_started_at)}</td></tr><tr><th scope="row">SLA</th><td>${w.sla_minutes / 60} h target (placeholder, set per utility) · ${slaText(w.sla, w.status)} · due ${fmtDateTime(w.sla.dueMs)}${w.sla.pausedMin ? ` · paused ${w.sla.pausedMin} min` : ''}</td></tr>
        ${w.completed_at ? html`<tr><th scope="row">Completed</th><td>${fmtDateTime(w.completed_at)}</td></tr>` : ''}${w.scheduled_for ? html`<tr><th scope="row">Scheduled</th><td>${fmtDate(w.scheduled_for)}</td></tr>` : ''}${showCost ? html`<tr><th scope="row">Total cost</th><td>${kes(w.cost_minor)}</td></tr>` : ''}</tbody></table></div>${w.description ? html`<p>${w.description}</p>` : ''}${w.completion_notes ? html`<p><b>Completion notes:</b> ${w.completion_notes}</p>` : ''}
          ${w.completion_photo_id ? html`<p><b>Completion photo</b><br><a href="/photos/${w.completion_photo_id}"><img class="photoimg" src="/photos/${w.completion_photo_id}" alt="Completion photo for ${w.ref}" width="240"></a></p>` : ''}</section>
        ${canWrite ? html`<section class="card stack"><h2>Actions</h2>
          ${['new', 'assigned', 'in_progress', 'awaiting_parts'].includes(w.status) ? html`<form method="post" action="/console/orders/${w.id}/assign" class="btnrow">${csrf(csrfToken(c, d))}<label for="ast" class="sr">Technician</label><select id="ast" name="assignee">${techs.map((t) => opt(t.id, t.name, t.id === w.assignee_id))}</select><button class="btn" type="submit">${w.assignee_id ? 'Reassign' : 'Assign'}</button></form>` : ''}
          ${w.status === 'completed' ? html`<form method="post" action="/console/orders/${w.id}/transition" class="stack">${csrf(csrfToken(c, d))}<input type="hidden" name="to" value="closed"><h3>Confirm completion</h3>${field('rs', 'Asset status after repair', html`<select id="rs" name="restore"><option value="keep">Leave as ${STATUS_TEXT[asset.status]}</option><option value="operational">Set Operational</option><option value="degraded">Set Degraded</option></select>`)}${asset.status === 'contamination' ? field('cr', 'Reason / lab reference (required to clear contamination)', html`<input id="cr" name="clear_reason" minlength="5" maxlength="300">`) : ''}<button class="btn pri" type="submit">Confirm completed</button></form>
            <form method="post" action="/console/orders/${w.id}/transition" class="stack">${csrf(csrfToken(c, d))}<input type="hidden" name="to" value="in_progress"><h3>Send back</h3>${field('sb', 'Reason (min 5 characters)', html`<input id="sb" name="note" required minlength="5" maxlength="300">`)}<button class="btn" type="submit">Send back to technician</button></form>` : ''}
          ${['new', 'assigned', 'in_progress', 'awaiting_parts'].includes(w.status) ? html`<form method="post" action="/console/orders/${w.id}/transition" class="btnrow">${csrf(csrfToken(c, d))}<input type="hidden" name="to" value="cancelled"><input name="note" required minlength="5" maxlength="300" placeholder="Cancellation reason" aria-label="Cancellation reason"><button class="btn danger" type="submit">Cancel work order</button></form>` : ''}
          ${!['closed', 'cancelled'].includes(w.status) ? html`<details><summary>Add cost line</summary><form method="post" action="/console/orders/${w.id}/cost" class="stack">${csrf(csrfToken(c, d))}${field('cn', 'Item', html`<input id="cn" name="name" required maxlength="120">`)}<div class="row3">${field('cc', 'Category', html`<select id="cc" name="category">${COST_CATEGORIES.map((x) => opt(x, x, false))}</select>`)}${field('cq', 'Qty', html`<input id="cq" name="qty" type="number" min="1" value="1" required>`)}${field('cu', 'Unit cost (KES)', html`<input id="cu" name="unit_cost" inputmode="decimal" required>`)}</div><button class="btn" type="submit">Add</button></form></details>` : ''}</section>` : ''}</div>
        <div class="stack"><section class="card"><h2>Reports</h2>${reps.length ? html`<ul class="tl">${reps.map((r) => html`<li><b>${r.ref}</b> ${CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL]?.en ?? r.category}<div class="meta">${r.text}</div></li>`)}</ul>` : html`<p class="hint">No linked reports (planned or manually created).</p>`}</section>
        <section class="card"><h2>Materials and costs</h2>${mats.length ? html`<div class="tablewrap"><table><thead><tr><th>Item</th><th>Category</th><th>Qty</th>${showCost ? html`<th>Line total</th>` : ''}</tr></thead><tbody>${mats.map((m) => html`<tr><td>${m.name}</td><td>${m.category}</td><td class="num">${m.qty}</td>${showCost ? html`<td class="num">${formatKes(m.qty * m.unit_cost_minor)}</td>` : ''}</tr>`)}</tbody></table></div>` : html`<p class="hint">No materials or costs recorded.</p>`}</section>
        <section class="card"><h2>Timeline</h2><ul class="tl">${evs.map((e) => html`<li><b>${STATUS_LABEL_WO[e.to_status]}</b><div class="meta">${fmtDateTime(e.ts)}${e.note ? ` · ${e.note}` : ''}</div></li>`)}</ul></section></div></div>` });
  });

  // ---------------- Planned maintenance schedule (design addendum 01) ----------------
  app.get('/console/schedule', requireAuth({ perm: 'schedule.manage' }), (c) => {
    const ctx = ctxOf(c, d);
    const sch = listSchedules(ctx);
    const assets = listAssets(ctx);
    const upcoming = listWorkOrders(ctx).filter((w) => w.kind === 'planned' && !['closed', 'cancelled'].includes(w.status)).sort((a, b) => (a.scheduled_for ?? 0) - (b.scheduled_for ?? 0));
    return render(c, d, { title: 'Planned maintenance', current: 'schedule', body: html`<div class="pagehead"><h1>Planned maintenance</h1><span class="spacer"></span><form method="post" action="/console/schedule/generate" class="inl">${csrf(csrfToken(c, d))}<button class="btn" type="submit">Generate due work orders now</button></form></div>
      <p class="hint">Recurring schedules create planned work orders 7 days before they fall due. Generation runs automatically every minute and is idempotent.</p>
      <div class="grid2"><section class="card"><h2>Upcoming planned work</h2>${upcoming.length ? html`<ul class="tl">${upcoming.map((w) => html`<li><b>${fmtDate(w.scheduled_for)}</b> · <a href="/console/orders/${w.id}">${w.ref}</a> ${w.title}<div class="meta">${w.asset_name} · ${w.assignee_name ?? 'Unassigned'} · ${priChip(w.priority)}</div></li>`)}</ul>` : html`<p class="hint">No planned work scheduled.</p>`}</section>
      <section class="card"><h2>Recurring schedules</h2>${sch.length ? html`<div class="tablewrap"><table><thead><tr><th>Asset</th><th>Task</th><th>Every</th><th>Next due</th><th></th></tr></thead><tbody>${sch.map((s) => html`<tr><td>${s.asset_name}</td><td>${s.title} ${priChip(s.priority)}</td><td>${s.interval_days} d</td><td>${s.next_due}</td><td><form method="post" action="/console/schedule/${s.id}/${s.active ? 'pause' : 'resume'}" class="inl">${csrf(csrfToken(c, d))}<button class="btn sm" type="submit">${s.active ? 'Pause' : 'Resume'}</button></form></td></tr>`)}</tbody></table></div>` : html`<p class="hint">No schedules yet.</p>`}
      <details open><summary>Add a schedule</summary><form method="post" action="/console/schedule" class="stack">${csrf(csrfToken(c, d))}${field('sa', 'Asset', html`<select id="sa" name="asset" required>${assets.map((a) => opt(a.id, `${a.name} (${a.code})`, false))}</select>`)}${field('st', 'Task', html`<input id="st" name="title" required minlength="3" maxlength="160">`)}<div class="row3">${field('si', 'Every (days)', html`<input id="si" name="interval" type="number" min="1" max="3650" required>`)}${field('sd', 'First due', html`<input id="sd" name="first_due" type="date" required>`)}${field('sp', 'Priority', html`<select id="sp" name="priority">${PRIORITIES.map((p) => opt(p, p, p === 'P3'))}</select>`)}</div><button class="btn pri" type="submit">Add schedule</button></form></details></section></div>` });
  });
  formAction(app, d, '/console/schedule', requireAuth({ perm: 'schedule.manage' }), (ctx, f) => { createSchedule(ctx, { assetId: fstr(f, 'asset'), title: fstr(f, 'title'), intervalDays: fnum(f, 'interval'), firstDue: fstr(f, 'first_due'), priority: fstr(f, 'priority') as Priority }); return { msg: 'Schedule added.' }; });
  formAction(app, d, '/console/schedule/generate', requireAuth({ perm: 'schedule.manage' }), (ctx) => { const n = generatePlannedWork(ctx); return { msg: n ? `${n} planned work order${n === 1 ? '' : 's'} generated.` : 'Nothing due.' }; });
  formAction(app, d, '/console/schedule/:id/pause', requireAuth({ perm: 'schedule.manage' }), (ctx, _f, c) => { setScheduleActive(ctx, c.req.param('id') as string, false); return { msg: 'Schedule paused.' }; });
  formAction(app, d, '/console/schedule/:id/resume', requireAuth({ perm: 'schedule.manage' }), (ctx, _f, c) => { setScheduleActive(ctx, c.req.param('id') as string, true); return { msg: 'Schedule resumed.' }; });
  void anyOrgUser; void need; void forbidden;
}
