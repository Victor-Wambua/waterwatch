# Prototype

Self-contained vanilla HTML/CSS/JS in `design/prototype/` (no CDN, no network, no build). Everything is simulated; the top bar always reads "Simulated — design prototype · Synthetic demonstration data". Sensors are labelled "SIMULATED SENSOR — test environment".

## Open it
```
cd tools && npm install            # playwright only, inside this product folder
node serve.mjs ../design 4400      # then open http://localhost:4400/prototype/
```
Or open `design/prototype/index.html` directly in a browser (works from file://). Wireframes: `design/wireframes/index.html`. Hi-fi gallery: `design/hifi/index.html`.

## What is clickable
- `#/` chooser; theme toggle (light/dark, also follows system).
- **Console** (`#/console/...`): map with 15 markers (select by click or Enter), status/type/search filters + empty state, asset card with sparkline, full asset record, outage triage (create work order dialog, duplicate, reject with required reason), work-order board (assign, advance, SLA timers, breach state), sensor health (missing/late/flat-lined) + "Send simulated test reading", analytics, audit log that records every action taken in the session.
- **Community report** (`#/report`): categories, contamination safety guidance, photo/GPS simulation, validation errors, EN/Kiswahili toggle, offline toggle with queue + Send now, measured time-to-submit.
- **Technician** (`#/tech`): jobs by SLA, job detail, Start work/Need parts, add material (validated), completion photo required, mark complete.
State is in memory and resets on reload.

## Verify
```
node tools/clickthrough.mjs   # 70 checks desktop+mobile, console errors
node tools/contrast.mjs       # token pairs + rendered text contrast
node tools/shots.mjs          # screenshots into design/screenshots
node tools/smoke.mjs          # route smoke test
```
Results: `design/screenshots/clickthrough-results.json`, `contrast-results.json`.

## Known simulation limits
No real GPS/camera/maps handoff, no real offline storage (queue is in memory), no authentication, no real translation review, schematic map instead of tiles.
