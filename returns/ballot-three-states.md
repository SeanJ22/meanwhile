# Returned: ballot-three-states

lane: ballot-three-states
owner: ballot-three-states
writer: the ballot-three-states lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T17:59:53Z
state: returned
fix_subject: fix:104af782
fix: River · stream/ballot-three-states — at-scale failed for ballot-three-states: BL-30 (3c12d0caa) also still conflicts with river in lib/civic-data/held-place-families.ts (hunks in the earlier note). BL-30 owns the national ballot path; stream/ballot-national is closed. AT SCALE numbers are missing from the READY commi

## Failure

```
BL-30 (3c12d0caa) also still conflicts with river in lib/civic-data/held-place-families.ts (hunks in the earlier note). BL-30 owns the national ballot path; stream/ballot-national is closed. AT SCALE numbers are missing from the READY commit message (rule in force from the next batch): peak memory per worker, database bytes read and written per run and per day, run time, how many copies fit on the runner at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). Run the change against national-size input and put the numbers in the READY commit message.
```

## Repair

Fix on stream/ballot-three-states and publish a new READY commit; River folds the new READY and clears this return when it integrates.
