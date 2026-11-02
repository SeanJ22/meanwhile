# Returned: measures

lane: measures
owner: measures
writer: the measures lane
check: connection proofs
ready: DP-06, CH-22, CH-23, CH-20, CI-01, IR-01, IR-02, IR-03, IR-04, IR-05, HK-01, FM-01, FM-02, FM-03, FM-04, FM-05, FM-06, CI-02, LD-01, LD-02, LD-03, LD-04, FM-07, FM-08, FM-09, FM-10, PN-01, CM-01, NR-01, NR-02, NR-03, NR-04, NR-05, NR-06, NR-07, NR-08, AF-01, AF-02, AF-03, AF-04, AF-05, AF-06, AF-07, AF-08, AF-09, AF-10, AF-11, SL-01, BD-01, SL-03, BD-02, BR-04, BR-07, BR-11, BR-12, BR-13, BR-16, BR-17, BR-18, BR-26, BR-27, BR-28, BR-29, BR-35, BR-39, NL-01, FEC-01, SRC-GC, UI-01, PC-01, SRC-AC, PB-01, MR-01, SRC-LS, SRC-SO, SRC-CG, ZIP-01, VS-01, DS-01, DS-02, BR-36, BR-20, BR-31, SV-01, DS-03, R3-ESCRIBE, R7, R0, R2B, R3-CIVICPLUS, R2, R3-NOVUS, R3-SWAGIT, R3-PRIMEGOV, R3-CIVICCLERK, R3-GRANICUS, R1, BL-12, BL-15, BL-11, BL-10, BL-13, BL-20, BL-16, BL-14, BL-30 3d2b6615fe594fbb936a0485d29fadf9e9e59a52
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:37:25Z
state: returned
fix_subject: fix:73213bea
fix: River · stream/measures — connection proofs failed for measures: READY 3d2b6615fe59 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 3d2b6615fe59 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/measures and publish a new READY commit; River folds the new READY and clears this return when it integrates.
