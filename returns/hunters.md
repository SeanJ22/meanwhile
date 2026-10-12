# Returned: hunters

lane: hunters
owner: hunters
writer: the hunters lane
check: fold-conflict
ready: CH-23 016f1a7bbdd2462bb6348d68589499f09286e549
river: 8d68f46721de856247c38dd39680db15e5a9f37e
at: 2026-10-12T21:47:47Z
state: returned
fix_subject: fix:84e3f0c6
fix: River · stream/hunters — fold-conflict failed for hunters: hunters READY 016f1a7bbdd2 (CH-23) conflicts with river-next when folded after registry; rebase/merge river into stream/hunters, resolve, and re-mark READY.

## Failure

```
hunters READY 016f1a7bbdd2 (CH-23) conflicts with river-next when folded after registry; rebase/merge river into stream/hunters, resolve, and re-mark READY.
```

## Repair

Fix on stream/hunters and publish a new READY commit; River folds the new READY and clears this return when it integrates.
