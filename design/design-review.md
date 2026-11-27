# Design review — WaterWatch vs spec

## Requirements coverage (spec 06)
| Requirement | Design status |
|---|---|
| A Infrastructure registry (types, geolocation, ownership, status, history) | Designed: 7 asset types, owner, status, asset record with maintenance history. Registry create/edit forms **not wireframed** |
| B Community fault reporting (categories, photo, location, authorised users) | Designed + prototyped, 7 categories, offline queue, EN/SW. Authorisation flow (verified reporter onboarding) only described |
| C Maintenance (assign, work orders, priority, scheduling, progress, materials, costs, completion) | Prototyped except **scheduling/planned maintenance calendar** (not designed) |
| D IoT (adapters, MQTT/HTTP, device auth + signing, simulated devices labelled) | Sensor health + ingestion panel designed; auth/signing described in text; device registration UI not designed |
| E Analytics | Outages, MTTR, repeat failures, downtime, cost prototyped; "reliability" metric defined only as repeat-failure/downtime; production/distribution readings charts not designed |
| F Maps | Schematic map prototyped; tile provider setting is a Phase B item |
| Acceptance: audit records | Audit log screen designed |

## Verification results (executed)
- Click-through: 70 checks (35 desktop 1440x900, 35 mobile 390x844), 0 failed, 0 console errors.
- Contrast: 62 token pairs, 0 failures; 2,430 rendered text nodes (11 routes x light/dark x desktop/mobile), 0 below threshold.
- Screenshots were viewed and fixed: map overflowed its pane (scale fix), work-order selects overflowed cards, "Online" bar used warning colour (now green), mobile KPI block pushed map down (compacted).

## Honest gaps and risks
1. WASREB 52.3% revenue-water figure not found; NRW 48% used instead. 72.1% is regulated-area coverage, not national (~42%).
2. WPDx field list, Kenya DPA text, CityTaps/Majitech/Jibu/SCADA vendors were not fetched; related statements are labelled unverified.
3. Swahili strings (incl. safety text) are drafted and **must be reviewed by a native speaker and public-health professional**.
4. No real-device, screen-reader, or low-end-Android performance testing.
5. Auth/MFA, admin, settings, notifications, exports, planned-maintenance scheduling, device registration are not designed in Phase A.
6. SLA targets (2 h / 24 h / 72 h) are placeholders to be set by the utility.
7. The "<45 s" target is measured only on a fast laptop in the prototype.

## Open questions (non-blocking)
Who notifies public health on contamination (utility procedure)? Should reporters be pre-verified by committee or by phone number? Offline: PWA vs light Android wrapper?
