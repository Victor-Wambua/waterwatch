import { OUTAGE_CATEGORIES } from './types.ts';

const HOUR = 3600000, DAY = 86400000;

/** Start (UTC ms) of the local Monday-based week containing ts, for a fixed UTC offset in minutes. */
export function weekStart(ts: number, offsetMin: number): number {
  const local = ts + offsetMin * 60000;
  const dayIdx = Math.floor(local / DAY);
  const dow = (dayIdx + 3) % 7; // 1970-01-01 was Thursday; Monday=0
  return (dayIdx - dow) * DAY - offsetMin * 60000;
}
export const localDay = (ts: number, offsetMin: number): string => new Date(ts + offsetMin * 60000).toISOString().slice(0, 10);
export function weekLabel(startMs: number, offsetMin: number): string {
  return localDay(startMs + offsetMin * 60000 + 1, 0).slice(5); // MM-DD of week start (local)
}
function weeksBetween(from: number, to: number, offsetMin: number): number[] {
  const out: number[] = [];
  for (let w = weekStart(from, offsetMin); w <= to; w += 7 * DAY) out.push(w);
  return out;
}

export type ReportRow = { category: string; status: string; created_at: number };
export function outagesPerWeek(reports: ReportRow[], from: number, to: number, offsetMin: number) {
  const buckets = new Map(weeksBetween(from, to, offsetMin).map((w) => [w, 0]));
  for (const r of reports) {
    if (r.status === 'duplicate' || r.status === 'rejected') continue;
    if (!(OUTAGE_CATEGORIES as readonly string[]).includes(r.category)) continue;
    if (r.created_at < from || r.created_at > to) continue;
    const w = weekStart(r.created_at, offsetMin);
    buckets.set(w, (buckets.get(w) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([start, count]) => ({ start, label: weekLabel(start, offsetMin), count }));
}

export type WoRow = { id: string; asset_id: string; title: string; kind: string; status: string; priority: string; created_at: number; fault_started_at: number; completed_at: number | null; sla_met?: boolean | null };
const REPAIR_KINDS = ['reactive', 'contamination', 'sensor'];
const isDone = (w: WoRow) => (w.status === 'completed' || w.status === 'closed') && w.completed_at !== null;

export function mttr(wos: WoRow[], from: number, to: number, offsetMin: number) {
  const done = wos.filter((w) => REPAIR_KINDS.includes(w.kind) && isDone(w) && (w.completed_at as number) >= from && (w.completed_at as number) <= to);
  const hours = done.map((w) => ((w.completed_at as number) - w.fault_started_at) / HOUR);
  const mean = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
  const sorted = [...hours].sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? (sorted[(sorted.length - 1) / 2] as number) : ((sorted[sorted.length / 2 - 1] as number) + (sorted[sorted.length / 2] as number)) / 2) : null;
  const byWeek = new Map(weeksBetween(from, to, offsetMin).map((w) => [w, [] as number[]]));
  for (const w of done) byWeek.get(weekStart(w.completed_at as number, offsetMin))?.push(((w.completed_at as number) - w.fault_started_at) / HOUR);
  return {
    count: done.length, meanHours: mean, medianHours: median,
    weekly: [...byWeek.entries()].map(([start, hs]) => ({ start, label: weekLabel(start, offsetMin), count: hs.length, meanHours: hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null }))
  };
}

export function repeatFailures(wos: WoRow[], from: number, to: number, minCount = 2) {
  const by = new Map<string, WoRow[]>();
  for (const w of wos) {
    if (!REPAIR_KINDS.includes(w.kind) || w.kind === 'sensor' || w.status === 'cancelled') continue;
    if (w.created_at < from || w.created_at > to) continue;
    by.set(w.asset_id, [...(by.get(w.asset_id) ?? []), w]);
  }
  return [...by.entries()].filter(([, l]) => l.length >= minCount).map(([assetId, l]) => {
    const freq = new Map<string, number>();
    for (const w of l) freq.set(w.title, (freq.get(w.title) ?? 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { assetId, count: l.length, commonJob: top?.[0] ?? '' };
  }).sort((a, b) => b.count - a.count || a.assetId.localeCompare(b.assetId));
}

/** Downtime = union of [fault_started_at, completed_at|now] for reactive/contamination work orders, clipped to the window. */
export function downtimeByAsset(wos: WoRow[], from: number, to: number, now: number) {
  const by = new Map<string, [number, number][]>();
  for (const w of wos) {
    if (!(w.kind === 'reactive' || w.kind === 'contamination') || w.status === 'cancelled') continue;
    const start = Math.max(w.fault_started_at, from);
    const end = Math.min(isDone(w) ? (w.completed_at as number) : now, to);
    if (end <= start) continue;
    by.set(w.asset_id, [...(by.get(w.asset_id) ?? []), [start, end]]);
  }
  const out: { assetId: string; hours: number; ongoing: boolean }[] = [];
  for (const [assetId, iv] of by) {
    iv.sort((a, b) => a[0] - b[0]);
    let total = 0, curS = (iv[0] as [number, number])[0], curE = (iv[0] as [number, number])[1];
    for (const [s, e] of iv.slice(1)) { if (s <= curE) curE = Math.max(curE, e); else { total += curE - curS; curS = s; curE = e; } }
    total += curE - curS;
    out.push({ assetId, hours: total / HOUR, ongoing: wos.some((w) => w.asset_id === assetId && !isDone(w) && w.status !== 'cancelled' && (w.kind === 'reactive' || w.kind === 'contamination')) });
  }
  return out.sort((a, b) => b.hours - a.hours || a.assetId.localeCompare(b.assetId));
}

export function availability(downtimeHours: number, from: number, to: number): number {
  const total = (to - from) / HOUR;
  return total <= 0 ? 1 : Math.max(0, 1 - downtimeHours / total);
}

export type MaterialRow = { asset_id: string; category: string; qty: number; unit_cost_minor: number };
export function costSummary(rows: MaterialRow[]) {
  const byCat = new Map<string, number>(), byAsset = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const c = r.qty * r.unit_cost_minor;
    total += c;
    byCat.set(r.category, (byCat.get(r.category) ?? 0) + c);
    byAsset.set(r.asset_id, (byAsset.get(r.asset_id) ?? 0) + c);
  }
  return { totalMinor: total, byCategory: [...byCat.entries()].map(([category, minor]) => ({ category, minor })).sort((a, b) => b.minor - a.minor || a.category.localeCompare(b.category)), byAsset: [...byAsset.entries()].map(([assetId, minor]) => ({ assetId, minor })).sort((a, b) => b.minor - a.minor || a.assetId.localeCompare(b.assetId)) };
}

export function slaCompliance(wos: { sla_met: boolean | null }[]) {
  const judged = wos.filter((w) => w.sla_met !== null);
  const met = judged.filter((w) => w.sla_met).length;
  return { judged: judged.length, met, pct: judged.length ? met / judged.length : null };
}

/**
 * Volume from flow readings (m3/h): rectangle rule, each reading holds until the next one, but never longer than
 * 2x the expected interval. Time beyond that is reported as an unmetered gap and NOT estimated.
 */
export function flowVolume(readings: { ts: number; value: number }[], expectedIntervalS: number, offsetMin: number) {
  const r = [...readings].sort((a, b) => a.ts - b.ts);
  const cap = 2 * expectedIntervalS * 1000;
  const days = new Map<string, { m3: number; gapHours: number }>();
  let total = 0, gap = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const a = r[i] as { ts: number; value: number }, b = r[i + 1] as { ts: number; value: number };
    const dt = b.ts - a.ts, used = Math.min(dt, cap), vol = (a.value * used) / HOUR, g = Math.max(0, dt - cap) / HOUR;
    const d = localDay(a.ts, offsetMin), cur = days.get(d) ?? { m3: 0, gapHours: 0 };
    cur.m3 += vol; cur.gapHours += g; days.set(d, cur);
    total += vol; gap += g;
  }
  return { totalM3: total, gapHours: gap, daily: [...days.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)) };
}
