# Returned: road

lane: road
owner: road
writer: the road lane
check: connection proofs
ready: NE-01, BL-30, R3-NOVUS, R3-SWAGIT, R3-MUNICODE, R1, MT-01, SRC-MN, NEON-ALLOW, R0, ADMIN-COUNTRY, DR-01, EP-01, RD-01 c566e13d60c9df91413e9fc7faedd6a2d65b5320
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:40:32Z
state: returned
fix_subject: fix:fa82b083
fix: River · stream/road — connection proofs failed for road: READY c566e13d60c9 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY c566e13d60c9 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/road and publish a new READY commit; River folds the new READY and clears this return when it integrates.
