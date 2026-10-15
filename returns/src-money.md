# Returned: src-money

lane: src-money
owner: src-money
writer: the src-money lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T18:00:20Z
state: returned
fix_subject: fix:dbb7a2db
fix: River · stream/src-money — at-scale failed for src-money: SRC-MN (d2562653d) also still conflicts with river in app/api/ask/grounded/route.ts, components/map/popup/entity-modal.tsx, lib/ask/evidence.ts, lib/civic-data/changes.ts, lib/civic-data/contracts.ts. AT SCALE numbers are missing from the R

## Failure

```
SRC-MN (d2562653d) also still conflicts with river in app/api/ask/grounded/route.ts, components/map/popup/entity-modal.tsx, lib/ask/evidence.ts, lib/civic-data/changes.ts, lib/civic-data/contracts.ts. AT SCALE numbers are missing from the READY commit message (rule in force from the next batch): peak memory per worker, database bytes read and written per run and per day, run time, how many copies fit on the runner at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). Run the change against national-size input and put the numbers in the READY commit message.
```

## Repair

Fix on stream/src-money and publish a new READY commit; River folds the new READY and clears this return when it integrates.
