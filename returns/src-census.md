# Returned: src-census

lane: src-census
owner: src-census
writer: the src-census lane
check: fold-conflict
ready: no step ids unknown
river: 691c01dd0ff44041930828ead156c968fc269f8a
at: 2026-10-13T22:49:43Z
state: returned
fix_subject: fix:35436b2e
fix: River · stream/src-census — fold-conflict failed for src-census: src-census READY 943ef42c5869 (SRC-AC) conflicts with river 25ef70542f9b (releases 25 to 29 plus src-legiscan) when merged alone. Conflicting file: lib/doors/seed-feeds.ts. Merge river into stream/src-census, resolve, and mark READY again.

## Failure

```
src-census READY 943ef42c5869 (SRC-AC) conflicts with river 25ef70542f9b (releases 25 to 29 plus src-legiscan) when merged alone. Conflicting file: lib/doors/seed-feeds.ts. Merge river into stream/src-census, resolve, and mark READY again.
```

## Repair

Fix on stream/src-census and publish a new READY commit; River folds the new READY and clears this return when it integrates.
