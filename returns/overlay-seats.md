# Returned: overlay-seats

lane: overlay-seats
owner: overlay-seats
writer: the overlay-seats lane
check: fold-conflict
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:04:49Z
state: returned
fix_subject: fix:86367b99
fix: River · stream/overlay-seats — fold-conflict failed for overlay-seats: SL-02 (fdf55ff36) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: lib/meetings/edge-serving.ts, lib/registry/runtime-edge.ts, lib/registry/server.ts. Merge origin/river into stream/overlay-seats, settle those f

## Failure

```
SL-02 (fdf55ff36) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: lib/meetings/edge-serving.ts, lib/registry/runtime-edge.ts, lib/registry/server.ts. Merge origin/river into stream/overlay-seats, settle those files so both sides' behavior is kept (NE-01's reader-edge reads and request accounting, municode's bounded portal reads), run the focused tests, push a new READY with AT SCALE numbers in the message.
```

## Repair

Fix on stream/overlay-seats and publish a new READY commit; River folds the new READY and clears this return when it integrates.
