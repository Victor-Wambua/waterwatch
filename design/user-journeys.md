# WaterWatch — user journeys

All personas and data are fictional.

## J1 Community reporter: report a fault in under 45 seconds (Wanjiru, Android entry-level phone, patchy signal)
1. Opens WaterWatch (verified reporter link). Language defaults to phone language; Kiswahili/English toggle always visible.
2. Taps a category tile (7 large tiles with icon + words). Contamination tile is full width and distinct.
3. If contamination: safety guidance appears at once (do not drink, alternative source, boiling may not help, clinic advice, not a lab test).
4. Optional photo (compressed on device). Taps "Use my location" (GPS with accuracy shown) or picks the nearest water point.
5. Taps Send. Online: confirmation with reference and measured time. Offline: "Saved on this phone", queue count, auto-send when signal returns plus manual Send now.
Errors: no category -> inline message; no location -> inline message; GPS denied -> pick from list.
Prototype measures time from first tap to send (target < 45 s).

## J2 Dispatcher: triage reports into work orders (Mary, utility desktop)
1. Console shows a contamination banner and Outage reports badge.
2. Opens triage: contamination pinned first. Duplicate reports on the same asset sit together.
3. Create work order -> priority pre-selected (P1 for contamination; SLA 2 h), assign technician or leave unassigned. Contamination also prompts the water-quality officer notification.
4. Reject requires a reason; duplicates are marked. All actions land in the audit log.

## J3 Technician: complete a repair (Amina, phone, sometimes offline)
1. Job list sorted by SLA. Opens job: asset, status, SLA timer.
2. Navigate (hands off to the maps app). Start work. If parts needed -> "Need parts".
3. Records materials/labour and costs (KES, integer minor units stored).
4. Completion requires a photo; then Mark complete. Changes sync later if offline.

## J4 Manager: understand reliability (Daniel, utility manager)
Map status at a glance -> Analytics: outages per week, MTTR, repeat failures, downtime by asset, cost by category -> opens a repeat-failure asset to see maintenance history and sensor trend -> decides on replacement vs repair. Exports (Phase B) CSV.

## J5 Sensor failure detection (operator)
Sensor health page flags missing/late/flat-lined devices; asset status is not changed automatically; operator confirms by inspection (creates work order) or marks sensor faulty.

## J6 Contamination escalation (end to end)
Report -> P1 banner on console -> work order P1 with sampling task -> water-quality officer + public-health contact notified (procedure outside the app in MVP; app logs the notification record) -> asset marked "Contamination alert" until a person clears it with a recorded reason (lab reference optional).

## J7 NGO monitor
Read-only map and analytics scoped to programme-owned assets; no reporter personal data.

## J8 Admin
Register asset (type, owner, location, WPDx-mapped fields), register device (key issued once), manage users with TOTP MFA, view audit.
