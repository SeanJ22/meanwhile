# Returned: road

lane: road
owner: road
writer: the road lane
check: test
ready: R0 5fe88f8a6373934e4bdf847c6f15de26c357d9b8
river: 0e9d37e0829974dbf3c91800fe7e3cb12360f00e
at: 2026-10-14T20:44:33Z
state: returned
fix_subject: fix:b35710d1
fix: River · stream/road — test failed for road: road READY 5fe88f8a6 (R0) fails pnpm gates on river 0e9d37e08299 (BL-10 is now on river). tests/ballot-publication.test.ts, 'the runner's ballot child assembles outside the checkout, publishes under its exact manual authority, and reports s

## Failure

```
road READY 5fe88f8a6 (R0) fails pnpm gates on river 0e9d37e08299 (BL-10 is now on river). tests/ballot-publication.test.ts, 'the runner's ballot child assembles outside the checkout, publishes under its exact manual authority, and reports skipped states', evals the slice of scripts/routine-civic-data-runner.mts from 'function sourceChildCommand(' to 'function recordSourceSettlementFailures' with only admittedRuntimeChildEnvironment, automaticRefreshContract and process in scope. This lane's sourceChildCommand now uses routineSerialLane, which that slice does not provide: 'ReferenceError: routineSerialLane is not defined' at sourceChildCommand. Merge river into stream/road and make the two agree: either keep sourceChildCommand self-contained or pass routineSerialLane into the test's Function scope (the test is BL-10's; change it only as far as the lane needs). Run tests/ballot-publication.test.ts, then mark READY again. Every other gate passed (lint, tsc, db:gate, build, bundle, standalone).
```

## Repair

Fix on stream/road and publish a new READY commit; River folds the new READY and clears this return when it integrates.
