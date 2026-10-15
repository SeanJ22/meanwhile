# Returned: control-reads

lane: control-reads
owner: control-reads
writer: the control-reads lane
check: fold-conflict
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:04:42Z
state: returned
fix_subject: fix:3e3d0d95
fix: River · stream/control-reads — fold-conflict failed for control-reads: CP-01 (deec70931) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: app/api/ask/grounded/route.ts, tests/admin-v6-workers.test.ts, tests/could-govern-pill.test.ts, tests/reader-edge.test.ts. Merge origin/river in

## Failure

```
CP-01 (deec70931) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: app/api/ask/grounded/route.ts, tests/admin-v6-workers.test.ts, tests/could-govern-pill.test.ts, tests/reader-edge.test.ts. Merge origin/river into stream/control-reads, settle those files so both sides' behavior is kept (NE-01's reader-edge reads and request accounting, municode's bounded portal reads), run the focused tests, push a new READY with AT SCALE numbers in the message.
```

## Repair

Fix on stream/control-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
