# Returned: site-reads

lane: site-reads
owner: site-reads
writer: the site-reads lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T18:00:16Z
state: returned
fix_subject: fix:357f8de5
fix: River · stream/site-reads — at-scale failed for site-reads: NE-01 (8782164dd) also fails gates: migration 0036_ne01 has no MIGRATION_PHASES entry in lib/db/migration-phases.ts (expand), and lib/api/reader-route.ts:21 selectionForReader is an unused export. AT SCALE numbers are missing from the READY

## Failure

```
NE-01 (8782164dd) also fails gates: migration 0036_ne01 has no MIGRATION_PHASES entry in lib/db/migration-phases.ts (expand), and lib/api/reader-route.ts:21 selectionForReader is an unused export. AT SCALE numbers are missing from the READY commit message (rule in force from the next batch): peak memory per worker, database bytes read and written per run and per day, run time, how many copies fit on the runner at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). Run the change against national-size input and put the numbers in the READY commit message.
```

## Repair

Fix on stream/site-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
