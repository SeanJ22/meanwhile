# Returned: src-money

lane: src-money
owner: src-money
writer: the src-money lane
check: fold-conflict
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:04:59Z
state: returned
fix_subject: fix:6360d85e
fix: River · stream/src-money — fold-conflict failed for src-money: SRC-MN (70d0bbd5b) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: lib/db/migrations/meta/_journal.json. Merge origin/river into stream/src-money, settle those files so both sides' behavior is kept (NE-01's rea

## Failure

```
SRC-MN (70d0bbd5b) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: lib/db/migrations/meta/_journal.json. Merge origin/river into stream/src-money, settle those files so both sides' behavior is kept (NE-01's reader-edge reads and request accounting, municode's bounded portal reads), run the focused tests, push a new READY with AT SCALE numbers in the message.
```

## Repair

Fix on stream/src-money and publish a new READY commit; River folds the new READY and clears this return when it integrates.
