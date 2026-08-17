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

**Five of eight items landed whole, plus the standing rule, one rule of item 4,
and two thirds of item 8. Two items were never started.**

Stated that way on purpose: the rule this session wrote requires a denominator
rather than a narrative, and "the consolidation was deferred" would be the
sentence it exists to forbid.

| item | state |
|---|---|
| the standing rule | **done**, first, before any other work |
| **1a 1b 1c 1d** | **done** — three fixed, one confirmed |
| **2 (C05)** | **done** whole |
| **3 (M141)** | **done** — mechanism named from the code, 320 of 320 |
| **4** | rule **4g done**; 4a–4f and 4h deferred whole (**G05**) |
| **5** | **not started** (**G07**) — deliberately, see below |
| **6** | **done**, with per-zip reachability reported |
| **7** | **not started** (**G09**) |
| **8** | **8b done**, **8c** three bullets of four, **8a** one deliverable of three (**G10**) |

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

### Item 3 (M141) — closed, on the measurement

**The author's objection was right about the scrim and wrong about the claim.**
A stacked scrim does not respond to pointer movement, and it never had to: the
scrim is what PREVENTED the paint, and something else FORCED the repaint. g5
named only the first half.

The second half, read out of the stylesheet rather than inferred:
`app/globals.css:2828`, `.al-row:hover`. The rows inside the panel body carry a
hover rule, so a pointer entering the panel triggers a style recalc that
invalidates paint **inside `.al-overlay-body`** — the exact container whose
pixels were missing. A phone has no hover, which is why a phone reader never got
the free repair.

**320 of 320** on the paint assertion — 390×844, both device pixel ratios, four
zips, 40 cold trials each, no pointer event of any kind. 960 of 960 across all
three assertions. Stated as a bound rather than as green: 4 of 4 against a 25%
failure rate happens 32% of the time and was correctly dismissed; 320
consecutive passes put the **95% upper bound on the failure rate at 0.93%**.
What the measurement cannot see — one machine, one Chromium build — is stated
too.

### Item 6 — done, with the finding the brief asked for

Reachability was established from the committed rosters **before** anything was
removed: 85701 and 07866 keep their mayors (row → battlecard → Representation);
85641 and 03255 have no mayor to lose. **No zip loses the office.** Newbury's
M32 no-mayor fact survives untouched — it is keyed on the office title, not on
"Mayor". The cost is named: the mayor moved from zero clicks to two.

### What did not, and where its spec lives

| Row | What |
|---|---|
| **G05** | item 4, rules 4a–4f and 4h; M137 and M138 are marked Absorbed and point here |
| **G07** | item 5, Ask discoverability |
| **G09** | item 7, the ramp measurement for NH and NJ, and sixteen frames |
| **G10** | item 8a's two measurement deliverables, and 8c's R16 remainder |

Each carries its whole spec, unchanged. Nothing was thinned and nothing was
reported as done that was not.

**Item 5 was deliberately not attempted, and the reason is a coupling rather
than doubt.** It is the designed compensation for rule 4a's discoverability
cost, and 4a is not built. Shipping 4a alone would have left two Ask boxes and
hidden both — worse than today, not better — so rules 4a–4f stayed whole.

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
