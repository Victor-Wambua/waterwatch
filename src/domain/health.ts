import type { SensorKind } from './types.ts';

export type HealthState = 'reporting' | 'late' | 'missing' | 'out_of_range' | 'flatline' | 'unknown';
export type SensorHealthInput = {
  kind: SensorKind; expectedIntervalS: number; minValid: number | null; maxValid: number | null; stuckCount: number; createdAt: number;
  /** newest first */ recent: { ts: number; value: number }[];
  lastReadingAt: number | null;
};
export type HealthSettings = { lateFactor: number; missingFactor: number };
export type HealthResult = { state: HealthState; reason: string };

const FLAT_EPS = 1e-9;

/** Pure sensor-health rules. Precedence: missing > out_of_range > flatline > late > reporting. */
export function evaluateSensorHealth(i: SensorHealthInput, now: number, s: HealthSettings): HealthResult {
  const intervalMs = i.expectedIntervalS * 1000;
  if (i.lastReadingAt === null) {
    return now - i.createdAt > s.missingFactor * intervalMs
      ? { state: 'missing', reason: 'No readings received since the sensor was registered.' }
      : { state: 'unknown', reason: 'Waiting for the first reading.' };
  }
  const age = now - i.lastReadingAt;
  if (age > s.missingFactor * intervalMs) return { state: 'missing', reason: `No reading for ${Math.round(age / 60000)} min (expected every ${Math.round(i.expectedIntervalS / 60)} min).` };
  const latest = i.recent[0];
  if (latest && ((i.minValid !== null && latest.value < i.minValid) || (i.maxValid !== null && latest.value > i.maxValid))) {
    return { state: 'out_of_range', reason: `Latest value ${latest.value} is outside the valid range ${i.minValid ?? '-inf'}..${i.maxValid ?? 'inf'}.` };
  }
  if (i.kind !== 'pump_status' && i.recent.length >= i.stuckCount && i.stuckCount >= 3) {
    const win = i.recent.slice(0, i.stuckCount);
    const first = win[0]?.value as number;
    if (win.every((r) => Math.abs(r.value - first) <= FLAT_EPS)) return { state: 'flatline', reason: `Last ${i.stuckCount} readings are identical (${first}); sensor may be stuck.` };
  }
  if (age > s.lateFactor * intervalMs) return { state: 'late', reason: `Last reading ${Math.round(age / 60000)} min ago (expected every ${Math.round(i.expectedIntervalS / 60)} min).` };
  return { state: 'reporting', reason: 'Reporting normally.' };
}

export type DeviceFlags = { batteryLow: boolean; signalWeak: boolean };
export function deviceFlags(d: { batteryPct: number | null; rssiDbm: number | null }, batteryLowPct: number, rssiWeakDbm: number): DeviceFlags {
  return { batteryLow: d.batteryPct !== null && d.batteryPct <= batteryLowPct, signalWeak: d.rssiDbm !== null && d.rssiDbm <= rssiWeakDbm };
}

export const HEALTH_LABEL: Record<HealthState, string> = { reporting: 'Reporting', late: 'Late', missing: 'Missing readings', out_of_range: 'Out of range', flatline: 'Flat-lined', unknown: 'Awaiting first reading' };
/** Health states that indicate a probable sensor/instrument failure and justify a work-order suggestion. */
export const FAILURE_STATES: readonly HealthState[] = ['missing', 'out_of_range', 'flatline'];
