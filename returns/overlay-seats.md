# Returned: overlay-seats

lane: overlay-seats
owner: overlay-seats
writer: the overlay-seats lane
check: fold-conflict
ready: no step ids unknown
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T03:38:09Z
state: returned
fix_subject: fix:8f74fe6f
fix: River · stream/overlay-seats — fold-conflict failed for overlay-seats: overlay-seats READY 478708dbd532 conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/coverage-notice.tsx components/map/map-entry.tsx components/officials/person-identity.tsx lib/census-geogra

## Failure

```
overlay-seats READY 478708dbd532 conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/coverage-notice.tsx components/map/map-entry.tsx components/officials/person-identity.tsx lib/census-geography/acquire.ts lib/census-geography/candidate.ts lib/control-plane/admin-view/promoted-slices.ts lib/geo/shapefile.ts lib/geo/zip-census-districts.ts lib/sources/plural/acquisition.ts package.json pnpm-lock.yaml scripts/census-geography-refresh.mts tests/ballot-source-isolation.test.ts tests/reference-data.test.ts   Merge river into stream/overlay-seats, resolve, and mark READY again.
```

## Repair

Fix on stream/overlay-seats and publish a new READY commit; River folds the new READY and clears this return when it integrates.
