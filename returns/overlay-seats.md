# Returned: overlay-seats

lane: overlay-seats
owner: overlay-seats
writer: the overlay-seats lane
check: fold-conflict
ready: no step ids 61f6d1449a41e8033eb51a02a6cfe9be380fd36e
river: 829e6d6e21caf7ccb99ee90c9e0c3e3ff1e98d53
at: 2026-10-18T19:43:45Z
state: returned
fix_subject: fix:004a6639
fix: River · stream/overlay-seats — fold-conflict failed for overlay-seats: CONFLICT (content): Merge conflict in app/api/address/resolve/route.ts

## Failure

```
Auto-merging lib/meetings/edge-store.ts
CONFLICT (content): Merge conflict in lib/meetings/edge-store.ts
Auto-merging lib/registry/runtime-edge.ts
CONFLICT (content): Merge conflict in lib/registry/runtime-edge.ts
Auto-merging lib/registry/server.ts
CONFLICT (content): Merge conflict in lib/registry/server.ts
CONFLICT (modify/delete): lib/sources/ballot-curated/index.ts deleted in origin/river and modified in origin/stream/overlay-seats.  Version origin/stream/overlay-seats of lib/sources/ballot-curated/index.ts left in tree.
CONFLICT (modify/delete): lib/sources/ballot-nj-morris/index.ts deleted in origin/river and modified in origin/stream/overlay-seats.  Version origin/stream/overlay-seats of lib/sources/ballot-nj-morris/index.ts left in tree.
Auto-merging lib/sources/census-acs-population/held-joins.ts
CONFLICT (content): Merge conflict in lib/sources/census-acs-population/held-joins.ts
Auto-merging package.json
Auto-merging scripts/fetch-voting-sites.mts
CONFLICT (modify/delete): scripts/lib/census-edge-publication.ts deleted in origin/river and modified in origin/stream/overlay-seats.  Version origin/stream/overlay-seats of scripts/lib/census-edge-publication.ts left in tree.
Auto-merging scripts/routine-civic-data-runner.mts
CONFLICT (content): Merge conflict in scripts/routine-civic-data-runner.mts
Auto-merging tests/admin-promoted-slices.test.ts
Auto-merging tests/admin-v6-national.test.ts
Auto-merging tests/ask-reader-edge.test.ts
CONFLICT (content): Merge conflict in tests/ask-reader-edge.test.ts
Auto-merging tests/ballot-national-parity-browser.test.ts
CONFLICT (content): Merge conflict in tests/ballot-national-parity-browser.test.ts
Auto-merging tests/ballot-reader-edge.test.ts
CONFLICT (content): Merge conflict in tests/ballot-reader-edge.test.ts
Auto-merging tests/ballot-source-isolation.test.ts
CONFLICT (content): Merge conflict in tests/ballot-source-isolation.test.ts
Auto-merging tests/census-district-edge.test.ts
CONFLICT (content): Merge conflict in tests/census-district-edge.test.ts
CONFLICT (modify/delete): tests/census-edge-publication.test.ts deleted in origin/river and modified in origin/stream/overlay-seats.  Version origin/stream/overlay-seats of tests/census-edge-publication.test.ts left in tree.
Auto-merging tests/civic-data-firewall.test.ts
CONFLICT (content): Merge conflict in tests/civic-data-firewall.test.ts
Auto-merging tests/could-govern-pill.test.ts
CONFLICT (content): Merge conflict in tests/could-govern-pill.test.ts
Auto-merging tests/dispatch-work.test.ts
CONFLICT (content): Merge conflict in tests/dispatch-work.test.ts
Auto-merging tests/held-place-capture.test.ts
Auto-merging tests/helpers/ballot-district-fixtures.ts
CONFLICT (content): Merge conflict in tests/helpers/ballot-district-fixtures.ts
Auto-merging tests/meeting-fresh-checks.test.ts
CONFLICT (content): Merge conflict in tests/meeting-fresh-checks.test.ts
Auto-merging tests/plural.test.ts
CONFLICT (content): Merge conflict in tests/plural.test.ts
Auto-merging tests/promoted-edge.test.ts
CONFLICT (content): Merge conflict in tests/promoted-edge.test.ts
CONFLICT (modify/delete): tests/publish-now-edge.test.ts deleted in origin/river and modified in origin/stream/overlay-seats.  Version origin/stream/overlay-seats of tests/publish-now-edge.test.ts left in tree.
Auto-merging tests/reader-cold-path.test.ts
Auto-merging tests/reader-edge-context.test.ts
CONFLICT (content): Merge conflict in tests/reader-edge-context.test.ts
Auto-merging tests/reader-edge-supervisor.test.ts
Auto-merging tests/reader-edge.test.ts
CONFLICT (content): Merge conflict in tests/reader-edge.test.ts
Auto-merging tests/registration-edge.test.ts
CONFLICT (content): Merge conflict in tests/registration-edge.test.ts
Auto-merging tests/registry-runtime-edge.test.ts
CONFLICT (content): Merge conflict in tests/registry-runtime-edge.test.ts
Auto-merging tests/routine-civic-data-runner.test.ts
CONFLICT (content): Merge conflict in tests/routine-civic-data-runner.test.ts
Auto-merging tests/site-reads.test.ts
Auto-merging tests/zip-census-districts.test.ts
CONFLICT (content): Merge conflict in tests/zip-census-districts.test.ts
```

## Repair

Fix on stream/overlay-seats and publish a new READY commit; River folds the new READY and clears this return when it integrates.
