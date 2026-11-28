# UX/UI review

## Method
The running app was started on a scratch database with the synthetic seed data and driven with Playwright (cached Chrome for Testing). Screens were captured as reporter, technician, dispatcher and admin at 1280x800 and 375x812 (touch, mobile emulation), light and dark. Overflow was measured with `scrollWidth` at 375 px on every console page. Review criteria: hierarchy, navigation, forms, touch targets, contrast, labelling of simulated data, alert noise, chart legibility, and field use (glare, gloves, one hand).

## Reviewed
Map and triage, asset list and detail, outage reports, work-order board and detail, planned work, sensor health and asset sensor charts, analytics, audit, admin users/devices/settings, community report form (including empty-submit errors and the contamination path), technician job list and job detail.

## Findings
| # | Severity | Screen | Problem | Fix | Status |
|---|---|---|---|---|---|
| 1 | High | Work orders (phone) | An sr-only label inside the horizontally scrolling board was not clipped, so the page widened to about 1000 px and the browser zoomed out. Same cause class on other scroll regions. | Scroll regions are now positioned containers so they clip; board columns are 82vw with snap scrolling | Fixed |
| 2 | High | Analytics, planned work (phone) | Bare tables forced the page to 742 px and 438 px wide | Tables wrapped in the scrolling table container | Fixed |
| 3 | High | All console pages (phone) | Bottom tab bar showed only the first five destinations; Sensor health and Analytics were unreachable | Tab bar lists every destination, scrolls horizontally, carries the open-report and sensor-alert badges | Fixed |
| 4 | High | All pages (phone) | Sticky header used about 170 px of an 812 px screen and its buttons were 36 px tall | Header scrolls away on phones, buttons are 44 px, long names truncate | Fixed |
| 5 | Medium | Map | The map note covered the label of the bottom-most asset; markers were 28 px hit areas; labels unreadable on phones | Note moved below the map; 44 px invisible hit target; map keeps a 640 px minimum width and scrolls inside its frame | Fixed |
| 6 | Medium | Sensor charts | In-chart text ("No readings", "Flat-lined") rendered about 4 px tall; no value range | Notes are real text below the chart with the min to max range; the shaded gap area stays | Fixed |
| 7 | Medium | Sensor health | The full "SIMULATED SENSOR — test environment" chip repeated on 14 rows (alert fatigue) | One banner with the full wording, compact "Simulated" chips (full wording in the tooltip). Asset pages keep the full chip | Fixed |
| 8 | Medium | Technician job | Complete form far below the fold; qty and cost stacked; stepper rows short | Large "Go to: complete the job" button, qty/cost side by side, 44 px stepper rows (two columns on phones) | Fixed |
| 9 | Medium | Report form | Native file input shown beside the styled photo button | Input visually hidden, the button shows the keyboard focus ring | Fixed |
| 10 | Low | High contrast | No stronger borders for contrast preference | `prefers-contrast: more` darkens control borders | Fixed |
| 11 | Low | Board | Long text clipped in completed cards | Cards wrap long words | Fixed |

## Not fixed or not reviewed
- Map label collisions on the schematic (for example near Ridge Pump Station) remain; fixing needs a label-placement algorithm.
- Sensor alerts are not grouped per device (three alerts for one device still list separately). That is a behaviour change.
- Completed work-order column is unbounded; no pagination was added.
- Outdoor glare was judged from contrast tokens and the large primary buttons only; no real device or sun test.
- The tile (Leaflet) map was not reviewed; tiles are off by default.
- Screen reader testing was not performed beyond reading the markup.
- The `design/prototype/` was not changed. It has no tab-bar or sensor-chart behaviour matching these screens, so it drifts slightly from the app on the sensor page and mobile header.
- Platform admin pages were not reviewed.

## Screenshots
`docs/screenshots/ux-review/` has before and after pairs (map and work orders on phone, sensor health and map on desktop, technician job on phone).

## Round 2

### Done
| Item | Result | Evidence |
|---|---|---|
| Automated accessibility (axe-core 4.x, dev dependency, `tests/e2e/a11y.spec.ts`) | 120 screen renders (7 roles, 375 and 1280 px, light and dark, wcag2a/aa, 2.1, 2.2 AA and best-practice rules). Serious/critical before: 24 renders affected, 116 nodes (map marker label vs visible name, unfocusable scroll regions, `role=img` list on analytics). After: 0. | test output |
| Keyboard-only walkthroughs (`tests/e2e/keyboard.spec.ts`) | Skip link first and working, focus visible on every stop, no trap, header then nav then content order, modal traps focus and Escape closes it, map markers work with Enter, report form reaches Send by Tab. Fix: dialogs now return focus to the opener. | 4 tests |
| Print styles | Print stylesheet hides the shell, flattens the board and tables, avoids breaking cards. Checked with print emulation on orders, analytics, audit and assets (no overflow, chrome hidden). | 4 tests |
| Contrast | Token pairs re-measured (62 pairs, light and dark): 0 failures. Rendered text: axe color-contrast rule is part of the sweep in both themes: 0 failures. | tools/contrast.mjs tokens, axe |
| Map label collisions | Labels now use collision-aware placement (below, above, right, left, farther), keep inside the frame and show full names. Checked visually on the seeded map. | `ux-review/r2-map-labels-desktop.png` |
| Alerts per device | Open alerts are grouped per device with a count and worst severity; single alerts stay as before; actions unchanged. Presentation only. | `ux-review/r2-sensors-grouped-mobile.png` |
| Completed column | Shows 5, then a "Show N more completed" disclosure; the count in the header is the true total. | e2e |
| Leaflet tile map | Reviewed with a local dummy tile URL: no horizontal overflow at 375 px, tile-error note appears. Markers were all the same blue; now coloured by status with a name and status tooltip. Markers are still not keyboard reachable; the asset list below is the keyboard alternative. | manual |
| Platform admin | `/platform` reviewed in the sweep (axe clean, both themes, both widths). Table is now a labelled, focusable scroll region. | axe |
| Performance (emulated, no throttling) | Map, sensors, orders at 375 px: 6 requests, 50 to 57 KB transferred, CLS 0.000. No changes needed. | `print-perf.spec.ts` |
| Kiswahili | 31 keys in en and sw, none missing or extra. No overflow at 320 px. Still a DRAFT. | unit-style check, e2e |
| Prototype | `design/prototype/` gets the bounded completed column and a labelled sensor table region. Still labelled simulated, no network. | |

### Still open
- Native Kiswahili review and public-health review of the safety wording are still required. Not verified by a native speaker.
- Real screen reader testing (VoiceOver, NVDA), real device, glare and real-network throttling were not done and cannot be done here.
- Leaflet markers are not individually keyboard focusable (list alternative provided).
- Prototype does not model per-device alert grouping (it has no alert list).
- axe only finds a subset of issues; moderate/minor axe findings were not triaged.
