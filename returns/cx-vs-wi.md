# Returned: cx-vs-wi

lane: cx-vs-wi
owner: cx-vs-wi
writer: the cx-vs-wi lane
check: connection proofs
ready: CX-VS 435849f221ecc06f98bf2c26439dc08bf60cc422
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:38:18Z
state: returned
fix_subject: fix:feb9e66a
fix: River · stream/cx-vs-wi — connection proofs failed for cx-vs-wi: READY 435849f221ec refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 435849f221ec refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/cx-vs-wi and publish a new READY commit; River folds the new READY and clears this return when it integrates.
