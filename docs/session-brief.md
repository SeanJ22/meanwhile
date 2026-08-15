# Session brief — party gets proven, the day-not-hour meetings land, and the faces finish

**2026-08-15, third session of the day.** Committed for the record, as the
standing convention requires. The author's rulings and orders are reproduced
verbatim below; what the session did with them is `docs/state.md` §26 and the
tracker rows named in each item.

---

This session runs unattended. Nobody is available to answer.

* Reversible: cheaper-to-undo, recorded with the rejected alternative, keep
  going. Irreversible: skip, tracker row, continue.
* Hunts never stop — more rungs, `attemptedAt` on every rung. The long way is
  a way.
* Browser-heavy steps LAST, inline, no background agents, strictly sequential.
* Live on every push; nothing half-finished to `main`. End with
  `pnpm handoff --ship`, verify on `main`, verify the deploy, standing report
  ending with "Needs your hands." Probe rows named per the standing rule.

Session-open: read `docs/defects.md` and triage.

## The author's rulings, now law

* The stamp audit is APPROVED. `docs/stamp-audit.md`'s recovered dates stand
  as ruled — apply whatever the audit held pending, retire the corresponding
  allowlist entries in `tests/doc-dates.test.ts`, and the AUTHOR_DECISION
  group goes (or stays) empty. Report the allowlist count before/after.
* M59's schema decision: YES — the "we know the day, not the hour" meeting
  shape is right.
* M62: build the certified-results rung. The author's order — this is no
  longer a recorded row, it is this session's lead content item.
* `sos.nh.gov`'s 403 is IP-class bot blocking (it blocks datacenter ranges;
  confirmed from two independent networks). A 403 is NEVER a dead end. The
  rungs for any NH SoS read, in order: (1) the committed filing snapshot
  already in the repo; (2) the search-index cache — search tooling returns NH
  SoS page content and document paths because state sites allowlist crawlers
  (PROVEN working); (3) direct document paths — the block is on the HTML site,
  so files under `sos.nh.gov/sites/g/files/...` may fetch clean even when
  pages 403; try per document; (4) the Internet Archive's dated mirror
  (independently timestamped — record the snapshot URL as the source); (5) the
  author's residential browser, a "Needs your hands" item, never a blocker.
  Residential-proxy spoofing is PROHIBITED — every byte through the front
  door. Record this ladder in the source-ladder doc.

Correct first. Fast second. Nothing third.

## 1 — M62: party for local partisan bodies, from certified results

No curated local body publishes party, and that silence was being read as
"nonpartisan" — false for genuinely partisan local offices. Build the rung:

* Per curated jurisdiction (all twelve rosters), determine FIRST whether the
  office is partisan or nonpartisan by law/charter — a nonpartisan office
  correctly renders nothing, and that finding (with source) closes the row.
* For partisan offices: the certified election results from the county or
  municipal election authority (county clerk, county board of elections, NH
  SoS via the rung ladder above) state each winner's party. Read the certified
  result, record `sourceUrl` + `collectedAt`, render party in the standard
  colored scheme.
* UNDETERMINED remains the honest state where certification can't be located —
  recorded with rungs, rendering nothing. Never inferred from endorsements,
  news, or party websites: certified results or silence.
* Report the twelve rosters as a table: partisan/nonpartisan/undetermined,
  source per row.

## 2 — M59: the day-not-hour meeting shape

Rockaway's AgendaCenter and Merrimack's notices page archive real past
meetings with a date and no start time. Approved shape:

* The meeting schema gains an hour-unknown state; ingestion accepts date-only
  meetings from these sources.
* Render honestly: the date, and "time not posted — check the agenda" (or
  register-appropriate equivalent) where the clock would be. Calendar links
  render as all-day events with the same note in the description.
* Ingest the two known archives; report counts gained per jurisdiction.
* Guard: a date-only meeting never renders a fabricated or defaulted time.

## 3 — D50 finishes: the challenger sweep and the locals remainder

* The Commons sweep for the ~76 ballot challengers (attribute-verified,
  machine-checkable licenses) and the campaign `og:image` rung where it yields
  a clean solo self-published portrait — canonical failure classes keep
  failing.
* The 48 remaining curated locals: official jurisdiction/board pages under
  door 2, then Commons.
* The new playbook rung from last session applies everywhere: VERIFY THE
  ABSENCE — a page that "has no photo" is checked for mislabeled images (wrong
  alt text, seals, sprites) before the miss is recorded.
* Manifest + generated report updated; final X of 750 per tier; D50 → Done or
  the honest remainder named with rungs.

## 4b — D53: the Census Geocoder, approved — the street input finishes

The author approved the Census Bureau's geocoder (federal source, free, no
key) as the external geocoding source. Wire it: a street entered in the active
zip geocodes to a point via the Census Geocoder, the map re-centers, and
meetings/officials/counters resolve to that point (completing the design
pass's shading work). Record the source in the source ladder; failures fall
back to the shipped shading behavior, never an error state. Device-side; the
point is never logged or stored — extend nothing about the search log.

## 4c — Three visible defects from the author's production pass

* The NH who-governs card floats off the top — its upper portion renders above
  the viewport at desktop (author screenshot at 03255). Same overlay-bounding
  family as M52/the control band; diagnose, fix, extend the bound guard to
  this card at desktop widths.
* The sidebar footer collides with the map legend at mobile width — "LAST
  CHECKED … could" text overlaps the legend chips. Fix the layering/layout;
  check every fixed footer element at 390px.
* Picks shown on another state's ballot need their jurisdiction named. Viewing
  the NH ballot with AZ picks stored shows the AZ picks unlabeled — correct
  behavior, missing sign. The picks card labels each pick's jurisdiction
  (e.g., "85701 · Arizona") whenever the viewed ballot's jurisdiction differs
  from a pick's. Device-local rendering only.

## 4 — R16: the future-date inventory gets categories

117 future dates sit in `docs/`, pinned by count. They are two species and the
scan must learn the difference:

* Expected-future dates — election day, registration deadlines, the September
  8 primary, any date that is SUPPOSED to postdate every scan until it passes:
  annotated as such (a marker the test recognizes), each verified against its
  source once, then never warned about again until it becomes past.
* Suspicious-future dates — session-label residue and anything else
  unexplained: corrected via the stamp-audit pattern (git evidence, never
  guessed) or left failing loudly.
* The test's report distinguishes the categories; the allowlist budget shrinks
  to the suspicious set only. Report before/after counts.

## 5 — Final pass and handoff

Walk at 390×844 as a stranger: a local partisan official rendering party with
its source, a day-only meeting rendering honestly with its calendar link, new
challenger faces spot-checked against sources. Supersede
`docs/tester-pass.md`. Documents: `state.md` (dates via `pnpm stamp`), tracker
in place (M59, M62, D50, R16 statuses honest), next free IDs verified.
Overwrite `docs/session-brief.md`. Ship, verify deploy, standing report ending
with "Needs your hands."

## Order, and cuts if short

1 → 2 → 3 → 4b → 4c → 4 → 5. If short: thin 3 to the challenger sweep (locals
named as remainder), then defer 4 whole. Never cut 1, 2, 4b, 4c, or 5.
Documents never cut.

## Standing rules

All of `CLAUDE.md`'s non-negotiables including the uniqueness invariant, the
organizations-as-filed rule, the blurb-source rule, n-stores-never-join,
equal-effort-per-candidate, probe-rows-named, and verify-the-absence. The
playbook clause stands. The stranger test. Denominators with counts; stated N
equals rendered rows; screenshot before believing green; diagnose before
fixing; never assert absence; a failed operation may not render as an empty
success; reader-facing dates are wall clock; every date written into any
document comes from `pnpm stamp`; a URL cited must have been fetched and
verified.

---

## What the session did with it

* **Order taken, with one deliberate change.** 4b and 4c are on the
  never-cut list, so they were done BEFORE item 3 rather than after, to
  guarantee they landed if the session ran short. It did run short — item 3
  was thinned to the challenger sweep exactly as the cut rule allows, and the
  48 locals are named as the remainder.
* **Nothing was cut from 1, 2, 4b, 4c, 4 or 5.** All six shipped.
* **Item 3 thinned as sanctioned**, and it shipped a zero: both rungs walked
  to the end for all 76 challengers, nothing shippable, and a doctrine
  question raised for the author rather than answered by the session.
* **The stamp audit held nothing pending.** All 11 stamps agree with git;
  AUTHOR_DECISION was already empty and stays empty. The allowlist shrinking
  the ruling asked for happened under R16 instead, where it belonged: 26
  entries / 118 occurrences → 16 / 81.
* **The NH ladder was walked rung by rung and recorded**, reaching the
  document at rung 4.
* **One thing needs your hands, and one needs your ruling** — both in the
  standing report and in `docs/state.md` §26.
