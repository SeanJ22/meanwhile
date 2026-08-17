# Session brief

The last brief executed was **h** — everything in 03255, and a measurement of
what it cost: the first real test of "can we just add more." This file is
overwritten by each session with the brief it ran; what follows is what h was
asked to do, what it did, and — at greater length, because it is the more
useful half — what it did not.

## What h was asked for

Seven items in a completion order that was explicitly **not** a cut order. An
item that could not land was to become a tracker row carrying its whole spec
and every rung walked, named in the standing report in the item's own words.
Silence, or a thinned version reported as done, was named as the one
unacceptable outcome.

- **Item 0** — copy THE TRANSPARENCY MANDATE and THE LADDER, EXHAUSTIVELY into
  `CLAUDE.md` verbatim, above the operational rules, before any retrieval,
  because this session's own hunts were governed by them.
- **Item 1** — establish 03255's denominator from OUTSIDE our own data, in two
  steps (authoritative universe, then jurisdiction mapping), and freeze it
  along with the required-field matrix, the target ballot universe and the
  meetings-near rule.
- **Item 2** — run the recipe at full depth on every body in that universe,
  under the mandate and the full fourteen-rung ladder, with the default scope
  being "everything that is public" rather than "everything on the list."
- **Item 3** — every candidate on 03255's ballot to the same standard, equal
  effort per race.
- **Item 4** — a scorecard rendered from evidence emitted during the hunt,
  reporting three cost views: incremental session cost, steady-state refresh
  cost, and observed transfer cost for the next previously-unseen instance.
- **Item 5** — the project's self-descriptions catch up to the truth.
- **Item 6** — final walk, ship, standing report.

Fifteen experimental controls (C0–C12) bound how the work was to be measured,
with C0 governing all of them: **acquisition outranks measurement, always.**

## What happened

**The denominator got built. The sweep did not.**

Items 0, 1, 4, 5 and 6 landed. Item 2 produced **one hunt against roughly
sixty bodies in scope**; item 3 produced **zero of 47 candidacies**. Both are
recorded as what they are rather than as partial progress.

### What landed

- **Item 0.** Both blocks are verbatim in `CLAUDE.md` above every operational
  rule, verified by character offset. One adaptation, named: the brief cites
  experimental control C5, which the brief itself forbids copying there.
- **Item 1.** 166 units enumerated from the 2022 Census of Governments across
  three counties — **the 25 km circle crosses two county lines and the
  committed extract held Merrimack alone**, so the official denominator for
  the meetings-near universe did not exist in the repo. Merrimack replicates
  the earlier hand extract exactly, 63 = 63, zero diff. Two new reusable
  commands: `pnpm gus:extract` and `pnpm zip:universe`.
- **Item 2's one hunt.** Kearsarge's member towns: **seven, and the brief's own
  working list was wrong in both directions** — Goshen is not a member, Warner
  is and holds three of nine seats. A plausible false answer was rejected on
  the way.
- **Item 4.** `docs/scorecard-03255.md`, rendered from the committed ledger.
- **Item 5.** `state.md` §7 restructured into Phases A–E; `README.md`
  rewritten to point rather than copy.
- **Session-open triage.** The tracker carried **two rows per ID** for M128 and
  M129; fixed, and guarded by a test proven to fail on a planted duplicate.

### What did not, and where its spec lives

| Row | What |
|---|---|
| **H01** | the depth sweep across the full body universe |
| **H02** | body enumeration per unit — the missing second layer of the who-governs denominator |
| **H03** | the re-walk cohort, 0 walked |
| **H04** | the 47-candidacy ballot sweep, 0 hunted |
| **H05** | special-district territory resolution, 40 UNRESOLVED |
| **H06** | the C7 same-subject replays and the C2b backfill |

### The three findings worth carrying forward

1. **Units are not bodies, and no external enumeration of bodies exists.** One
   Census row stands behind the Town of Newbury's five-plus boards.
   `pnpm census:zip 03255` prints "6 of 6" — true against the registry, silent
   about the town. This is **H02**, and it is the highest-leverage missing
   piece for national scale.
2. **The three cost views are not computable from what this session did**, and
   the scorecard says so rather than estimating them. A per-field cost drawn
   from two bodies would be a sample of the easiest bodies, and the easiest
   bodies are the ones already wired.
3. **Retrieval is not where the cost lives.** Total instrumented network time
   for the whole session: **12.1 seconds across 15 fetches.** The cost is in
   deciding what to fetch, reading what came back, and refusing the plausible
   wrong answer — none of which a fetch timer can see.

## Standing rules this session inherited and kept

The state-focus map effect and the deleted zip shading were **not touched**, in
whatever state g5 left them. HEAD at session open was `68987ee`, `main` with
g5 merged.
