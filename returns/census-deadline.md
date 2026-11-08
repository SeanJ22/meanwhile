# Returned: census-deadline

lane: census-deadline
owner: census-deadline
writer: the census-deadline lane
check: connection proofs
ready: CN-02 462c348ba593d4271fa548f5a14452ff563758e3
river: ddfe674f2f5723f889e3bee8db94e334cbb5df0b
at: 2026-11-08T15:31:18Z
state: cleared: integrated ready df2eb547308eb73bbe1a7a9d152340b3a2e37d1d on river df60bf774fd5c1e5bf1f3d6e61b2dcca90f23719
fix_subject: fix:7b563fec
fix: River · stream/census-deadline — connection proofs failed for census-deadline: READY 462c348ba593 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 462c348ba593 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/census-deadline and publish a new READY commit; River folds the new READY and clears this return when it integrates.
