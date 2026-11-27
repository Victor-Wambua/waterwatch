import { badRequest, conflict, forbidden, notFound } from '../core/errors.ts';
import { computeSla, validateTransition, type SlaResult } from '../domain/workorder.ts';
import { COST_CATEGORIES, PRIORITIES, type CostCategory, type Priority, type WoKind, type WoStatus } from '../domain/types.ts';
import { getAsset, setAssetStatus } from './assets.ts';
import { getReport, type ReportRow } from './reports.ts';
import { audit, need, newId, nextRef, notify, usersWithRoles, type Ctx } from './ctx.ts';

export type WoRow = {
  id: string; org_id: string; ref: string; asset_id: string; title: string; description: string | null; priority: Priority; status: WoStatus; kind: WoKind;
  assignee_id: string | null; schedule_id: string | null; schedule_due: string | null; scheduled_for: number | null; sla_minutes: number; sla_pause_awaiting: number;
  fault_started_at: number; created_by: string | null; created_at: number; started_at: number | null; completed_at: number | null; closed_at: number | null; closed_by: string | null;
  completion_notes: string | null; completion_photo_id: string | null; cancel_reason: string | null; origin: string;
};
export type WoView = WoRow & { asset_name: string; asset_code: string; assignee_name: string | null; sla: SlaResult; cost_minor: number };

export const STATUS_LABEL_WO: Record<WoStatus, string> = { new: 'New', assigned: 'Assigned', in_progress: 'In progress', awaiting_parts: 'Awaiting parts', completed: 'Completed', closed: 'Closed (confirmed)', cancelled: 'Cancelled' };

const events = (ctx: Ctx, woId: string) => ctx.t.all<{ ts: number; to_status: WoStatus; from_status: string | null; note: string | null; actor_id: string | null }>(
  'SELECT ts, to_status, from_status, note, actor_id FROM wo_events WHERE org_id = :org AND wo_id = :w ORDER BY ts, rowid', { w: woId });
const costOf = (ctx: Ctx, woId: string) => ctx.t.get<{ c: number | null }>('SELECT SUM(qty * unit_cost_minor) AS c FROM wo_materials WHERE org_id = :org AND wo_id = :w', { w: woId })?.c ?? 0;

function decorate(ctx: Ctx, w: WoRow & { asset_name: string; asset_code: string; assignee_name: string | null }): WoView {
  const evs = events(ctx, w.id).map((e) => ({ ts: e.ts, to_status: e.to_status }));
  const ended = w.status === 'completed' || w.status === 'closed' ? w.completed_at : null;
  const sla = computeSla({ startMs: w.fault_started_at, minutes: w.sla_minutes, events: evs, pauseAwaitingParts: !!w.sla_pause_awaiting, nowMs: ctx.now, endMs: ended });
  return { ...w, sla, cost_minor: costOf(ctx, w.id) };
}

const SELECT_WO = `SELECT w.*, a.name AS asset_name, a.code AS asset_code, u.name AS assignee_name FROM work_orders w
  JOIN assets a ON a.id = w.asset_id AND a.org_id = :org LEFT JOIN users u ON u.id = w.assignee_id AND u.org_id = :org WHERE w.org_id = :org`;

export function listWorkOrders(ctx: Ctx, f: { status?: string; assigneeId?: string } = {}): WoView[] {
  const tech = ctx.actor.role === 'technician';
  if (tech) need(ctx, 'wo.read_assigned'); else need(ctx, 'wo.read');
  let sql = SELECT_WO;
  const p: Record<string, string> = {};
  if (tech) { sql += ' AND w.assignee_id = :me'; p['me'] = ctx.actor.id; }
  if (ctx.actor.scopeOwner) { sql += ' AND a.owner_name = :scope'; p['scope'] = ctx.actor.scopeOwner; }
  if (f.status) { sql += ' AND w.status = :st'; p['st'] = f.status; }
  if (f.assigneeId) { sql += ' AND w.assignee_id = :as'; p['as'] = f.assigneeId; }
  sql += ' ORDER BY w.created_at DESC LIMIT 1000';
  const rows = ctx.t.all<WoRow & { asset_name: string; asset_code: string; assignee_name: string | null }>(sql, p).map((w) => decorate(ctx, w));
  return rows;
}

export function getWorkOrder(ctx: Ctx, id: string): WoView {
  const tech = ctx.actor.role === 'technician';
  if (tech) need(ctx, 'wo.read_assigned'); else need(ctx, 'wo.read');
  let sql = SELECT_WO + ' AND w.id = :id';
  const p: Record<string, string> = { id };
  if (tech) { sql += ' AND w.assignee_id = :me'; p['me'] = ctx.actor.id; }
  if (ctx.actor.scopeOwner) { sql += ' AND a.owner_name = :scope'; p['scope'] = ctx.actor.scopeOwner; }
  const w = ctx.t.get<WoRow & { asset_name: string; asset_code: string; assignee_name: string | null }>(sql, p);
  if (!w) throw notFound('Work order not found');
  return decorate(ctx, w);
}

export const woEvents = events;
export const woMaterials = (ctx: Ctx, woId: string) => ctx.t.all<{ id: string; name: string; category: CostCategory; qty: number; unit_cost_minor: number }>(
  'SELECT id, name, category, qty, unit_cost_minor FROM wo_materials WHERE org_id = :org AND wo_id = :w ORDER BY created_at', { w: woId });
export const woReports = (ctx: Ctx, woId: string) => ctx.t.all<{ id: string; ref: string; category: string; text: string; photo_id: string | null }>(
  'SELECT id, ref, category, text, photo_id FROM reports WHERE org_id = :org AND work_order_id = :w', { w: woId });

function technicianOrNull(ctx: Ctx, id: string | null | undefined): string | null {
  if (!id) return null;
  const u = ctx.t.get<{ id: string }>("SELECT id FROM users WHERE org_id = :org AND id = :id AND role = 'technician' AND status = 'active'", { id });
  if (!u) throw badRequest('Choose an active technician from your organisation.');
  return u.id;
}

type CreateInput = { assetId: string; title: string; description?: string; priority: Priority; kind: WoKind; assigneeId?: string | null; scheduledFor?: number | null; faultStartedAt?: number; reportIds?: string[]; scheduleId?: string; scheduleDue?: string; origin?: string };

function insertWo(ctx: Ctx, i: CreateInput): string {
  const title = i.title.trim();
  if (title.length < 3 || title.length > 160) throw badRequest('Title must be 3-160 characters.');
  if (!(PRIORITIES as readonly string[]).includes(i.priority)) throw badRequest('Invalid priority.');
  getAsset({ ...ctx, actor: { ...ctx.actor, scopeOwner: null } }, i.assetId);
  const assignee = technicianOrNull(ctx, i.assigneeId);
  const id = newId();
  const status: WoStatus = assignee ? 'assigned' : 'new';
  ctx.t.run(`INSERT INTO work_orders (id, org_id, ref, asset_id, title, description, priority, status, kind, assignee_id, schedule_id, schedule_due, scheduled_for, sla_minutes, sla_pause_awaiting, fault_started_at, created_by, created_at, origin)
    VALUES (:id,:org,:ref,:a,:t,:d,:p,:s,:k,:as,:sid,:sdue,:sf,:sla,:pause,:fs,:cb,:now,:o)`,
    { id, ref: nextRef(ctx, 'WO'), a: i.assetId, t: title, d: (i.description ?? '').slice(0, 2000), p: i.priority, s: status, k: i.kind, as: assignee, sid: i.scheduleId ?? null, sdue: i.scheduleDue ?? null, sf: i.scheduledFor ?? null,
      sla: ctx.settings.slaMinutes[i.priority], pause: ctx.settings.slaPauseAwaitingParts ? 1 : 0, fs: i.faultStartedAt ?? ctx.now, cb: ctx.actor.id, now: ctx.now, o: i.origin ?? 'user_submitted' });
  ctx.t.run('INSERT INTO wo_events (id, org_id, wo_id, ts, actor_id, from_status, to_status, note) VALUES (:id,:org,:w,:ts,:a,NULL,:s,:n)', { id: newId(), w: id, ts: ctx.now, a: ctx.actor.id, s: status, n: 'Created' });
  audit(ctx, 'workorder.created', 'work_order', id, { priority: i.priority, kind: i.kind, asset: i.assetId, assignee });
  if (assignee) notify(ctx, [assignee], 'assignment', `New job assigned: ${title}`, `/tech/${id}`);
  return id;
}

export function createWorkOrder(ctx: Ctx, i: CreateInput): string {
  need(ctx, 'wo.create');
  return ctx.t.tx(() => insertWo(ctx, i));
}

/** Creates one work order from one or more triaged reports (same asset). Contamination is always P1. */
export function createFromReports(ctx: Ctx, input: { reportIds: string[]; priority?: Priority; assigneeId?: string | null; title?: string; description?: string }): string {
  need(ctx, 'wo.create');
  need(ctx, 'report.triage');
  if (!input.reportIds.length) throw badRequest('Select at least one report.');
  const reps: ReportRow[] = input.reportIds.map((id) => getReport(ctx, id));
  if (reps.some((r) => r.status !== 'new')) throw badRequest('Only new reports can be turned into a work order.');
  const assetId = reps[0]?.asset_id;
  if (!assetId || reps.some((r) => r.asset_id !== assetId)) throw badRequest('All selected reports must be for the same asset.');
  const contamination = reps.some((r) => r.category === 'contamination');
  const priority: Priority = contamination ? 'P1' : (input.priority ?? 'P2');
  const first = reps[0] as ReportRow;
  const defaultTitle = contamination ? 'Contamination response: isolate and sample' : `Fault report ${first.ref}: ${first.category.replace('_', ' ')}`;
  return ctx.t.tx(() => {
    const id = insertWo(ctx, {
      assetId, title: input.title?.trim() || defaultTitle, description: input.description ?? reps.map((r) => `${r.ref}: ${r.text}`).join('\n'), priority, kind: contamination ? 'contamination' : 'reactive',
      assigneeId: input.assigneeId, faultStartedAt: Math.min(...reps.map((r) => r.observed_at))
    });
    for (const r of reps) ctx.t.run("UPDATE reports SET status = 'linked', work_order_id = :w WHERE org_id = :org AND id = :id", { w: id, id: r.id });
    audit(ctx, 'report.linked_to_workorder', 'work_order', id, { reports: reps.map((r) => r.ref) });
    return id;
  });
}

export function assignWorkOrder(ctx: Ctx, id: string, assigneeId: string): void {
  need(ctx, 'wo.assign');
  const w = getWorkOrder(ctx, id);
  const tech = technicianOrNull(ctx, assigneeId);
  if (!tech) throw badRequest('Choose a technician.');
  if (!['new', 'assigned', 'in_progress', 'awaiting_parts'].includes(w.status)) throw conflict('This work order can no longer be reassigned.');
  ctx.t.tx(() => {
    ctx.t.run('UPDATE work_orders SET assignee_id = :a WHERE org_id = :org AND id = :id', { a: tech, id });
    if (w.status === 'new') {
      ctx.t.run("UPDATE work_orders SET status = 'assigned' WHERE org_id = :org AND id = :id", { id });
      ctx.t.run('INSERT INTO wo_events (id, org_id, wo_id, ts, actor_id, from_status, to_status, note) VALUES (:id,:org,:w,:ts,:a,:f,:s,:n)', { id: newId(), w: id, ts: ctx.now, a: ctx.actor.id, f: 'new', s: 'assigned', n: 'Assigned' });
    }
    audit(ctx, 'workorder.assigned', 'work_order', id, { from: w.assignee_id, to: tech });
    notify(ctx, [tech], 'assignment', `Job assigned: ${w.title}`, `/tech/${id}`);
  });
}

export type TransitionInput = { to: WoStatus; note?: string; photoId?: string | null; completionNotes?: string; restoreStatus?: 'operational' | 'degraded' | 'keep'; clearReason?: string };

export function transitionWorkOrder(ctx: Ctx, id: string, i: TransitionInput): void {
  const w = getWorkOrder(ctx, id); // technicians can only see their own, otherwise 404
  const isTech = ctx.actor.role === 'technician';
  if (isTech) need(ctx, 'wo.update_assigned');
  else if (i.to === 'closed') need(ctx, 'wo.confirm');
  else if (i.to === 'assigned') need(ctx, 'wo.assign');
  else need(ctx, 'wo.create');
  const photoId = i.photoId ?? w.completion_photo_id;
  if (i.photoId) {
    const ph = ctx.t.get<{ uploader_id: string; kind: string }>('SELECT uploader_id, kind FROM photos WHERE org_id = :org AND id = :id', { id: i.photoId });
    if (!ph || ph.kind !== 'completion' || (isTech && ph.uploader_id !== ctx.actor.id)) throw badRequest('Invalid completion photo.');
  }
  const v = validateTransition(w.status, i.to, { role: ctx.actor.role, hasAssignee: !!w.assignee_id, hasCompletionPhoto: !!photoId, note: i.note });
  if (!v.ok) throw badRequest(v.error);
  ctx.t.tx(() => {
    const sets: string[] = ['status = :to'];
    const p: Record<string, string | number | null> = { id, to: i.to };
    if (i.to === 'in_progress') {
      if (w.status === 'assigned') { sets.push('started_at = :now'); p['now'] = ctx.now; }
      if (w.status === 'completed') { sets.push('completed_at = NULL'); }
    }
    if (i.to === 'completed') { sets.push('completed_at = :now', 'completion_photo_id = :ph', 'completion_notes = :cn'); p['now'] = ctx.now; p['ph'] = photoId ?? null; p['cn'] = (i.completionNotes ?? '').slice(0, 2000); }
    if (i.to === 'closed') { sets.push('closed_at = :now', 'closed_by = :cb'); p['now'] = ctx.now; p['cb'] = ctx.actor.id; }
    if (i.to === 'cancelled') { sets.push('cancel_reason = :cr'); p['cr'] = (i.note ?? '').trim().slice(0, 300); }
    ctx.t.run(`UPDATE work_orders SET ${sets.join(', ')} WHERE org_id = :org AND id = :id`, p);
    ctx.t.run('INSERT INTO wo_events (id, org_id, wo_id, ts, actor_id, from_status, to_status, note) VALUES (:id,:org,:w,:ts,:a,:f,:s,:n)', { id: newId(), w: id, ts: ctx.now, a: ctx.actor.id, f: w.status, s: i.to, n: (i.note ?? '').slice(0, 300) || null });
    audit(ctx, `workorder.${i.to}`, 'work_order', id, { from: w.status, note: (i.note ?? '').slice(0, 300) });
    if (i.to === 'completed') {
      syncMaintenanceRecord(ctx, id);
      notify(ctx, usersWithRoles(ctx, ['dispatcher', 'org_admin']), 'completed', `Work order ${w.ref} completed, confirmation needed`, `/console/orders/${id}`);
    }
    if (i.to === 'closed') {
      syncMaintenanceRecord(ctx, id);
      const restore = i.restoreStatus ?? 'keep';
      if (restore !== 'keep') {
        const a = getAsset({ ...ctx, actor: { ...ctx.actor, scopeOwner: null } }, w.asset_id);
        if (a.status === 'contamination' && (i.clearReason ?? '').trim().length < 5) throw badRequest('A recorded reason (e.g. lab reference or inspection result, at least 5 characters) is required to clear a contamination alert.');
        setAssetStatus(ctx, w.asset_id, restore, i.clearReason ?? `Restored after work order ${w.ref}`);
      }
    }
    if (i.to === 'in_progress' && w.status === 'completed' && w.assignee_id) notify(ctx, [w.assignee_id], 'reopened', `Work order ${w.ref} sent back: ${(i.note ?? '').slice(0, 80)}`, `/tech/${id}`);
  });
}

function syncMaintenanceRecord(ctx: Ctx, woId: string): void {
  const w = getWorkOrder({ ...ctx, actor: { ...ctx.actor, role: 'dispatcher', scopeOwner: null } }, woId);
  if (w.completed_at === null) return;
  const date = new Date((w.completed_at as number) + ctx.settings.tzOffsetMin * 60000).toISOString().slice(0, 10);
  const by = w.assignee_name ?? 'Unassigned';
  const summary = `${w.ref}: ${w.title}${w.completion_notes ? ' - ' + w.completion_notes.slice(0, 120) : ''}`.slice(0, 300);
  const ex = ctx.t.get<{ id: string }>('SELECT id FROM maintenance_records WHERE org_id = :org AND work_order_id = :w', { w: woId });
  if (ex) ctx.t.run('UPDATE maintenance_records SET cost_minor = :c, summary = :s, performed_on = :d WHERE org_id = :org AND id = :id', { id: ex.id, c: w.cost_minor, s: summary, d: date });
  else ctx.t.run('INSERT INTO maintenance_records (id, org_id, asset_id, work_order_id, performed_on, summary, performed_by, cost_minor, created_at) VALUES (:id,:org,:a,:w,:d,:s,:p,:c,:now)', { id: newId(), a: w.asset_id, w: woId, d: date, s: summary, p: by, c: w.cost_minor, now: ctx.now });
}

export function parseKesToMinor(s: string): number {
  const t = s.trim().replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) throw badRequest('Enter an amount in KES like 1850 or 1850.50.');
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
export const formatKes = (minor: number) => `KES ${(minor / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function addMaterial(ctx: Ctx, woId: string, i: { name: string; category: string; qty: number; unitCostMinor: number }): void {
  const w = getWorkOrder(ctx, woId);
  if (ctx.actor.role === 'technician') need(ctx, 'wo.update_assigned'); else need(ctx, 'wo.create');
  if (['closed', 'cancelled'].includes(w.status)) throw conflict('Costs cannot be added to a closed or cancelled work order.');
  if (!(COST_CATEGORIES as readonly string[]).includes(i.category)) throw badRequest('Choose a cost category.');
  if (i.name.trim().length < 2 || i.name.length > 120) throw badRequest('Item name must be 2-120 characters.');
  if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 100000) throw badRequest('Quantity must be at least 1.');
  if (!Number.isInteger(i.unitCostMinor) || i.unitCostMinor < 0 || i.unitCostMinor > 10_000_000_000) throw badRequest('Unit cost must be zero or more.');
  ctx.t.tx(() => {
    ctx.t.run('INSERT INTO wo_materials (id, org_id, wo_id, name, category, qty, unit_cost_minor, created_by, created_at) VALUES (:id,:org,:w,:n,:c,:q,:u,:cb,:now)',
      { id: newId(), w: woId, n: i.name.trim(), c: i.category, q: i.qty, u: i.unitCostMinor, cb: ctx.actor.id, now: ctx.now });
    audit(ctx, 'workorder.cost_added', 'work_order', woId, { item: i.name.trim(), qty: i.qty, unitCostMinor: i.unitCostMinor, category: i.category });
    if (w.status === 'completed') syncMaintenanceRecord(ctx, woId);
  });
}

// ---- planned maintenance ----
export type ScheduleRow = { id: string; asset_id: string; title: string; interval_days: number; next_due: string; priority: Priority; active: number; asset_name: string };
export const PLANNED_LEAD_DAYS = 7;
const MAX_CATCHUP = 3;

export function listSchedules(ctx: Ctx): ScheduleRow[] {
  need(ctx, 'schedule.manage');
  return ctx.t.all<ScheduleRow>('SELECT s.id, s.asset_id, s.title, s.interval_days, s.next_due, s.priority, s.active, a.name AS asset_name FROM maintenance_schedules s JOIN assets a ON a.id = s.asset_id AND a.org_id = :org WHERE s.org_id = :org ORDER BY s.next_due');
}
export function createSchedule(ctx: Ctx, i: { assetId: string; title: string; intervalDays: number; firstDue: string; priority: Priority }): string {
  need(ctx, 'schedule.manage');
  getAsset({ ...ctx, actor: { ...ctx.actor, scopeOwner: null } }, i.assetId);
  if (i.title.trim().length < 3 || i.title.length > 160) throw badRequest('Title must be 3-160 characters.');
  if (!Number.isInteger(i.intervalDays) || i.intervalDays < 1 || i.intervalDays > 3650) throw badRequest('Interval must be 1-3650 days.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.firstDue) || Number.isNaN(Date.parse(i.firstDue))) throw badRequest('First due date must be YYYY-MM-DD.');
  if (!(PRIORITIES as readonly string[]).includes(i.priority)) throw badRequest('Invalid priority.');
  const id = newId();
  ctx.t.run('INSERT INTO maintenance_schedules (id, org_id, asset_id, title, interval_days, next_due, priority, created_by, created_at) VALUES (:id,:org,:a,:t,:iv,:d,:p,:cb,:now)', { id, a: i.assetId, t: i.title.trim(), iv: i.intervalDays, d: i.firstDue, p: i.priority, cb: ctx.actor.id, now: ctx.now });
  audit(ctx, 'schedule.created', 'schedule', id, { asset: i.assetId, intervalDays: i.intervalDays });
  return id;
}
export function setScheduleActive(ctx: Ctx, id: string, active: boolean): void {
  need(ctx, 'schedule.manage');
  if (ctx.t.run('UPDATE maintenance_schedules SET active = :a WHERE org_id = :org AND id = :id', { a: active ? 1 : 0, id }).changes === 0) throw notFound();
  audit(ctx, active ? 'schedule.activated' : 'schedule.paused', 'schedule', id);
}

const addDays = (isoDate: string, n: number) => new Date(Date.parse(isoDate + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** Generates work orders for schedules due within the lead window. Idempotent: unique (schedule_id, schedule_due). */
export function generatePlannedWork(ctx: Ctx): number {
  need(ctx, 'schedule.manage');
  const today = new Date(ctx.now + ctx.settings.tzOffsetMin * 60000).toISOString().slice(0, 10);
  const horizon = addDays(today, PLANNED_LEAD_DAYS);
  const sched = ctx.t.all<{ id: string; asset_id: string; title: string; interval_days: number; next_due: string; priority: Priority }>('SELECT id, asset_id, title, interval_days, next_due, priority FROM maintenance_schedules WHERE org_id = :org AND active = 1 AND next_due <= :h', { h: horizon });
  let made = 0;
  for (const s of sched) {
    let due = s.next_due, n = 0;
    ctx.t.tx(() => {
      while (due <= horizon && n < MAX_CATCHUP + 1) {
        const exists = ctx.t.get('SELECT 1 AS x FROM work_orders WHERE org_id = :org AND schedule_id = :s AND schedule_due = :d', { s: s.id, d: due });
        if (!exists) {
          const dueMs = Date.parse(due + 'T00:00:00Z') - ctx.settings.tzOffsetMin * 60000;
          insertWo(ctx, { assetId: s.asset_id, title: s.title, description: `Planned maintenance due ${due}`, priority: s.priority, kind: 'planned', scheduledFor: dueMs, faultStartedAt: dueMs, scheduleId: s.id, scheduleDue: due });
          made++;
        }
        due = addDays(due, s.interval_days);
        n++;
      }
      ctx.t.run('UPDATE maintenance_schedules SET next_due = :d WHERE org_id = :org AND id = :id', { d: due, id: s.id });
    });
  }
  if (made) audit(ctx, 'schedule.generated', 'schedule', undefined, { count: made });
  return made;
}

export function assertCanSeeWo(ctx: Ctx, id: string): void { if (!getWorkOrder(ctx, id)) throw forbidden(); }
