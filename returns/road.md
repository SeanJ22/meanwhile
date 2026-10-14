# Returned: road

lane: road
owner: road
writer: the road lane
check: fold-conflict
ready: no step ids df7b359c97cf9aa0c94b79c1860d555a508e161e
river: 5bb464f06e345165d6302377d20418f29d392409
at: 2026-10-14T00:55:00Z
state: returned
fix_subject: fix:98beff1f
fix: River · stream/road — fold-conflict failed for road: road READY df7b359c9 conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/road, resolve, and mark READY again.

## Failure

```
road READY df7b359c9 conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/road, resolve, and mark READY again.
```

## Repair

Fix on stream/road and publish a new READY commit; River folds the new READY and clears this return when it integrates.
