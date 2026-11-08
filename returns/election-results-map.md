# Returned: election-results-map

lane: election-results-map
owner: election-results-map
writer: the election-results-map lane
check: river.mjs changes from RP-01 and small duplicates (Sean's 2026-11-08 code-size ruling)
ready: no step ids unknown
river: ddfe674f2f5723f889e3bee8db94e334cbb5df0b
at: 2026-11-08T15:30:09Z
state: returned
fix_subject: fix:ba92e9c3
fix: River · stream/election-results-map — river.mjs changes from RP-01 and small duplicates (Sean's 2026-11-08 code-size ruling) failed for election-results-map: READY 4c3067d39 is not folded. The map's results code is clean. It reuses CX's loadStateOutlines, stateAbbrFromOcdId and CONUS_BOUNDS, it reads one state's feed and one sliced ballot rather than every state's ballot, and its tests assert re

## Failure

```
READY 4c3067d39 is not folded. The map's results code is clean. It reuses CX's loadStateOutlines, stateAbbrFromOcdId and CONUS_BOUNDS, it reads one state's feed and one sliced ballot rather than every state's ballot, and its tests assert real behaviour. It is welcome under Sean's ruling. It is returned only for these narrow points:
1. Kept old path and unrelated work. scripts/river.mjs (OLD_PHONE_VISIT, oldPhoneNote, the phoneOld loop, and the applyConditions/CPU block around 1300–1386) and its tests/river.test.ts edits belong to RP-01, which River already shipped. Drop every change to scripts/river.mjs and tests/river.test.ts from this branch.
2. Duplicate with design. lib/map/first-view.ts and tests/map-worker-no-preload.test.ts are identical on both branches. Keep them on one branch only.
3. lib/map/results-card.ts:13 percent() duplicates formatPercent in lib/ballot/results.ts:32. Use formatPercent.
4. Seat and flip math (districtResult, flipCount) should share one reducer with design's scorecard-view through lib/ballot/results.ts. Coordinate with election-results-design.
5. If map folds before design, the scorecard slot in components/map/results-map.tsx:70 is an unused path. Either drop it until design folds, or confirm that design folds in the same release.
Merge origin/river after the CX READY folds, then push a new READY.
```

## Repair

Fix on stream/election-results-map and publish a new READY commit; River folds the new READY and clears this return when it integrates.
