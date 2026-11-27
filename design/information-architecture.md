# WaterWatch — information architecture

## Sitemap
```
/ (prototype chooser)
├── Utility console   #/console
│   ├── Map & assets        map/:assetId   (list + map + asset card)
│   │   └── Asset record    asset/:id      (registry, sensors, history, linked reports)
│   ├── Outage reports      reports        (triage)
│   ├── Work orders         orders         (board)
│   ├── Sensor health       sensors        (+ ingestion test panel)
│   ├── Analytics           analytics
│   └── Audit log           audit
├── Community report  #/report   (single screen, 3 steps, offline queue, EN/SW)
└── Technician        #/tech     jobs list → #/tech/:woId job detail
Phase B adds: Login/MFA, Admin (users, assets, devices), Settings, Notifications, Exports, Public status (optional, off by default).
```
Diagram: see `design/ia-sitemap.svg`.

## Per-role navigation
| Role | Sees | Cannot see |
|---|---|---|
| Admin | everything, users, devices, audit | n/a |
| Utility manager | console all, analytics, exports | user admin |
| Dispatcher | map, reports (incl. reporter contact), orders, sensors | user admin |
| Technician | own jobs (mobile), assigned asset detail | other techs' jobs, reporter personal data, analytics |
| NGO monitor | scoped map, scoped analytics | reporter data, work-order costs unless granted |
| Community reporter | report form, own report history/status | everything else |

## Navigation model
Desktop: left rail (6 items, badge on Outage reports), top bar with view switcher, simulated-data label and theme. Mobile console: bottom tabs (5). Community and technician views are standalone mobile layouts (no rail).

## Naming
Status vocabulary (fixed): Operational, Degraded, Out of service, Contamination alert, Status unknown. Work-order states: New, Assigned, In progress, Awaiting parts, Completed. Priority: P1 urgent (2 h SLA), P2 high (24 h), P3 routine (72 h). Sensor health: Reporting, Late, Missing readings, Flat-lined.
