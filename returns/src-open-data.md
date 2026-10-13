# Returned: src-open-data

lane: src-open-data
owner: src-open-data
writer: the src-open-data lane
check: fold-conflict
ready: no step ids 68971e45968698574ac8c2fd1367a5bfc36e0ee4
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T01:56:08Z
state: returned
fix_subject: fix:9ad50819
fix: River · stream/src-open-data — fold-conflict failed for src-open-data: src-open-data READY 68971e459686 conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/src-open-data, resolve, and mark READY again.

## Failure

```
src-open-data READY 68971e459686 conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/src-open-data, resolve, and mark READY again.
```

## Repair

Fix on stream/src-open-data and publish a new READY commit; River folds the new READY and clears this return when it integrates.
