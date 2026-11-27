# Deployment (staging only)

Not deployed anywhere. Docker files were **not built or run** on the development machine (no Docker).

## Local
`npm ci`, copy `.env.example` to `.env` values into the environment, `npm run seed` (synthetic data), `npm start` (port 4400). Or `WW_SEED_ON_START=1`.
## Staging
`docker compose up --build` with `WW_SECRET_KEY` set (long random). Put TLS termination in front; set `WW_COOKIE_SECURE=1`, `WW_TRUST_PROXY=1` only behind a trusted proxy. Persist `/data` (SQLite + private photos). `WW_ENV=production` refuses placeholder secrets and simulated devices, and the seed.
## Environment variables
See `.env.example`: PORT, HOST, WW_ENV, WW_DB_PATH, WW_DATA_DIR, WW_SECRET_KEY, WW_COOKIE_SECURE, WW_TRUST_PROXY, WW_ALLOW_SIMULATED, WW_TILE_URL, WW_TILE_ATTRIBUTION, WW_HEALTH_INTERVAL_MS, WW_SEED_ON_START, WW_SEED_PASSWORD, WW_MAX_UPLOAD_BYTES.
## Health
`GET /health` -> `{status, db, env, time, version}` (503 if the database fails).
## Backup / restore
`npm run backup [dir]` (VACUUM INTO + photo copy; consistent while running). Restore: stop the app, place `waterwatch.sqlite` at `WW_DB_PATH` and `photos/` under `WW_DATA_DIR`, start, run `npm run verify-audit`. Rotating `WW_SECRET_KEY` makes stored device secrets and MFA seeds unreadable: re-issue them. Test restores before relying on backups.
## Tile maps
Set `WW_TILE_URL` (e.g. a provider template) and `WW_TILE_ATTRIBUTION`; check the provider's terms; the CSP allows that origin only.
## CI
`.github/workflows/ci.yml` (Node 22/24: typecheck, lint, coverage, audit, e2e) - written, not executed. Node 22/24 compatibility was not run locally (Node 26 only).
## PostgreSQL
Not implemented. `docker-compose.postgres.example.yml` is a placeholder.
