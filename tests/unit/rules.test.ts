import { describe, expect, it } from 'vitest';
import { TRANSITIONS, computeSla, pausedMs, validateTransition, roleMayTransition, defaultPriorityForCategory } from '../../src/domain/workorder.ts';
import { WO_STATUSES, type WoStatus } from '../../src/domain/types.ts';
import { deviceFlags, evaluateSensorHealth, type SensorHealthInput } from '../../src/domain/health.ts';
import { MATRIX, can, mfaRequired, PERMISSIONS } from '../../src/domain/rbac.ts';
import { ROLES } from '../../src/domain/types.ts';
import { settingsSchema, parseSettings } from '../../src/domain/settings.ts';

const MIN = 60_000, HOUR = 3_600_000;

describe('work-order state machine', () => {
  const ctx = (o: Partial<Parameters<typeof validateTransition>[2]> = {}) => ({ role: 'dispatcher' as const, hasAssignee: true, hasCompletionPhoto: true, ...o });
  it('allows exactly the documented transitions (exhaustive over all status pairs)', () => {
    for (const from of WO_STATUSES) for (const to of WO_STATUSES) {
      const r = validateTransition(from, to, ctx({ note: 'a valid reason' }));
      expect(r.ok, `${from}->${to}`).toBe(TRANSITIONS[from].includes(to));
    }
  });
  it('closed and cancelled are terminal', () => { expect(TRANSITIONS.closed).toEqual([]); expect(TRANSITIONS.cancelled).toEqual([]); });
  it('cannot leave New without an assignee', () => { expect(validateTransition('new', 'assigned', ctx({ hasAssignee: false })).ok).toBe(false); expect(validateTransition('new', 'assigned', ctx()).ok).toBe(true); });
  it('completion requires a photo', () => {
    const r = validateTransition('in_progress', 'completed', ctx({ role: 'technician', hasCompletionPhoto: false }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/photo/i) });
    expect(validateTransition('in_progress', 'completed', ctx({ role: 'technician' })).ok).toBe(true);
  });
  it('cancel and send-back need a reason of at least 5 characters', () => {
    expect(validateTransition('new', 'cancelled', ctx({ note: 'no' })).ok).toBe(false);
    expect(validateTransition('new', 'cancelled', ctx({ note: '     ' })).ok).toBe(false);
    expect(validateTransition('new', 'cancelled', ctx({ note: 'duplicate job' })).ok).toBe(true);
    expect(validateTransition('completed', 'in_progress', ctx({ note: 'x' })).ok).toBe(false);
    expect(validateTransition('completed', 'in_progress', ctx({ note: 'photo is blurry' })).ok).toBe(true);
  });
  it('technicians can only do their own working transitions; never confirm, cancel or assign', () => {
    const allowed = [['assigned', 'in_progress'], ['in_progress', 'awaiting_parts'], ['awaiting_parts', 'in_progress'], ['in_progress', 'completed']];
    for (const from of WO_STATUSES) for (const to of WO_STATUSES) expect(roleMayTransition('technician', from, to)).toBe(allowed.some(([a, b]) => a === from && b === to));
  });
  it('reporters, auditors and platform admins can never transition', () => { for (const r of ['reporter', 'auditor', 'platform_admin'] as const) for (const f of WO_STATUSES) for (const t of WO_STATUSES) expect(roleMayTransition(r, f, t)).toBe(false); });
  it('contamination defaults to P1', () => { expect(defaultPriorityForCategory('contamination')).toBe('P1'); expect(defaultPriorityForCategory('no_water')).toBe('P2'); expect(defaultPriorityForCategory('access')).toBe('P3'); });
});

describe('SLA computation (hand-computed)', () => {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  it('P1 2h: 90 minutes in = 30 min remaining, state soon', () => {
    const r = computeSla({ startMs: start, minutes: 120, events: [], pauseAwaitingParts: false, nowMs: start + 90 * MIN });
    expect(r.remainingMin).toBe(30); expect(r.dueMs).toBe(start + 2 * HOUR); expect(r.state).toBe('soon');
  });
  it('ok with plenty of time, breached after the deadline', () => {
    expect(computeSla({ startMs: start, minutes: 1440, events: [], pauseAwaitingParts: false, nowMs: start + 60 * MIN }).state).toBe('ok');
    const b = computeSla({ startMs: start, minutes: 120, events: [], pauseAwaitingParts: false, nowMs: start + 150 * MIN });
    expect(b.state).toBe('breached'); expect(b.remainingMin).toBe(-30);
  });
  it('boundary: exactly at the due time is not yet breached', () => {
    expect(computeSla({ startMs: start, minutes: 120, events: [], pauseAwaitingParts: false, nowMs: start + 120 * MIN }).state).toBe('soon');
    expect(computeSla({ startMs: start, minutes: 120, events: [], pauseAwaitingParts: false, nowMs: start + 120 * MIN + 1000 }).state).toBe('breached');
  });
  it('finished work is judged at completion time', () => {
    expect(computeSla({ startMs: start, minutes: 120, events: [], pauseAwaitingParts: false, nowMs: start + 999 * HOUR, endMs: start + 119 * MIN }).state).toBe('met');
    expect(computeSla({ startMs: start, minutes: 120, events: [], pauseAwaitingParts: false, nowMs: start + 999 * HOUR, endMs: start + 121 * MIN }).state).toBe('missed');
  });
  it('awaiting-parts pause extends the deadline only when enabled', () => {
    const events = [{ ts: start + 30 * MIN, to_status: 'awaiting_parts' as WoStatus }, { ts: start + 90 * MIN, to_status: 'in_progress' as WoStatus }];
    const off = computeSla({ startMs: start, minutes: 120, events, pauseAwaitingParts: false, nowMs: start + 130 * MIN });
    expect(off.state).toBe('breached');
    const on = computeSla({ startMs: start, minutes: 120, events, pauseAwaitingParts: true, nowMs: start + 130 * MIN });
    expect(on.dueMs).toBe(start + 180 * MIN); expect(on.remainingMin).toBe(50); expect(on.pausedMin).toBe(60); expect(on.state).toBe('ok');
  });
  it('an open pause counts up to now', () => {
    expect(pausedMs([{ ts: 1000, to_status: 'awaiting_parts' }], 61_000)).toBe(60_000);
    expect(pausedMs([{ ts: 1000, to_status: 'awaiting_parts' }, { ts: 2000, to_status: 'in_progress' }, { ts: 5000, to_status: 'awaiting_parts' }, { ts: 6000, to_status: 'in_progress' }], 100_000)).toBe(2000);
    expect(pausedMs([], 5)).toBe(0);
  });
});

describe('sensor health rules', () => {
  const NOW = 10 * HOUR, base: SensorHealthInput = { kind: 'flow', expectedIntervalS: 900, minValid: 0, maxValid: 100, stuckCount: 5, createdAt: 0, recent: [{ ts: NOW - 5 * MIN, value: 10 }, { ts: NOW - 20 * MIN, value: 11 }], lastReadingAt: NOW - 5 * MIN };
  const s = { lateFactor: 1.25, missingFactor: 2 };
  const h = (o: Partial<SensorHealthInput>, now = NOW) => evaluateSensorHealth({ ...base, ...o }, now, s).state;
  it('reporting when recent', () => expect(h({})).toBe('reporting'));
  it('late between 1.25x and 2x the interval (15 min interval: >18.75 and <=30 min)', () => {
    expect(h({ lastReadingAt: NOW - 18 * MIN })).toBe('reporting');
    expect(h({ lastReadingAt: NOW - 19 * MIN })).toBe('late');
    expect(h({ lastReadingAt: NOW - 30 * MIN })).toBe('late');
  });
  it('missing beyond 2x the interval', () => { expect(h({ lastReadingAt: NOW - 31 * MIN })).toBe('missing'); expect(h({ lastReadingAt: NOW - 24 * HOUR + 1 })).toBe('missing'); });
  it('missing outranks out-of-range and flat-line', () => expect(h({ lastReadingAt: NOW - HOUR, recent: [{ ts: 0, value: 999 }] })).toBe('missing'));
  it('out of range above max and below min, null bounds ignored', () => {
    expect(h({ recent: [{ ts: NOW - MIN, value: 101 }] })).toBe('out_of_range');
    expect(h({ recent: [{ ts: NOW - MIN, value: -1 }] })).toBe('out_of_range');
    expect(h({ minValid: null, maxValid: null, recent: [{ ts: NOW - MIN, value: 1e9 }] })).toBe('reporting');
  });
  it('flat-lines after N identical readings, but not N-1 or varying values', () => {
    const rs = (vals: number[]) => vals.map((v, i) => ({ ts: NOW - (i + 1) * MIN, value: v }));
    expect(h({ recent: rs([4.2, 4.2, 4.2, 4.2, 4.2]) })).toBe('flatline');
    expect(h({ recent: rs([4.2, 4.2, 4.2, 4.2]) })).toBe('reporting');
    expect(h({ recent: rs([4.2, 4.2, 4.2, 4.2, 4.3]) })).toBe('reporting');
  });
  it('pump status may legitimately stay constant', () => expect(h({ kind: 'pump_status', recent: [1, 1, 1, 1, 1, 1].map((v, i) => ({ ts: NOW - i * MIN, value: v })) })).toBe('reporting'));
  it('no readings yet: unknown until 2x the interval after creation, then missing', () => {
    expect(h({ lastReadingAt: null, recent: [], createdAt: NOW - 10 * MIN })).toBe('unknown');
    expect(h({ lastReadingAt: null, recent: [], createdAt: NOW - 31 * MIN })).toBe('missing');
  });
  it('device flags for battery and signal', () => {
    expect(deviceFlags({ batteryPct: 15, rssiDbm: -110 }, 20, -105)).toEqual({ batteryLow: true, signalWeak: true });
    expect(deviceFlags({ batteryPct: 80, rssiDbm: -80 }, 20, -105)).toEqual({ batteryLow: false, signalWeak: false });
    expect(deviceFlags({ batteryPct: null, rssiDbm: null }, 20, -105)).toEqual({ batteryLow: false, signalWeak: false });
  });
});

describe('RBAC matrix', () => {
  it('every role/permission pair is explicit and platform admins have no tenant data permissions', () => {
    for (const r of ROLES) for (const p of PERMISSIONS) expect(typeof can(r, p)).toBe('boolean');
    const tenant = PERMISSIONS.filter((p) => !['org.manage', 'user.manage', 'audit.read'].includes(p));
    for (const p of tenant) expect(can('platform_admin', p), p).toBe(false);
  });
  it('reporters can only create and read their own reports', () => { expect([...MATRIX.reporter]).toEqual(['report.create', 'report.read_own']); });
  it('technicians cannot read all reports, costs, analytics, audit or devices', () => { for (const p of ['asset.read', 'report.read', 'wo.cost.read', 'analytics.read', 'audit.read', 'device.manage', 'user.manage', 'wo.create', 'wo.assign', 'wo.confirm'] as const) expect(can('technician', p), p).toBe(false); });
  it('auditors are read-only', () => { for (const p of PERMISSIONS) if (/write|create|assign|confirm|manage|import|update/.test(p)) expect(can('auditor', p), p).toBe(false); });
  it('only dispatchers and admins can see reporter contact details', () => { for (const r of ROLES) expect(can(r, 'report.reporter_contact')).toBe(r === 'dispatcher' || r === 'org_admin'); });
  it('MFA is required for privileged roles only', () => { expect(ROLES.filter(mfaRequired).sort()).toEqual(['dispatcher', 'org_admin', 'platform_admin']); });
});

describe('settings', () => {
  it('defaults are the documented placeholders', () => { const s = parseSettings(null); expect(s.slaMinutes).toEqual({ P1: 120, P2: 1440, P3: 4320 }); expect(s.slaPauseAwaitingParts).toBe(false); });
  it('falls back to defaults on corrupt JSON and rejects invalid bounds', () => {
    expect(parseSettings('{not json').ingestSkewSec).toBe(300);
    expect(settingsSchema.safeParse({ bounds: { minLat: 5, maxLat: 1, minLng: 0, maxLng: 1 } }).success).toBe(false);
    expect(settingsSchema.safeParse({ slaMinutes: { P1: 1, P2: 10, P3: 10 } }).success).toBe(false);
  });
});
