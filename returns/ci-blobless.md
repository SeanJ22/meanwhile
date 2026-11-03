# Returned: ci-blobless

lane: ci-blobless
owner: ci-blobless
writer: the ci-blobless lane
check: connection proofs
ready: CI-01 dc937dd0a68a6c689b4c04b2752611e0500f850b
river: 99eac64f7bfd847b4f647642cc959c12382ce549
at: 2026-11-03T17:02:39Z
state: returned
fix_subject: fix:bad1f67b
fix: River · stream/ci-blobless — connection proofs failed for ci-blobless: READY dc937dd0a68a refused: its message lacks "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.

## Failure

```
READY dc937dd0a68a refused: its message lacks "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/ci-blobless and publish a new READY commit; River folds the new READY and clears this return when it integrates.
