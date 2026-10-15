# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T20:42:17Z
state: returned
fix_subject: fix:b9dd589c
fix: River · stream/ballot-parity — at-scale failed for ballot-parity: BL-20 (386c53463) merges clean with river 493311674 now, but the READY commit message has no AT SCALE numbers: peak memory per worker, database bytes read and written per run and per day, run time, copies that fit at the 0.75 GiB margin, an

## Failure

```
BL-20 (386c53463) merges clean with river 493311674 now, but the READY commit message has no AT SCALE numbers: peak memory per worker, database bytes read and written per run and per day, run time, copies that fit at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). The message says these follow in a second READY under Sean's two-READY order; River has no such order on record, and the rule in force (Sean, 18:00Z) is that a READY touching national data without them goes back. Put the numbers in this READY, or Sean can say in writing that this one is waived.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
