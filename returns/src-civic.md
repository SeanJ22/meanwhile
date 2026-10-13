# Returned: src-civic

lane: src-civic
owner: src-civic
writer: the src-civic lane
check: fold-conflict
ready: no step ids unknown
river: 3734a8f9bb3bb234dfe9ca3b241e6d83b339ce97
at: 2026-10-13T04:19:54Z
state: returned
fix_subject: fix:fc5f4de5
fix: River · stream/src-civic — fold-conflict failed for src-civic: src-civic READY c073ab91203b (VS-01) conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/voting-sites-panel.tsx tests/ballot-source-isolation.test.ts tests/reference-data.test.ts   Merge river

## Failure

```
src-civic READY c073ab91203b (VS-01) conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/voting-sites-panel.tsx tests/ballot-source-isolation.test.ts tests/reference-data.test.ts   Merge river into stream/src-civic, resolve, and mark READY again.
```

## Repair

Fix on stream/src-civic and publish a new READY commit; River folds the new READY and clears this return when it integrates.
