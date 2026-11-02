# Returned: river-174

lane: river-174
owner: river-174
writer: the river-174 lane
check: connection proofs
ready: RL-174 17d868859ea05d9918d32972496258567fbf6e5c
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:39:28Z
state: cleared: integrated ready 3c5a0e9755a3db69595dedf9abe80782a59295c8 on river 566628e5b5b0966b2d6c12759444dc14a1bb6fe5
fix_subject: fix:15d0df7b
fix: River · stream/river-174 — connection proofs failed for river-174: READY 17d868859ea0 refused: its message lacks "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.

## Failure

```
READY 17d868859ea0 refused: its message lacks "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/river-174 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
