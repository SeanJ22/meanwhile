# Returned: rb-a4

lane: rb-a4
owner: rb-a4
writer: the rb-a4 lane
check: connection proofs
ready: RB-A4 b2bbdc183ca9779bc914a932afed10e33966ad1b
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:39:24Z
state: returned
fix_subject: fix:52fc980a
fix: River · stream/rb-a4 — connection proofs failed for rb-a4: READY b2bbdc183ca9 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY b2bbdc183ca9 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/rb-a4 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
