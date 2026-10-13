# Returned: src-census

lane: src-census
owner: src-census
writer: the src-census lane
check: fold-conflict
ready: no step ids unknown
river: 1e72570acb7e4dff84ed9a95b3c2882ed4080931
at: 2026-10-13T14:55:02Z
state: returned
fix_subject: fix:aebf3963
fix: River · stream/src-census — fold-conflict failed for src-census: src-census READY 989a28db38b1 (SRC-AC) conflicts with river edd7652c5bb5 (now containing admin BR-07..BR-31 and src-open-data) when merged alone. Conflicting file: app/(admin)/_mw/admin-v6/capture-health.tsx. Merge river into stream/src-cen

## Failure

```
src-census READY 989a28db38b1 (SRC-AC) conflicts with river edd7652c5bb5 (now containing admin BR-07..BR-31 and src-open-data) when merged alone. Conflicting file: app/(admin)/_mw/admin-v6/capture-health.tsx. Merge river into stream/src-census, resolve, and mark READY again.
```

## Repair

Fix on stream/src-census and publish a new READY commit; River folds the new READY and clears this return when it integrates.
