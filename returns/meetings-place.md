# Returned: meetings-place

lane: meetings-place
owner: meetings-place
writer: the meetings-place lane
check: at-scale
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:21:32Z
state: returned
fix_subject: fix:5d7efe35
fix: River · stream/meetings-place — at-scale failed for meetings-place: MT-01 (a22bfdfb4): AT SCALE peak comes from a whole state. 'Peak state worker RSS 447.23 MiB, largest state worker IL' and a national body index (554,292 identities, shared index heap 29 MB) held by the reader; a job's peak must come from o

## Failure

```
MT-01 (a22bfdfb4): AT SCALE peak comes from a whole state. 'Peak state worker RSS 447.23 MiB, largest state worker IL' and a national body index (554,292 identities, shared index heap 29 MB) held by the reader; a job's peak must come from one place or one body. Name the stage (the state worker's due-work and index pass; the reader's national body-identity index) and bound it to one place. Behavior conflict with CP-01 (folded in the batch): both lanes implement the field-manual slice query. lib/control-plane/repository/pg-store.ts FIELD_MANUAL_SLICE_SQL differs (- with an eligible/candidates CTE in CP-01; your version adds a state parameter at /), plus pg-schema.ts, scripts/platform-census-runner.mts imports and tests/field-manual-schema.test.ts. One query must serve both: drop your own slicing and extend CP-01's. Also reads removed ScoutResult.sourceDeadEnds in route-hints.ts if H-01 is in river.
```

## Repair

Fix on stream/meetings-place and publish a new READY commit; River folds the new READY and clears this return when it integrates.
