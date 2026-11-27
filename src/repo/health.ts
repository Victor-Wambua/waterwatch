import type { DatabaseSync } from 'node:sqlite';
import { SystemDb, TenantDb } from '../db/index.ts';
import { deviceFlags, evaluateSensorHealth, FAILURE_STATES, HEALTH_LABEL, type HealthState } from '../domain/health.ts';
import { appendAudit } from '../domain/audit.ts';
import { parseSettings } from '../domain/settings.ts';
import type { Priority, SensorKind } from '../domain/types.ts';
import { newId } from './ctx.ts';

type SensorRow = { id: string; device_id: string; asset_id: string | null; key: string; kind: SensorKind; expected_interval_s: number; min_valid: number | null; max_valid: number | null; stuck_count: number; created_at: number; last_reading_at: number | null; health: string; origin: 'real' | 'simulated'; battery_pct: number | null; rssi_dbm: number | null; device_name: string };

export type HealthCycleResult = { sensors: number; opened: number; resolved: number };

/**
 * Evaluates every enabled sensor of every organisation, updates sensor health, and opens/resolves alerts.
 * Missing / flat-lined / out-of-range sensors also carry a work-order SUGGESTION (a person decides). Asset status is never changed automatically.
 */
export function runHealthCycle(db: DatabaseSync, now: number): HealthCycleResult {
  const sys = new SystemDb(db);
  const res: HealthCycleResult = { sensors: 0, opened: 0, resolved: 0 };
  for (const org of sys.all<{ id: string; settings: string }>('SELECT id, settings FROM organisations')) {
    const t = new TenantDb(db, org.id);
    const settings = parseSettings(org.settings);
    const sensors = t.all<SensorRow>(`SELECT s.id, s.device_id, s.asset_id, s.key, s.kind, s.expected_interval_s, s.min_valid, s.max_valid, s.stuck_count, s.created_at, s.last_reading_at, s.health,
      d.origin, d.battery_pct, d.rssi_dbm, d.name AS device_name FROM sensors s JOIN devices d ON d.id = s.device_id AND d.org_id = :org WHERE s.org_id = :org AND s.enabled = 1 AND d.status = 'active'`);
    const wanted = new Set<string>();
    const open = (kind: string, severity: string, key: string, s: SensorRow | null, deviceId: string, assetId: string | null, title: string, detail: string, suggest: Priority | null, origin: string) => {
      const dedupe = `${kind}:${key}`;
      wanted.add(dedupe);
      const r = t.run(`INSERT OR IGNORE INTO alerts (id, org_id, kind, severity, sensor_id, device_id, asset_id, dedupe_key, state, title, detail, suggested_priority, opened_at, origin)
        VALUES (:id,:org,:k,:sev,:s,:d,:a,:dk,'open',:t,:det,:sp,:now,:o)`, { id: newId(), k: kind, sev: severity, s: s?.id ?? null, d: deviceId, a: assetId, dk: dedupe, t: title, det: detail, sp: suggest, now, o: origin });
      if (r.changes) {
        res.opened++;
        appendAudit(db, now, { orgId: org.id, actor: null, action: 'alert.opened', objectType: 'alert', objectId: dedupe, detail: { kind, title } });
      } else t.run('UPDATE alerts SET detail = :det WHERE org_id = :org AND dedupe_key = :dk AND state <> \'resolved\'', { det: detail, dk: dedupe });
    };
    for (const s of sensors) {
      res.sensors++;
      const recent = t.all<{ ts: number; value: number }>('SELECT ts, value FROM readings WHERE org_id = :org AND sensor_id = :s ORDER BY ts DESC LIMIT :n', { s: s.id, n: s.stuck_count });
      const h = evaluateSensorHealth({ kind: s.kind, expectedIntervalS: s.expected_interval_s, minValid: s.min_valid, maxValid: s.max_valid, stuckCount: s.stuck_count, createdAt: s.created_at, recent, lastReadingAt: s.last_reading_at }, now, { lateFactor: settings.healthLateFactor, missingFactor: settings.healthMissingFactor });
      if (h.state !== s.health) t.run('UPDATE sensors SET health = :h, health_changed_at = :now WHERE org_id = :org AND id = :id', { h: h.state, now, id: s.id });
      const label = `${s.device_name} / ${s.key}`;
      const originTag = s.origin === 'simulated' ? 'simulated' : 'real';
      if (FAILURE_STATES.includes(h.state)) open(`sensor_${h.state}`, h.state === 'missing' ? 'high' : 'medium', s.id, s, s.device_id, s.asset_id, `${label}: ${HEALTH_LABEL[h.state as HealthState]}`, h.reason, 'P3', originTag);
      else if (h.state === 'late') open('sensor_late', 'low', s.id, s, s.device_id, s.asset_id, `${label}: Late`, h.reason, null, originTag);
    }
    // device-level telemetry flags
    const devices = t.all<{ id: string; name: string; asset_id: string | null; battery_pct: number | null; rssi_dbm: number | null; origin: string }>("SELECT id, name, asset_id, battery_pct, rssi_dbm, origin FROM devices WHERE org_id = :org AND status = 'active'");
    for (const d of devices) {
      const f = deviceFlags({ batteryPct: d.battery_pct, rssiDbm: d.rssi_dbm }, settings.batteryLowPct, settings.rssiWeakDbm);
      if (f.batteryLow) open('device_battery_low', 'medium', d.id, null, d.id, d.asset_id, `${d.name}: battery low`, `Battery at ${d.battery_pct}% (threshold ${settings.batteryLowPct}%).`, null, d.origin);
      if (f.signalWeak) open('device_signal_weak', 'low', d.id, null, d.id, d.asset_id, `${d.name}: weak signal`, `Signal ${d.rssi_dbm} dBm (threshold ${settings.rssiWeakDbm} dBm).`, null, d.origin);
    }
    // auto-resolve alerts whose condition has cleared
    for (const a of t.all<{ id: string; dedupe_key: string }>("SELECT id, dedupe_key FROM alerts WHERE org_id = :org AND state <> 'resolved' AND kind LIKE 'sensor_%' OR org_id = :org AND state <> 'resolved' AND kind LIKE 'device_%'")) {
      if (!wanted.has(a.dedupe_key)) {
        t.run("UPDATE alerts SET state = 'resolved', resolved_at = :now WHERE org_id = :org AND id = :id", { now, id: a.id });
        res.resolved++;
        appendAudit(db, now, { orgId: org.id, actor: null, action: 'alert.resolved', objectType: 'alert', objectId: a.dedupe_key });
      }
    }
  }
  return res;
}
