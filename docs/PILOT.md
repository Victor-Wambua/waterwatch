# Pilot readiness

Nothing here is claimed from a pilot: none has happened. WaterWatch is a tested MVP on synthetic data and simulated sensors.

Context (WASREB, Impact 18, 2024/25, as read in design research): water coverage "in regulated areas" about 72.1% (not national; national about 42%); non-revenue water 48% (sector guideline: below 20% optimal). The brief's "52.3% revenue water" was not found. WaterWatch does not compute NRW.

## Pilot guide (suggested 8-12 weeks, one utility or county programme, 20-60 assets)
1. Agree scope, success metrics and data-protection roles (utility is controller; counsel decides registration/DPIA) in writing.
2. Deploy a staging instance (docs/DEPLOYMENT.md) behind TLS; no real sensors until Phase 4.
3. Weeks 1-2: import assets (CSV), set SLA targets and service area, create users, train dispatchers and technicians (docs/USER-GUIDE.md).
4. Weeks 3-4: pre-verify reporters (committee or phone), launch community reporting with Swahili text reviewed by a native speaker and public-health professional.
5. Weeks 5+: work orders live; planned maintenance schedules; review weekly.
6. Optional sensors: 2-5 devices on one site, validated and calibrated by the utility; run alongside manual checks.
## Onboarding a utility
Checklist: organisation created by platform admin; first admin enrols TOTP; asset import validated; technicians and dispatcher accounts; SLA placeholders replaced; contamination notification procedure (who calls the water-quality officer and public-health contact) written down outside the app; backup schedule; support contact.
## Support workflow
Severity 1 (cannot sign in / ingestion down / data loss): same-day triage; 2 (feature broken): 2 working days; 3 (question): 5. Collect request id, time, role, page, screenshot; reproduce on staging; fix; add a regression test; note in a changelog. Contamination reports are the utility's responsibility, not the vendor's.
## Success metrics (measured from the system)
Median time to submit a report (recorded per report as `submit_ms`; target below 45 s on a low-end phone, unverified); time report to work order; share of P1 acknowledged inside SLA; MTTR trend; share of assets with status updated in 24 h; sensor missing-reading detection within 2x interval; repeat-failure count; reporter retention; dispatcher weekly active use.
## Feedback collection
Weekly 30-minute dispatcher/technician review, an in-person reporter session per community, a defects list with severity, end-of-pilot survey (unwritten; to be designed with the utility).
## Risk register
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Contamination report mishandled or misread as a lab result | M | High | P1 banner, safety text, disclaimers, utility procedure, audit; text review by a health professional |
| Personal data (phone, photos, GPS) misuse | M | High | role-limited access, EXIF removal, audit, retention policy to be agreed; counsel review |
| Poor connectivity / low-end phones | H | M | offline queue, small payloads; real-device testing outstanding |
| Sensor data trusted too far (water quality) | M | High | "validation required" label, no safe/unsafe claims |
| Utility data quality (wrong coordinates/owners) | H | M | CSV validation, bounds, review |
| Single-process SQLite scale/availability | M | M | backup/restore, Postgres adapter later |
| Spam/false reports | M | M | verified reporters, rate limits, triage |
| Key person / support capacity | M | M | documented runbooks |
| Swahili text inaccuracies | M | M | native review before launch |
## Business model (hypotheses to test, no revenue claimed)
Utility subscription per asset band; county contracts; NGO monitoring (scoped read-only view); sensor integration services (fixed fee per site); maintenance-management subscription for contractors. Pricing is not set and needs pilot cost data.
## Impact metrics (to be measured)
Hours of outage per asset (downtime), MTTR, repeat failures avoided, time to restore after contamination reports, reports acted on within SLA, share of assets with known status. Attribution to WaterWatch requires a baseline captured before go-live.
