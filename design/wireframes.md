# Wireframes

Low-fidelity grayscale HTML + PNG in `design/wireframes/` (open `wireframes/index.html`), rendered in headless Chromium by `tools/build-wireframes.mjs`. Each sheet carries numbered annotations.

| File | Covers |
|---|---|
| 01-map-console | Dashboard / navigation / map-first console, desktop and mobile tabs |
| 02-triage-board | Outage triage, contamination pinning, work-order board with SLA timers, assignment |
| 03-asset-detail | Registry, sensor sparkline, maintenance history, sensor health table, ingestion panel |
| 04-community-report | Data entry: three-step report, safety guidance, offline queue (mobile) |
| 05-technician | Technician job list, job detail, materials, completion photo (mobile) |
| 06-analytics-audit-states | Reports/analytics, audit log, empty/loading/error/success states |

Search/filter/results is covered on sheet 01 (status, type, search over map + list). Auth/onboarding, profile/settings and admin/user management are **not wireframed in Phase A** (see design-review: gaps) — they follow the studio patterns and are added at the start of Phase B.
