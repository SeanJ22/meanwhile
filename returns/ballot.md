# Returned: ballot

lane: ballot
owner: ballot
writer: the ballot lane
check: connection proofs
ready: DB-22, CA-08, DP-25, DP-26, DP-33, DP-34, FE-21, DP-29, CA-02, BX-11, CH-24 7981365a4fc965470969006eaffde3e62bd66f05
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:37:41Z
state: returned
fix_subject: fix:670d5326
fix: River · stream/ballot — connection proofs failed for ballot: READY 7981365a4fc9 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 7981365a4fc9 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/ballot and publish a new READY commit; River folds the new READY and clears this return when it integrates.
