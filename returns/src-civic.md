# Returned: src-civic

lane: src-civic
owner: src-civic
writer: the src-civic lane
check: fold-conflict
ready: no step ids unknown
river: 6c204dcd865cc99f3e6bb2a4f0270f78b28a7f07
at: 2026-10-13T07:23:28Z
state: returned
fix_subject: fix:f350ff71
fix: River · stream/src-civic — fold-conflict failed for src-civic: src-civic READY d212fb6ac7df conflicts with river 985c00c33f7a (releases 25 and 26 plus src-congress and zip-entry) when merged alone. Conflicting files: lib/civic-data/contracts.ts lib/civic-data/source-authority.ts lib/doors/seed-feeds.ts

## Failure

```
src-civic READY d212fb6ac7df conflicts with river 985c00c33f7a (releases 25 and 26 plus src-congress and zip-entry) when merged alone. Conflicting files: lib/civic-data/contracts.ts lib/civic-data/source-authority.ts lib/doors/seed-feeds.ts tests/routine-civic-data-runner.test.ts   Merge river into stream/src-civic, resolve, and mark READY again.
```

## Repair

Fix on stream/src-civic and publish a new READY commit; River folds the new READY and clears this return when it integrates.
