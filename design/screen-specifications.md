# Screen specifications

Routes refer to the prototype (`#/...`). Data is synthetic.

## S1 Map & assets `#/console/map[/:id]`
Purpose: asset status at a glance. Layout: KPI row (assets, operational, degraded/out, contamination, past SLA), contamination banner (role=alert), filters (status, type, search), map (left, ~60%) and asset card + list (right). Markers: shape+icon+text label, keyboard focusable, Enter/click selects. States: empty search -> "No assets match" + Clear filters; filtered-out markers dimmed. Mobile: stacked; bottom tabs.
Data: asset id, name, type, owner, status, install year, last maintenance, sensor flag.

## S2 Asset record `#/console/asset/:id`
Registry table (incl. WPDx mapping note), sensors with sparkline and SIMULATED label, maintenance history timeline (date, work, who, cost in KES), linked reports. Empty: "No maintenance recorded yet", "No sensor installed".

## S3 Outage reports `#/console/reports`
Rows: id, category, asset, age, language, photo flag, GPS with accuracy, text. Contamination rows pinned with "High priority — contamination" chip and bordered. Actions: Create work order (dialog: priority, technician; P1 pre-selected for contamination; officer-notification note), Mark duplicate, Reject (dialog; reason >= 5 chars required). Linked reports show the WO chip.

## S4 Work orders `#/console/orders`
Five columns. Card: id, priority chip, title, asset, SLA timer (icon + text; breached state), assignee, cost, assign select, Advance. Rules: cannot advance New without a technician; Completed cards lock.

## S5 Sensor health `#/console/sensors`
KPIs, warning bar, table (device, SIMULATED chip, asset, kind, health chip, last reading, 24 h mini trend), ingestion explanation, "Send simulated test reading" (labelled).

## S6 Analytics `#/console/analytics`
KPIs; outages/week bars with data table; MTTR line; repeat failures table; downtime by asset; cost by category. Banner: synthetic, not real performance. Note on NRW being a utility-level metric.

## S7 Audit log `#/console/audit`
Time, actor, action, object; newest first; append-only in Phase B (hash-chained or DB-enforced).

## S8 Community report `#/report`
Header with language toggle; online/offline bar; 7 category tiles; safety panel (contamination); photo slot; GPS + nearest point; Send. Validation: category required, location required. Result: reference, queued vs sent, measured time. Queue box with Send now (disabled offline). Swahili strings exist for all labels (needs native review).

## S9 Technician jobs `#/tech`, job `#/tech/:id`
List sorted by SLA. Detail: asset, SLA, Navigate, status stepper + Start work / Need parts, materials & costs (dialog: item, qty >= 1, unit cost >= 0), completion photo required, Mark complete.

## Cross-cutting
Every page: simulated/synthetic banner; focus moves to `main` on navigation; toasts also in an aria-live region; dialogs use native modal behaviour (Esc closes, focus returns).
