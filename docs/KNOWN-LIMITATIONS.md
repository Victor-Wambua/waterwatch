# Known limitations

- **Not production ready.** Synthetic data and simulated sensors only; no pilot, no real device, no real reporter.
- MQTT adapter and LoRaWAN not implemented (documented seam only). No real-device integration tested.
- PostgreSQL adapter not implemented (SQLite only); Docker/compose/CI files written but **not built or run**; Node 22/24 not run locally (Node 26 only).
- Technician work is online-only (offline queue exists for community reports only).
- No email/SMS (in-app notifications only); no password reset by email; no QR code for MFA enrolment (manual key).
- Swahili strings (including safety text) are drafts needing native and public-health review.
- WPDx field mapping unverified (list not obtainable in design phase); attribute names are WaterWatch-specific.
- Map: schematic by default; tile provider untested against a real provider; Leaflet view is basic.
- Real-device, screen-reader (VoiceOver/TalkBack/NVDA), low-end Android, performance/load, forced-colours and zoom testing not performed. Contrast was verified on the design tokens in Phase A, not re-run on the built app.
- Contamination handling follows a design assumption (precautionary asset status on report); the utility's notification procedure is outside the app.
- Reporter data retention/erase/export tooling not built; audit tail truncation needs an external head-hash anchor.
- SLA targets are placeholders; NRW is not computed; analytics are only as good as the entered data.
- Rate limiter is per process; sessions and uploads are single-node.
- Planned maintenance generates work orders up to 3 missed occurrences at a time; no calendar grid view (list agenda).
- Desktop top bar wraps on narrow phones for console users (reporters/technicians use compact pages).
