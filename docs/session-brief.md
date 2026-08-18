# Session brief — h1 (successor to g16)

**Written 2026-08-18 by the g16 session. Overwrite this file when you finish.**

---

## THE PRE-H BUILD QUEUE IS NOT EMPTY, AND THIS IS WHAT IS LEFT

g16 completed **items 1 and 2 whole**, **1 of item 3's 5 rows**, and **1 of
item 4's 3 rulings**. Four queue rows and two rulings carry forward, all
deferred whole with their specs intact. That is the honest denominator and it
is the first thing this brief says, because g16's own brief opened by asking
whether the queue was empty and the answer is no.

Production serves `ff88941`. The deploy pipeline works: a PR-merge push
produced a Netlify build inside the handoff gate's five-minute window, twice.

---

## NOTHING IN THIS BRIEF IS CUTTABLE, AND ORDER IS LAW

Items run in the order written. The completion metric never justifies
reordering. A session that believes the order is wrong records the belief and
follows the order anyway. Work each item whole, keep starting the next until
the session genuinely ends, defer whatever remains whole and specced, and
report completion against the denominator.

## THE AUTHOR'S STANDING RULES, inherited

- A screenshot or named instance is an EXAMPLE of a class-wide defect. Fix the
  class, audit everywhere, report the full count.
- Testing-era organic rows are the author's. He is actively testing production
  himself; Victoria is off-grid. Censuses state the organic count with that
  presumption named in one clause. No attribution hunting, no backmarking, no
  re-raising — he will draw a testing-era line in the data himself later.
- All of `CLAUDE.md`'s non-negotiables.

---

## 1 — The author's testing pass (P0, first)

**This is first because it is the author's own reading of the live product,
and it arrived while g16 was mid-flight with no room to build it.**

`docs/Feedback 8.18 1421 pm.docx`, committed, with 29 matching screenshots in
the Drive mirror under `Screenshots from Feedback` (13:42–14:40 local on
2026-08-18). Roughly forty findings. Tracker row **F01** carries every one of
them enumerated, so this can be worked from the row without re-reading the
document — but read the document anyway, because it is his voice and the
screenshots are keyed to it by timestamp.

**Split F01 into per-surface rows first**, then build them. The groupings the
row already uses are the natural split: cards and navigation; meetings
ordering; pills and panels; the votes surface; the gap language; the ask box;
the ballot page; the map; who-governs spacing.

**Three things in it need naming rather than filing:**

1. **One finding is a DATA claim, not a UI one, and it is the only item in the
   pass that could be rendering something untrue.** The New Hampshire
   who-governs card says Kearsarge Regional and Newbury Town could not be
   reached at the last check and their meetings may be missing — while the
   maroon pin in New London shows Kearsarge meetings. Either the carry-forward
   notice is stale or the two surfaces disagree about the same source. That is
   the refresh corollary's own territory. **Work it first within this item.**
2. **The gap-language change touches a committed rule.** He wants "this is a
   gap in our research / our data" gone across the board. `CLAUDE.md`'s
   render-default rule requires a named gap to say WHOSE it is — "we haven't
   recorded this yet" is a fact about us and "not in this chamber for this
   vote" is a fact about them, and they may never render as the same sentence.
   The WORDING is his to change; the DISTINCTION may not be dropped. Where the
   two collide, change the wording and keep the distinction, and say in the
   report exactly which strings moved.
3. **He liked two things** and a defect list that drops them misreports the
   pass: the AZ6 shading-and-deselect behaviour ("excellent behavior, I like
   that a lot") and the phone chooser on a person's card. Say so.

---

## 2 — The four queue rows g16 did not reach, in this order

Each carries its full spec on its tracker row. None was started; none is
half-built.

- **P03 — reactions extend to measures and provisions.** P01 landed the
  targets: 52 provisions at `lib/ballot/measure-provisions.ts`, every one
  carrying a permanent id shaped `<contestId>#<slug>`, already rendered after
  the explanation, which is where `CLAUDE.md` requires the ask to be. **FREE
  TEXT DOES NOT SHIP — the T05 gate stands, and R41's reply field does not
  change it.** Incumbent and challenger buckets stay separate. Nothing renders
  an aggregate back to a reader.
- **D25 — comment access.** Fill the honest UNKNOWNs for the curated bodies via
  the ladder; record rungs per body.
- **D29 — Tucson's 56 boards.** Wire the remaining `KNOWN_UNCOVERED` where a
  schedule format exists; state N wired of M total.
- **D06 — the funding tracker**, under the UNCHANGED structural FEC rule:
  reader-facing display only; contributor-level data never enters any
  aggregation path that produces anything sold; the FEC key may be wired.

## 3 — The author's two remaining rulings, built

- **The place card (ruling A, still unbuilt).** A place row opens a small
  honest card: the place's name and type, and the bodies that sit in it, each
  row linking onward to its body card. Nothing invented, no body elected to
  stand for the place. M135's every-row rule is then whole across all seven
  surfaces — state the final converted count. The handler that needs it is
  `onSearchPick` in `components/map/map-entry.tsx`, where the place branch is
  deliberately left flying and says so.
- **The `^_` config line (ruling A, still unbuilt).** `varsIgnorePattern: "^_"`
  in the ESLint config; the discard warnings become legal; remove them from
  `lint-allowlist.json`; the allowlist gate must still prove both refusal
  directions. **The count moved** — g16 removed five unused `Browser` imports
  while closing R50, so the allowlist stands at **15**, not 16. Read the file,
  do not trust this sentence.

## 4 — R51's last loose end, if it recurs

R51 is closed on this session's evidence: two PR-merge pushes both produced
builds inside five minutes, and the refusal that looked like a missing trigger
was a correct budget refusal in a mode the budget had never measured. **If a
merge ever again produces no build within a stated window, reopen it** and
hunt the webhook and build hook — g15's Netlify-API evidence for the original
"no build at all" still stands and is not re-litigated.

`.github/workflows/build-check.yml` now runs the literal `netlify.toml` build
command on ubuntu in BOTH modes on every push, so a budget refusal is readable
with `gh run view` rather than behind the author's Netlify login. Use it before
guessing.

---

## Handoff

`pnpm walk:all` against production, counts and identity set stated, 100%
distinct. `pnpm census:runs --target=production` — organic stated with the
testing-era presumption clause. `docs/state.md` via `pnpm stamp`. Tracker rows
by ID. `docs/deferred.csv` NOT regenerated. Update `docs/session-map.md`.
Playbook diff or explicit "nothing new". Overwrite `docs/session-brief.md`.
`pnpm handoff --ship` with the R22 gate; verify via `/api/build`; state the SHA.

Completion against the denominator: items 1–4, N of 4 whole; within item 2,
rows completed of four. **"Needs your hands."** followed IMMEDIATELY by the
numbered list, or **"Nothing — the queue continues."** Author-ruled-expected
items never appear there.

## Standing rules

Diagnose before fixing. No empty success. Never assert absence. Stated N equals
rendered rows. Denominators always stated. A screenshot is an example of a
class. Screenshot before believing green; where a measurement can pass while
wrong, measure the right thing. Every reader-facing date is wall clock via
`pnpm stamp`. A render default may never manufacture a claim.

**Correct first. Fast second. Nothing third.**
