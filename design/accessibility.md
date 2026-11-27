# Accessibility (target WCAG 2.2 AA — a design goal, not a compliance claim)

- **Not colour alone**: status uses shape + icon + text; priority and sensor health chips have icons and words; SLA breach has icon + words; charts have value labels and data tables.
- **Contrast**: computed by `tools/contrast.mjs` — 62 token pairs (31 per theme: text 4.5:1, UI/graphics/focus 3:1) all pass; plus 2,422 rendered text nodes sampled across 11 routes x light/dark x desktop/mobile, 0 below threshold. See `screenshots/contrast-results.json`.
- **Keyboard**: skip link; all controls are buttons/links/selects; map markers are focusable (`role=button`, Enter/click) with a visible focus ring; board uses selects + buttons (no drag-and-drop); native `<dialog>` for modals.
- **Focus**: visible 3 px focus ring (contrast checked); focus moves to `main` after navigation.
- **Screen readers**: landmarks (header, nav, main), labelled controls, `role=alert` for contamination banners and form errors, aria-live region for toasts, charts have `role=img` + descriptive labels, status chips carry text. Map has a list equivalent with the same actions.
- **Targets**: >= 44 px (36 px for dense secondary buttons inside cards — accepted under WCAG 2.2 target-size minimum 24 px; primary actions 44–52 px).
- **Language**: Swahili/English switch; content strings carry `lang` handling planned for Phase B (`lang` attribute on translated blocks); safety text in Swahili needs native review.
- **Motion**: reduced-motion honoured. **Zoom/reflow**: layout reflows at 390 px; text resizable.
- **Not yet tested**: real screen readers (VoiceOver/TalkBack/NVDA), real low-end devices, forced-colours mode, 200%/400% zoom run. These remain manual Phase B checks.
