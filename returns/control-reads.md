# Returned: control-reads

lane: control-reads
owner: control-reads
writer: the control-reads lane
check: fold-conflict
ready: CP-01 aa787c762bbd9a11bad97a2754878f4b24ca65dd
river: ab0c352cf21752d23500fb7ea72ddf712675755e
at: 2026-10-18T20:56:34Z
state: returned
fix_subject: fix:98c8a3f1
fix: River · stream/control-reads — fold-conflict failed for control-reads: CP-01 replacement READY aa787c762bbd9a11bad97a2754878f4b24ca65dd was assessed freshly. Its CP-01 migration now calls expand DDL and records the schema version; the prior national row-copy migration was removed. This return is for the new fo

## Failure

```
Auto-merging lib/control-plane/workers/scoped-history.ts
CONFLICT (content): Merge conflict in lib/control-plane/workers/scoped-history.ts
Auto-merging lib/control-plane/workers/standing-runtime.ts
CONFLICT (content): Merge conflict in lib/control-plane/workers/standing-runtime.ts
Auto-merging scripts/ballot-scale.mts
Auto-merging scripts/pilot-runner.mts
CONFLICT (content): Merge conflict in scripts/pilot-runner.mts
Auto-merging scripts/platform-census-runner.mts
CONFLICT (content): Merge conflict in scripts/platform-census-runner.mts
Auto-merging scripts/publish-owner-snapshot.mts
CONFLICT (content): Merge conflict in scripts/publish-owner-snapshot.mts
Auto-merging scripts/routine-civic-data-runner.mts
CONFLICT (content): Merge conflict in scripts/routine-civic-data-runner.mts
Auto-merging tests/auto-crosswalk-expansion.test.ts
CONFLICT (content): Merge conflict in tests/auto-crosswalk-expansion.test.ts
Auto-merging tests/box.test.ts
CONFLICT (content): Merge conflict in tests/box.test.ts
Auto-merging tests/carried-row-reason.test.ts
CONFLICT (content): Merge conflict in tests/carried-row-reason.test.ts
Auto-merging tests/carried-row-supersession.test.ts
Auto-merging tests/carried-venue-placement.test.ts
CONFLICT (content): Merge conflict in tests/carried-venue-placement.test.ts
Auto-merging tests/census-lane.test.ts
Auto-merging tests/could-govern-pill.test.ts
CONFLICT (content): Merge conflict in tests/could-govern-pill.test.ts
Auto-merging tests/derived-meeting-family.test.ts
CONFLICT (content): Merge conflict in tests/derived-meeting-family.test.ts
Auto-merging tests/expansion-any-state.test.ts
CONFLICT (content): Merge conflict in tests/expansion-any-state.test.ts
Auto-merging tests/held-meeting-partition.test.ts
CONFLICT (content): Merge conflict in tests/held-meeting-partition.test.ts
Auto-merging tests/helpers/reader-fixtures.ts
CONFLICT (content): Merge conflict in tests/helpers/reader-fixtures.ts
Auto-merging tests/hunter-lane.test.ts
CONFLICT (content): Merge conflict in tests/hunter-lane.test.ts
Auto-merging tests/meeting-fresh-checks.test.ts
CONFLICT (content): Merge conflict in tests/meeting-fresh-checks.test.ts
Auto-merging tests/meeting-history.test.ts
CONFLICT (content): Merge conflict in tests/meeting-history.test.ts
Auto-merging tests/meeting-partition-data-plane.test.ts
CONFLICT (content): Merge conflict in tests/meeting-partition-data-plane.test.ts
Auto-merging tests/meetings-data-plane-cutover.test.ts
CONFLICT (content): Merge conflict in tests/meetings-data-plane-cutover.test.ts
Auto-merging tests/national-ballot-candidacy-bridge.test.ts
CONFLICT (modify/delete): tests/prepared-meeting-snapshot.test.ts deleted in origin/river and modified in aa787c762bbd9a11bad97a2754878f4b24ca65dd.  Version aa787c762bbd9a11bad97a2754878f4b24ca65dd of tests/prepared-meeting-snapshot.test.ts left in tree.
Auto-merging tests/reader-edge-supervisor.test.ts
CONFLICT (content): Merge conflict in tests/reader-edge-supervisor.test.ts
Auto-merging tests/reader-edge.test.ts
CONFLICT (content): Merge conflict in tests/reader-edge.test.ts
Auto-merging tests/reader-last-mile-ask-listing-identity.test.ts
CONFLICT (content): Merge conflict in tests/reader-last-mile-ask-listing-identity.test.ts
Auto-merging tests/registry-runtime-data-plane.test.ts
Auto-merging tests/routine-civic-data-runner.test.ts
CONFLICT (content): Merge conflict in tests/routine-civic-data-runner.test.ts
Auto-merging tests/scoped-task-reads.test.ts
CONFLICT (content): Merge conflict in tests/scoped-task-reads.test.ts
Auto-merging tests/state-votes-reader.test.ts
Auto-merging tests/worker-reader-publication.test.ts
Auto-merging tests/worker-roster-publication.test.ts
```

## Repair

Fix on stream/control-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
