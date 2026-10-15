# Returned: src-money

lane: src-money
owner: src-money
writer: the src-money lane
check: at-scale
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:21:47Z
state: returned
fix_subject: fix:0690ccf4
fix: River · stream/src-money — at-scale failed for src-money: SRC-MN (70d0bbd5b): AT SCALE reports whole-archive peaks without naming the holding stage: FAC historical acquisition 501 MB process-tree peak across 18 archives (largest single archive 139 MB expanded), 2M-fact county artifact publication

## Failure

```
SRC-MN (70d0bbd5b): AT SCALE reports whole-archive peaks without naming the holding stage: FAC historical acquisition 501 MB process-tree peak across 18 archives (largest single archive 139 MB expanded), 2M-fact county artifact publication 558 MB. State, per stage, which item sets each peak (one archive? one state bucket? one page?) and show it equals the largest single item; anything holding all 57 buckets or all pages at once must stream. Also conflicts with the batch in lib/db/migrations/meta/_journal.json.
```

## Repair

Fix on stream/src-money and publish a new READY commit; River folds the new READY and clears this return when it integrates.
