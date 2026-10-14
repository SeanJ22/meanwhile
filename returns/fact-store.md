# Returned: fact-store

lane: fact-store
owner: fact-store
writer: the fact-store lane
check: fold-conflict
ready: no step ids unknown
river: 0e9d37e0829974dbf3c91800fe7e3cb12360f00e
at: 2026-10-14T20:56:14Z
state: returned
fix_subject: fix:616e13e3
fix: River · stream/fact-store — fold-conflict failed for fact-store: fact-store READY 39a046cb8 (R1) conflicts with river 0e9d37e08299 by itself (the lane's last river merge is 9b36ff25c; release 38 landed after it). Conflicts: docs/pilot-runner.md, docs/sources.md and docs/system-map.md (FM-07 deleted these

## Failure

```
fact-store READY 39a046cb8 (R1) conflicts with river 0e9d37e08299 by itself (the lane's last river merge is 9b36ff25c; release 38 landed after it). Conflicts: docs/pilot-runner.md, docs/sources.md and docs/system-map.md (FM-07 deleted these docs; this lane modifies them — drop or re-home those edits), plus lib/civic-data/worker-publication-tasks.ts and lib/control-plane/gateway/registry.ts (BL-10 changed the same code in release 38 — resolve against river's version). Merge river into stream/fact-store, resolve, and mark READY again.
```

## Repair

Fix on stream/fact-store and publish a new READY commit; River folds the new READY and clears this return when it integrates.
