# Returned: river-placemapload-136

lane: river-placemapload-136
owner: river-placemapload-136
writer: the river-placemapload-136 lane
check: connection proofs
ready: RIVER-PLACEMAPLOAD ea63747348668c00d5945191bb6927a9ddb94cb1
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:40:04Z
state: returned
fix_subject: fix:ae5b7a60
fix: River · stream/river-placemapload-136 — connection proofs failed for river-placemapload-136: READY ea6374734866 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY ea6374734866 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/river-placemapload-136 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
