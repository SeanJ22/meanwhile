# Returned: river-placemap-136

lane: river-placemap-136
owner: river-placemap-136
writer: the river-placemap-136 lane
check: connection proofs
ready: RIVER-PLACEMAP 34da906425165f9129d317a8913d15cc776b7345
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:40:00Z
state: returned
fix_subject: fix:61f76821
fix: River · stream/river-placemap-136 — connection proofs failed for river-placemap-136: READY 34da90642516 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 34da90642516 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/river-placemap-136 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
