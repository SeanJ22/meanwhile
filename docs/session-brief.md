# Session brief — g12 (written 2026-08-17 by g11)

The queue, exactly where g11 stopped. The environment rows are closed and the
migrations are applied, so nothing below is blocked on the author.

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

## 0 — What g11 cleared, so you do not re-derive it

**R36 and R42 are CLOSED.** There is a working handle to production in both
directions and you should use both rather than rebuilding either:

* `WTP_PRODUCTION_DATABASE_URL_READONLY` — reads. `pnpm verify:readonly`
  passes thirteen checks. `pnpm census:runs --target=production` prints the
  run-id census the standing report asks for; do not assemble that number by
  hand. `pnpm feedback:read --target=production` works.
* `WTP_PRODUCTION_DATABASE_URL_WRITE` — the ONE sanctioned write path, for
  migrations and explicit maintenance only. Resolve it through
  `lib/db/write-handle.ts`; never read it directly and never write through the
  READONLY variable, which the guard refuses by name.
* `pnpm db:apply --target=production` applies committed migrations and
  verifies the journal. `drizzle-kit migrate` still exits 1 with no message on
  this machine — do not spend time on it. Production is current at 9 of 9.

**One thing the author may want to do, and nothing here depends on it:** the
`readonly` role has no USAGE on the `drizzle` schema, so a migration-journal
read through the read handle returns *permission denied for schema drizzle*.

**R41, M12, D22 and G05 rule 4d are CLOSED.** Do not re-open them. Rule 4d
matters to item 1 below: the ask box can now route to four in-app destinations,
and the copy reads its promises from `ROUTABLE_CATEGORIES` rather than naming
them by hand. Extend that mechanism rather than writing a second list.

---

## 1 — Finish g7 item 4: the ask surface, whole

g11 completed the precondition (rule 4d) and nothing else in this item. What
remains is one build, and the row IDs it closes are A01, A02, M119, and — in
the same PR, per their own notes — A06 and A07.

* **M119** — ONE input in the sidebar. Keyword-first: text matching a known
  meeting, body, district or person filters and navigates exactly as
  `components/shell/search-box.tsx` does today. Anything else routes as an ask
  through the existing curated path — keyword layer first, the classifier
  behind its ripcord, A07's refusal unchanged. One placeholder teaching both
  uses; the Ask affordance stays the submit action. **The two logs must not
  blur:** a keystroke lands in exactly one of them and the stores never join.
* **A01 / A02** — the natural-language entry point, and the "what's going on
  where I live" digest scoped to the reader's divisions. Every sentence is
  curated copy or registry data; nothing generated.
* **A07 and A06 are VERIFIED WORKING** (g11 read the log rows back out of the
  store) and close with A01. A06 carries one handover: g11 observed that "what
  will the weather be like on election day" routes to `elections-voting` on the
  single word "election". Nothing was fabricated and everything rendered was
  sourced, so A07's contract holds — but whether the matcher should require
  more than one hit before routing is a matching question this build owns.

## 2 — G05's remaining six rules: 4a, 4b, 4c, 4e, 4f, 4h

The full text is in G05's Detail column, unchanged. Note two things g6 and g11
already settled so they are not re-litigated: rule 4g shipped separately as
G06, and 4b's "and N more" affordance was a bare `li` with no handler — it has
been removed, and the reachability concern it was supposed to answer stands as
the open question.

Rules 4e and 4f each demand a PERMANENT check, and both are specific about
what it must measure: 4e COUNTS RENDERED INSTANCES in the DOM (not the
presence of one selector) and asserts exactly one, in all four states, at four
zips and both viewports. 4f asserts the card's top is on screen and its bottom
reachable at 390x844 with the longest content. Append both to
`scripts/walk-all.mts`. Re-run `pnpm contrast` and `pnpm overlaps` after 4f.

## 3 — G07: the pill label

Depends on item 2 — it is the designed compensation for 4a's discoverability
cost, and shipping 4a without it ships a known regression. Record the chosen
label at each of the three placements in `docs/DESIGN.md` with the width that
forced each choice.

## 4 — D35: the positions three-answer machinery

Spec in the row.

## 5 — The fourteen finish-now rows, in order

M134, M136, M139, M135, M07, B15, the tracker row G10 (distinct from the g10
session letter), P01, P03 with free-text gated on T05 — R41's reply field does
NOT move that gate — D25, D29, D06 under the unchanged structural FEC rule,
and M93 proposal-only.

---

## Handoff

`pnpm walk:all` against production, new checks appended, old and new counts
stated, the identity set emitted — it must stay 100% distinct, and a duplicate
is a NAMED REGRESSION that fails the run. Do not transcribe the check count
from a report; diff your run's census against the previous run's.
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
`pnpm census:runs --target=production`** — expected 0 organic throughout, and
now readable, so COULD NOT READ is no longer an acceptable answer unless the
command itself fails and says why.

Items the author has already ruled expected — the two photo-door stamp
disagreements — are stated in the stamp-audit line and NEVER appear under
"Needs your hands."

The report ends with **"Needs your hands."** followed IMMEDIATELY by a NUMBERED
list of exactly what needs the author — every ruling, every console action,
every open question — even where it repeats the body. An empty list is stated
as "Nothing — the queue continues."

Completion against the denominator: items 1–5, N of 5 whole, and within each
item, sub-items completed of sub-items listed.

## Standing rules

All of `CLAUDE.md`'s non-negotiables. Diagnose before fixing. No empty success.
Never assert absence. Stated N equals rendered rows. Denominators always
stated. A screenshot is an example of a class, never the instance. Screenshot
before believing green; where a measurement can pass while wrong, measure the
right thing. Every reader-facing date is wall clock via `pnpm stamp`. A render
default may never manufacture a claim.

**Correct first. Fast second. Nothing third.**
