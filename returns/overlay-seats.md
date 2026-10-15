# Returned: overlay-seats

lane: overlay-seats
owner: overlay-seats
writer: the overlay-seats lane
check: at-scale
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T18:00:03Z
state: returned
fix_subject: fix:101ae930
fix: River · stream/overlay-seats — at-scale failed for overlay-seats: SL-02 (478708dbd) also still conflicts with river in app/api/address/resolve/route.ts, components/map/coverage-notice.tsx, components/map/map-entry.tsx, components/officials/person-identity.tsx, lib/census-geography/acquire.ts. AT SCALE num

## Failure

```
SL-02 (478708dbd) also still conflicts with river in app/api/address/resolve/route.ts, components/map/coverage-notice.tsx, components/map/map-entry.tsx, components/officials/person-identity.tsx, lib/census-geography/acquire.ts. AT SCALE numbers are missing from the READY commit message (rule in force from the next batch): peak memory per worker, database bytes read and written per run and per day, run time, how many copies fit on the runner at the 0.75 GiB margin, and the largest input tested (name anything not tested at full size). Run the change against national-size input and put the numbers in the READY commit message.
```

## Repair

Fix on stream/overlay-seats and publish a new READY commit; River folds the new READY and clears this return when it integrates.
