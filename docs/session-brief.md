# Session brief — g13 (written 2026-08-17 by g12)

Queue 2 is nearly empty. What is left of it is eleven rows the g12 brief
called "finish now" and g12 did not reach — they were deferred whole, never
started, and each carries a dated row saying exactly that. **This session is
those eleven rows, in the brief's own order, and nothing else until they are
gone.**

This session runs unattended. Nobody is available to answer.

**NOTHING IN THIS BRIEF IS CUTTABLE.** Work items in order, complete each
whole, keep starting the next until the session genuinely ends, defer whole
with a row, and report completion against the denominator. Where a disposition
in `docs/deferred.csv` and this brief disagree, the disposition governs. Read
each row's full Notes in `docs/tracker.csv` before building; the specs live
there and this brief does not restate what a row already holds.

**THE AUTHOR'S STANDING RULE:** a screenshot or named instance is an EXAMPLE
of a class-wide defect. Fix the class at the shared code path, audit everywhere
the pattern occurs, report the full count found and fixed.

---

## 0 — What g12 closed, so you do not re-derive it

**Do not re-open any of these.** A01, A02, A06, A07, M119, G05 (all seven
rules), G07, D35, M134, M93.

Four things g12 built that the rows below now inherit, stated so you build ON
them rather than beside them:

* **The matcher is strong-match only.** Two distinct keyword hits, or an exact
  name, or a curated destination phrase. Everything weaker falls to the
  classifier; where that is unavailable the reader gets the refusal with the
  four destinations offered. `STRONG_MATCH_MIN_HITS` in `lib/routing/match.ts`,
  `lib/routing/exact-name.ts`, and the proving case is permanent in
  `tests/ask-matcher.test.ts` AND in `walk-all` section H.
* **There is ONE pill cluster and ONE text input.** `clusterPlacement`
  (`lib/map/cluster-placement.ts`) decides where the cluster goes from two
  booleans; `components/shell/search-box.tsx` is DELETED. If you need a search
  box, you need the one in the ask panel.
* **The rail is a bounded card**, not a full-height column. It ends where its
  content ends and scrolls internally past `100dvh` minus insets and safe
  areas. `--rail-width`, `--rail-inset`, `--rail-gutter`.
* **`askWasAnswered` is the single definition of "answered".** If you add a
  fourth kind of answer to the ask box, add it THERE — not to a second
  expression in the component.

---

## 1 — The eleven rows, in this order

Each row carries its spec and its remainder. Read it, ship the remainder,
close or update honestly.

**M136** — body battlecards to person-card depth. Seven sections, an honest
absence line per section, and the test is named in the row: Pima, Tucson and
Tucson Unified each render every applicable section with either content or an
honest line, and the walk asserts it on all three.

**M139** — the half-load, diagnosed BEFORE it is fixed. Two mechanisms worth
checking first, both from g12's own work rather than speculation: the rail is
no longer full-height, so a blank rail is now content that did not arrive
rather than a rail that painted empty; and g12 found a real hydration mismatch
of exactly the class this row's suspects describe (a component reading
`localStorage` during render, server and client disagreeing, React discarding
the tree). Then the zip control's geometry, the districts panel's two sections
with a stated N each, and the load budget measured on production with a cold
cache, method and profile stated.

**M135** — the every-row-opens-a-card audit, per-surface counts. The districts
panel's rows, the meetings list's rows and the search results have not been
walked one by one. Note that "the search results" now means the autocomplete
inside the single ask input.

**M07** — returning user: zip remembered, confirm on return, district NEVER
assumed.

**B15** — the laws half. 0 of 20 law rows carry a verified roll call, and the
route that closes it is unchanged: congress.gov API, search the bill by title,
take its number FROM THE RECORD, then take that bill's roll calls in both
chambers. **Bill numbers from the record, never from memory.**

**The tracker row G10, sub-item 8a** — bytes and layer counts per active state
at 85701 and at 03255 with neither containing the other's; both themes, twelve
frames plus the two no-active-state frames; the stated exclusion distance and
the reasoning for it.

**P01** — measures decomposed into contested provisions: funding, program,
oversight, sunset.

**P03** — reactions extend to measures and provisions. **FREE TEXT DOES NOT
SHIP.** The T05 gate stands and R41's reply field does not change it. One thing
you inherit: `lib/ballot/derived-picks.ts` does not know what a candidate is,
so the moment a measure carries a reaction target, a Yes or No on it becomes
the pick with no second code path — M134's rule 5 is already tested against
that.

**D25** — comment access, ladder per body. The honest UNKNOWNs want real rules
and the per-meeting override has no consumer.

**D29** — Tucson's 56 boards: 5 wired of 56 stated. Move the number, and state
both halves whichever way it moves.

**D06** — the funding tracker under the unchanged structural FEC rule:
reader-facing display only, contributor data never enters anything sold.

---

## 2 — Only if item 1 is genuinely finished

Queue 3, in the session map's own order. Do not start it while any of the
eleven remain.

---

## Handoff

`pnpm walk:all` against production, new checks appended, old and new counts
stated, the identity set emitted — it must stay 100% distinct, and a duplicate
is a NAMED REGRESSION that fails the run. Do not transcribe the check count
from a report; diff your run's census against the previous run's. **Section H
is new this session and it is the one most likely to be affected by anything
you touch in the shell** — it counts rendered pill clusters, measures the
rail's geometry at 390×844, and asks the ask box five questions.

`scripts/walk-r41.mts` writes real feedback rows and is excluded by name from
the standing suite — run it deliberately with `WTP_RUN_ID` set, which it
requires and refuses to run without.

`state.md` via `pnpm stamp`. Tracker rows by ID; `docs/deferred.csv` NOT
regenerated. Update `docs/session-map.md`. Playbook diff or explicit "nothing
new". Overwrite `docs/session-brief.md`. `pnpm handoff --ship` with the R22
gate; verify the deploy LANDS via `/api/build` and state the SHA.

Standing report in the established format: ship status; test, lint, build
counts with allowlisted warnings named; every mirror file by name with bytes;
`context.md` against its 40 KB cap; tracker rows touched by ID;
`stamp-audit.md` inline; **production rows by run-id census, from
`pnpm census:runs --target=production`** — expected 0 organic throughout.

Items the author has already ruled expected — the two photo-door stamp
disagreements — are stated in the stamp-audit line and NEVER appear under
"Needs your hands."

The report ends with **"Needs your hands."** followed IMMEDIATELY by a NUMBERED
list of exactly what needs the author — every ruling, every console action,
every open question — even where it repeats the body. An empty list is stated
as "Nothing — the queue continues."

Completion against the denominator: item 1, N of 11 rows whole.

## Standing rules

All of `CLAUDE.md`'s non-negotiables. Diagnose before fixing. No empty success.
Never assert absence. Stated N equals rendered rows. Denominators always
stated. A screenshot is an example of a class, never the instance. Screenshot
before believing green; where a measurement can pass while wrong, measure the
right thing. Every reader-facing date is wall clock via `pnpm stamp`. A render
default may never manufacture a claim.

**Correct first. Fast second. Nothing third.**
