/** Portable SQL (SQLite dialect used here; kept free of SQLite-only features except the audit triggers and AUTOINCREMENT). */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
CREATE TABLE organisations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('utility','county','ngo','platform')),
  is_demo INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY, org_id TEXT REFERENCES organisations(id), email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('reporter','technician','dispatcher','org_admin','platform_admin','auditor')),
  password_hash TEXT, status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended')),
  mfa_secret_enc TEXT, mfa_enrolled INTEGER NOT NULL DEFAULT 0, mfa_last_step INTEGER NOT NULL DEFAULT -1,
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, scope_owner TEXT,
  origin TEXT NOT NULL DEFAULT 'user_submitted', created_at INTEGER NOT NULL, last_login_at INTEGER
);
CREATE INDEX users_org ON users(org_id);
CREATE TABLE invites (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, mfa_verified INTEGER NOT NULL DEFAULT 0, csrf TEXT NOT NULL, ip TEXT, ua TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE counters (org_id TEXT NOT NULL, name TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (org_id, name));
CREATE TABLE photos (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), kind TEXT NOT NULL, uploader_id TEXT NOT NULL,
  mime TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, path TEXT NOT NULL, width INTEGER, height INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE assets (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), code TEXT NOT NULL, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('borehole','kiosk','waterpoint','pump','tank','treatment','valve','pipe')),
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('operational','degraded','down','contamination','unknown')),
  owner_type TEXT NOT NULL, owner_name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, install_year INTEGER,
  attributes TEXT NOT NULL DEFAULT '{}', notes TEXT, origin TEXT NOT NULL DEFAULT 'user_submitted',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (org_id, code)
);
CREATE INDEX assets_org ON assets(org_id);
CREATE TABLE asset_links (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), from_asset TEXT NOT NULL REFERENCES assets(id), to_asset TEXT NOT NULL REFERENCES assets(id)
);
CREATE TABLE work_orders (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), ref TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id),
  title TEXT NOT NULL, description TEXT, priority TEXT NOT NULL CHECK (priority IN ('P1','P2','P3')),
  status TEXT NOT NULL CHECK (status IN ('new','assigned','in_progress','awaiting_parts','completed','closed','cancelled')),
  kind TEXT NOT NULL CHECK (kind IN ('reactive','planned','sensor','contamination')), assignee_id TEXT REFERENCES users(id),
  schedule_id TEXT, schedule_due TEXT, scheduled_for INTEGER, sla_minutes INTEGER NOT NULL, sla_pause_awaiting INTEGER NOT NULL DEFAULT 0,
  fault_started_at INTEGER NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, closed_at INTEGER, closed_by TEXT,
  completion_notes TEXT, completion_photo_id TEXT REFERENCES photos(id), cancel_reason TEXT, origin TEXT NOT NULL DEFAULT 'user_submitted',
  UNIQUE (org_id, ref)
);
CREATE INDEX wo_org_status ON work_orders(org_id, status);
CREATE INDEX wo_asset ON work_orders(asset_id);
CREATE UNIQUE INDEX wo_schedule_due ON work_orders(schedule_id, schedule_due) WHERE schedule_id IS NOT NULL;
CREATE TABLE wo_events (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), wo_id TEXT NOT NULL REFERENCES work_orders(id),
  ts INTEGER NOT NULL, actor_id TEXT, from_status TEXT, to_status TEXT NOT NULL, note TEXT
);
CREATE INDEX wo_events_wo ON wo_events(wo_id);
CREATE TABLE wo_materials (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), wo_id TEXT NOT NULL REFERENCES work_orders(id),
  name TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('parts','labour','contractor','transport')),
  qty INTEGER NOT NULL CHECK (qty >= 1), unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0), created_by TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE reports (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), ref TEXT NOT NULL, asset_id TEXT REFERENCES assets(id),
  category TEXT NOT NULL CHECK (category IN ('no_water','low_pressure','leak','pump_failure','contamination','damage','access')),
  text TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT 'en', lat REAL, lng REAL, accuracy_m REAL, reporter_id TEXT REFERENCES users(id),
  client_uid TEXT, status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','linked','duplicate','rejected')),
  work_order_id TEXT REFERENCES work_orders(id), duplicate_of TEXT, reject_reason TEXT, photo_id TEXT REFERENCES photos(id),
  origin TEXT NOT NULL DEFAULT 'user_submitted', observed_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE (org_id, ref)
);
CREATE UNIQUE INDEX reports_idem ON reports(org_id, reporter_id, client_uid) WHERE client_uid IS NOT NULL;
CREATE INDEX reports_org_status ON reports(org_id, status);
CREATE TABLE maintenance_records (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), asset_id TEXT NOT NULL REFERENCES assets(id), work_order_id TEXT,
  performed_on TEXT NOT NULL, summary TEXT NOT NULL, performed_by TEXT NOT NULL, cost_minor INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'user_submitted', created_at INTEGER NOT NULL
);
CREATE INDEX maint_asset ON maintenance_records(asset_id);
CREATE TABLE maintenance_schedules (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), asset_id TEXT NOT NULL REFERENCES assets(id), title TEXT NOT NULL,
  interval_days INTEGER NOT NULL CHECK (interval_days >= 1), next_due TEXT NOT NULL, priority TEXT NOT NULL CHECK (priority IN ('P1','P2','P3')),
  active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at INTEGER NOT NULL, origin TEXT NOT NULL DEFAULT 'user_submitted'
);
CREATE TABLE devices (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), device_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  asset_id TEXT REFERENCES assets(id), origin TEXT NOT NULL CHECK (origin IN ('real','simulated')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')), secret_enc TEXT NOT NULL, secret_version INTEGER NOT NULL DEFAULT 1,
  battery_pct REAL, rssi_dbm REAL, last_seen_at INTEGER, created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE sensors (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), device_id TEXT NOT NULL REFERENCES devices(id),
  asset_id TEXT REFERENCES assets(id), key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flow','level','pump_status','pressure','quality')), param TEXT, unit TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'none' CHECK (role IN ('none','production','distribution')),
  expected_interval_s INTEGER NOT NULL CHECK (expected_interval_s >= 10), min_valid REAL, max_valid REAL, stuck_count INTEGER NOT NULL DEFAULT 12,
  validation_required INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, last_reading_at INTEGER, last_value REAL,
  health TEXT NOT NULL DEFAULT 'unknown', health_changed_at INTEGER, created_at INTEGER NOT NULL, UNIQUE (device_id, key)
);
CREATE INDEX sensors_org ON sensors(org_id);
CREATE TABLE readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, sensor_id TEXT NOT NULL REFERENCES sensors(id), device_id TEXT NOT NULL,
  ts INTEGER NOT NULL, value REAL NOT NULL, uid TEXT NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('real','simulated')),
  received_at INTEGER NOT NULL, UNIQUE (device_id, uid)
);
CREATE INDEX readings_sensor_ts ON readings(sensor_id, ts);
CREATE TABLE ingest_nonces (device_id TEXT NOT NULL, nonce TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (device_id, nonce));
CREATE TABLE ingest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT, device_id TEXT, ts INTEGER NOT NULL, outcome TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, detail TEXT
);
CREATE TABLE alerts (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), kind TEXT NOT NULL, severity TEXT NOT NULL,
  sensor_id TEXT, device_id TEXT, asset_id TEXT, dedupe_key TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','acknowledged','resolved')),
  title TEXT NOT NULL, detail TEXT, suggested_priority TEXT, wo_id TEXT, opened_at INTEGER NOT NULL, resolved_at INTEGER, acked_by TEXT, origin TEXT NOT NULL DEFAULT 'real'
);
CREATE UNIQUE INDEX alerts_open_dedupe ON alerts(org_id, dedupe_key) WHERE state <> 'resolved';
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, link TEXT, created_at INTEGER NOT NULL, read_at INTEGER
);
CREATE INDEX notif_user ON notifications(user_id, read_at);
CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, chain TEXT NOT NULL, org_id TEXT, ts INTEGER NOT NULL, actor_id TEXT, actor_role TEXT,
  action TEXT NOT NULL, object_type TEXT, object_id TEXT, detail TEXT NOT NULL DEFAULT '{}', prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX audit_chain ON audit_log(chain, seq);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`
  }
];
