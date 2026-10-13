# Returned: src-congress

lane: src-congress
owner: src-congress
writer: the src-congress lane
check: fold-conflict
ready: no step ids unknown
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T03:38:16Z
state: returned
fix_subject: fix:e2653bb5
fix: River · stream/src-congress — fold-conflict failed for src-congress: src-congress READY b88f95c79c06 conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/ballot/candidate-battlecard.tsx   Merge river into stream/src-congress, resolve, and mark READY again.

## Failure

```
src-congress READY b88f95c79c06 conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/ballot/candidate-battlecard.tsx   Merge river into stream/src-congress, resolve, and mark READY again.
```

## Repair

Fix on stream/src-congress and publish a new READY commit; River folds the new READY and clears this return when it integrates.
