# Returned: src-legiscan

lane: src-legiscan
owner: src-legiscan
writer: the src-legiscan lane
check: fold-conflict
ready: no step ids unknown
river: 6c204dcd865cc99f3e6bb2a4f0270f78b28a7f07
at: 2026-10-13T07:23:32Z
state: returned
fix_subject: fix:15987bc4
fix: River · stream/src-legiscan — fold-conflict failed for src-legiscan: src-legiscan READY 1f6f8edbb832 conflicts with river 985c00c33f7a (releases 25 and 26 plus src-congress and zip-entry) when merged alone. Conflicting files: components/map/popup/official-modal.tsx lib/civic-data/contracts.ts lib/control-pla

## Failure

```
src-legiscan READY 1f6f8edbb832 conflicts with river 985c00c33f7a (releases 25 and 26 plus src-congress and zip-entry) when merged alone. Conflicting files: components/map/popup/official-modal.tsx lib/civic-data/contracts.ts lib/control-plane/expansion/mission-parts.ts lib/doors/seed-feeds.ts tests/routine-civic-data-runner.test.ts   Merge river into stream/src-legiscan, resolve, and mark READY again.
```

## Repair

Fix on stream/src-legiscan and publish a new READY commit; River folds the new READY and clears this return when it integrates.
