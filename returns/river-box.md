# Returned: river-box

lane: river-box
owner: river-box
writer: the river-box lane
check: connection proofs
ready: RV-BOX 9350e15da92de8f77323003eb7ef9c1ba6fe6924
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:39:32Z
state: returned
fix_subject: fix:a47a3f64
fix: River · stream/river-box — connection proofs failed for river-box: READY 9350e15da92d refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 9350e15da92d refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/river-box and publish a new READY commit; River folds the new READY and clears this return when it integrates.
