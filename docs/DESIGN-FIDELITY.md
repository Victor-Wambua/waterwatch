# Design fidelity (built app vs approved design)

Method: Playwright captured the real app (seeded synthetic data, Chromium, desktop 1440x900 and mobile 390x844, light and dark) into `docs/screenshots/app-*.png` (30 images); compared by eye with `design/screenshots/*` and `design/screen-specifications.md`. Tokens (`public/css/tokens.css`), the prototype stylesheet, the icon sprite and the status shape language are reused.

| Screen | Result |
|---|---|
| S1 Map | Matches: KPI row, contamination banner, filters, schematic map with shape+icon markers (now real `<a>` links, keyboard focusable), asset card, list. Differences: markers positioned from real coordinates (some overlap at close assets), filter by submit/auto-submit rather than live JS, "Tile map" option added |
| S2 Asset record | Matches content (registry, sensors with sparkline and SIMULATED label, history, linked reports); layout is two columns of cards |
| S3 Reports | Matches (pinned contamination, chips, dialogs for work order/duplicate/reject with reason >= 5); native `<dialog>` from templates |
| S4 Work orders | Matches five columns, SLA timers, assignee, cost; "Advance" replaced by Assign select plus detail page actions (state machine enforced) |
| S5 Sensors | Matches table, chips, trends; added alerts and suggested work orders; "Send simulated test reading" moved to Devices admin |
| S6 Analytics | Matches charts with data tables, repeat failures, downtime, cost; added availability, SLA, production volume, definitions |
| S7 Audit | Matches; adds integrity verification |
| S8 Report | Matches tiles, safety panel, photo, GPS/nearest point, offline bar, queue, EN/SW. Difference: no 3-step progress bar; account header shown above the phone card |
| S9 Technician | Matches list sorted by SLA, stepper, materials, required completion photo; Navigate uses a `geo:` link |
Defects found while comparing and fixed: hidden panels still displayed (flex overrode `hidden`), photo slot overflow, sensor health showing "awaiting first reading" until the first job ran (now evaluated at startup), map label clipping.
Remaining differences: mobile console header wraps; no motion/skeleton states built; not re-run for contrast or screen readers.
