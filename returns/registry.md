# Returned: registry

lane: registry
owner: registry
writer: the registry lane
check: connection proofs
ready: BX-08, BX-10, CA-12, MW-VS, CP-04, CA-11, CA-05, CA-14, BX-13, CP-10, VS-NOW, DP-06, CH-22, CH-23, CH-20 544e2032310cdfc572033105332f1bafc881bd9e
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:37:29Z
state: returned
fix_subject: fix:55d420e0
fix: River · stream/registry — connection proofs failed for registry: READY 544e2032310c refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY 544e2032310c refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/registry and publish a new READY commit; River folds the new READY and clears this return when it integrates.
