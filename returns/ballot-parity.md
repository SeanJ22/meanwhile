# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T17:59:43Z
state: returned
fix_subject: fix:9434dcec
fix: River · stream/ballot-parity — at-scale failed for ballot-parity: BL-20 (6429fc3ad) also still conflicts with river in lib/civic-data/promotion.ts and lib/coverage/checklist-map.json (hunks in the earlier note on this page). BL-30 now owns the national ballot path, so settle overlap with stream/ballot-thr

## Failure

```
BL-20 (6429fc3ad) also still conflicts with river in lib/civic-data/promotion.ts and lib/coverage/checklist-map.json (hunks in the earlier note on this page). BL-30 now owns the national ballot path, so settle overlap with stream/ballot-three-states first. AT SCALE numbers are missing from the READY commit message (rule in force from the next batch): peak memory per worker, database bytes read and written per run and per day, run time, how many copies fit on the runner at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). Run the change against national-size input and put the numbers in the READY commit message.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
