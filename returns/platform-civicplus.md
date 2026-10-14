# Returned: platform-civicplus

lane: platform-civicplus
owner: platform-civicplus
writer: the platform-civicplus lane
check: fold-conflict
ready: no step ids unknown
river: 5bb464f06e345165d6302377d20418f29d392409
at: 2026-10-14T00:54:42Z
state: returned
fix_subject: fix:1c8b3897
fix: River · stream/platform-civicplus — fold-conflict failed for platform-civicplus: platform-civicplus READY b2576c548 conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/platform-civicplus, resolve, and mark READY again.

## Failure

```
platform-civicplus READY b2576c548 conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/platform-civicplus, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-civicplus and publish a new READY commit; River folds the new READY and clears this return when it integrates.
