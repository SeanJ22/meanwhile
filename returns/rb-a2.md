# Returned: rb-a2

lane: rb-a2
owner: rb-a2
writer: the rb-a2 lane
check: connection proofs
ready: RV-BOX, DB-03 235c6f83714278c521f1a90d2a056b35034c3b86
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:39:20Z
state: returned
fix_subject: fix:1d6fcaae
fix: River · stream/rb-a2 — connection proofs failed for rb-a2: READY 235c6f837142 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 235c6f837142 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/rb-a2 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
