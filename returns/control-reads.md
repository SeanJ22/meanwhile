# Returned: control-reads

lane: control-reads
owner: control-reads
writer: the control-reads lane
check: fold-conflict
ready: no step ids unknown
river: 965bf002ea7ba2dd209f8d07852708e5e1fa1a8d
at: 2026-10-16T03:36:24Z
state: returned
fix_subject: fix:196137f7
fix: River · stream/control-reads — fold-conflict failed for control-reads: CP-01 (deec70931) conflicts with river 1d3d303d7 (R1 follow-up on river) in a way that changes what its code does, so River did not settle it. Behavior: both redesign the same control-plane read paths. (1) Box: river's backfillBox indexes o

## Failure

```
CP-01 (deec70931) conflicts with river 1d3d303d7 (R1 follow-up on river) in a way that changes what its code does, so River did not settle it. Behavior: both redesign the same control-plane read paths. (1) Box: river's backfillBox indexes only results the Box does not hold, with one Box read per call and findings stored on the Box row (lib/control-plane/box.ts); CP-01 replaces that read path. (2) Held-election inputs: river's worker-held-elections returns Pick<HeldInputs,'nationalAt'|'registryAt'|'routesAt'>; CP-01 returns HeldBallotInputs and pages subjects through cp_work_items_history. (3) Storage: CP-01's admin-section, model-charge and dispatch-state DDL and pg-schema imports vs river's schema (pg-schema.ts, pg-store.ts, file-store.ts, memory.ts). (4) app/api/ask/grounded/route.ts (comment hunks and the identityReady ordering, both settled by River before, now in conflict again) and scripts/derive-candidate-campaign-sites.mts reading cp_work_items_history. Merge origin/river into stream/control-reads, make CP-01's reads go through river's per-pass cursors instead of beside them, delete whichever backfill/read path CP-01 replaces, run the focused tests, and push a new READY.
```

## Repair

Fix on stream/control-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
