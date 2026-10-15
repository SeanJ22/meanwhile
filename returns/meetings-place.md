# Returned: meetings-place

lane: meetings-place
owner: meetings-place
writer: the meetings-place lane
check: fold-conflict
ready: MT-01 50c8f78cd71e56c75e736d820489a99036161966
river: d9107da58a23f9d38b60d300552af7e9d2509561
at: 2026-10-15T05:37:03Z
state: returned
fix_subject: fix:b258ac9f
fix: River · stream/meetings-place — fold-conflict failed for meetings-place: MT-01 (50c8f78cd) is clean against river alone, but H-01 (hunter-v2, folded this batch) removes ScoutResult.sourceDeadEnds and the scout path; lib/control-plane/discovery/route-hints.ts:81 still reads result.sourceDeadEnds, so tsc fails (TS

## Failure

```
MT-01 (50c8f78cd) is clean against river alone, but H-01 (hunter-v2, folded this batch) removes ScoutResult.sourceDeadEnds and the scout path; lib/control-plane/discovery/route-hints.ts:81 still reads result.sourceDeadEnds, so tsc fails (TS2339 and TS7006) when both are in. Once H-01 is on river, merge origin/river into stream/meetings-place, move route-hints.ts onto H-01's replacement for the dead-end rows, delete anything the old path left, run the focused tests, push a new READY.
```

## Repair

Fix on stream/meetings-place and publish a new READY commit; River folds the new READY and clears this return when it integrates.
