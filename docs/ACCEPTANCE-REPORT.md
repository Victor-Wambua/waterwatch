# Acceptance report

Status key: Met / Partially / Not met. Evidence is executed tests unless stated. Final run: `npm run typecheck` clean, `npm run lint` clean, 559 unit+integration tests passing (Vitest), 6 Playwright journeys passing (run twice), coverage overall lines 97.86% / critical modules lines 99.06% (docs/COVERAGE.md), `npm audit` 0 vulnerabilities. Not run: Docker build, CI, Node 22/24, real devices, screen readers.

## Product acceptance (spec 06)
| Criterion | Status | Evidence |
|---|---|---|
| Infrastructure registered (all asset types, geolocation validation, ownership, status, maintenance history, CSV import) | Met | assets tests (8 types, bounds, CSV all-or-nothing, history); e2e |
| Assets on map | Met (schematic default; tile map untested with a real provider) | map tests, screenshots |
| Faults reported (categories, photo + GPS, offline queue, anti-spam, contamination escalation + disclaimers, privacy) | Met | reports tests; e2e online + offline->sync with real service worker; contamination e2e |
| Reports generate work orders | Met | triage tests, e2e |
| Technicians update; repairs recorded (assignment, SLA, scheduling incl. planned, materials, costs, completion photo, dispatcher confirmation) | Met | state-machine/SLA hand-computed tests, lifecycle tests, planned maintenance tests, e2e |
| Maintenance analytics work (outages, MTTR, repeat failures, downtime, cost, reliability, production readings) | Met | hand-computed fixture tests; DB integration test; e2e shows count change. Reliability = availability derived from downtime (defined in docs/API.md) |
| Sensor readings ingested from supported test devices | Met (simulated devices only) | 30 ingestion tests, simulator test |
| Sensor failures and missing readings identified | Met | 16 health tests, e2e J5 (real 23 s wait) |
| Audit records | Met | audit tests, hash chain, verification |
| MQTT adapter | Not met (documented as outstanding) | DEVICE-INTEGRATION.md |
| Real device / live integration | Not met (none claimed) | external dependency |
| Water-quality sensors | Partially | accepted and labelled "validation required"; no calibration/validation workflow |
| Planned-maintenance calendar view | Partially | agenda list, no grid |

## Universal list
| Item | Status | Evidence |
|---|---|---|
| Critical journeys work | Met | 6 e2e journeys |
| Data persists | Met | SQLite integration tests, backup/verify script run once manually |
| Business logic tested | Met | unit + integration suites |
| Authn + authz work | Met | 266-case matrix, auth tests, MFA/CSRF tests |
| Critical data protected | Met (as tested) | encryption at rest, escaping, headers, tenancy, uploads |
| Error handling | Met | validation, JSON errors, error pages, no leakage test |
| Reports from actual data | Met | analytics computed from stored rows; demo data is synthetic and labelled |
| APIs documented | Met | OpenAPI + coverage-consistency test |
| Tests executed | Met | counts above |
| No unresolved critical security issues | Met (known gaps listed in SECURITY.md; no external review or pen test). One real defect found and fixed during testing: technician role could list all assets |
| Deployable to staging | Partially | Dockerfile/compose/CI written, never built or run here |
| Docs complete | Met | ARCHITECTURE, DEVICE-INTEGRATION, SECURITY, API, DEPLOYMENT, PILOT, USER-GUIDE, KNOWN-LIMITATIONS, COVERAGE, DESIGN-FIDELITY |
| Known limitations disclosed | Met | KNOWN-LIMITATIONS.md |
| Pilot plan exists | Met | PILOT.md (no pilot has occurred) |
| Business + impact metrics defined | Met (definitions only, no claimed values) | PILOT.md |
| Design fidelity | Met with listed differences | DESIGN-FIDELITY.md |
| Accessibility | Partially | semantic HTML, text+shape status, focus rings, labels; no screen-reader or contrast re-run on the built app |
