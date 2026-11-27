# WaterWatch design system

Identity: **infrastructure operations console** — cool paper-and-ink neutrals, a single deep-water teal as the interactive colour, and a **shape-coded status language** (circle/triangle/square/diamond/dashed circle) so state never depends on colour. Distinct from the other products by its map-first layout, hairline "survey sheet" borders, a schematic river/pipeline map, and status markers instead of coloured pills.

Tokens: `design-tokens.json` (source), `design-tokens.css` (light + dark, also `prototype/tokens.css`). Dark mode follows `prefers-color-scheme` with a manual toggle.

## Colour (light / dark)
Neutrals: paper `#EEF3F2` / `#07161C`; surface `#FFFFFF` / `#0E2530`; ink `#0B2530` / `#E6F1F3`; ink-2 `#3B5560` / `#A9C0C6`; rule `#C5D3D0` / `#24424C`.
Brand (actions, selection): `#0B6180` / `#5CC0E0`.
Status pairs (text on soft background): ok `#11693C`, warn `#7A5200`, bad `#A01E1E`, contamination `#5B2A86`, unknown `#44565C`; dark variants in the token file. Chart: chart-a (teal) and chart-b (burnt orange) — both distinguishable in greyscale by position/labels; every chart carries value labels.

## Status language (never colour alone)
| State | Shape | Icon inside | Text |
|---|---|---|---|
| Operational | circle | check | Operational |
| Degraded | triangle | bar | Degraded |
| Out of service | square | x | Out of service |
| Contamination alert | diamond | exclamation | Contamination alert |
| Status unknown | dashed circle | question | Status unknown |
Sensor badge: small filled dot on the marker. Sensor health chips: Reporting (check), Late (clock), Missing readings (wifi-off), Flat-lined (alert). Priority chips: P1 urgent / P2 high / P3 routine with icon.

## Typography
Atkinson Hyperlegible (fallbacks Segoe UI, system-ui, Roboto — no CDN, so system stack in prototype); monospace for IDs, times, KES. Base 15 px desktop; 16 px minimum for form inputs on mobile; scale 15/17/20/24.

## Spacing, shape, motion
4 px grid; radius 8 (controls), 10 (cards), 22 (phone frame); 1.5 px borders. Touch targets >= 44 px (primary actions 52 px). Motion is limited to skeleton shimmer and toast; disabled under `prefers-reduced-motion`.

## Components
Top bar + view switcher; left rail (badge); bottom tabs (mobile); KPI tile; status chip; alert banner (contamination, warning); asset marker (SVG, keyboard focusable, focus ring); schematic map; asset card; list row button; work-order card (priority edge + SLA timer); board column; sensor sparkline with gap band; bar, line and horizontal-bar charts with data table; category tile (icon + label); safety panel; photo capture slot; offline bar; queue box; stepper; dialog (native `<dialog>`, focus managed); toast + live region; empty / skeleton / error states.

## Icons
Custom 24 px stroke set (2 px stroke), inline SVG symbols: drop, drop-off, gauge, leak, wrench, alert, damage, lock, check, x, question, clock, map, list, board, chart, signal, log, camera, pin, navigate, wifi-off, user, sun, home.

## Logo
Rounded-square mark with a water drop above two level lines ("water level / watch"); wordmark WaterWatch in bold. See `hifi/logo.svg`.

## Map
MVP prototype uses a vector-free schematic (river, boundary, pipeline links, markers). Phase B: self-hosted Leaflet assets, tile provider as a setting with attribution shown, schematic fallback when tiles unavailable. No CDN.
