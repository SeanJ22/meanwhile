# Returned: salvage-river-next-slide

lane: salvage-river-next-slide
owner: salvage-river-next-slide
writer: the salvage-river-next-slide lane
check: connection proofs
ready: DB-09, DB-10, DB-11, CA-09, RL-01, CA-12, SC-01, RL-07, SC-03, SC-20, CA-06, SC-02, RL-06, SC-05, CH-02, SC-12, SC-08, RL-03, SC-04, DB-01, DB-12, CA-42, SC-07, CH-06, DB-25, BR-08, CA-03, SC-09, CA-13, CH-10, SC-06, SC-15, SC-11, SC-18, DP-02, DP-04, DB-48, DB-02, DP-06, DB-13, DB-21, BX-08, BR-21, SC-13, SC-16, BR-23, CH-03, CA-24, CA-20, CA-30, CA-44, CA-45, CA-51, DB-17, DB-23, DP-07, DB-42, DB-38, DB-49, DP-09, DB-37, DB-40, DB-41, DP-08, DP-19, DB-43, DB-14, DB-51, DP-20, CH-04, DB-15, DB-16, DP-21, DP-22, DP-27, DB-57, FE-16, DP-03, FE-17, FE-18, CA-15, DB-18, DB-50, DP-24, DP-15, FE-03, CH-05, DB-32, DP-05, DP-13, DB-06, DP-28, DP-16, BX-10, DB-07, DB-33, DP-10, DP-18, DB-55, DP-14, CH-07, DB-03, DB-04, DB-05, DB-54, DB-56, DB-27, DB-31, CA-40, CA-41, DB-08, CH-08, BX-09, DB-30, CH-09, BR-05, BR-06, BR-01, BR-03, BR-24, CH-13, BR-12, BR-15, BR-09, BR-02, BR-10, BR-16, BR-37, CH-29, CH-30, CH-12, CH-14, CP-01, CP-19, CH-11, DB-28, DB-34, DB-35, CH-24, CH-26, CA-01, FE-05, FE-06, FE-07, FE-10, FE-39, FE-43, FE-44, BR-14, DB-58, DB-36, DP-12, DB-44, DB-46, DP-23, CP-02, CP-09, BX-12, BX-03, CP-10, CP-13, CP-16, CP-06, BX-13, DB-53, BR-25, CA-37, CA-52, CP-03, CP-04, CP-05, CP-07, CP-08, CP-11, CP-12, CP-18, BX-07, FE-08, FE-09, FE-11, FE-13, FE-15, FE-29, FE-30, FE-31, FE-34, FE-38, FE-41, FE-42, FE-45, FE-28, FE-32, SC-10, BX-01, SC-14, BR-33, FE-20, FE-21, BR-34, CH-15, BR-30, SC-19, CH-16, CH-17, BX-02, BX-06, CH-19, CA-21, CA-25, CA-26, CA-27, CA-28, CA-33, CA-46 671b0b567a7beb962c3f18fba60298325befdcc4
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:41:07Z
state: returned
fix_subject: fix:4515a5c0
fix: River · stream/salvage-river-next-slide — connection proofs failed for salvage-river-next-slide: READY 671b0b567a7b refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 671b0b567a7b refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/salvage-river-next-slide and publish a new READY commit; River folds the new READY and clears this return when it integrates.
