# Responsive design

Breakpoint: 860 px. Mobile is a designed experience, not a squeezed desktop.

| Area | >= 860 px | < 860 px |
|---|---|---|
| Console navigation | Left rail 200 px | Bottom tab bar (5 items, 56 px) |
| Map & assets | Map + list/card two columns | Single column: KPI (3 across), banner, filters, map, card, list |
| Work-order board | 5 columns, horizontal scroll inside board | Same board scrolls horizontally inside its own container; page never scrolls sideways |
| Tables | Full | Wrapped in horizontally scrollable region |
| Community report | Phone-width card centred | Full-bleed, no frame |
| Technician | Phone-width card centred | Full-bleed |

Verified widths: 1440 and 390 (no page-level horizontal overflow on map, reports, orders, report, tech — see verification). Low-end Android: no web fonts, no CDN, single JS file; the community flow targets a small payload and works with JS-only state (Phase B: PWA with service worker and IndexedDB queue). Touch targets >= 44 px; inputs 16 px+. Landscape and tablet: layout follows the same breakpoint (tablet uses desktop layout from 860 px).
