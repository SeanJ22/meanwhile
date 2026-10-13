# Returned: map-representation

lane: map-representation
owner: map-representation
writer: the map-representation lane
check: fold-conflict
ready: MR-01 b190a8dd66c7de69d4aef838a034e87c8d7cadcf
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T01:55:38Z
state: returned
fix_subject: fix:839a7482
fix: River · stream/map-representation — fold-conflict failed for map-representation: map-representation READY b190a8dd66c7 conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/map-representation, resolve, and mark READY

## Failure

```
map-representation READY b190a8dd66c7 conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/map-representation, resolve, and mark READY again.
```

## Repair

Fix on stream/map-representation and publish a new READY commit; River folds the new READY and clears this return when it integrates.
