# September 4 — scoped Pearl and Lumen implementation

Specification: `feedback/9.4.26/we-the-people-feedback-2026-09-04-tester.xlsx`,
the **Pearl Button CSS** and **Lumen Edge Shading** worksheets. Both were read
from the byte-identical session copy before implementation. The current owner
brief limits Pearl to the collapsed-sidebar map Ask pill and Lumen to compact
popup cards; no source ZIP, fonts, broad palette adoption or design-system
integration is involved.

## Pearl: worksheet adaptations

- `components/shell/ask-pearl.module.css` is imported only by `PillCluster`.
  Its class is attached only when `placement === "map"`; every selector also
  requires `data-ask-pill="map"`. Sidebar and WGH Ask placements keep their
  existing treatment. Ballot Ask and other buttons are unchanged.
- There is a reference/baseline discrepancy: the worksheet calls the previous
  pill lavender, while the reconciled main renders `background: var(--panel)`
  and declares no Ask-specific lavender token. The adaptation reuses the
  app's existing `--online` lavender (`#9b7fd4` dark / `#6f5aa8` light) through
  a locally scoped Ask variable. No party or voting color token is borrowed.
- The existing 44px minimum height, 14px horizontal padding, 7px gap, 15px
  type and border width remain inherited. The source's hero padding/type
  never enter the app. The rounded ellipse and upper inset highlight keep
  the source's relative positions; the five shadow layers scale down.
- White inset alphas are reduced from reference 0.3–0.5 to 0.13–0.18 at rest;
  the curved top gradient is 0.15 instead of 0.3 and its edge is 0.4 instead
  of 0.8. Light mode further quiets the broad highlight to protect text
  contrast. Light mode uses the existing white panel token for the ink;
  dark mode uses the existing dark background token.
- Active presses down 2px with shorter shadows. There is no hover label swap
  and no text-fading mask; the existing `Ask: a meeting?` words and accessible
  name still come directly from `ASK_PILL_LABELS`. Focus has a visible outline.
  Reduced motion removes highlight travel and makes transitions immediate.

## Lumen: six worksheet signals

`components/map/popup/lumen-popup.module.css` is imported only by `PopupCard`,
shared by the compact district, official battlecard and meeting popups.

| Signal | Adaptation |
| --- | --- |
| Bottom lighting | `radial-gradient(ellipse at bottom, peak 0%, floor 65%)`; existing `--panel` floor and 18% lightened peak in dark; original light panel peak and 7% darker floor in light. |
| Hairline | 1px inset shadow, no layout border; dark white 0.10 → 0.16 and light black 0.08 → 0.14. |
| Horizon | Bottom 1px line, left 15%, width 70%, rest opacity 0.18 → 1 on hover/focus within; white in dark and existing lavender at 60% alpha in light. |
| Elevation | Worksheet raised variant for cards floating over the map: `0 2px 4px` and `0 24px 48px -16px`, alphas 0.5/0.7 dark and 0.25/0.35 light. |
| Weighted motion | Exact 1s `cubic-bezier(0.15, 0.83, 0.66, 1)` rim/horizon transitions; 1ms reduced-motion override (the existing global floor can shorten it further). No card hover lift. |
| Assembly | Existing surface → radial layer → inset rim + outer shadow → horizon. Relative position, isolation and clipped overflow; current app font, radius and three content bands retained. |

Hover/focus illuminates the rim and horizon; the card surface color does not
change. The fixed header, body scroller, More footer, facts and contact links
are unchanged.

## Targeted verification

- 31/31 existing checks pass across `small-popup`, `pill-cluster`,
  `ballot-ask-pill`, `motion-tokens` and `rhythm-tokens` test files.
- Direct local ESLint passes for the two changed TSX files. `pnpm exec`
  attempted a package-manager dependency check and aborted before a non-TTY
  modules purge; direct `node node_modules/eslint/bin/eslint.js` then passed.
- The existing motion scanner reports zero raw transition durations in both
  new modules. `git diff --check` passes.
- Browser evidence remains part of the combined session's small representative
  visual set. This source/test record does not certify rendered appearance.
