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
