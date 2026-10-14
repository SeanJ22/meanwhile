# Returned: fact-store

lane: fact-store
owner: fact-store
writer: the fact-store lane
check: fold-conflict
ready: no step ids unknown
river: 9b36ff25c9cd1d5d99ed9445575d95b1558ba5f7
at: 2026-10-14T20:07:16Z
state: returned
fix_subject: fix:9d3fe4eb
fix: River · stream/fact-store — fold-conflict failed for fact-store: fact-store READY e488f0d45 (R1) conflicts with river 0e9d37e08299 by itself in docs/pilot-runner.md and docs/sources.md: release 38 (FM-07) deleted those docs files, and this lane modifies them. Merge river into stream/fact-store, delete or

## Failure

```
fact-store READY e488f0d45 (R1) conflicts with river 0e9d37e08299 by itself in docs/pilot-runner.md and docs/sources.md: release 38 (FM-07) deleted those docs files, and this lane modifies them. Merge river into stream/fact-store, delete or re-home those edits (the docs no longer exist on river), and mark READY again. It also overlapped the release 38 batch in lib/civic-data/worker-publication-tasks.ts and lib/control-plane/gateway/registry.ts; those two come in with river, so recheck them after the merge.
```

## Repair

Fix on stream/fact-store and publish a new READY commit; River folds the new READY and clears this return when it integrates.
