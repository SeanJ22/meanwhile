# Returned: src-money

lane: src-money
owner: src-money
writer: the src-money lane
check: connection proofs
ready: SRC-MN, HF-01, HF-02 6dc11bf851b6f1813bb551721c63dc299605bcf4
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:41:19Z
state: returned
fix_subject: fix:e3c19235
fix: River · stream/src-money — connection proofs failed for src-money: READY 6dc11bf851b6 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 6dc11bf851b6 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/src-money and publish a new READY commit; River folds the new READY and clears this return when it integrates.
