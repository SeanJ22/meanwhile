# Returned: platform-novusagenda

lane: platform-novusagenda
owner: platform-novusagenda
writer: the platform-novusagenda lane
check: fold-conflict
ready: no step ids unknown
river: 5bb464f06e345165d6302377d20418f29d392409
at: 2026-10-14T00:54:53Z
state: returned
fix_subject: fix:64151bf7
fix: River · stream/platform-novusagenda — fold-conflict failed for platform-novusagenda: platform-novusagenda READY 06dd8586c conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/platform-novusagenda, resolve, and mark READY again.

## Failure

```
platform-novusagenda READY 06dd8586c conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/platform-novusagenda, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-novusagenda and publish a new READY commit; River folds the new READY and clears this return when it integrates.
