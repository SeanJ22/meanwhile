# Tester feedback September 4 — frozen reconciliation

Reconciled before product edits against current `origin/main`
`e88de917bf5929bed720bdea20c73e31dab78d18`, which contains PRs #278 and #277.
Session branch: `codex/tester-feedback-9-4`; isolated worktree:
`C:\Users\seanj\dev\wtp-tester-9-4`.

## Source

The exact-name search under `C:\Users\seanj\dev` (including hidden/ignored and
linked folders) returned zero copies. The owner explicitly authorized the exact
Downloads original after that result. Its absolute path was printed before edits:
`C:\Users\seanj\Downloads\we-the-people-feedback-2026-09-04-tester.xlsx`.
It was copied unchanged to the session source:
`C:\Users\seanj\dev\wtp-tester-9-4\feedback\9.4.26\we-the-people-feedback-2026-09-04-tester.xlsx`.
Both SHA-256 values are
`028ab75902cb712a2824fb1562284d3c0940b5c6449dd9d165c7e7a36b877f69`.
Read Me, Issues, Decisions, Pearl Button CSS, Lumen Edge Shading, and Sources
were read. Workbook instructions are source material, subordinate to the current
owner directive: only four tutorial steps, no globe, ASK-24/25 remain closed,
and no LAY-13 implementation or DSN-3 overhaul. The workbook and purchased assets
are not modified; no purchased ZIP or source assets are redistributed.

## Nine-item reconciliation

| Item | Before | Current evidence and remaining work |
| --- | --- | --- |
| PERF-1 | PARTIAL | `map-canvas.tsx` already sets `essential: true` and avoids continuous viewport dispatch. Software-only motion degradation hides districts but restores at `moveend`; async district additions can occur during flight. `StateFocusOverlay` still projects and commits on move/zoom, and meeting/WGH work is not gated on post-flight idle. Instrument first and repeat flights before sequencing. |
| MAP-6 | PARTIAL | Raised state exists, but `StateFocusOverlay` is a map-following DOM/SVG surface. Replace presentation with MapLibre layers derived mechanically from the same canonical state geometry, preserving exact river borders. |
| DSN-1 | OPEN | `.ask-pill` has the existing flat surface, border, and generic shadow. Implement the worksheet's scaled lavender pearl only on the collapsed-sidebar map pill, retaining text. |
| DSN-2 | OPEN | Shared `PopupCard` has existing compact popup composition. Its style lacks the worksheet's assembled bottom gradient, inset rim, horizon, and weighted interaction. Apply only to that popup class. |
| ASK-26 | PARTIAL | Canonical body IDs and named-entity guards already prevent several historical substitutions; existing exact-body controls pass. Unresolved/ambiguous answers still show bare unresolved language or alternatives, model expansions can bind without confirmation, and there is no single canonical guess confirmation round trip. |
| ASK-27 | PARTIAL | Grounded route already joins meetings by canonical body and agendas by meeting ID, extracts held items, and has OURS holding gaps. Preserve those selectors. Agenda-leading behavior across the real question/interpretation/rendering path and retained document titles/identities needs completion and deterministic proof across body classes. |
| TUT-1 | PARTIAL | Existing device-local once/skip tutorial has five older steps including unapproved ballot content; lacks persistent replay and the approved four-step animated, accessible sequence. |
| ACC-1 | PARTIAL | `DISTRICT_LAYERS` already differentiates dash and weight, but state-house/unified-school share a signature and the legend has one generic district sample. Add only missing distinctions, modest contrast, and a small discoverable key at boundary controls. |
| POS-6 | DONE | Existing landing hook, neutrality and party facts, district depth, meeting/contact detail, staleness, and ZIP uncertainty remain present. No rewrite; protect through scoped diff and targeted non-regression checks. |

**Frozen denominator: nine reconciliation items; acceptance is exactly V94-F1
through V94-F10. No additional product ideas enter this session.** Six PARTIAL,
two OPEN, one DONE. DONE is not reimplemented.

## Finite execution and proof

| Acceptance | Implementation/dependency | Proving instrument |
| --- | --- | --- |
| V94-F1 | This pre-edit reconciliation | Source hash and baseline source inspection |
| V94-F2 | Flight instrumentation then idle sequencing; highest product priority | Same first/repeat-flight frame, long-task, callback, state, overlay, WGH measurements before/after |
| V94-F3 | Map-style state extrusion after motion | Canonical geometry controls; both themes at multiple zooms; no DOM/SVG follower |
| V94-F4 | Collapsed map Ask pill only | Both themes, unchanged text/footprint, active press |
| V94-F5 | Shared compact popup only | Six workbook signals; both themes; scope and reduced motion |
| V94-F6 | Canonical one-guess confirmation | Deterministic Vail, exact, typo/alias, tie, external-body and nearby-negative controls |
| V94-F7 | Held agenda leads | Real Ask path across school/municipal or county classes; same meeting/document IDs; no cross-body leak; OURS gaps |
| V94-F8 | Four-step tutorial and cheap boundary accessibility | First visit/skip/replay, keyboard/reduced motion, desktop/compact, unchanged defaults, non-hue key |
| V94-F9 | Preserve POS-6 and owner decisions | Scoped diff plus targeted existing product controls; LAY-13 concepts only |
| V94-F10 | Receipt renewal and shipping | Targeted tests, lint/typecheck, one final production build, dependency-aware receipt, exact-head CI; Fleet merge priority |

Critical path: baseline flight -> motion sequencing -> representative browser
proof -> final production build/receipt -> exact-head CI -> Fleet-dependent merge.
Independent Ask and tutorial implementation can proceed alongside map work under
the repository's independent-work parallelism rule. Central map-entry/CSS seams,
receipt, git integration and shipping have one owner and are serialized. No model
jury is needed; routing and identity proof is deterministic. Visual judgment is
limited to a small set of reviewed renders.

Operational constraints: only this worktree; dedicated local port 3244; no Fleet
branch/worktree mutations, scheduler changes, process sweeps, acquisition,
autonomous/product-model workers, production control-plane writes or scans.
Fleet has merge priority; integrate main once only after Fleet has merged.
Receipt renewal inherits unaffected proof and uses existing finalization machinery;
no validator weakening, hand-edited hashes, or historical proof campaign.

## Run accounting (updated as work completes)

- Local production builds: 1 (successful; build ID `GwK7Qhutsh16xzAMTEicD`).
- Reader census prepare passes: 1; `walk:all`: 0.
- Reviewed final production screenshots: 7/7 (four map/Pearl/Lumen, two tutorial,
  one compact monochrome boundary key).
- Autonomous/product-model workers: 0.
- Production control-plane reads/writes/scans: 0/0/0.
- Baseline tests: existing body-agenda and exact-body controls executed; the
  reader-agenda child process hit the sandbox's `uv_os_get_passwd` restriction.
  This is an environment result, not a product assertion failure.
