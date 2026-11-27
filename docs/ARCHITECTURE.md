# Architecture

Modular monolith, TypeScript (strict) on Node 22.18+/24 (Node 26 locally). No build step: Node runs `.ts` directly (type stripping, `erasableSyntaxOnly`); `tsc --noEmit` is the type gate.

| Concern | Choice | Notes |
|---|---|---|
| HTTP | Hono + `@hono/node-server` | `app.request()` drives integration tests without sockets |
| Data | `node:sqlite` (WAL), portable SQL | `src/db/schema.ts` migrations; Postgres adapter **not implemented** (see limitations) |
| Validation | Zod | config, settings, assets, reports, sensors, ingestion |
| UI | Server-rendered HTML (own auto-escaping `html` template), small client JS, design tokens CSS | no CDN; CSP `script-src 'self'; style-src 'self'` |
| Maps | Schematic SVG by default; vendored Leaflet only when a tile URL is configured | tiles OFF by default, attribution shown |
| Images | sharp (re-encode, strip EXIF) | magic-byte check first |
| Auth | scrypt, sessions (hashed token in DB), CSRF synchroniser token, TOTP (own RFC 6238 implementation, tested with RFC vectors) | |

Deviations from the recommendation: own TOTP/HTML-template code instead of libraries (small, fully tested, avoids dependencies); no Express; Vitest + Playwright as recommended.

## Layers
`src/domain` pure rules (state machine, SLA, sensor health, analytics, RBAC, audit chain, upload validation) - no I/O. `src/repo` services over the database; **all tenant data goes through `TenantDb`**, which refuses any statement lacking the `:org` parameter and binds it to the actor's organisation. `SystemDb` is used only for auth, organisations, and the device lookup by globally unique device key. `src/web` routes and pages; `src/sim` simulator; `src/jobs.ts` periodic health + planned-maintenance generation.

## Tenancy
Organisation (utility/county/NGO) owns every row (`org_id`). Cross-tenant tests enumerate 28 operations by org B on org A identifiers (refused, org A snapshot unchanged), plus listing, HTTP, analytics and a static scan that tenant modules never touch the raw handle. A mutation (removing the org filter) was confirmed to fail 13 tests. Platform admins have no tenant data permissions.

## Data origin
Every record carries `origin` (synthetic, user_submitted, imported; readings/devices real|simulated). Demo organisations show "Synthetic demonstration data"; simulated devices show "SIMULATED SENSOR - test environment"; production refuses simulated devices.

## Audit
`audit_log`: per-organisation SHA-256 hash chain, DB triggers reject UPDATE/DELETE, `verifyChain`, `npm run verify-audit`, UI/API verification. Tail truncation is not detectable without an external anchor (record the head hash periodically).

## Concurrency / scale
Single process, synchronous SQLite, fixed-window in-memory rate limiter. Multi-instance needs Postgres and a shared limiter. Not load tested.
