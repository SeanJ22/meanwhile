# Governance consolidation — Session G handoff (UNFINISHED)

**Date:** 2026-09-03 (`pnpm stamp`). **Base SHA:** `61219ad0c68d6601ba1eebb7139611dbd4979f7a`.
**Branch:** `claude/governance-consolidation-rewrite-1de366`. **Merged to main:** nothing.

Reader delta: **zero by design**. This session did not change the reader product.
It measured and de-risked the governance consolidation and produced the conservation
instruments the migration needs. It did **not** land the candidate as current law:
conservation (acceptance item 4) is provably NOT_MET, and the brief's terminal rule
forbids a partial merge of a governance corpus — it lands whole or not at all.

## PROBE result — BRANCH B (with the fixpoint nuance)

- `scripts/governance-compile.mts:229` calls `writeLedger(LEDGER_PATH)`; its header
  declares input as `ledger.jsonl` **plus** `lib/governance/adoptions.ts`.
- On the committed tree, `pnpm governance:compile` reproduces the ledger
  **byte-identical** (sha `3c1288e0…` unchanged, zero `git diff`) — a naive diff looks
  like BRANCH A. **But the same run recreated 75 records** from `adoptions.ts`
  (`NEW_DECISIONS` splices out and re-pushes every record it owns, lines 108–160),
  applied 13 status resolutions and 5 claim assignments. The committed ledger is a
  compile **fixpoint**; the overlay still recreates/reactivates records on every run.
- Per the brief's criterion ("compile modifies the ledger **OR** an overlay
  recreates/re-activates records"), this is **BRANCH B**. §1A/§2 (compiler cutover) are
  mandatory and blocking before the candidate can be installed and compiled.

## What is MET (verified this session)

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | Complete shaped bundle incl. canonical ledger | **MET** | 19 inputs hashed → `consolidation-input-manifest-2026-09-03.json`; candidate `ledger.jsonl` = 314 valid records, 958,390 B, sha `23fa44c6…`. Preflight reproduced exactly: 248 SUPERSEDED / 51 ACTIVE / 14 HISTORICAL / 1 RETIRED; active 35 LAW / 12 DECISION / 4 FACT; R-0248…R-0276 = 244 unique `supersedes_full` targets, all SUPERSEDED; R-0277 ACTIVE LAW; R-0261 supersedes R-0160 and carries the 3 business claims. |
| 2 | Exact baseline of all current law | **MET** | Base: 283 records, 262 current (226 LAW / 32 DECISION / 4 other), 21 historical. `governance:check` green on base (13 checks, 0 issues). |
| 5 | Every old body + variant preserved | **MET (mechanical)** | 283/283 base records present in candidate with **byte-identical body and variants** (0 missing, 0 changed). `consolidation-map-2026-09-03.json` → `preservationSummary`. |

Also verified (partial evidence toward item 4, not sufficient alone):
- **Semantic claim conservation is perfect.** All **65** base current claim-keys survive
  on candidate active records with unchanged values (0 dropped); exactly the 3 owner
  keys added. The *structured* law is fully conserved.
- **Supersession graph is structurally complete.** Every one of the 262 prior-operative
  records either carries forward current or has an incoming supersession/amendment edge
  in the candidate. No orphaned current record.

## What is NOT_MET (the blockers, named)

**Item 4 — semantic conservation. NOT_MET.** `consolidation-map-2026-09-03.json`
dispositions the 262 prior-operative records: 20 `CARRIED_ACTIVE_UNCHANGED`,
3 `SUPERSEDED_LIKELY_CONSERVED`, **239 `SUPERSEDED_REQUIRES_SEMANTIC_REVIEW`**.
Consolidation deliberately rewrites wording, so verbatim clause overlap is low by
design and **cannot** discharge conservation — each of the 239 needs a bidirectional
clause read (does the successor's consolidated body carry every operative clause of the
record it absorbs?). The map is the exact worklist. Confirmed concrete holes inside it:

1. **The 14-rung retrieval ladder (§6).** R-0249 replaced the fourteen **numbered rungs**
   with lettered **tiers** (A0/A/B/C). Neither R-0249 nor the candidate `CLAUDE.md`
   carries the rung list. Stored `walledAtRung` integers would be reinterpreted. Preserve
   the 14 rung numbers+meanings verbatim in one canonical current holder (the registry
   defining `walledAtRung`) and repoint before superseding the old ladder holder. **Do
   not renumber.**
2. **Photo "one tracker row per session" clause (R-0055).** No active-LAW match; verify
   whether it legitimately moved to tracker-workflow or was dropped.

**Item 3 — compiler cutover (BRANCH B). NOT DONE.** Fold every still-operative adoption,
classification, status resolution, claim assignment and retirement from
`lib/governance/adoptions.ts` (205 KB / 4056 lines), `classification.ts`, `claims.ts`
permanently into `ledger.jsonl`; make `governance:compile` **read-only on the ledger**
(never `writeLedger`, never recreate/reactivate a record); add the two guards
(double-compile hash stability; a planted overlay-owned superseded record that compile
cannot reactivate/replace). Must precede the first post-install `governance:check`.

**Item 6 — contradictions. NOT DONE** (15 items in the brief's §6): history-never-overrides
(fix R-0247 wording), 277-as-pending purge, single `NEEDS_SEAN` terminal state, pilot/
frontier order, the ladder hole above, the rendering/suppression taxonomy, walk:all
scope, deploy scope, current-decisions composition, numbering (7/11/18/22/88/89),
permission enum, privacy disclosure wording, depth-order scope.

**Item 7 — `ruleKey`. NOT DONE.** No `ruleKey` field exists in `schema.ts` today. Add it,
enforce one active holder per key in `validate.ts`, backfill every active LAW_DECISION,
add negative controls (duplicate key fails; history note linked to existing key passes).

**Item 8 — generated views. NOT DONE.** Depends on the finalized ledger + cutover.
`rulings.md` must become an index (bodies in history only); nine policies + constitution +
current-decisions + `AGENTS.md` (`pnpm agents:sync`) regenerate and byte-verify. Delivered
bundle policy files are advisory fixtures (§6A), not the spec.

Items 9–11 (reference census, full gates on exact head, one merge) are downstream of 3–8.

## Resume point (exact)

The candidate is fundamentally **sound** — no text lost, all structured claims conserved,
supersession graph complete — so this is a **verification + targeted-repair** job, not a
rebuild. Recommended order for the next session:

1. **Conservation audit (item 4).** Walk the 239 `SUPERSEDED_REQUIRES_SEMANTIC_REVIEW`
   rows in `consolidation-map-2026-09-03.json`; for each, confirm every operative clause of
   the absorbed record appears in a successor's active body, marking `CONSERVED` /
   `EXPLICITLY_RETIRED_BY_OWNER` / `CONFLICT`. Repair the ladder and photo-row holes by
   moving the clauses into a canonical current holder **before** relying on the supersession.
2. **Compiler cutover (item 3)** once the ledger content is final.
3. `ruleKey` (item 7), contradictions (item 6), regeneration (item 8), census + gates +
   merge (9–11). Merge only when items 1–8 are MET on the exact head; else UNFINISHED again.

## Artifacts committed to this branch (not merged)

- `docs/governance/consolidation-map-2026-09-03.json` — §3/§4 conservation + preservation map.
- `docs/governance/consolidation-input-manifest-2026-09-03.json` — §1 input hashes.
- `scripts/consolidation-conserve.mts` — the generator behind the map (re-runnable).
- This handoff.

The delivered bundle lives (uncommitted) at `docs/governance-consolidation-2026-09-03/`
in the main checkout; hashes are in the manifest for re-verification.

**Owner needs from this consolidation: none.** No semantic conflict required an owner
decision this directive did not already settle. The block is engineering volume
(239-record conservation audit + cutover + regeneration), not a pending question.
