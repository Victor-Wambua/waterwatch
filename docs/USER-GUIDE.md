# User guide

Demo logins (seeded, SYNTHETIC; password is the one set by `WW_SEED_PASSWORD` or printed by `npm run seed`): admin@mtokijani.test (utility admin), dispatcher@mtokijani.test, peter@/amina@/joseph@/grace@mtokijani.test (technicians), wanjiru@mtokijani.test (reporter), auditor@, ngo@ (scoped read-only), admin@bahari.test (second organisation), platform@waterwatch.test. Dispatcher/admin/platform sign-ins enrol an authenticator app on first use.

**Community reporter** (`/report`): tap the problem, add a photo (optional), use your location or pick the water point, Send. No signal: it is saved on the phone and sent automatically (or press Send now). Contamination shows safety advice immediately; it is not a lab result. EN/SW toggle.
**Dispatcher**: Map (filters, status, asset card); Outage reports (contamination pinned; Create work order, Mark duplicate, Reject with reason); Work orders board (assign, open card for timeline, costs, confirm/send back); Planned work; Sensor health (alerts, suggested work orders); Analytics (window selector, CSV).
**Technician** (`/tech`): jobs sorted by SLA; Start work, Need parts, add materials/costs, completion photo + notes, Mark complete. Reporter details are not shown to you.
**Utility admin**: everything above plus Assets import, Users (invitation link, suspend, reset MFA), Devices (register, rotate, revoke), Settings, Audit log (verify integrity).
**Auditor / NGO monitor**: read-only; NGO monitor sees only assets of its owner, no costs, no reporter data.
