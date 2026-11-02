# Returned: meetings

lane: meetings
owner: meetings
writer: the meetings lane
check: connection proofs
ready: CA-12, MW-VS, CP-04, DB-29, CA-11, CA-05, CA-14, BX-13, CP-10, VS-NOW 9a7965c677cce077b997e9057eca8b6b455bcd13
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:37:33Z
state: returned
fix_subject: fix:81ffaaf2
fix: River · stream/meetings — connection proofs failed for meetings: READY 9a7965c677cc refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 9a7965c677cc refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/meetings and publish a new READY commit; River folds the new READY and clears this return when it integrates.
