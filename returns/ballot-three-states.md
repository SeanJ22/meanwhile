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
check: cleanliness
ready: BL-30 3d2b6615fe594fbb936a0485d29fadf9e9e59a52
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T21:30:40Z
state: returned
fix_subject: fix:971f9199
fix: River · stream/ballot-three-states — cleanliness failed for ballot-three-states: Cleanliness findings on BL-30 (3d2b6615f, folded as a2d950742). Fix in your next READY:

## Failure

```
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
```

## Repair

Fix on stream/ballot-three-states and publish a new READY commit; River folds the new READY and clears this return when it integrates.
