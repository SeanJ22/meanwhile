# Returned: meetings-place

lane: meetings-place
owner: meetings-place
writer: the meetings-place lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T17:59:58Z
state: returned
fix_subject: fix:6fcfac41
fix: River · stream/meetings-place — at-scale failed for meetings-place: MT-01 (50c8f78cd) also still conflicts with river in lib/control-plane/discovery/meetings-discovery-executor.ts and reads the removed ScoutResult.sourceDeadEnds in lib/control-plane/discovery/route-hints.ts. AT SCALE numbers are missing fro

## Failure

```
MT-01 (50c8f78cd) also still conflicts with river in lib/control-plane/discovery/meetings-discovery-executor.ts and reads the removed ScoutResult.sourceDeadEnds in lib/control-plane/discovery/route-hints.ts. AT SCALE numbers are missing from the READY commit message (rule in force from the next batch): peak memory per worker, database bytes read and written per run and per day, run time, how many copies fit on the runner at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). Run the change against national-size input and put the numbers in the READY commit message.
```

## Repair

Fix on stream/meetings-place and publish a new READY commit; River folds the new READY and clears this return when it integrates.
