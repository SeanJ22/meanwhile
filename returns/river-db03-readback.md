# Returned: river-db03-readback

lane: river-db03-readback
owner: river-db03-readback
writer: the river-db03-readback lane
check: connection proofs
ready: DB-03 235c6f83714278c521f1a90d2a056b35034c3b86
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:39:43Z
state: returned
fix_subject: fix:f1dd5536
fix: River · stream/river-db03-readback — connection proofs failed for river-db03-readback: READY 235c6f837142 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 235c6f837142 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/river-db03-readback and publish a new READY commit; River folds the new READY and clears this return when it integrates.
