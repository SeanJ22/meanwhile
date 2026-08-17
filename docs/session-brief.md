# Session brief

The last brief executed was **g6** — one surface at a time, and the numbers
that contradict each other. This file is overwritten by each session with the
brief it ran; what follows is what g6 was asked to do, what it did, and — at
greater length, because it is the more useful half — what it did not.

## What g6 was asked for

A standing rule to be written into `CLAUDE.md` before any other work, then
eight items in a completion order that was explicitly **not** a cut order.
Items 1, 2 and 3 were named not cuttable. The whole brief was governed by one
ruling: **the neumorphic active-state treatment landed, keep it exactly as it
is** — no token, no layer, no shadow, no mask, and any item that appeared to
require a change to it was to stop and record a row instead.

- **The standing rule** — the deferral boundary falls between subjects, never
  inside one; a session does not stop starting subjects because it doubts it
  can finish them, and it reports completions against a denominator. Plus,
  separately, a record of the h session's one documented deviation from the
  transparency mandate's source text.
- **Item 1** — four places where a stated number and a rendered thing
  disagree: (a) Who Governs Here stating 4 / 5 / 5 for one list, (b) a route
  answering at 0,0, (c) the `walk:all` count not reconciling across two
  sessions, (d) the meetings panel's stated N, to be confirmed mechanically.
- **Item 2 (C05)** — our own automated traffic stops contaminating the
  sold aggregate, with the "just stop writing to production" fix explicitly
  rejected in the brief.
- **Item 3 (M141)** — name the mechanism by which pointer movement changed the
  render, then re-run at high n on a phone viewport with no pointer events at
  all: 390×844, both device pixel ratios, four zips, ≥40 trials per
  configuration, cold each time.
- **Item 4** — the interface consolidates: eight rules, 4a–4h, absorbing the
  parked rows M137 and M138.
- **Item 5** — Ask discoverability: the pill's label carries the teaching.
- **Item 6** — Mayor comes out of Who Governs Here, with per-zip reachability
  reported rather than decided.
- **Item 7** — measure the active-state ramp for New Hampshire and New Jersey
  and capture sixteen frames. Change nothing.
- **Item 8** — g5's three unreported deliverables, `pnpm perf`, and
  `context.md`'s loud-failure cleanup.

## What happened

**Three of eight items landed, plus the standing rule and one rule of item 4.
Five items were never started.**

Stated that way on purpose: the rule this session wrote requires a denominator
rather than a narrative, and "the consolidation was deferred" would be the
sentence it exists to forbid.

### What landed

- **The standing rule**, in `CLAUDE.md` immediately below the fourteen-rung
  ladder, and the h deviation recorded beside the mandate text — two clauses
  that read without a reference to experimental control C5, which the h brief
  itself forbade copying in.
- **Item 1a.** Fixed, and **the brief's named suspect was half wrong**: the
  Public Housing Authority board IS classed `GOVERNING` and is inside the four;
  the row that moved was the Board of Adjustment, a commission. A **second,
  latent instance** was found in the same pass — the M26 narrowing shrinks the
  list on the client while the count came from the server, so a reader
  narrowing to their own school district would have re-opened the gap by hand.
- **Item 1b.** Root cause `Number(null) === 0`. Eleven routes audited, two
  affected (`/api/meetings`, `/api/directory`). No 0,0 coordinate default
  exists anywhere else in the codebase. The repo-wide guard was proven to fail
  before it was trusted.
- **Item 1c.** Reconciled by enumeration: **nothing was lost.** The counts are
  131 → 134 → 135 and both deltas close exactly. The discrepancy was the
  STARTING number — g5's report said 133 where the real count was 131, which
  is the figure g4's own report recorded. `walk:all` now prints its own census
  so no session transcribes a count again.
- **Item 1d.** A permanent four-way check at all four zips.
- **Item 2 (C05).** Built whole. The three counts: **0 organic, 46 synthetic,
  2845 unknown, 2891 total** — the brief estimated ~537 rows were ours, the
  table holds 2891, and none of the history is attributable.
- **Rule 4g**, taken out of order because it is a one-line copy ruling that
  cannot half-land. One surface carried the line.

### Item 3, and why it is not closed here

The mechanism is named from the code rather than inferred: `.al-row:hover`
(`app/globals.css`) is the style rule a pointer move recalculates, which is the
"something dirtied the layer" g5's account referred to. The high-n re-run was
launched — 320 trials, phone viewport, no pointer events, both device pixel
ratios, four zips — and its result is recorded in `docs/state.md` §38. The row
stays open or closes on that number, not on this paragraph.

### What did not, and where its spec lives

| Row | What |
|---|---|
| **item 4** | the interface consolidation, rules 4a–4f and 4h; M137 and M138 are marked Absorbed and point here |
| **item 5** | Ask discoverability — the pill's label carries the teaching |
| **item 6** | Mayor out of Who Governs Here, with per-zip reachability reported |
| **item 7** | the ramp measurement for NH and NJ, and sixteen frames |
| **item 8** | g5's three unreported deliverables, `pnpm perf`, `context.md` |

Each carries its whole spec in the g6 brief, unchanged. Nothing was thinned and
nothing was reported as done that was not.

### The findings worth carrying forward

1. **`Number(null)` is 0, not NaN**, and every `isFinite` guard downstream of a
   `Number(params.get(...))` is therefore decorative. It produced a populated
   200 in the Gulf of Guinea AND a row in the store we sell.
2. **A mis-transcribed integer is indistinguishable from lost coverage.** One
   wrong starting count propagated through two sessions and a merge and looked
   exactly like two checks silently dying. Instruments should print their own
   census rather than let a number be copied by hand.
3. **The search log's history is not sellable.** Not because it is
   contaminated by a known amount, but because nothing in a pre-marker row
   distinguishes our robot from a reader. The sellable record starts
   2026-08-17.
4. **A run that forgets its marker is worse than an unmarked one.** This
   session mislabelled four of its own rows as readers within an hour of
   shipping the marker, while verifying its own deploy.

## Standing rules this session inherited and kept

The neumorphic active-state treatment was **not touched** — no item required
it, and none was allowed to. Zip shading stayed deleted. HEAD at session open
was `eb4df50`, `main` with h merged.
