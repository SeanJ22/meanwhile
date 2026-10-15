# Returned: overlay-seats

lane: overlay-seats
owner: overlay-seats
writer: the overlay-seats lane
check: at-scale
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:21:37Z
state: returned
fix_subject: fix:4d8821aa
fix: River · stream/overlay-seats — at-scale failed for overlay-seats: SL-02 (fdf55ff36): AT SCALE peak comes from the national publisher: 'Peak publisher 730.195 MiB, coordinator 307 MiB' hold the whole national representation run; a job's peak must come from one place or one district file. Name the stage tha

## Failure

```
SL-02 (fdf55ff36): AT SCALE peak comes from the national publisher: 'Peak publisher 730.195 MiB, coordinator 307 MiB' hold the whole national representation run; a job's peak must come from one place or one district file. Name the stage that holds the national set (the publisher's accumulation before promotion) and publish per state or per district with the peak at the largest single one. Also conflicts with river 3282584e2 in lib/meetings/edge-serving.ts, lib/registry/runtime-edge.ts, lib/registry/server.ts, tests/could-govern-pill.test.ts, tests/plural.test.ts.
```

## Repair

Fix on stream/overlay-seats and publish a new READY commit; River folds the new READY and clears this return when it integrates.
