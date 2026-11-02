# Returned: site-reads

lane: site-reads
owner: site-reads
writer: the site-reads lane
check: connection proofs
ready: R3-MUNICODE, R1, NE-01 f42bc19c66a0d40a51cb156cd9bc86a529b03870
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:41:11Z
state: returned
fix_subject: fix:7526029f
fix: River · stream/site-reads — connection proofs failed for site-reads: READY f42bc19c66a0 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY f42bc19c66a0 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/site-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
