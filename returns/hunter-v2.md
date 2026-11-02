# Returned: hunter-v2

lane: hunter-v2
owner: hunter-v2
writer: the hunter-v2 lane
check: connection proofs
ready: R0, NE-01, BL-30, R3-NOVUS, R3-SWAGIT, R3-MUNICODE, R1, MT-01, SRC-MN, NEON-ALLOW 90f9be11d9227f353c25ccfce637f4f5f600e1d1
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:38:43Z
state: returned
fix_subject: fix:a2e9ae6c
fix: River · stream/hunter-v2 — connection proofs failed for hunter-v2: READY 90f9be11d922 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 90f9be11d922 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/hunter-v2 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
