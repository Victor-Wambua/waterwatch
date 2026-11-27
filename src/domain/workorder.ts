import type { Priority, Role, WoStatus } from './types.ts';

export const TRANSITIONS: Record<WoStatus, readonly WoStatus[]> = {
  new: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['awaiting_parts', 'completed', 'cancelled'],
  awaiting_parts: ['in_progress', 'cancelled'],
  completed: ['closed', 'in_progress'],
  closed: [],
  cancelled: []
};

/** Which roles may perform which transition (technician only on own work orders - checked by the caller). */
const TECH_ALLOWED: ReadonlySet<string> = new Set(['assigned>in_progress', 'in_progress>awaiting_parts', 'awaiting_parts>in_progress', 'in_progress>completed']);
export function roleMayTransition(role: Role, from: WoStatus, to: WoStatus): boolean {
  if (role === 'technician') return TECH_ALLOWED.has(`${from}>${to}`);
  if (role === 'dispatcher' || role === 'org_admin') return true;
  return false;
}

export type TransitionCtx = { role: Role; hasAssignee: boolean; hasCompletionPhoto: boolean; note?: string };
export type TransitionResult = { ok: true } | { ok: false; error: string };
export function validateTransition(from: WoStatus, to: WoStatus, ctx: TransitionCtx): TransitionResult {
  if (!TRANSITIONS[from].includes(to)) return { ok: false, error: `Cannot move a work order from ${from} to ${to}.` };
  if (!roleMayTransition(ctx.role, from, to)) return { ok: false, error: 'Your role may not make this change.' };
  if (to === 'assigned' && !ctx.hasAssignee) return { ok: false, error: 'Assign a technician before moving this work order out of New.' };
  if (to === 'completed' && !ctx.hasCompletionPhoto) return { ok: false, error: 'A completion photo is required to mark a work order complete.' };
  if (to === 'cancelled' && (ctx.note ?? '').trim().length < 5) return { ok: false, error: 'A reason of at least 5 characters is required to cancel.' };
  if (from === 'completed' && to === 'in_progress' && (ctx.note ?? '').trim().length < 5) return { ok: false, error: 'A reason of at least 5 characters is required to send completed work back.' };
  return { ok: true };
}

export type SlaEvent = { ts: number; to_status: WoStatus };
export type SlaInput = { startMs: number; minutes: number; events: SlaEvent[]; pauseAwaitingParts: boolean; nowMs: number; endMs?: number | null };
export type SlaState = 'ok' | 'soon' | 'breached' | 'met' | 'missed';
export type SlaResult = { dueMs: number; remainingMin: number; state: SlaState; pausedMin: number };

/** Total time spent in awaiting_parts up to `upTo`. */
export function pausedMs(events: SlaEvent[], upTo: number): number {
  const evs = [...events].sort((a, b) => a.ts - b.ts);
  let paused = 0, since: number | null = null;
  for (const e of evs) {
    if (e.ts > upTo) break;
    if (e.to_status === 'awaiting_parts') since ??= e.ts;
    else if (since !== null) { paused += e.ts - since; since = null; }
  }
  if (since !== null) paused += Math.max(0, upTo - since);
  return paused;
}

export function computeSla(i: SlaInput): SlaResult {
  const ref = i.endMs ?? i.nowMs;
  const paused = i.pauseAwaitingParts ? pausedMs(i.events, ref) : 0;
  const dueMs = i.startMs + i.minutes * 60000 + paused;
  const remainingMin = Math.round(((dueMs - ref) / 60000) * 100) / 100;
  let state: SlaState;
  if (i.endMs != null) state = i.endMs <= dueMs ? 'met' : 'missed';
  else if (remainingMin < 0) state = 'breached';
  else if (remainingMin <= Math.min(30, i.minutes * 0.25)) state = 'soon';
  else state = 'ok';
  return { dueMs, remainingMin, state, pausedMin: Math.round(paused / 60000) };
}

export const defaultPriorityForCategory = (category: string): Priority => (category === 'contamination' ? 'P1' : category === 'no_water' || category === 'pump_failure' ? 'P2' : 'P3');
