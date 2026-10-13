# Returned: zip-entry

lane: zip-entry
owner: zip-entry
writer: the zip-entry lane
check: fold-conflict
ready: no step ids unknown
river: 3734a8f9bb3bb234dfe9ca3b241e6d83b339ce97
at: 2026-10-13T04:00:27Z
state: returned
fix_subject: fix:3fb2dbfa
fix: River · stream/zip-entry — fold-conflict failed for zip-entry: zip-entry READY c6c7b8f6fd41 (ZIP-01) conflicts with river 3734a8f9bb3b (release 25) when merged alone; it was cut from river 593be2416b30. Conflicting files: components/map/welcome-overlay.tsx lib/ballot/zip-divisions.ts lib/geo/zip-census

## Failure

```
zip-entry READY c6c7b8f6fd41 (ZIP-01) conflicts with river 3734a8f9bb3b (release 25) when merged alone; it was cut from river 593be2416b30. Conflicting files: components/map/welcome-overlay.tsx lib/ballot/zip-divisions.ts lib/geo/zip-census-districts.ts   Merge river into stream/zip-entry, resolve, and mark READY again.
```

## Repair

Fix on stream/zip-entry and publish a new READY commit; River folds the new READY and clears this return when it integrates.
