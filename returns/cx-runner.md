# Returned: cx-runner

lane: cx-runner
owner: cx-runner
writer: the cx-runner lane
check: connection proofs
ready: CX-RUNNER 865dc3124b9a4fd50884c61fea53d163b6e30851
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:38:01Z
state: returned
fix_subject: fix:3f74a064
fix: River · stream/cx-runner — connection proofs failed for cx-runner: READY 865dc3124b9a refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 865dc3124b9a refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/cx-runner and publish a new READY commit; River folds the new READY and clears this return when it integrates.
