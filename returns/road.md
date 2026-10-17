# Returned: road

lane: road
owner: road
writer: the road lane
check: fold: conflicts with EP-01
ready: no step ids unknown
river: 5d6a5797f01b55cfabd1636beb28432fe6bbd1e2
at: 2026-10-17T08:11:14Z
state: returned
fix_subject: fix:df46831b
fix: River · stream/road — fold: conflicts with EP-01 failed for road: fold: stream/road READY 25633e3d2 (R0) conflicts with river-next carrying EP-01 (edge-publish c1d9394f2).

## Failure

```
fold: stream/road READY 25633e3d2 (R0) conflicts with river-next carrying EP-01 (edge-publish c1d9394f2).
Conflicts: app/api/ask/grounded/route.ts, lib/api/reader-route.ts, lib/civic-data/reader-edge-publication.ts, lib/meetings/edge-serving.ts, lib/registry/runtime-edge.ts, tests/ask-reader-edge.test.ts, tests/ballot-national-parity-browser.test.ts, tests/ballot-reader-edge.test.ts, tests/federal-money-reader.test.ts, tests/helpers/promoted-fixtures.ts (and more).
EP-01 publishes every authority family to its own pointer and removes the national pass; R0 touches the same reader-edge files.
Next: after release 52 lands EP-01 on river, merge river into stream/road, resolve, run your focused checks, and send a new READY.
```

## Repair

Fix on stream/road and publish a new READY commit; River folds the new READY and clears this return when it integrates.
