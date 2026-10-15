# Returned: ballot-three-states

lane: ballot-three-states
owner: ballot-three-states
writer: the ballot-three-states lane
check: fold-conflict
ready: no step ids unknown
river: d9107da58a23f9d38b60d300552af7e9d2509561
at: 2026-10-15T05:24:22Z
state: returned
fix_subject: fix:ab5f067e
fix: River · stream/ballot-three-states — fold-conflict failed for ballot-three-states: BL-30 (fec78c0ec) conflicts with river b35cc62d9 (BL-10, PB-01-FIX2 folded) in: lib/ballot/types.ts, lib/civic-data/changes.ts, lib/civic-data/manual-projections.ts, lib/civic-data/worker-ballot-contests.ts, scripts/assemble-ballot-package.

## Failure

```
BL-30 (fec78c0ec) conflicts with river b35cc62d9 (BL-10, PB-01-FIX2 folded) in: lib/ballot/types.ts, lib/civic-data/changes.ts, lib/civic-data/manual-projections.ts, lib/civic-data/worker-ballot-contests.ts, scripts/assemble-ballot-package.mts, tests/assemble-ballot-package.test.ts, tests/ballot-reader-edge.test.ts, and a modify/delete on lib/sources/ballot-nj-morris/index.ts (river changed a file you deleted). lib/db/migration-immutability.ts and tests/migration-immutability.test.ts: take river's version. Merge origin/river into stream/ballot-three-states, settle these against BL-10's changes, run the focused tests, push a new READY.
```

## Repair

Fix on stream/ballot-three-states and publish a new READY commit; River folds the new READY and clears this return when it integrates.
