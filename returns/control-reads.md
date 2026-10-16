# Returned: control-reads

lane: control-reads
owner: control-reads
writer: the control-reads lane
check: at-scale
ready: no step ids unknown
river: 1d3d303d70dc9d14aab69d61ea9b0d76d76b6e6f
at: 2026-10-16T05:56:23Z
state: returned
fix_subject: fix:db041872
fix: River · stream/control-reads — at-scale failed for control-reads: Not folded: CP-01 edb5a08f3 carries data in a migration.

## Failure

```
Not folded: CP-01 edb5a08f3 carries data in a migration.
New rule (Sean, SB-01 order): return any READY that adds or keeps a stored record or reader read covering more than one state, or a migration that carries data.
lib/control-plane/repository/migrations/CP-01.ts moves existing rows: INSERT INTO cp_route_tasks_archive / cp_work_items_archive SELECT * FROM the live tables, backfillAdminSections for Admin settings, and backfillModelCharges. Those copy production rows across every state's work in one migration.
Needed: ship the schema change as expand-only DDL with no row copying, and move the archive, Admin-section and model-charge backfills into code the runner runs per place or per state under its own job. Also 174 files changed in one READY; split if it can be.
```

## Repair

Fix on stream/control-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
