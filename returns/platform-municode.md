# Returned: platform-municode

lane: platform-municode
owner: platform-municode
writer: the platform-municode lane
check: fold-conflict
ready: no step ids unknown
river: 5bb464f06e345165d6302377d20418f29d392409
at: 2026-10-14T00:54:49Z
state: returned
fix_subject: fix:634685de
fix: River · stream/platform-municode — fold-conflict failed for platform-municode: platform-municode READY cf4f6cd90 conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/platform-municode, resolve, and mark READY again.

## Failure

```
platform-municode READY cf4f6cd90 conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/platform-municode, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-municode and publish a new READY commit; River folds the new READY and clears this return when it integrates.
