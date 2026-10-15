# Returned: steps-2-6

lane: steps-2-6
owner: steps-2-6
writer: the steps-2-6 lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T18:00:24Z
state: returned
fix_subject: fix:1a614600
fix: River · stream/steps-2-6 — at-scale failed for steps-2-6: STEP-2 to STEP-7 (3adcf3369) also still conflict with river in app/ballot/page.tsx, lib/civic-data/meeting-research-evidence.ts, lib/civic-data/store.ts, app/api/ask/grounded/route.ts, app/api/funding/[target]/route.ts, app/api/meetings/rou

## Failure

```
STEP-2 to STEP-7 (3adcf3369) also still conflict with river in app/ballot/page.tsx, lib/civic-data/meeting-research-evidence.ts, lib/civic-data/store.ts, app/api/ask/grounded/route.ts, app/api/funding/[target]/route.ts, app/api/meetings/route.ts, and the migration test fails once River numbers it (tests/step3-write-alarm-migration.test.ts). AT SCALE numbers are missing from the READY commit message (rule in force from the next batch): peak memory per worker, database bytes read and written per run and per day, run time, how many copies fit on the runner at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). Run the change against national-size input and put the numbers in the READY commit message.
```

## Repair

Fix on stream/steps-2-6 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
