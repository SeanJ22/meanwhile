# Returned: ballot-three-states

Cleanliness findings on BL-30 (3d2b6615f, folded as a2d950742). Fix in your next READY:
Exports nothing outside their own file imports (unexport, or delete if unused in the file too):
   lib/civic-data/ballot-publication.ts:26 BallotPublicationResults tests=0
   lib/civic-data/manual-projections.ts:173 ballotProvenanceUrls tests=0
   lib/civic-data/promoted-edge-publication.ts:87 statePromotedEdgePointers tests=1
   lib/control-plane/repository/pg-store.ts:979 migrateVotingDoorScopes tests=1
   lib/meetings/edge-serving.ts:517 PublishReaderEdgeOptions tests=0
   lib/meetings/edge-serving.ts:529 publishReaderAuthorityArtifacts tests=0
   lib/meetings/edge-store.ts:9 READER_AUTHORITY_MANIFEST_KEY tests=0
   lib/meetings/edge-store.ts:17 StoredAuthorityManifest tests=0
   lib/registry/runtime-edge.ts:48 StateAuthoritiesEdge tests=0
A new code file nothing imports: scripts/ballot-scale.mts (wire it into package.json or delete it).


lane: ballot-three-states
owner: ballot-three-states
writer: the ballot-three-states lane
check: gates
ready: BL-30 3d2b6615fe594fbb936a0485d29fadf9e9e59a52
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T22:03:02Z
state: returned
fix_subject: fix:df4ed401
fix: River · stream/ballot-three-states — gates failed for ballot-three-states: BL-30 (3d2b6615f) fails gates (5 tests in tests/apply-migrations-dry.test.ts). Cause: lib/db/migrations/BL-30_candidate_scopes.sql (River numbers it 0036_bl30_candidate_scopes.sql) is 6,755,935 bytes. scripts/apply-migrations.mts:162 and :1

## Failure

```
BL-30 (3d2b6615f) fails gates (5 tests in tests/apply-migrations-dry.test.ts). Cause: lib/db/migrations/BL-30_candidate_scopes.sql (River numbers it 0036_bl30_candidate_scopes.sql) is 6,755,935 bytes. scripts/apply-migrations.mts:162 and :168 read committed SQL with execFileSync('git', ['show', 'HEAD:<file>']) which has a 1 MiB default buffer, so it throws spawnSync git ENOBUFS and db:apply cannot read the migration, here or in production. Data rides as data, not as a migration: take the candidate rows out of the SQL and publish them through the data path (or, if the SQL must stay, raise maxBuffer in apply-migrations.mts and prove db:apply --dry and a production-size apply work). Then run tests/apply-migrations-dry.test.ts and pnpm db:gate, push a new READY. The cleanliness items in the section above are still open.
```

## Repair

Fix on stream/ballot-three-states and publish a new READY commit; River folds the new READY and clears this return when it integrates.
