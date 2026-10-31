# Returned: spn-01-tasksonce

lane: spn-01-tasksonce
owner: spn-01-tasksonce
writer: the spn-01-tasksonce lane
check: connection proofs
ready: SPN-01 33fe38e9dfbe9c3e1af0b8d3949b7185a0308376
river: f1bb5dfad0b0555f1f851fbeaeb26046273a797b
at: 2026-10-31T02:23:34Z
state: returned
fix_subject: fix:aafe7ef5
fix: River · stream/spn-01-tasksonce — connection proofs failed for spn-01-tasksonce: READY 33fe38e9dfbe refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 33fe38e9dfbe refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/spn-01-tasksonce and publish a new READY commit; River folds the new READY and clears this return when it integrates.
