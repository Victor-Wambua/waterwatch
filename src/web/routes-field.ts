import { getCookie, setCookie } from 'hono/cookie';
import { html, raw } from '../core/html.ts';
import { forbidden, notFound } from '../core/errors.ts';
import { savePhoto, readPhoto } from '../repo/photos.ts';
import { listAssets } from '../repo/assets.ts';
import { CATEGORY_LABEL, listReports, submitReport, type ReportInput } from '../repo/reports.ts';
import { STATUS_LABEL_WO, addMaterial, getWorkOrder, listWorkOrders, parseKesToMinor, transitionWorkOrder, woEvents, woMaterials, woReports } from '../repo/workorders.ts';
import { ASSET_TYPE_LABEL } from '../repo/assets.ts';
import { REPORT_CATEGORIES, COST_CATEGORIES } from '../domain/types.ts';
import { body, csrfToken, ctxOf, flash, limit, requireAuth, type AppT, type Deps } from './http.ts';
import { ffile, formAction, fnum, fstr, type Form } from './action.ts';
import { T, pickLang } from './i18n.ts';
import { render } from './shell.ts';
import { ago, csrf, emptyState, field, ic, kes, opt, priChip, slaText, statusChip, woChip, chip } from './ui.ts';

const reporters = requireAuth({ roles: ['reporter'] });
const techs = requireAuth({ roles: ['technician'] });
const MAX_MULTIPART = 7 * 1024 * 1024;

export function fieldRoutes(app: AppT, d: Deps): void {
  // ---------------- S8 Community report ----------------
  app.get('/report', reporters, (c) => {
    const ctx = ctxOf(c, d);
    const lang = pickLang(c.req.query('lang'), getCookie(c, 'ww_lang'));
    setCookie(c, 'ww_lang', lang, { path: '/', maxAge: 31536000, sameSite: 'Lax' });
    const t = T[lang];
    const assets = listAssets({ ...ctx, actor: { ...ctx.actor, role: 'dispatcher', scopeOwner: null } });
    const cats = REPORT_CATEGORIES;
    const safety = html`<div class="safety" role="alert" id="safety-panel" hidden><h3>${ic('alert')} ${t.safetyTitle}</h3><ul>${t.safety.map((s) => html`<li>${s}</li>`)}</ul><p>${t.safetyNote}</p></div>`;
    return render(c, d, { title: t.title, lang, noNav: true, scripts: ['/js/report.js'], extraHead: html`<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0B6180">`, body: html`<div class="phonewrap"><div class="phone" id="report-app" data-lang="${lang}" data-asset-count="${assets.length}">
      <div class="phonehead"><span>${ic('drop')} ${t.title}</span><span class="spacer"></span><span class="langbar"><a class="btn sm" href="/report?lang=en" lang="en" ${lang === 'en' ? raw('aria-current="true"') : ''}>EN</a><a class="btn sm" href="/report?lang=sw" lang="sw" ${lang === 'sw' ? raw('aria-current="true"') : ''}>SW</a></span></div>
      <div class="offbar on" id="net-bar" role="status">${t.online}</div>
      <form class="phonebody" id="report-form" method="post" action="/report" enctype="multipart/form-data" novalidate>${csrf(csrfToken(c, d))}
        <input type="hidden" name="lang" value="${lang}"><input type="hidden" name="client_uid" id="client_uid"><input type="hidden" name="lat" id="lat"><input type="hidden" name="lng" id="lng"><input type="hidden" name="accuracy_m" id="accuracy_m"><input type="hidden" name="observed_at" id="observed_at"><input type="hidden" name="submit_ms" id="submit_ms">
        <h2>${t.s1}</h2><div class="catgrid" role="radiogroup" aria-label="${t.s1}">${cats.map((k) => html`<label class="cat c-${k === 'contamination' ? 'contam' : 'x'}"><input type="radio" name="category" value="${k}" class="visually-hidden">${ic(CATEGORY_LABEL[k].icon)}<span lang="${lang}">${CATEGORY_LABEL[k][lang]}</span></label>`)}</div>
        <p class="err" id="err-cat" role="alert" hidden>${t.missing}</p>${safety}
        ${field('text', t.describe, html`<textarea id="text" name="text" maxlength="1000" rows="3"></textarea>`)}
        <h2>${t.s2}</h2><div class="photo"><label class="btn" for="photo">${ic('cam')} ${t.photo}</label><input id="photo" name="photo" type="file" accept="image/*" capture="environment"><img id="photo-prev" alt="" hidden></div>
        <h2>${t.s3}</h2><button class="btn" type="button" id="gps-btn">${ic('pin')} ${t.gps}</button><p class="hint" id="gps-status" role="status"></p>
        ${field('asset_id', t.pick, html`<select id="asset_id" name="asset_id"><option value="">-</option>${assets.map((a) => html`<option value="${a.id}">${a.name} (${ASSET_TYPE_LABEL[a.type]})</option>`)}</select>`)}
        <p class="err" id="err-loc" role="alert" hidden>${t.loc}</p>
        <button class="btn pri big" type="submit" id="send-btn">${t.send}</button>
        <p class="legalnote">${t.disclaimer}</p><p class="legalnote">${t.privacy}</p></form>
      <div class="phonebody" id="done" hidden><div class="card"><h1 class="okh" id="done-title"></h1><p class="num" id="done-ref"></p><p class="timer" id="done-time"></p></div><div id="done-safety"></div><button class="btn pri big" type="button" id="again-btn">${t.another}</button></div>
      <div class="phonebody"><div class="queue" id="queue" hidden aria-live="polite"><h3>${t.waiting} (<span id="queue-count">0</span>)</h3><ul id="queue-list" class="list"></ul><button class="btn" type="button" id="flush-btn">${t.sendNow}</button></div><a class="btn" href="/report/mine">${t.mine}</a></div>
      <template id="i18n" data-saved="${t.queued}" data-thanks="${t.thanks}" data-loc-ok="${t.locOk}" data-loc-fail="${t.locFail}" data-offline="${t.offline}" data-online="${t.online}" data-failed="${t.failed}" data-remove="${t.remove}" data-signin="${t.signin}" data-secs="s"></template>
      <template id="safety-tpl"><div class="safety" role="alert"><h3>${t.safetyTitle}</h3><ul>${t.safety.map((s) => html`<li>${s}</li>`)}</ul><p>${t.safetyNote}</p></div></template></div></div>` });
  });

  // No-JS fallback: plain multipart POST
  app.post('/report', reporters, body(MAX_MULTIPART), async (c) => {
    const ctx = ctxOf(c, d);
    limit(d, c, `upload:${ctx.actor.id}`, 30, 10 * 60_000);
    const f = (await c.req.parseBody()) as Form;
    try {
      const file = ffile(f, 'photo');
      const photoId = file ? await savePhoto(ctx, 'report', new Uint8Array(await file.arrayBuffer())) : null;
      const r = submitReport(ctx, formToReport(f), photoId);
      return c.redirect(`/report/done?ref=${encodeURIComponent(r.ref)}${r.contamination ? '&c=1' : ''}`, 303);
    } catch (e) { const m = e as { status?: number; message: string }; if (m.status === 400 || m.status === 429) { flash(c, 'err', m.message); return c.redirect('/report', 303); } throw e; }
  });
  app.get('/report/done', reporters, (c) => {
    const lang = pickLang(undefined, getCookie(c, 'ww_lang')), t = T[lang];
    const ref = (c.req.query('ref') ?? '').replace(/[^A-Za-z0-9-]/g, '');
    return render(c, d, { title: t.thanks, lang, noNav: true, body: html`<div class="phonewrap"><div class="phone"><div class="phonebody"><div class="card"><h1 class="okh">${ic('check')} ${t.thanks}</h1><p class="num">Ref ${ref}</p></div>${c.req.query('c') ? html`<div class="safety" role="alert"><h3>${t.safetyTitle}</h3><ul>${t.safety.map((s) => html`<li>${s}</li>`)}</ul><p>${t.safetyNote}</p></div>` : ''}<a class="btn pri big" href="/report">${t.another}</a></div></div></div>` });
  });
  app.get('/report/mine', reporters, (c) => {
    const ctx = ctxOf(c, d);
    const lang = pickLang(undefined, getCookie(c, 'ww_lang')), t = T[lang];
    const rows = listReports(ctx);
    const state = (r: { status: string; wo_ref: string | null }) => r.status === 'rejected' ? 'Closed' : r.status === 'duplicate' ? 'Merged with an earlier report' : r.wo_ref ? 'Repair scheduled' : 'Received';
    return render(c, d, { title: t.mine, lang, noNav: true, body: html`<div class="phonewrap"><div class="phone"><div class="phonehead"><span>${t.mine}</span><span class="spacer"></span><a class="btn sm" href="/report">${t.send}</a></div><div class="phonebody">${rows.length ? html`<ul class="list">${rows.map((r) => html`<li class="row"><span class="grow"><b class="mono">${r.ref}</b> ${CATEGORY_LABEL[r.category][lang]}<br><span class="sub">${r.asset_name ?? '-'} · ${ago(r.created_at, ctx.now)} · ${state(r)}</span></span></li>`)}</ul>` : emptyState('drop', '-')}</div></div></div>` });
  });

  // ---------------- Photos (authorised serving) ----------------
  app.get('/photos/:id', requireAuth(), (c) => {
    const p = readPhoto(ctxOf(c, d), c.req.param('id') as string);
    return new Response(new Uint8Array(p.data), { headers: { 'Content-Type': p.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  });

  // ---------------- S9 Technician ----------------
  app.get('/tech', techs, (c) => {
    const ctx = ctxOf(c, d);
    const rows = listWorkOrders(ctx).filter((w) => !['closed', 'cancelled'].includes(w.status)).sort((a, b) => a.sla.remainingMin - b.sla.remainingMin);
    return render(c, d, { title: 'My jobs', noNav: true, body: html`<div class="phonewrap"><div class="phone"><div class="phonehead"><span>${ic('wrench')} My jobs</span></div><div class="phonebody">
      ${rows.length ? html`<ul class="list">${rows.map((w) => html`<li><a class="row job" href="/tech/${w.id}">${priChip(w.priority)}<span class="grow"><b>${w.ref}</b> ${w.title}<br><span class="sub">${w.asset_name} · ${STATUS_LABEL_WO[w.status]}</span><br>${slaText(w.sla, w.status)}</span></a></li>`)}</ul>` : emptyState('check', 'No jobs assigned', 'New jobs appear here when a dispatcher assigns them.')}</div></div></div>` });
  });
  app.get('/tech/:id', techs, (c) => {
    const ctx = ctxOf(c, d);
    const w = getWorkOrder(ctx, c.req.param('id') as string);
    const asset = ctx.t.get<{ status: string; lat: number; lng: number; name: string }>('SELECT status, lat, lng, name FROM assets WHERE org_id = :org AND id = :id', { id: w.asset_id });
    const mats = woMaterials(ctx, w.id), reps = woReports(ctx, w.id), evs = woEvents(ctx, w.id);
    const back = [...evs].reverse().find((e) => e.from_status === 'completed' && e.to_status === 'in_progress');
    const steps: [string, string][] = [['assigned', 'Assigned'], ['in_progress', 'In progress'], ['awaiting_parts', 'Awaiting parts'], ['completed', 'Completed']];
    const open = !['closed', 'cancelled', 'completed'].includes(w.status);
    return render(c, d, { title: w.ref, noNav: true, body: html`<div class="phonewrap"><div class="phone"><div class="phonehead"><a class="btn sm" href="/tech">Back</a><span>${w.ref}</span></div><div class="phonebody">
      <div class="card stack"><h1>${w.title}</h1><p>${priChip(w.priority)} ${woChip(w.status, STATUS_LABEL_WO[w.status])}</p><p><b>${w.asset_name}</b> (${w.asset_code}) ${asset ? statusChip(asset.status as 'operational') : ''}</p><p>${slaText(w.sla, w.status)}</p>
        ${asset ? html`<a class="btn big" href="geo:${asset.lat},${asset.lng}?q=${asset.lat},${asset.lng}(${encodeURIComponent(asset.name)})">${ic('nav')} Navigate</a>` : ''}
        ${w.description ? html`<p>${w.description}</p>` : ''}${reps.map((r) => html`<p class="hint">${r.ref}: ${r.text}</p>`)}
        ${back ? html`<p class="flash err">Sent back by dispatcher: ${back.note}</p>` : ''}</div>
      <ol class="stepper" aria-label="Progress">${steps.map(([k, l]) => html`<li class="${w.status === k ? 'cur' : ''}">${w.status === k ? ic('wrench') : ''}${l}</li>`)}</ol>
      ${w.status === 'assigned' ? html`<form method="post" action="/tech/${w.id}/transition">${csrf(csrfToken(c, d))}<input type="hidden" name="to" value="in_progress"><button class="btn pri big" type="submit">Start work</button></form>` : ''}
      ${w.status === 'in_progress' ? html`<form method="post" action="/tech/${w.id}/transition">${csrf(csrfToken(c, d))}<input type="hidden" name="to" value="awaiting_parts"><button class="btn big" type="submit">Need parts</button></form>` : ''}
      ${w.status === 'awaiting_parts' ? html`<form method="post" action="/tech/${w.id}/transition">${csrf(csrfToken(c, d))}<input type="hidden" name="to" value="in_progress"><button class="btn pri big" type="submit">Parts arrived: resume work</button></form>` : ''}
      ${open ? html`<div class="card stack"><h2>Materials and costs</h2>${mats.length ? html`<ul class="list">${mats.map((m) => html`<li class="row"><span class="grow">${m.name} × ${m.qty}</span><span class="num">${kes(m.qty * m.unit_cost_minor)}</span></li>`)}</ul><p><b>Total ${kes(w.cost_minor)}</b></p>` : html`<p class="hint">Nothing recorded yet.</p>`}
        <form method="post" action="/tech/${w.id}/cost" class="stack">${csrf(csrfToken(c, d))}${field('mn', 'Item', html`<input id="mn" name="name" required maxlength="120">`)}<div class="row3">${field('mcat', 'Type', html`<select id="mcat" name="category">${COST_CATEGORIES.map((x) => opt(x, x, false))}</select>`)}${field('mq', 'Qty', html`<input id="mq" name="qty" type="number" min="1" value="1" required>`)}${field('mu', 'Unit cost (KES)', html`<input id="mu" name="unit_cost" inputmode="decimal" required>`)}</div><button class="btn" type="submit">Add</button></form></div>` : ''}
      ${w.status === 'in_progress' ? html`<form method="post" action="/tech/${w.id}/complete" enctype="multipart/form-data" class="card stack">${csrf(csrfToken(c, d))}<h2>Complete the job</h2>${field('cp', 'Completion photo (required)', html`<input id="cp" name="photo" type="file" accept="image/*" capture="environment" required>`)}${field('cn', 'What was done', html`<textarea id="cn" name="notes" maxlength="2000" rows="3"></textarea>`)}<button class="btn pri big" type="submit">Mark complete</button></form>` : ''}
      ${w.status === 'completed' ? html`<div class="flash ok">Completed. Waiting for dispatcher confirmation.</div>` : ''}</div></div></div>` });
  });
  formAction(app, d, '/tech/:id/transition', techs, (ctx, f, c) => { transitionWorkOrder(ctx, c.req.param('id') as string, { to: fstr(f, 'to') as 'in_progress', note: fstr(f, 'note') }); return { msg: 'Updated.' }; });
  formAction(app, d, '/tech/:id/cost', techs, (ctx, f, c) => { addMaterial(ctx, c.req.param('id') as string, { name: fstr(f, 'name'), category: fstr(f, 'category'), qty: fnum(f, 'qty'), unitCostMinor: parseKesToMinor(fstr(f, 'unit_cost') || '0') }); return { msg: 'Cost added.' }; });
  app.post('/tech/:id/complete', techs, body(MAX_MULTIPART), async (c) => {
    const ctx = ctxOf(c, d);
    limit(d, c, `upload:${ctx.actor.id}`, 30, 10 * 60_000);
    const f = (await c.req.parseBody()) as Form;
    const id = c.req.param('id') as string;
    try {
      getWorkOrder(ctx, id);
      const file = ffile(f, 'photo');
      if (!file) { flash(c, 'err', 'A completion photo is required to mark the job complete.'); return c.redirect(`/tech/${id}`, 303); }
      const photoId = await savePhoto(ctx, 'completion', new Uint8Array(await file.arrayBuffer()));
      transitionWorkOrder(ctx, id, { to: 'completed', photoId, completionNotes: fstr(f, 'notes') });
      flash(c, 'ok', 'Job marked complete.');
      return c.redirect('/tech', 303);
    } catch (e) { const m = e as { status?: number; message: string }; if (m.status === 400 || m.status === 409) { flash(c, 'err', m.message); return c.redirect(`/tech/${id}`, 303); } throw e; }
  });
  void forbidden; void notFound; void chip;
}

export function formToReport(f: Form): ReportInput {
  return { category: fstr(f, 'category') as 'no_water', text: fstr(f, 'text'), lang: (fstr(f, 'lang') || 'en') as 'en', asset_id: fstr(f, 'asset_id') || null, lat: fstr(f, 'lat') || null, lng: fstr(f, 'lng') || null, accuracy_m: fstr(f, 'accuracy_m') || null, client_uid: fstr(f, 'client_uid') || null, observed_at: fstr(f, 'observed_at') || null, submit_ms: fstr(f, 'submit_ms') || null };
}
