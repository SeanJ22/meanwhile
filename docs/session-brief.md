# Session brief — g11 (written 2026-08-17 by g10)

The queue, exactly where g10 stopped. Resolution, no drift.
On completion, overwrite this file.

This session runs unattended. Nobody is available to answer.

**NOTHING IN THIS BRIEF IS CUTTABLE.** Work items in order, complete each
whole, keep starting the next until the session genuinely ends, defer whole
with a row, and report completion against the denominator. Where a disposition
in `docs/deferred.csv` and this brief disagree, the disposition governs. Read
each row's full Notes in `docs/tracker.csv` before building; the specs live
there and this brief does not restate what a row already holds.

**THE AUTHOR'S STANDING RULE:** a screenshot or named instance is an EXAMPLE of
a class-wide defect. Fix the class at the shared code path, audit everywhere
the pattern occurs, report the full count found and fixed.

---

## 0 — R36, and why it now costs more than a row

**The author swapped the variable NAMES and not the hosts.** g9 diagnosed the
swap; the author acted; the fix landed half-right.
`WTP_PRODUCTION_DATABASE_URL_READONLY` now carries role `readonly` — that half
is genuinely done — but it points at `ep-weathered-cherry`, the LOCAL branch,
instead of the production endpoint `ep-dry-river-axwtolzc-pooler`. A Neon role
lives on the branch it was created on and nowhere else, and this one was
created on production, so **the variable does not authenticate at all**.

The second consequence is bigger than the row and it will keep costing every
session until it is fixed: **there is no handle to the production database.**
g10 could not run the run-id census the standing report calls for,
`pnpm feedback:read --target=production` cannot work, and `pnpm walk:all`
prints its landed-rows line as COULD NOT READ rather than as a number.

To close it, in `.env.local`: put the `readonly:…` string at the PRODUCTION
endpoint `ep-dry-river-axwtolzc-pooler` into
`WTP_PRODUCTION_DATABASE_URL_READONLY`. Then `pnpm verify:readonly` — it exits
non-zero printing "R36 STAYS OPEN" until all ten checks pass, and exits 0
printing "R36 CLOSES" when they do. **Do not create or alter roles yourself,
and do not force it.** If the author has not done this by the time you run, say
so and carry on; everything below is reachable without it.

**R42's own defect is FIXED and proven** — `pnpm verify:local-write` writes
through the application's own paths, reads back by run id, and cleans up. The
row stays open only on R36's remaining half and on the production census that
cannot be taken. Both clear together.

**R41 still has no ruling anywhere in the repo.** Not in `docs/deferred.csv`,
not in `state.md`, and `docs/abuse-policy.md` still records the question as
open. If a ruling of A appears, build the optional reply field exactly as R41's
Notes spec it — one optional field, its own column, joined to nothing, excluded
from the T09 scrub while the message body stays scrubbed, `/transparency`
updated in the same commit. If the ruling is B or still absent: touch nothing,
note it, and the row stays the author's call. T05's gate on ask-box free text
stands either way — R41 does not move it.

---

## 1 — The two remainders of g8's item 4, same order, specs in each row

D19, D18, D24 and D31 are DONE (g10) and leave this list. Two remain:

* **M12** — the school overlay split into unified / elementary / secondary:
  three types, three sources, three toggles, tests updated.
* **D22** — the NovusAgenda adapter against a LIVE tenant only; the Vail
  tenant is an archive. If no live tenant exists in scope, that finding is the
  deliverable and the row records it.

## 2 — Resume the g7 item 4–8 block, whole, in order

Untouched by g8, g9 and g10. The full specs are in the g7 brief and its
referenced rows, unchanged:

* **item 4** — the ask surface: one build closing A01, A02, A07-same-PR, M119,
  A06, G05-4d; copy promises only what routes.
* **item 5** — G05: rules 4a–4c, 4e, 4f, 4h.
* **item 6** — G07: the pill label.
* **item 7** — D35: positions three-answer machinery.
* **item 8** — the fourteen finish-now rows: M134, M136, M139, M135, M07, B15,
  G10/8a (the tracker row G10, distinct from the g10 session letter), P01, P03
  with free-text gated on T05, D25, D29, D06 under the unchanged structural FEC
  rule, M93 proposal-only.

## 3 — H02, whose surface exists

H02's missing-body feedback link is the surface R40 shipped, with a second
entry point. The `feedback` store's `surface` column already holds `COVERAGE`
for exactly this, so the link needs no new page and no new store — wire it,
pass `surface="COVERAGE"`, and the author's queue tells the two apart.

## 4 — What g10 left as work, named rather than left to be found

Not new rows; each is recorded in the row it belongs to.

* **The seven Pima special districts are UNRESOLVED and resolvable.** D19 found
  Flood Control, Library, Improvement, Stadium, Rocking K South CFD, Wildflower
  CFD and Ajo Domestic Water ID acting inside Pima County's own agendas. D31
  settled how to identify them. What is missing is a READ of each district's
  own published page — a heading proves a government acted, it is not a source
  for its name or its boundary. That read is the next step and it is the 4.7.6
  thesis becoming coverage.
* **85 active governments are absent from the canonical list**, named in full
  in `docs/canonical-reconciliation.md`. Contributing them upstream would close
  D24's remaining gap at the source; nothing here depends on it.
* **`PLACELESS_LOCATIONS` is append-only and short.** A vendor phrasing not on
  the list makes that vendor's virtual sittings drop as an unknown venue. Add
  as observed.

---

## Handoff

`pnpm walk:all` against production, new checks appended, old and new counts
stated, the identity set emitted — it must stay 100% distinct, and a duplicate
is a NAMED REGRESSION that fails the run. `state.md` via `pnpm stamp`. Tracker
rows by ID; `docs/deferred.csv` NOT regenerated. Update `docs/session-map.md`
with this session's closures. Playbook diff or explicit "nothing new".
Overwrite `docs/session-brief.md`. `pnpm handoff --ship` with the R22 gate;
verify the deploy LANDS via `/api/build` and state the SHA.

Standing report in the established format: ship status; test, lint, build
counts with allowlisted warnings named; every mirror file by name with bytes;
`context.md` against its 40 KB cap; tracker rows touched by ID;
`stamp-audit.md` inline; production rows by run-id census — expected 0 organic
throughout, and stated as COULD NOT READ rather than as zero while R36 is open.
Completion against the denominator, and within each item, sub-items completed
of sub-items listed.

The report ends with **"Needs your hands."** followed IMMEDIATELY by a NUMBERED
list of exactly what needs the author — every ruling, every console action,
every open question — even where it repeats the body. An empty list is stated
as "Nothing — the queue continues."

## Standing rules

All of `CLAUDE.md`'s non-negotiables. Diagnose before fixing. No empty success.
Never assert absence. Stated N equals rendered rows. Denominators always
stated. A screenshot is an example of a class, never the instance. Screenshot
before believing green; where a measurement can pass while wrong, measure the
right thing. Every reader-facing date is wall clock via `pnpm stamp`. A render
default may never manufacture a claim.

**Correct first. Fast second. Nothing third.**
