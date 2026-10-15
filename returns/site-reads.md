# Returned: site-reads

lane: site-reads
owner: site-reads
writer: the site-reads lane
check: gates
ready: NE-01 8782164ddb2f125249f206ab13dc9b2c5b42b3c9
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T15:36:20Z
state: returned
fix_subject: fix:e9150675
fix: River · stream/site-reads — gates failed for site-reads: NE-01 (8782164dd) fails gates: River numbers its migration NE-01.sql to 0036_ne01.sql, and lib/db/migration-phases.ts has no MIGRATION_PHASES entry for 0036_ne01. db:gate refuses (UNDECLARED, no default) and 13 tests in tests/apply-migratio

## Failure

```
NE-01 (8782164dd) fails gates: River numbers its migration NE-01.sql to 0036_ne01.sql, and lib/db/migration-phases.ts has no MIGRATION_PHASES entry for 0036_ne01. db:gate refuses (UNDECLARED, no default) and 13 tests in tests/apply-migrations-dry.test.ts fail with 'db:apply: REFUSED — 0036_ne01 has no matching migration phase'. Add the entry for 0036_ne01 with the reason (it adds a column with a default and creates a function, nothing the live code depends on being absent: expand). R1 did the same for 0035_r1_fact_store. Run pnpm db:gate and tests/apply-migrations-dry.test.ts, push a new READY. The cleanliness item (unused export selectionForReader in lib/api/reader-route.ts) is also still open.
```

## Repair

Fix on stream/site-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
