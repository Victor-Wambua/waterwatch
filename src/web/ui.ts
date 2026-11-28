import { esc, html, raw, type Part, Raw } from '../core/html.ts';
import { SPRITE } from './icons.ts';
import type { AssetStatus, Role } from '../domain/types.ts';
import { roleLabel, can, type Permission } from '../domain/rbac.ts';

export const ic = (name: string, extra = '') => raw(`<svg class="i ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`);

// ---- formatting ----
const TZ = 'Africa/Nairobi';
export const fmtDateTime = (ms: number | null | undefined) => (ms ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(ms) : '-');
export const fmtDate = (ms: number | null | undefined) => (ms ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'medium' }).format(ms) : '-');
export const ago = (ms: number, now: number) => { const m = Math.max(0, Math.round((now - ms) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
export const mins = (m: number) => { const a = Math.abs(Math.round(m)); return a >= 1440 ? `${Math.floor(a / 1440)}d ${Math.floor((a % 1440) / 60)}h` : a >= 60 ? `${Math.floor(a / 60)}h ${a % 60}m` : `${a}m`; };
export const kes = (minor: number) => `KES ${(minor / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const hrs = (h: number | null) => (h === null ? 'n/a' : `${h.toFixed(1)} h`);

// ---- status visuals: shape + icon + text, never colour alone ----
const SHAPES: Record<AssetStatus, string> = {
  operational: '<circle cx="12" cy="12" r="9"/><path d="M7.5 12.5l3 3 6-6.5" class="g"/>',
  degraded: '<path d="M12 3l10 18H2z"/><path d="M12 10v5" class="g"/>',
  down: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8l8 8M16 8l-8 8" class="g"/>',
  contamination: '<path d="M12 1.5l10.5 10.5L12 22.5 1.5 12z"/><path d="M12 7v6M12 16v.5" class="g"/>',
  unknown: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3" fill="none"/><path d="M9.5 9.5a2.7 2.7 0 1 1 3.5 2.5c-.8.4-1 .8-1 1.8" class="g"/>'
};
export const STATUS_CLASS: Record<AssetStatus, string> = { operational: 'operational', degraded: 'degraded', down: 'down', contamination: 'contam', unknown: 'unknown' };
export const STATUS_TEXT: Record<AssetStatus, string> = { operational: 'Operational', degraded: 'Degraded', down: 'Out of service', contamination: 'Contamination alert', unknown: 'Status unknown' };
export const stIcon = (s: AssetStatus, size = 16) => raw(`<svg class="mk stm ${STATUS_CLASS[s]}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${SHAPES[s]}</svg>`);
export const statusChip = (s: AssetStatus) => html`<span class="chip ${STATUS_CLASS[s]}">${stIcon(s, 14)}${STATUS_TEXT[s]}</span>`;
export const chip = (cls: string, label: string, icon = 'clock') => html`<span class="chip ${cls}">${ic(icon)}${label}</span>`;
export const priChip = (p: string) => chip(p, p === 'P1' ? 'P1 urgent' : p === 'P2' ? 'P2 high' : 'P3 routine', p === 'P3' ? 'clock' : 'alert');
const WO_ICON: Record<string, string> = { new: 'clock', assigned: 'user', in_progress: 'wrench', awaiting_parts: 'clock', completed: 'check', closed: 'check', cancelled: 'x' };
export const woChip = (s: string, label: string) => chip(s === 'awaiting_parts' ? 'parts' : s === 'completed' || s === 'closed' ? 'done' : s, label, WO_ICON[s] ?? 'clock');
const HEALTH_ICON: Record<string, string> = { reporting: 'check', late: 'clock', missing: 'wifi-off', out_of_range: 'alert', flatline: 'alert', unknown: 'q' };
export const healthChip = (h: string, label: string) => chip(h === 'reporting' ? 'ok' : h === 'late' ? 'late' : h === 'unknown' ? 'unknown' : h === 'missing' || h === 'out_of_range' ? 'missing' : 'flatline', label, HEALTH_ICON[h] ?? 'clock');
export const simChip = (compact = false) => compact
  ? html`<span class="chip sim" title="SIMULATED SENSOR — test environment">${ic('chip')}Simulated</span>`
  : html`<span class="chip sim">${ic('chip')}SIMULATED SENSOR — test environment</span>`;
export const originChip = (origin: string) => origin === 'synthetic' ? html`<span class="chip sim" title="Synthetic demonstration data">Synthetic</span>` : origin === 'user_submitted' ? html`<span class="chip unknown">User-submitted</span>` : origin === 'imported' ? html`<span class="chip unknown">Imported</span>` : html`<span class="chip unknown">${origin}</span>`;
export const slaText = (sla: { state: string; remainingMin: number }, status: string): Raw => {
  if (status === 'closed' || status === 'cancelled') return html``;
  if (sla.state === 'met') return html`<span class="sla">${ic('check')} SLA met</span>`;
  if (sla.state === 'missed') return html`<span class="sla breach">${ic('alert')} SLA missed</span>`;
  if (sla.state === 'breached') return html`<span class="sla breach">${ic('alert')} SLA breached ${mins(sla.remainingMin)} ago</span>`;
  return html`<span class="sla ${sla.state === 'soon' ? 'soon' : ''}">${ic('clock')} SLA in ${mins(sla.remainingMin)}</span>`;
};

// ---- layout ----
export type Nav = { key: string; href: string; icon: string; label: string; perm?: Permission; badge?: number };
export type PageOpts = { title: string; role?: Role | null; userName?: string; orgName?: string; isDemo?: boolean; nav?: Nav[]; current?: string; csrf?: string; flash?: { kind: 'ok' | 'err'; text: string } | null; nonce?: string; bare?: boolean; simulatedEnv?: boolean; unread?: number; lang?: string; extraHead?: Part; scripts?: string[] };

export const consoleNav = (role: Role, badges: { reports?: number; alerts?: number } = {}): Nav[] => {
  const all: Nav[] = [
    { key: 'map', href: '/console/map', icon: 'map', label: 'Map', perm: 'asset.read' },
    { key: 'assets', href: '/console/assets', icon: 'list', label: 'Assets', perm: 'asset.read' },
    { key: 'reports', href: '/console/reports', icon: 'alert', label: 'Outage reports', perm: 'report.read', badge: badges.reports },
    { key: 'orders', href: '/console/orders', icon: 'board', label: 'Work orders', perm: 'wo.read' },
    { key: 'schedule', href: '/console/schedule', icon: 'cal', label: 'Planned work', perm: 'schedule.manage' },
    { key: 'sensors', href: '/console/sensors', icon: 'signal', label: 'Sensor health', perm: 'sensor.read', badge: badges.alerts },
    { key: 'analytics', href: '/console/analytics', icon: 'chart', label: 'Analytics', perm: 'analytics.read' },
    { key: 'audit', href: '/console/audit', icon: 'log', label: 'Audit log', perm: 'audit.read' },
    { key: 'users', href: '/console/admin/users', icon: 'users', label: 'Users', perm: 'user.manage' },
    { key: 'devices', href: '/console/admin/devices', icon: 'chip', label: 'Devices', perm: 'device.manage' },
    { key: 'settings', href: '/console/admin/settings', icon: 'cog', label: 'Settings', perm: 'settings.manage' }
  ];
  return all.filter((n) => !n.perm || can(role, n.perm));
};

export function page(o: PageOpts, body: Part): string {
  const nav = o.nav ?? [];
  const rail = nav.length ? html`<nav class="rail" aria-label="Console"><small>${o.orgName ?? ''}</small>${nav.map((n) => html`<a href="${n.href}" ${o.current === n.key ? raw('aria-current="page"') : ''}>${ic(n.icon)}${n.label}${n.badge ? html`<span class="badge" aria-label="${n.badge} new">${n.badge}</span>` : ''}</a>`)}</nav>` : '';
  const tabs = nav.length ? html`<nav class="mobtabs" aria-label="Console">${nav.map((n) => html`<a href="${n.href}" ${o.current === n.key ? raw('aria-current="page"') : ''}>${ic(n.icon)}${n.label.split(' ')[0]}${n.badge ? html`<span class="badge" aria-label="${n.badge} new">${n.badge}</span>` : ''}</a>`)}</nav>` : '';
  const top = o.bare ? '' : html`<header class="top"><a class="logo" href="/">${raw('<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--brand)"/><path d="M16 5c4 5 7 8.5 7 12.5a7 7 0 0 1-14 0C9 13.5 12 10 16 5z" fill="var(--on-brand)"/><path d="M10 19h12M12 22.5h8" stroke="var(--brand)" stroke-width="2"/></svg>')}WaterWatch</a>
    ${o.isDemo ? html`<span class="sim">Synthetic demonstration data</span>` : ''}${o.simulatedEnv ? html`<span class="sim">Test environment</span>` : ''}<span class="spacer"></span>
    ${o.role ? html`<a class="btn sm" href="/notifications" aria-label="Notifications${o.unread ? `, ${o.unread} unread` : ''}">${ic('bell')}${o.unread ? html`<span class="badge inline">${o.unread}</span>` : ''}</a><a class="btn sm" href="/account">${ic('user')}${o.userName}<span class="hint"> · ${roleLabel[o.role]}</span></a>
    <form method="post" action="/logout" class="inl"><input type="hidden" name="_csrf" value="${o.csrf ?? ''}"><button class="btn sm" type="submit">Sign out</button></form>` : ''}
    <button class="btn sm" type="button" id="theme-toggle" aria-label="Toggle light and dark theme">${ic('sun')} Theme</button></header>`;
  const flash = o.flash ? html`<div class="flash ${o.flash.kind}" role="${o.flash.kind === 'err' ? 'alert' : 'status'}">${o.flash.text}</div>` : '';
  const doc = html`<!doctype html><html lang="${o.lang ?? 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${o.title} · WaterWatch</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/console.css">${o.extraHead ?? ''}</head>
<body><a class="skip" href="#main">Skip to content</a>${raw(SPRITE)}${top}
${nav.length ? html`<div class="console">${rail}<main id="main" tabindex="-1">${flash}${body}</main></div>${tabs}` : html`<main id="main" tabindex="-1" class="${o.bare ? '' : 'plain'}">${flash}${body}</main>`}
<div id="live" class="sr" aria-live="polite"></div><div id="toasts" aria-live="polite"></div><dialog id="dlg"></dialog>
<script src="/js/app.js" defer></script>${(o.scripts ?? []).map((s) => html`<script src="${s}" defer></script>`)}</body></html>`;
  return doc.value;
}

// ---- forms ----
export const csrf = (token: string) => html`<input type="hidden" name="_csrf" value="${token}">`;
export const field = (id: string, label: string, input: Part, hint?: string) => html`<div class="field"><label for="${id}">${label}</label>${input}${hint ? html`<p class="hint">${hint}</p>` : ''}</div>`;
export const opt = (value: string, label: string, sel: boolean) => html`<option value="${value}" ${sel ? raw('selected') : ''}>${label}</option>`;

// ---- map (schematic SVG, no tiles) ----
export type MapAsset = { id: string; code: string; name: string; type: string; status: AssetStatus; lat: number; lng: number; has_sensor: number };
export function schematicMap(assets: MapAsset[], links: { from_asset: string; to_asset: string }[], selected: string | null, dim: Set<string>, small = false): Raw {
  const W = 640, H = 416, padX = 92, padY = 52;
  const lats = assets.map((a) => a.lat), lngs = assets.map((a) => a.lng);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats), minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
  const sx = (lng: number) => (maxLo === minLo ? W / 2 : padX + ((lng - minLo) / (maxLo - minLo)) * (W - 2 * padX));
  const sy = (lat: number) => (maxLa === minLa ? H / 2 : padY + ((maxLa - lat) / (maxLa - minLa)) * (H - 2 * padY));
  const pos = new Map(assets.map((a) => [a.id, { x: sx(a.lng), y: sy(a.lat) }]));
  const ls = links.map((l) => { const a = pos.get(l.from_asset), b = pos.get(l.to_asset); return a && b ? html`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="pipe"/>` : ''; });
  const labelOf = (a: MapAsset) => a.name.replace(/ \(.*/, '').slice(0, 28);
  // Label placement: try below, above, right, left, then farther below/above; take the first spot that clears every marker and every label already placed.
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const markerBoxes = new Map(assets.map((a) => { const p = pos.get(a.id) as { x: number; y: number }; return [a.id, { x0: p.x - 24, y0: p.y - 24, x1: p.x + 24, y1: p.y + 24 }] as [string, Box]; }));
  const placed: Box[] = [];
  const place = new Map<string, { anchor: string; dx: number; dy: number }>();
  if (!small) for (const a of [...assets].sort((p, q) => (pos.get(p.id) as { y: number }).y - (pos.get(q.id) as { y: number }).y || p.id.localeCompare(q.id))) {
    const p = pos.get(a.id) as { x: number; y: number }, w = labelOf(a).length * 6.6 + 6;
    const cands = [{ anchor: 'middle', dx: 0, dy: 36 }, { anchor: 'middle', dx: 0, dy: -26 }, { anchor: 'start', dx: 27, dy: 4 }, { anchor: 'end', dx: -27, dy: 4 }, { anchor: 'middle', dx: 0, dy: 52 }, { anchor: 'middle', dx: 0, dy: -42 }, { anchor: 'start', dx: 27, dy: 20 }, { anchor: 'end', dx: -27, dy: 20 }];
    const boxOf = (c: (typeof cands)[0]): Box => { const x = p.x + c.dx, x0 = c.anchor === 'middle' ? x - w / 2 : c.anchor === 'start' ? x : x - w; return { x0, y0: p.y + c.dy - 11, x1: x0 + w, y1: p.y + c.dy + 4 }; };
    const inside = (b: Box) => b.x0 >= 2 && b.x1 <= W - 2 && b.y0 >= 2 && b.y1 <= H - 2;
    const hits = (b: Box) => placed.filter((q) => overlap(b, q)).length + [...markerBoxes].filter(([id, q]) => id !== a.id && overlap(b, q)).length + (inside(b) ? 0 : 3);
    let best = cands[0] as (typeof cands)[0], bestHits = Infinity;
    for (const c of cands) { const h = hits(boxOf(c)); if (h < bestHits) { best = c; bestHits = h; } if (h === 0) break; }
    place.set(a.id, best); placed.push(boxOf(best));
  }
  const ms = assets.map((a) => { const p = pos.get(a.id) as { x: number; y: number }; const label = labelOf(a), lp = place.get(a.id);
    const name = a.name.includes(label) ? a.name : `${label}, ${a.name}`;
    return html`<a href="/console/map?asset=${a.id}" class="marker ${selected === a.id ? 'sel' : ''} ${dim.has(a.id) ? 'dim' : ''}" aria-label="${name}, ${STATUS_TEXT[a.status]}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})"><circle class="hit" r="22"/><circle class="ring" r="20"/><svg x="-14" y="-14" width="28" height="28" viewBox="0 0 24 24" class="stm ${STATUS_CLASS[a.status]}">${raw(SHAPES[a.status])}</svg>${a.has_sensor ? raw('<circle cx="13" cy="-13" r="4.5" class="sdot"/>') : ''}${small || !lp ? '' : html`<text x="${lp.dx}" y="${lp.dy}" text-anchor="${lp.anchor}" class="mlabel">${label}</text>`}</a>`; });
  return html`<svg class="map" viewBox="0 0 ${W} ${H}" role="group" aria-label="Schematic map of registered assets"><path d="M0 330C120 300 200 360 300 320S520 250 640 300V416H0Z" class="water"/><path d="M0 230C150 210 250 260 360 220S560 150 640 190" class="river"/>${ls}${ms}</svg>`;
}
export const mapLegend = () => html`<ul class="legend">${(['operational', 'degraded', 'down', 'contamination', 'unknown'] as AssetStatus[]).map((s) => html`<li>${stIcon(s, 18)} ${STATUS_TEXT[s]}</li>`)}<li><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" class="sdot"/></svg> Has sensor</li></ul>`;

// ---- charts (server-rendered SVG with data tables) ----
export function barChart(label: string, items: { label: string; value: number }[], unit = ''): Raw {
  const W = 420, H = 190, pl = 30, pb = 26, pt = 18, n = items.length || 1, max = Math.max(1, ...items.map((i) => i.value));
  const bw = (W - pl - 8) / n;
  const bars = items.map((it, i) => { const h = ((H - pb - pt) * it.value) / max, x = pl + i * bw + bw * 0.18, y = H - pb - h; return html`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" class="bar"/><text x="${(x + bw * 0.32).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="cv">${it.value}</text><text x="${(x + bw * 0.32).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="cl">${it.label}</text>`; });
  return html`<figure class="chart"><figcaption><b>${label}</b></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}. ${items.map((i) => `${i.label}: ${i.value}${unit}`).join(', ')}"><line x1="${pl}" y1="${H - pb}" x2="${W - 8}" y2="${H - pb}" class="axis"/>${bars}</svg>${dataTable(label, ['Period', unit || 'Value'], items.map((i) => [i.label, String(i.value)]))}</figure>`;
}
export function lineChart(label: string, items: { label: string; value: number | null }[], unit: string): Raw {
  const W = 420, H = 190, pl = 34, pb = 26, pt = 18, vals = items.filter((i) => i.value !== null).map((i) => i.value as number);
  const max = Math.max(1, ...vals) * 1.1, n = items.length;
  const X = (i: number) => pl + (n <= 1 ? 0 : (i * (W - pl - 14)) / (n - 1)), Y = (v: number) => H - pb - ((H - pb - pt) * v) / max;
  let d = '', gap = true;
  items.forEach((it, i) => { if (it.value === null) { gap = true; return; } d += `${gap ? 'M' : 'L'}${X(i).toFixed(1)} ${Y(it.value).toFixed(1)} `; gap = false; });
  const pts = items.map((it, i) => it.value === null ? '' : html`<circle cx="${X(i).toFixed(1)}" cy="${Y(it.value).toFixed(1)}" r="4" class="pt"/><text x="${X(i).toFixed(1)}" y="${(Y(it.value) - 8).toFixed(1)}" text-anchor="middle" class="cv">${it.value.toFixed(1)}</text>`);
  return html`<figure class="chart"><figcaption><b>${label}</b></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}. ${items.map((i) => `${i.label}: ${i.value === null ? 'no data' : i.value.toFixed(1) + ' ' + unit}`).join(', ')}"><line x1="${pl}" y1="${H - pb}" x2="${W - 8}" y2="${H - pb}" class="axis"/><path d="${d}" class="ln"/>${pts}${items.map((it, i) => html`<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="cl">${it.label}</text>`)}</svg>${dataTable(label, ['Week', unit], items.map((i) => [i.label, i.value === null ? 'no data' : i.value.toFixed(1)]))}</figure>`;
}
export function hbarChart(label: string, items: { label: string; value: number; text: string }[]): Raw {
  const max = Math.max(1, ...items.map((i) => i.value));
  return html`<figure class="chart"><figcaption><b>${label}</b></figcaption>${items.length ? html`<ul class="hbars" aria-label="${label}">${items.map((i) => html`<li><span class="hl">${i.label}</span><span class="hb"><svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect width="${((i.value / max) * 100).toFixed(1)}" height="10" class="bar"/></svg></span><span class="hv">${i.text}</span></li>`)}</ul>` : html`<p class="empty">No data in this period.</p>`}</figure>`;
}
const dataTable = (cap: string, head: string[], rows: string[][]) => html`<details class="dt"><summary>Data table</summary><table><caption class="sr">${cap}</caption><thead><tr>${head.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${rows.map((r) => html`<tr>${r.map((c, i) => (i === 0 ? html`<th scope="row">${c}</th>` : html`<td class="num">${c}</td>`))}</tr>`)}</tbody></table></details>`;

export function sparkline(label: string, series: { ts: number; value: number }[], from: number, to: number, state: string): Raw {
  const w = 300, h = 70, vals = series.map((s) => s.value);
  if (!vals.length) return html`<span class="sparkwrap"><span class="hint sparknote">No readings in this period</span></span>`;
  const mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1, span = to - from || 1;
  const X = (ts: number) => 6 + ((ts - from) / span) * (w - 12), Y = (v: number) => h - 8 - ((v - mn) / r) * (h - 16);
  const d = series.map((s, i) => `${i ? 'L' : 'M'}${X(s.ts).toFixed(1)} ${Y(s.value).toFixed(1)}`).join(' ');
  const last = series[series.length - 1] as { ts: number };
  const gap = state === 'missing' && X(last.ts) < w - 20 ? html`<rect x="${X(last.ts).toFixed(1)}" y="2" width="${(w - 6 - X(last.ts)).toFixed(1)}" height="${h - 4}" class="gap"/>` : '';
  const note = state === 'missing' ? 'Shaded: no readings since the last point.' : state === 'flatline' ? 'Flat-lined: identical values, sensor may be stuck.' : '';
  return html`<span class="sparkwrap"><svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}. ${series.length} readings, latest ${vals[vals.length - 1]}. Health: ${state}."><path d="${d}" class="ln"/>${gap}</svg><span class="hint sparknote">Range ${mn} to ${mx}${note ? html`. <b>${note}</b>` : ''}</span></span>`;
}

export const emptyState = (iconName: string, title: string, hint = '') => html`<div class="empty card">${ic(iconName)}<p><b>${title}</b></p>${hint ? html`<p class="hint">${hint}</p>` : ''}</div>`;
export { esc, html, raw };
