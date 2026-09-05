# Remaining visual feedback from September 2

Baseline: `fa90d4c20c696ccf7a085e266d264528df1716f2` (current main at session start).
Source: original workbook Issues rows 2–15, transcript, and all 11 original PNGs in
`feedback/9.2.26`. All 11 images were opened and read. Workbook status fields were
ignored. Local current-main UI was rendered with database/model credentials disabled.

## Frozen reconciliation

| Workbook row | ID | Before | Current-main observation |
| --- | --- | --- | --- |
| 2 | LAY-12 | OPEN | Selected Tucson boundary still covered by two expanded cards at 900px and 390px. Desktop reference remains intact. |
| 3 | MTG-15 | DONE | Parks and Recreation meeting panel shows Local immediately after its wrapping title, using the shared tier tag. |
| 4 | BAL-40 | DONE | Wordmark leads the smaller ballot headline. |
| 5 | BAL-41 | DONE | Every rendered race/measure has its canonical tier tag; Statewide/Local headings carry tier colors. |
| 6 | BAL-42 | DONE | Current held county-office explanation renders in ballot notes; no acquisition or new civic adjudication required by this visual session. |
| 7 | BAL-43 | OPEN | Offices still flow down independent desktop columns; candidates stack inside them. |
| 8 | BAL-45 | DONE | Local summary face uses the same sans font as state measures. |
| 9 | BAL-46 | DONE | Local measures have held plain-language summaries. Part-by-part remains conditional on actual enumerated provisions; no invented subdivision. |
| 10 | BAL-47 | DONE | Local authority text remains available inside a closed official-text disclosure. |
| 11 | BAL-48 | DONE | Extended Corporation Commissioner mechanics are closed under More info; office explanation remains open. |
| 12 | ASK-24 | PARTIAL | Irrelevant Senate/people removed, but the structured answer buries the held summary after procedure and full legal analysis. |
| 13 | ASK-25 | DONE | Question relevance filter, short generated-answer limit, token ceiling and cached prefix already implemented. A live cost study is not a visual remainder. |
| 14 | POS-4 | DONE | Desktop retains boundary, Who Governs Here and district card together. |
| 15 | POS-5 | DONE | State summaries, part-by-part and collapsed official analysis retained. |

**14 original issue rows: 11 DONE, 1 PARTIAL, 2 OPEN.** The implementation denominator
is exactly LAY-12, BAL-43 and ASK-24. No acceptance rows may be added after this freeze.

The nine Carryover rows are cross-references: the first three map to these issue
rows; the five previously fixed items remain present (See the rest, top ballot
pills, quoted/attributed taglines, available portraits, spelled-out dates). The
remaining agenda-copy observation is DONE under current governance: an unobserved
publisher slot must retain the truthful OURS disclosure. Its copy must not revert.

Baseline captures read: ballot top, Governor, local/state measures, mechanics,
structured Ask, selected map at desktop/tablet/phone, and meeting panel. Stored in
the session's ignored `.scratch/before/` directory. These demonstrate the three
remaining defects; source/data controls support the already-DONE rows.

## Scope and proof

Only display/layout changes are authorized. No civic holdings, retrieval, identity,
business rules, readiness semantics, acquisition or worker activity changes.
Targeted browser checks during work; one final production build and CI pass when
stable. No large reader census or `walk:all` run, per the current owner directive.

Permanent targeted command: `pnpm verify:visual-feedback-9-2`, against a local
server with database and model credentials disabled. It checks both ballot source
branches at 1440/900/390px, the real structured Ask route, and municipal/school/
congressional map selection in AZ plus a municipal control in NJ. Captures are
reviewed separately as images; a passing capture command alone is not visual proof.

The obsolete BAL-25/SB0831 walk assertions were migrated from office columns to
candidate columns within offices. This records the BAL-43 supersession; it does
not run or enlarge the standing walk.

## Final local production proof

Implementation frozen and built at `1082e85040859dd04e6020b003f810f6da7e2d3f`.
Final browser run: 2026-09-04 at 19:33:45 America/Phoenix, against
`http://localhost:3210`. All 11 cases passed. All 10 final captures were opened
and read as images, not merely generated. Evidence lives in the ignored
`.scratch/visual-feedback-final/` directory with the complete `results.json`.
This evidence-only closeout does not change the tested implementation.

| Changed row | Measured final result | Image proof reviewed |
| --- | --- | --- |
| LAY-12 / row 2 | Municipal, unified-school and congressional selections at 85701 plus municipal at 07866: two default pills, one expanded panel, identity retained on minimize, 1.5s glow and reduced-motion suppression. Pill stack remains separate from the footnote; boundary stays exposed. Desktop reference preserved. | `LAY-12-desktop-reference.png`, `LAY-12-85701-municipal-900-dark.png`, `LAY-12-85701-school-390-light.png`, `LAY-12-85701-congressional-900-light.png`, `LAY-12-07866-municipal-390-dark.png` |
| BAL-43 / row 7 | 85701: 10 offices / 24 candidates. 07866: 9 offices / 26 candidates. At 1440/900/390px, office blocks have equal full width, a maximum 12px inter-office gap, and zero horizontal overflow. Candidate columns are two on desktop and one below 1024px. | `BAL-43-85701-1440.png`, `BAL-43-85701-390.png`, `BAL-43-07866-1440.png`, `BAL-43-07866-390.png` |
| ASK-24 / row 12 | Actual grounded route returns summary `ballot-az-pima:prop-141#summary`, six records and zero contacts, without model synthesis. Exact held summary and its source lead; Further records (5) is closed initially and reveals the five remaining records on expansion. | `ASK-24-held-summary.png` |

Targeted tests: **36/36 passed**, covering the existing visual feedback,
ballot composition/Ask entry, shared summary-first renderer, browser construction
and label tracking. Post-build feedback checks: **16/16 passed**. Full lint:
**zero errors**, 37 existing warnings. Typecheck passed. Build-output budgets
passed; runtime trace check found **zero failures** across its existing 14 routes,
35 requirements and 63 files.

One production build completed successfully. Two earlier invocations failed on
local setup (an external node_modules junction, then stale development-generated
route types); neither required a product-code change. The successful build and
final browser proof use the same frozen implementation. No large reader census,
`walk:all`, civic acquisition, database verification, model synthesis or autonomous
product worker was run. Current main was checked once at shipping and had not
advanced from the reconciliation baseline.

**Closure: all three frozen remaining rows resolved; the 11 previously-DONE rows
were not reimplemented.** The canonical sweep proof is updated only for LAY-12,
BAL-43 and ASK-24. Original screenshots, transcript and workbook remain untouched.

NON-BLOCKING FOLLOW-UP: the existing NJ U.S. Senate tier label reads State; this
is an unchanged civic identity/tier mapping, outside this visual-only denominator.

## CI closeout and scope boundary

PR #277's first CI run, `33939645841`, passed both production-build modes. The
test step reported 5,397 passed, seven failed and five skipped. Test was the only
failed gate step. Six test failures were branch bookkeeping/token
issues and were repaired within the frozen visual scope:

- The browser check now floors its selected-case denominator and refuses unknown
  feedback IDs before launching a browser.
- The canonical guard inventory records the intentional BAL-25 to BAL-43
  supersession and the new shared Ask renderer control.
- The boundary glow uses named motion tokens. The reviewed 13px text, 10px
  vertical inset and 44px header clearance derive from existing scale tokens;
  the action-pill size difference is explicitly documented. No baseline grew.

The six affected test files pass **35/35** targeted checks. Typecheck passes. An
isolated browser comparison of the built implementation's source CSS and the
token-compliant source CSS gives identical duration (1.5s), easing, font size
(13px), padding (10px 16px), minimum height (44px), and header clearance (44px).
The earlier ten reviewed screenshots therefore retain their visual claim. This
repair ran no additional production build, screenshot campaign or full suite.

**Merge remains blocked by an existing proof-policy boundary**, not an unresolved
original visual row. `tests/reader-last-mile-census.test.ts` requires the prior
complete reader receipt to match the current source hashes and its frozen
LM-F1..LM-F10 invalidation report. It rejects the six deliberately changed visual
reader files: `app/ballot/page.tsx`, `app/globals.css`,
`components/ask/answer-records.tsx`, `components/map/map-entry.tsx`,
`components/map/popup/district-popup.tsx`, and
`components/map/popup/popup-card.tsx`.

The current owner directive forbids reopening Reader Last-Mile or running its
large census. Its validator and frozen evidence remain untouched; no hash was
rewritten to claim unexecuted proof and no gate was bypassed. The completed visual
work is preserved on the PR for a separately authorized resolution of that
shipping-contract conflict. No production deploy is claimed.
