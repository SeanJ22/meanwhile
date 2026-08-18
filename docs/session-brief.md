# Session brief — g14 (written by g13, 2026-08-18)

The queue is the same eleven rows minus one, with two new P0-class rows in
front of them. Resolution, no drift.

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

## 0 — R47, the named regression (P0)

`pnpm walk:all` fails on it every run, so the suite is red until it is fixed.

**At 85701, zooming out to z7 wipes every pin** — the walk reports `pins 11 →
12 → 0 across zooms 11.0 → 9.0 → 7.0`. 11 → 12 is correct; 12 → 0 is the
defect, and it undoes the g3 win behind CLAUDE.md's "More viewport must never
mean fewer pins."

**Half the diagnosis is already done and is in the row — do not repeat it.**
The server is innocent, proven: `/api/meetings` at 85701's centre returns 89
meetings at `radiusKm=25`, 97 at 60, 97 at 150 and 97 at 400 (clamped to 150
and saying so in its own `radiusKm`). Monotonic at every rung. The data is on
the wire; the pins are not on screen.

The unfinished half is WHICH CLIENT LAYER drops them. Two candidate shapes,
both in R47: the pin pool marking every entry hidden at low zoom, or the map
effect's clip/mask — this repo has already been bitten once by Chromium
dropping an oversized clip-path, and projected geometry at z7 is far larger
than at z11. Start with `components/map/map-canvas.tsx`, logging
`__wtpSpiderProbe`'s visible count and each element's `dataset.hidden` at z11,
z9 and z7. The walk check already exists and already fails, so the fix is
provable the moment it lands.

## 1 — R48, the scheduled-job push race (P2, small, fix it early)

`intake-tripwire.yml` and `refresh-meetings-snapshot.yml` both `git push origin
main` with no pull, rebase or retry. When they run close together the second is
rejected `fetch first` and the job goes red having done all its work correctly.
Fix BOTH in one edit — fixing one only moves which job loses.

The failure mode the fix must not create: a rebase that silently drops the
commit turns a red run into a green one that changed nothing, which is the
empty success `CLAUDE.md` forbids. Verify the push landed and stay red if it
did not.

## 2 — The ten finish-now rows, in this order

Each carries its spec and remainder in `docs/tracker.csv`; read the row before
building. M136 is DONE and is no longer in this list.

* **M139** — the half-load, the zip control's geometry, the districts panel's
  two sections, the load budget. Diagnose the half-load before fixing; the
  row's suspects are recorded.
* **M135** — the every-row-opens-a-card audit across every list surface. Walk
  each surface; state found and converted per surface.
* **M07** — returning user: zip remembered, reader confirms or re-enters on
  return, district NEVER assumed.
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
  surface. State N wired of M total.
* **D06** — the funding tracker, under the UNCHANGED structural FEC rule:
  reader-facing display is the protected accountability use; contributor-level
  data never enters any aggregation path that produces anything sold. Build on
  the already-aggregated endpoints per the row; the FEC key may be wired.

## 3 — M136's stated gap, if the queue reaches it

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

Completion against the denominator: items 0–2, N of 3 whole, and within item 2,
rows completed of ten. "Needs your hands." followed IMMEDIATELY by the numbered
list, or "Nothing — the queue continues."

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
