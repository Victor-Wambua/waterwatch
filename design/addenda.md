# Design addenda (Phase B)

Areas the Phase A package did not design. Each follows the existing design system (tokens, shape-coded status language, hairline cards, 44 px targets, no colour-only meaning). Implemented screens are in `docs/screenshots/`.

1. **Authentication and MFA** (`/login`, `/login/mfa`, `/invite/:token`, `/account`). Single centred card. Roles dispatcher, utility admin and platform admin must verify a TOTP code; first sign-in shows the key for authenticator enrolment (no QR library, manual key + setup URI). No public sign-up: admins create users and hand over a one-time invitation link (no email is sent). Errors use `role=alert`; lockout after 5 failures.
2. **Device registry** (`/console/admin/devices`). Table of devices (origin chip: SIMULATED SENSOR - test environment vs Real, status, last seen, battery/signal) and a registration form with a first sensor. Credentials page shows key and secret once. Actions: rotate secret, revoke, send simulated test reading (simulated devices only).
3. **Users admin** (`/console/admin/users`): table, suspend/reactivate, reset MFA, create with role and optional owner scope (NGO monitor sees only assets of that owner, no reporter data, no costs).
4. **Settings** (`/console/admin/settings`): SLA minutes per priority (placeholders), SLA pause while awaiting parts, service-area bounds, sensor health thresholds, ingestion window, report anti-spam, repeat-failure window, timezone offset.
5. **Planned maintenance** (`/console/schedule`): upcoming planned work list, recurring schedules (asset, task, interval days, next due, priority, pause/resume), "Generate due work orders now". Planned work orders appear on the board with a Planned chip.
6. **Work-order confirmation**: completed work shows an "Awaiting confirmation" chip; the dispatcher confirms (optionally restoring the asset status, with a recorded reason to clear a contamination alert) or sends it back with a reason. Board column "Completed" holds completed and confirmed (14 days).
7. **Asset registry** (`/console/assets`, form, CSV import with validate-first preview). Eighth asset type **pipeline segment** added (spec lists pipes); per-type attribute fields.
8. **Alerts** on the Sensor health page with Acknowledge and "Create suggested work order" (a person decides; asset status is never changed automatically).
9. **Notifications** (`/notifications`, bell with unread count): in-app only; email/SMS need a provider.
10. **Platform admin** (`/platform`): create organisations and first admin; no access to tenant data.
11. **Audit page** adds integrity verification (hash chain).
12. **Reporter**: "My reports" list showing only own reports with plain-language status; Swahili toggle; offline queue box with Send now.
