# Returned: river-ci-once

lane: river-ci-once
owner: river-ci-once
writer: the river-ci-once lane
check: connection proofs
ready: RIVER-CIONCE ba8bd32afb0d24bd8af334c98a03085f6d37fc09
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:39:40Z
state: returned
fix_subject: fix:4cfdd287
fix: River · stream/river-ci-once — connection proofs failed for river-ci-once: READY ba8bd32afb0d refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY ba8bd32afb0d refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/river-ci-once and publish a new READY commit; River folds the new READY and clears this return when it integrates.
