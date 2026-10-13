# Returned: overlay-seats

lane: overlay-seats
owner: overlay-seats
writer: the overlay-seats lane
check: fold-conflict
ready: SL-02 478708dbd532bd4bd4b20505f0c8b1f47ed898d5
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T01:55:53Z
state: returned
fix_subject: fix:48f1e133
fix: River · stream/overlay-seats — fold-conflict failed for overlay-seats: overlay-seats READY 478708dbd532 conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/overlay-seats, resolve, and mark READY again.

## Failure

```
overlay-seats READY 478708dbd532 conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/overlay-seats, resolve, and mark READY again.
```

## Repair

Fix on stream/overlay-seats and publish a new READY commit; River folds the new READY and clears this return when it integrates.
