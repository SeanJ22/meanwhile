# Returned: cx-votes

lane: cx-votes
owner: cx-votes
writer: the cx-votes lane
check: connection proofs
ready: CX-VOTES f13552c0ffd51cd51dff795160480fca50406645
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:38:06Z
state: returned
fix_subject: fix:2ea09826
fix: River · stream/cx-votes — connection proofs failed for cx-votes: READY f13552c0ffd5 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY f13552c0ffd5 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/cx-votes and publish a new READY commit; River folds the new READY and clears this return when it integrates.
