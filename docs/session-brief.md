# Session brief — 2026-08-15 (executed)

The author's brief for the reactions-and-plain-language session, committed
so future sessions start from a repo file rather than a pasted document.
Executed on branch `claude/reactions-and-plain-language-0815`; outcomes in
`docs/state.md` §13, row pointers in `docs/defects.md` (2026-08-15 entry).

Governing rule: **Correct first. Fast second. Nothing third.**

## 1 — Reaction capture goes live (whole or not at all) — SHIPPED

- 1a: "Do you like this vote?" Yes/No/Unsure on every federal vote row;
  instant, changeable, one reusable control keyed by target type + id;
  "why we ask" with the approved sentence.
- 1b: identifier-free `reactions` table; hashed browser continuity key
  (`wtp.reaction_key`); `verificationTier` on every row from row one
  (ANONYMOUS; LOCALITY_VERIFIED / VOTER_MATCHED designed); the two-stores
  rule became the n-stores rule in CLAUDE.md with structural guards.
- 1c: demo-grade collection, launch-grade schema. Launch-grade: tier field,
  store shape, no-join guard, tested aggregation contract. Demo-grade
  (T03): enum validation, valid-target-id, payload caps, fail closed,
  per-IP + per-key rate limits (IP never stored). T05: rate intent only.
  Transparency page in the same commit. T08 opened: full hardening is a
  precondition of removing the site password.
- 1d: OFFICIAL_OPENED approved — event + transparency line together.
- 1e gate: burst demonstrably 429s; screenshots of all control states.

## 2 — Two data regressions — SHIPPED

- 2a: settle-path failure. Diagnose first (Netlify logs unreachable
  unattended — recorded); both shapes healthy locally; the failure card now
  names its status; retry action; a failed fetch never renders confident
  zeros (stats/badge/popup all say couldn't-check); rule joined the
  standing guard family. Antimeridian wrap fixed.
- 2b: Prop 142 match-then-deny. All 11 analyses fetched, extracted,
  rendered verbatim under labeled plain-language summaries; honest
  narrower pending note; Prop 319's broken adopted-analysis link recorded
  with the draft fallback labeled as such.

## 3 — Popup architecture — SHIPPED

Two tiers: compact glance cards (visible close + obvious More) and the
one-at-a-time large tier with the subsume rule; meeting popup what-first
with agenda content and comment access; rep popup re-housed; who-governs
lifecycle fixed (once per area, click-into-district, explicit minimize,
zip-change clears state); Last-checked demoted to a footnote; the list
overlay became a centered large surface.

## 4 — The plain-language layer — SHIPPED

- 4a: no identifiers/enum keys render; click-to-copy dead; CLAUDE.md rule.
- 4b: vote-type explainers, keyed data, twelve types, cited definitions.
- 4c: agenda content on the meeting surface; TUSD notice channel hunted
  and wired (`noticeUrl`); the Aug 25 meeting renders its notice with the
  Palo Verde public hearing called out.
- 4d: curated summaries for measures and notices, cited to the exact text
  (content-hash-keyed for notices), tested.

## 5 — Officials completeness — SHIPPED (5d cut, as sanctioned)

Rosters from the bodies' own pages: TUSD, Pima BoS, Tucson M&C (mayor +
six wards), Vail USD, Newbury Selectboard. Mayor blurb verified against
Tucson's council-manager charter. No-mayor-as-fact for unincorporated
areas. Websites on every wired body. NJ rosters open. 5d (sidebar counts
as doors) was the brief's first cut — taken.

## 6 — Ballot and map corrections — SHIPPED

6a certified canvass lineup (scan read by page-image extraction, method
cited); 6b back-to-map; 6c contest source at top; 6d district deselect by
the same gesture; 6e fixed legend with muting; 6f deliberate per-zip
first-view zooms; 6g pointer cursors.

## 7 — Documents and handoff — this file, state.md §13, tracker rows
(P03/T03/T05/T02/T08/D32/M05/P01/D33), ladder's 2026-08-15 rung set,
defects triage entry, transparency verification, ship.

## Standing rules carried

All CLAUDE.md non-negotiables; denominators with counts; screenshot before
believing green; diagnose before fixing; a failed operation may not render
as an empty success; browser-heavy work last (the host died three times on
the results portal); background agents off.
