# Returned: src-census

lane: src-census
owner: src-census
writer: the src-census lane
check: fold-conflict
ready: no step ids unknown
river: 985c00c33f7a6ab2035fefc563668bf51a22207f
at: 2026-10-13T09:44:15Z
state: returned
fix_subject: fix:0452c204
fix: River · stream/src-census — fold-conflict failed for src-census: src-census READY 2972b7a39cbe (SRC-AC) conflicts with river cc9589c05915 (releases 25 to 27) when merged alone. Conflicting file: lib/doors/seed-feeds.ts. Merge river into stream/src-census, resolve, and mark READY again.

## Failure

```
src-census READY 2972b7a39cbe (SRC-AC) conflicts with river cc9589c05915 (releases 25 to 27) when merged alone. Conflicting file: lib/doors/seed-feeds.ts. Merge river into stream/src-census, resolve, and mark READY again.
```

## Repair

Fix on stream/src-census and publish a new READY commit; River folds the new READY and clears this return when it integrates.
