# Returned: src-open-data

lane: src-open-data
owner: src-open-data
writer: the src-open-data lane
check: fold-conflict
ready: no step ids unknown
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T03:38:24Z
state: returned
fix_subject: fix:6fd98211
fix: River · stream/src-open-data — fold-conflict failed for src-open-data: src-open-data READY 68971e459686 conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/popup/entity-modal.tsx   Merge river into stream/src-open-data, resolve, and mark READY again.

## Failure

```
src-open-data READY 68971e459686 conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/popup/entity-modal.tsx   Merge river into stream/src-open-data, resolve, and mark READY again.
```

## Repair

Fix on stream/src-open-data and publish a new READY commit; River folds the new READY and clears this return when it integrates.
