# Returned: cx-vs-ri

lane: cx-vs-ri
owner: cx-vs-ri
writer: the cx-vs-ri lane
check: connection proofs
ready: CX-VS 324dce9eef600a1dd018d47b3420f3e70823b03a
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:38:15Z
state: returned
fix_subject: fix:c7fab0ea
fix: River · stream/cx-vs-ri — connection proofs failed for cx-vs-ri: READY 324dce9eef60 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 324dce9eef60 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/cx-vs-ri and publish a new READY commit; River folds the new READY and clears this return when it integrates.
