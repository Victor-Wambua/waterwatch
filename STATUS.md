# WaterWatch status
Phase A (design): complete. Phase B (build): complete as an MVP, **not production ready**; local git only, nothing pushed or deployed.
Run: `npm ci && npm run seed && npm start` (http://127.0.0.1:4400). Tests: 559 unit/integration pass, 6 Playwright journeys pass (plus 30 screenshot captures), lint/typecheck clean, `npm audit` 0 vulnerabilities, overall line coverage 97.86%.
See docs/ACCEPTANCE-REPORT.md and docs/KNOWN-LIMITATIONS.md. Outstanding external dependencies: real devices, MQTT/LoRaWAN adapters, Postgres adapter, Docker build verification, pilot utility, Swahili/public-health review, counsel review.
