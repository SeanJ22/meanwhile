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
