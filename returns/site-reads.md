# Returned: site-reads

lane: site-reads
owner: site-reads
writer: the site-reads lane
check: fold-conflict
ready: no step ids f42bc19c66a0d40a51cb156cd9bc86a529b03870
river: 829e6d6e21caf7ccb99ee90c9e0c3e3ff1e98d53
at: 2026-10-18T19:43:48Z
state: returned
fix_subject: fix:89d2332c
fix: River · stream/site-reads — fold-conflict failed for site-reads: CONFLICT (content): Merge conflict in app/api/ask/grounded/route.ts

## Failure

```
CONFLICT (content): Merge conflict in lib/ballot/zip-divisions.ts
Auto-merging lib/civic-data/candidate-integrity.ts
Auto-merging lib/civic-data/place-payload-slices.ts
Auto-merging lib/civic-data/promoted-edge-publication.ts
CONFLICT (content): Merge conflict in lib/civic-data/promoted-edge-publication.ts
Auto-merging lib/civic-data/read-model.ts
CONFLICT (content): Merge conflict in lib/civic-data/read-model.ts
Auto-merging lib/civic-data/reader-edge-publication.ts
CONFLICT (content): Merge conflict in lib/civic-data/reader-edge-publication.ts
Auto-merging lib/civic-data/store.ts
CONFLICT (content): Merge conflict in lib/civic-data/store.ts
Auto-merging lib/db/migration-phases.ts
CONFLICT (content): Merge conflict in lib/db/migration-phases.ts
Auto-merging lib/db/reader-route.ts
Auto-merging lib/meetings/authority-records.ts
CONFLICT (content): Merge conflict in lib/meetings/authority-records.ts
Auto-merging lib/meetings/edge-artifacts.ts
CONFLICT (content): Merge conflict in lib/meetings/edge-artifacts.ts
Auto-merging lib/meetings/edge-serving.ts
CONFLICT (content): Merge conflict in lib/meetings/edge-serving.ts
CONFLICT (modify/delete): lib/meetings/prepared-snapshot.ts deleted in origin/river and modified in origin/stream/site-reads.  Version origin/stream/site-reads of lib/meetings/prepared-snapshot.ts left in tree.
Auto-merging lib/meetings/query.ts
CONFLICT (content): Merge conflict in lib/meetings/query.ts
Auto-merging lib/meetings/snapshot.ts
CONFLICT (content): Merge conflict in lib/meetings/snapshot.ts
Auto-merging lib/registration/edge.ts
CONFLICT (content): Merge conflict in lib/registration/edge.ts
Auto-merging lib/registry/comment-access.ts
CONFLICT (content): Merge conflict in lib/registry/comment-access.ts
Auto-merging lib/registry/runtime-read-model.ts
CONFLICT (content): Merge conflict in lib/registry/runtime-read-model.ts
Auto-merging lib/registry/server.ts
CONFLICT (content): Merge conflict in lib/registry/server.ts
Auto-merging lib/votes/snapshot.ts
CONFLICT (content): Merge conflict in lib/votes/snapshot.ts
CONFLICT (modify/delete): tests/cascade.test.ts deleted in origin/river and modified in origin/stream/site-reads.  Version origin/stream/site-reads of tests/cascade.test.ts left in tree.
Auto-merging tests/dotgov.test.ts
CONFLICT (content): Merge conflict in tests/dotgov.test.ts
Auto-merging tests/meeting-fresh-checks.test.ts
CONFLICT (content): Merge conflict in tests/meeting-fresh-checks.test.ts
Auto-merging tests/meeting-partition-data-plane.test.ts
CONFLICT (content): Merge conflict in tests/meeting-partition-data-plane.test.ts
Auto-merging tests/migration-shipping-invariant.test.ts
CONFLICT (modify/delete): tests/prepared-meeting-snapshot.test.ts deleted in origin/river and modified in origin/stream/site-reads.  Version origin/stream/site-reads of tests/prepared-meeting-snapshot.test.ts left in tree.
Auto-merging tests/promoted-edge.test.ts
CONFLICT (content): Merge conflict in tests/promoted-edge.test.ts
CONFLICT (modify/delete): tests/publish-now-edge.test.ts deleted in origin/river and modified in origin/stream/site-reads.  Version origin/stream/site-reads of tests/publish-now-edge.test.ts left in tree.
Auto-merging tests/reader-cold-path.test.ts
CONFLICT (content): Merge conflict in tests/reader-cold-path.test.ts
Auto-merging tests/reader-edge-context.test.ts
CONFLICT (content): Merge conflict in tests/reader-edge-context.test.ts
Auto-merging tests/reader-edge.test.ts
CONFLICT (content): Merge conflict in tests/reader-edge.test.ts
Auto-merging tests/registration-edge.test.ts
CONFLICT (content): Merge conflict in tests/registration-edge.test.ts
Auto-merging tests/registry-runtime-edge.test.ts
CONFLICT (content): Merge conflict in tests/registry-runtime-edge.test.ts
Auto-merging tests/site-reads.test.ts
CONFLICT (content): Merge conflict in tests/site-reads.test.ts
```

## Repair

Fix on stream/site-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
