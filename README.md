# WaterWatch

Water-asset monitoring, community fault reporting, maintenance management and sensor ingestion for utilities, counties and NGOs. **MVP, not production ready.** All demo data is synthetic; sensors in the demo are simulated.

```
npm ci
npm run seed          # synthetic demo data (prints seed password, writes data/simulator-devices.json)
npm start             # http://127.0.0.1:4400   (needs WW_SECRET_KEY, see .env.example)
npm run simulate      # labelled simulated devices
npm test              # unit + integration
npm run test:coverage # coverage (v8)
npm run test:e2e      # Playwright (starts its own server on :4401)
npm run typecheck && npm run lint && npm audit
```
Docs: `docs/` (ARCHITECTURE, DEVICE-INTEGRATION, SECURITY, API + openapi.json, DEPLOYMENT, PILOT, USER-GUIDE, KNOWN-LIMITATIONS, COVERAGE, DESIGN-FIDELITY, ACCEPTANCE-REPORT). Design: `design/` (+ `design/addenda.md`).
