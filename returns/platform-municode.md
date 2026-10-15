# Returned: platform-municode

lane: platform-municode
owner: platform-municode
writer: the platform-municode lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T18:00:12Z
state: returned
fix_subject: fix:dd2cc280
fix: River · stream/platform-municode — at-scale failed for platform-municode: R3-MUNICODE (4575313bc) also still conflicts with river in lib/civic-data/derived-door-kinds.ts, lib/control-plane/discovery/auto-crosswalk.ts, derived-wiring-reading.ts, derived-wiring.ts, lib/hunt/meetings-recipes.ts. AT SCALE numbers are

## Failure

```
R3-MUNICODE (4575313bc) also still conflicts with river in lib/civic-data/derived-door-kinds.ts, lib/control-plane/discovery/auto-crosswalk.ts, derived-wiring-reading.ts, derived-wiring.ts, lib/hunt/meetings-recipes.ts. AT SCALE numbers are missing from the READY commit message (rule in force from the next batch): peak memory per worker, database bytes read and written per run and per day, run time, how many copies fit on the runner at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). Run the change against national-size input and put the numbers in the READY commit message.
```

## Repair

Fix on stream/platform-municode and publish a new READY commit; River folds the new READY and clears this return when it integrates.
