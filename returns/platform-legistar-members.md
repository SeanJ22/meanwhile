# Returned: platform-legistar-members

lane: platform-legistar-members
owner: platform-legistar-members
writer: the platform-legistar-members lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T18:00:07Z
state: returned
fix_subject: fix:53ba6e6d
fix: River · stream/platform-legistar-members — at-scale failed for platform-legistar-members: R3-LEGISTAR-MEMBERS (811bcee4a) also still conflicts with river in lib/civic-data/derived-meeting-wiring.ts, scripts/promote-registry-runtime.mts, scripts/routine-civic-data-runner.mts, tests/door-kinds-data-rows.test.ts. AT SCALE numbers a

## Failure

```
R3-LEGISTAR-MEMBERS (811bcee4a) also still conflicts with river in lib/civic-data/derived-meeting-wiring.ts, scripts/promote-registry-runtime.mts, scripts/routine-civic-data-runner.mts, tests/door-kinds-data-rows.test.ts. AT SCALE numbers are missing from the READY commit message (rule in force from the next batch): peak memory per worker, database bytes read and written per run and per day, run time, how many copies fit on the runner at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). Run the change against national-size input and put the numbers in the READY commit message.
```

## Repair

Fix on stream/platform-legistar-members and publish a new READY commit; River folds the new READY and clears this return when it integrates.
