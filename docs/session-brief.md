# Session brief — h2 (next session)

Written 2026-08-18 at the close of g15, replacing the g15 brief in place as
that brief instructed.

This session runs unattended. Nobody is available to answer.

NOTHING IN THIS BRIEF IS CUTTABLE. Work items in order, complete each whole,
keep starting the next until the session genuinely ends, defer whole with a
row, and report completion against the denominator. Where a disposition in
`docs/deferred.csv` and this brief disagree, the disposition governs. Read each
row's full Notes before building.

THE AUTHOR'S STANDING RULE: a screenshot or named instance is an EXAMPLE of a
class-wide defect. Fix the class, audit everywhere, report the full count.

## Carried rulings, recorded as fact

* **The seven ORGANIC rows STAND AS THEY ARE.** No backmark, no new write
  sanction, no console action. The author will draw a testing-era line in the
  data himself at a time of his choosing; `docs/synthetic-runs.md` is the
  standing record until then. Do not touch them or re-raise them. Any census
  reported states organic with one clause: "all author-acknowledged test rows,
  standing per his ruling."
* **R49 and R50 dispositions are PENDING the author.** Touch neither row. Where
  a walk check writes a fixed timeout, use the event-driven form instead, so new
  work does not grow R49's count.
* **Ship cadence unchanged** — `pnpm handoff --ship` per session, deploy
  verified via `/api/build`.
* **The audit document is still missing.** `docs/audit-2026-08-18.md` is named
  by the g15 brief and is in neither the repo nor the Drive mirror. All nine
  `AUD` rows record that their content came from the g15 brief rather than from
  the document, and name what is therefore absent: the evidence citations,
  except `AUD04`'s. **If the author has since placed it in Drive, commit it and
  fill each row's citation from it.** If he has not, say so again — do not
  quietly stop mentioning it.

## 0 — FIRST: production is thirteen commits behind (R51, P0)

g15 merged to `main` (`2681234`) and **Netlify never started a build**.
Production serves `bf0cd7b`, the 18:59Z bot snapshot-refresh commit. Nothing
from g15 is live — not the M135 autocomplete fix, not AUD-04, not the budgets.

It is not the tree and not the build: `pnpm build` is clean in 11s, and the
last deploy that ran finished in 54s. There is no queued, building or failed
deploy behind the current one; GitHub's `pending` status on the merge is a
stale context, not a build in progress. The asymmetry to chase: the deploy that
works came from the bot pushing DIRECTLY to main (`deploy_source: api`); the
two that produced nothing came through PR merges. Build hook, GitHub App
webhook deliveries for merge commits, or stopped builds / auto-publishing.

**Two standing-handoff gaps close by themselves when a deploy lands, and not
before:** g15's `walk:all` ran against the PRE-g15 build, so its 302 checks
verify prior sessions only; and no new walk checks were appended, because a
check for the M135 fix would fail against undeployed code and read as a false
regression. **Land a deploy, re-run `walk:all`, then append the M135 check.**

Full evidence on tracker row **R51** and in state.md's g15 section.

## 1 — The five rows g15 deferred whole (the pre-H queue; it stays first)

g15 completed four of the nine and deferred five WHOLE, none half-built. Each
carries its spec on its tracker row; read the full Notes before building.

* **P01** — the 11 AZ measures decomposed into contested provisions (funding /
  program / oversight / sunset). Provisions are what reactions attach to. The
  official Legislative Council analyses are already fetched and extracted at
  `data/ballot/az-analyses-2026.json` — 11 measures, full text, `extraction:
  pdf`, 0 failed. **Every provision must carry VERBATIM analysis text and its
  source**; the four category names in `CLAUDE.md` are illustrative, and forcing
  a measure that has no sunset clause into a sunset provision would manufacture
  a claim. Where the corpus needs a category the four do not cover, add it to a
  closed enum and say why.
* **P03** — reactions extend to measures and provisions per the row's
  remainder. Depends on P01. **FREE TEXT DOES NOT SHIP** — the T05 gate stands,
  and R41's reply field does not change it.
* **D25** — comment access: fill the honest UNKNOWNs for the curated bodies via
  the ladder; record rungs per body.
* **D29** — Tucson's 56 boards: wire the remaining KNOWN_UNCOVERED where a
  schedule format exists; D18's "online" rendering gives virtual-only bodies a
  surface. State N wired of M total.
* **D06** — the funding tracker, under the UNCHANGED structural FEC rule:
  reader-facing display is the protected accountability use; contributor-level
  data never enters any aggregation path that produces anything sold. Build on
  the already-aggregated endpoints per the row; the FEC key may be wired.

**M135 also stays In progress**, and its remainder is two named rows, not a
sweep: one body row at 85701 that cannot be resolved distinctly, and one place
row. The second is an AUTHOR RULING, below.

## 2 — AUD06, the one coverage manifest

Dispositioned here by the author, and it **lands before any second-state
hunting** — that ordering is the disposition, not a preference. A second state
multiplies whatever drift a split coverage definition already carries, so the
manifest consolidates first and the hunting follows it.

Related law it makes checkable in one place: coverage claims are made against
the OFFICIAL universe (Census of Governments, NCES, state rosters), never
against our own registry; the per-county audit is
`docs/coverage-audit-by-county.md`.

## 3 — The H hunt itself

Per the standing H briefs, after AUD06 lands.

## Standing rules

All of `CLAUDE.md`'s non-negotiables. Diagnose before fixing. No empty success.
Never assert absence. Stated N equals rendered rows. Denominators always stated.
A screenshot is an example of a class. Screenshot before believing green; where
a measurement can pass while wrong, measure the right thing. Every reader-facing
date is wall clock via `pnpm stamp`. A render default may never manufacture a
claim.

**Two numbers now replace the old "largest bundle" figure in every standing
report** (AUD02): server trace cardinality, and the client cost for `/` in
emitted and compressed bytes with MapLibre stated separately. Do not report the
trace figure as a bundle size — that is the defect that created this rule.

**The test count comes from the runner, never from a document.** `corepack pnpm
test` prints it. The commands table carries a snapshot with the commit it was
measured at, and a snapshot is not a source.

**"Allowlisted" now has a mechanism.** `corepack pnpm lint:allowlist` refuses a
warning not listed with a reason in `lint-allowlist.json`. If a report says
allowlisted, that command must have passed.

## Handoff

`pnpm walk:all` against production, new checks appended (event-driven, never
fixed-timeout), counts and identity set stated, 100% distinct maintained.
`pnpm census:runs --target=production` in the report — organic stated with the
author-ruling clause; **without the flag it reads the LOCAL branch and prints a
plausible census of the wrong store.** `state.md` via `pnpm stamp`. Tracker rows
by ID. `docs/deferred.csv` NOT regenerated. Update `docs/session-map.md`.
Playbook diff or explicit "nothing new". Overwrite `docs/session-brief.md`.
`pnpm handoff --ship` with the R22 gate; verify the deploy LANDS via
`/api/build` and state the SHA.

Completion against the denominator: items 0–3, N of 4 whole; within item 1, rows
completed of five. "Needs your hands." followed IMMEDIATELY by the numbered
list, or "Nothing — the queue continues." Author-ruled-expected items never
appear there.

Correct first. Fast second. Nothing third.
