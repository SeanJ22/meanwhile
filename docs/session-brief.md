# Session brief

The last brief executed was the **2026-08-17 carry-forward hotfix**
(`hotfix-0817`, branch `claude/h2-carry-forward-truth-0817`). This file is
overwritten by each session with the brief it ran; what follows is what this
session was asked to do, what it did, and what it deliberately did not.

## What this session was asked for

A small, bounded hotfix. Two items, both about the same false claim, plus one
inherited row to close. The brief was explicit about scope: do not touch the
interface rules deferred as G05, do not start G07 or G09, do not restyle
anything, and leave the author's production pass parked as the next session's
whole subject.

- **Item 1 (P0)** — the meetings snapshot counts two things and states one
  number. The scheduled *Refresh meetings snapshot* job had failed at least
  twice with `snapshot holds 217 meetings but sources claim 193`, and the
  brief supplied the facts so nothing would be re-diagnosed from scratch: 193
  fetched fresh, 24 carried forward for `schedulepage`, 193 + 24 = 217. The
  invariant predated carry-forward and had never been taught it exists.
- **Item 2 (P0, truth defect)** — the reader is told a freshness that is not
  true of every row. `LAST CHECKED 6 hours ago` is true of the snapshot and
  false of the 24 carried rows.
- **Item 1c** — closed properly, at four points, with nothing inherited.

The brief led with a prohibition, and it is the whole point of item 1: **do
not** change the assertion to `total >= claims`, **do not** add a tolerance,
**do not** skip the check when carried rows are present, and **do not** make
the per-source claims include the carried rows so the sums match. Every one of
those makes the test pass and makes it worthless.

## What shipped

**Item 1 — the invariant learns that carry-forward exists.** The snapshot now
states `fresh`, `carried` and `total`; every carried row carries
`{ source, lastFreshAt }` stamped at write time; and `reconcileCounts()`
enforces four equalities at the write boundary and on every read —
`fresh + carried = total`, `total` = the rows present, `fresh` = the sum of the
per-source `normalized` (the original assertion, preserved exactly, aimed at
the right number), and `carried` = the rows carrying the mark, per source as
well as in total. Nothing was loosened; the forbidden repair of folding carried
rows into `normalized` is itself a test that must still fail.

**Item 2 — a carried row states its own freshness.** The footer names the
count and, when the carried rows agree on one day, that day; the panel card and
the popup each gain a `Last reached` line reading the row's own stamp. No
badge, no colour, no new component, no filtering — the truth fix only.

**Item 1c — four counts, derived backward from an observed run.**
`d6d477d` 131, `68987ee` 134, `eb4df50` 135, `2dbae55` **148 observed**. No
check was ever missing; the discrepancy was a mis-transcribed 133 for 131.

**A permanent walk check**, and a playbook entry: *a count derived at read time
stops being true when the data grows a new case*.

## What was proven before it was trusted

Four mutations of the real committed snapshot were run against the real CI
gate, and each one reddened it. Three of four mutations of the item-2 render
guard passed the first version of that guard — a dead `{false && (` branch
still contains the field names it was grepping for — so the guard was tightened
to pin the conditional each surface renders behind, and re-proven.

The refresh was run end to end (`pnpm ingest composite`, 10 of 10 sources
reachable, 217 fresh + 0 carried), and because a developer's egress is not the
one `kearsarge.org` refuses, the carry path was driven separately on real data
with `schedulepage` forced to fail: 189 fresh + 28 carried = 217, written, read
back, marks intact.

## What this session deliberately did NOT do

- **It did not fix the egress wall.** `schedulepage` is still unreachable from
  CI. That is ladder rung 5, the CivicPlus rung-12 attempt belongs to the
  planned `h2` depth session's item 3, and carry-forward masks the wall
  honestly rather than repairing it.
- **It did not decide how staleness should look.** Removing a false claim is a
  truth fix; the visual treatment is the author's and belongs to the next
  interface session.
- **It touched none of G05, G07 or G09**, restyled nothing, and left the
  author's production pass parked.

## Standing rules this session inherited

All of `CLAUDE.md`'s non-negotiables. Diagnose before fixing. Stated N equals
rendered rows. A failed operation never renders as an empty success, and a wall
never renders as an emptiness — the carried rows exist because a wall held, and
the product must not imply otherwise. Never assert absence. Denominators always
stated. Where a measurement can pass while wrong, measure the right thing.
Every reader-facing date is wall clock via `pnpm stamp`.
