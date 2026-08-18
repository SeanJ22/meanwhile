# Session brief — g15 (written by g14, 2026-08-18)

One instrument row, then nine rows, in order. No P0 in front of them for the
first time in four sessions.

This session runs unattended. Nobody is available to answer.

NOTHING IN THIS BRIEF IS CUTTABLE. Work items in order, complete each whole,
keep starting the next until the session genuinely ends, defer whatever remains
whole and specced, and report completion against the denominator. Where a
disposition in `docs/deferred.csv` and this brief disagree, the disposition
governs. Read each row's full Notes before building.

THE AUTHOR'S STANDING RULE: a screenshot or named instance is an EXAMPLE of a
class-wide defect. Fix the class, audit everywhere, report the full count.

THE RULINGS STILL STANDING, carried forward unchanged: M93's empty sections
collapse closed with the honest absence line inside, header visible. The
matcher ruling stands as written — no middle rung; weak matches fall to the
classifier, refusal when it is unreachable. 4c's desktop default stands as g12
shipped it. `pnpm perf` is deferred to the author's walkthrough day by his
ruling; the budget stays unset and nothing here invents one.

## What g14 leaves you

The pre-H queue is NOT empty: nine of item 2's ten rows are untouched. R45,
R46, R47 and M139 are closed. There is no open P0.

**Two instruments are new and both are worth reusing before writing another
one.** `pnpm probe:r47` samples the map's pin count every 100 ms through a
zoom-out while watching in-flight requests; `pnpm probe:m139` samples the four
stat tiles every 100 ms through a cold arrival and a return from `/ballot`.
The shape they exist to catch is the one that burned three sessions: **a
surface that is empty for a few hundred milliseconds reads as "sometimes
broken" to anything that looks once.** If a row says "sometimes", sample
continuously before believing any single result — in either direction.

**And read the three instrument corrections in `state.md` §g14 before trusting
a new probe.** Each one produced a confident false report: a probe that closed
the card it came to measure (rule 4c), a probe that started sampling after the
event had finished, and a screenshot pass that shot dark twice while claiming
both themes.

## 0 — R49, before the rows: the suite reads outcomes on a timer

Three checks in `scripts/walk-all.mts` reported WORKING surfaces as NAMED
REGRESSIONS in one session, all against the same build, because they read a
rendered outcome on a timer. All are fixed and the suite is 302 ok / 0 FAIL
against production — but it took FOUR attempts, and the three that failed are
written up in `state.md` §g14 because each one looked right. **The class audit
is a count: 36 `waitForTimeout` calls in that file, the 4 in the ask family
converted, 32 NOT audited individually.** R49 carries the walk-and-split: decide per call whether
it waits for a SETTLE (fine) or for an OUTCOME (must poll), and state the
split.

The one rule, which the row also carries: **a conversion must never wait until
the check PASSES.** Waiting for an outcome means waiting until the surface has
said something — a refusal or an answer, a count or a named gap — and then
judging what it said. A poll that exits only on success turns a flaky check
into one that cannot fail.

## 0b — R50, the beacon hole (P1, and it already bit)

Three QUESTION_ASKED rows landed **ORGANIC** in the store we sell, written by
g14's own walk. `lib/log/client.ts` prefers `navigator.sendBeacon`, and
Playwright's `extraHTTPHeaders` **do not apply to a beacon** — so anything
leaving that way is recorded as a reader.

Fixed in 10 contexts by removing `sendBeacon` so the fetch fallback carries
the header. **The class: `scripts/` holds 50 browser contexts, 10 guarded, 40
NOT**, across 36 scripts. R50 carries them — and prices the better fix, which
is to make the marker travel in the request BODY too, so it survives both
transports and closes the class once instead of once per script.

**The three rows are not backmarked, and a session must not grant itself the
write.** The window is exact in `docs/synthetic-runs.md`.

## 1 — The nine finish-now rows, in this order

Each carries its spec and remainder in `docs/tracker.csv`; read the row before
building. M139 is DONE and is no longer in this list.

* **M135** — the every-row-opens-a-card audit across every list surface. Walk
  each surface; state found and converted per surface. NOTE: the districts
  door changed shape in g14 — it is now two sections, so the audit covers both
  of them, not one list.
* **M07** — returning user: zip remembered, reader confirms or re-enters on
  return, district NEVER assumed. The third clause is the one that matters;
  the first is already shipped via `hooks/use-stored-zip.ts`, and the second
  is the actual build.
* **B15** — the laws half of key votes. congress.gov API by official title,
  bill number from the record, then its roll calls. Never a bill number from
  memory. 0 of 20 → as many as verify; misses render the recorded gap.
* **G10 / 8a** — bytes and layer counts held per active state (85701 active,
  then 03255 active, neither containing the other's per-state geometry); both
  themes — twelve frames plus the two no-active-state frames; the stated
  exclusion distance for the effect-off check with its reasoning. Measurement
  only; the map effect itself is author-accepted and does not change.
* **P01** — the 11 AZ measures decomposed into contested provisions (funding /
  program / oversight / sunset). Provisions are what reactions attach to.
* **P03** — reactions extend to measures and provisions per the row's
  remainder. FREE TEXT DOES NOT SHIP — the T05 gate stands; R41's reply field
  does not change it.
* **D25** — comment access: fill the honest UNKNOWNs for the curated bodies via
  the ladder; record rungs per body.
* **D29** — Tucson's 56 boards: wire the remaining KNOWN_UNCOVERED where a
  schedule format exists; D18's "online" rendering gives virtual-only bodies a
  surface. State N wired of M total. `pnpm meetings:report` currently reports
  85701 as **60 bodies governing, 52 without a wired source** — that is the
  denominator, read on 2026-08-18.
* **D06** — the funding tracker, under the UNCHANGED structural FEC rule:
  reader-facing display is the protected accountability use; contributor-level
  data never enters any aggregation path that produces anything sold. Build on
  the already-aggregated endpoints per the row; the FEC key may be wired.

## 2 — M136's stated gap, if the queue reaches it

`lib/officials/body-blurbs.ts` holds sourced role blurbs for Arizona's county
and school-district classes plus Tucson's charter. **New Hampshire has none** —
Merrimack County, Newbury and Kearsarge Regional all render the honest absence
line. Closing it means reading RSA 28, RSA 47 and RSA 189 and citing them the
way the Arizona entries cite A.R.S. § 11-251 and § 15-341, with a read date
from `pnpm stamp`. There is deliberately no national default and none may be
added: what a county board does differs in fifty states, and a paraphrase that
reads plausibly everywhere is wrong somewhere without saying so.

## Handoff

`pnpm walk:all` against production, new checks appended, counts and identity
set stated, 100% distinct maintained. `pnpm census:runs` in the report —
organic count stated. `state.md` via `pnpm stamp`. Tracker rows by ID;
`docs/deferred.csv` NOT regenerated. Update `docs/session-map.md`. Playbook
diff or explicit "nothing new". Overwrite `docs/session-brief.md`. `pnpm
handoff --ship` with the R22 gate; verify the deploy LANDS via `/api/build` and
state the SHA.

Completion against the denominator: items 0-1, and within item 1, rows
completed of nine. "Needs your
hands." followed IMMEDIATELY by the numbered list, or "Nothing — the queue
continues."

**Report format, as law.** Author-ruled-expected items appear in the
stamp-audit line ONLY and never under "Needs your hands", not even with a
disclaimer. That section carries rulings, console actions, and open questions —
nothing else.

## Standing rules

All of `CLAUDE.md`'s non-negotiables. Diagnose before fixing. No empty success.
Never assert absence. Stated N equals rendered rows. Denominators always
stated. A screenshot is an example of a class. Screenshot before believing
green; where a measurement can pass while wrong, measure the right thing. Every
reader-facing date is wall clock via `pnpm stamp`. A render default may never
manufacture a claim.

Correct first. Fast second. Nothing third.
