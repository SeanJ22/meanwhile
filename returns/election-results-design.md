# Returned: election-results-design

lane: election-results-design
owner: election-results-design
writer: the election-results-design lane
check: unrelated work bundled in and duplicated tokens/math (Sean's 2026-11-08 code-size ruling)
ready: no step ids unknown
river: ddfe674f2f5723f889e3bee8db94e334cbb5df0b
at: 2026-11-08T15:30:05Z
state: returned
fix_subject: fix:1694ef2b
fix: River · stream/election-results-design — unrelated work bundled in and duplicated tokens/math (Sean's 2026-11-08 code-size ruling) failed for election-results-design: READY 80257a13c is not folded. The results redesign itself is welcome under Sean's ruling (genuinely new feature code may grow the tree). It replaces the deferred-result-enhancer cleanly. Returned for the parts that are not the redesign or

## Failure

```
READY 80257a13c is not folded. The results redesign itself is welcome under Sean's ruling (genuinely new feature code may grow the tree). It replaces the deferred-result-enhancer cleanly. Returned for the parts that are not the redesign or that duplicate code:
1. Unrelated work bundled in (about 65 files, about 1,100 lines). These belong to other steps, so drop them from this branch:
   - lib/counts/hour.ts COUNT_HOUR_SQL rewrite
   - CX-WRITES-02 migrations (lib/control-plane/repository/migrations/CX-WRITES-02.ts, lib/db/migrations/0084_*). These are already on river.
   - lib/control-plane/line-keeper/health.ts and watch.ts
   - lib/civic-data/store.ts:2430-2990 candidate vault/readClock rewrite
   - lib/signal/reactions.ts VOTE_CAST
   - the measure-grade9, research-cycle-progress-scope, line-keeper and vb01 tests
   Rebuild the branch from origin/river (plus the CX READY) with results-design commits only.
2. Duplicate tokens. app/globals.css:4957 adds --result-d, --result-r and --result-on, which duplicate the existing --party-democratic and --party-republican. Use the existing tokens.
3. Duplicate seat and flip math. lib/ballot/scorecard-view.ts (chamberFlipped, seatCountParts, partyLines, controlSummary) overlaps lib/ballot/results.ts flippedParty and map's lib/map/results.ts. Put one seat/flip reducer in lib/ballot/results.ts and import it everywhere. Coordinate with election-results-map.
4. The removal of about 480 lines of dead CSS (.map-floaters, .rail-section, .brand-change, .notice-rule, plus reader.css and v6.module.css) is fine, but put it in its own commit.
5. Check whether tests/live-results.test.tsx re-asserts what tests/contest-result.test.tsx covers. If it does, merge them.
Rebase on the CX READY that is folded, merge origin/river, and push a new READY.
```

## Repair

Fix on stream/election-results-design and publish a new READY commit; River folds the new READY and clears this return when it integrates.
