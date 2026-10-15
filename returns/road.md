# Returned: road

Cleanliness findings on R0 (374e58d57, folded as 3b2ec1266). Fix in your next READY:
Exports nothing outside their own file imports (tests count only; unexport):
   lib/civic-data/raw-capture-vault.ts:23 readRawCapture
   lib/control-plane/workers/worker-slots.ts:102 measuredReservationBytes
   lib/sources/congress/publication.ts:39 holdFederalCapture
   lib/sources/plural/votes.ts:51 PluralVoteAcquisition
   scripts/convert-embedded-captures.mts:34 convertEmbeddedCaptures
Doc comments over two lines (cut to two lines max):
   lib/ops/bounded-beat.ts (4 lines)
   lib/ops/fatal-line.ts (4 lines)


lane: road
owner: road
writer: the road lane
check: cleanliness
ready: R0 374e58d57792f9181f0c5397581525311512cd7d
river: d9107da58a23f9d38b60d300552af7e9d2509561
at: 2026-10-15T04:44:19Z
state: returned
fix_subject: fix:29a6e4be
fix: River · stream/road — cleanliness failed for road: Cleanliness findings on R0 (374e58d57, folded as 3b2ec1266). Fix in your next READY:

## Failure

```
Cleanliness findings on R0 (374e58d57, folded as 3b2ec1266). Fix in your next READY:
Exports nothing outside their own file imports (tests count only; unexport):
   lib/civic-data/raw-capture-vault.ts:23 readRawCapture
   lib/control-plane/workers/worker-slots.ts:102 measuredReservationBytes
   lib/sources/congress/publication.ts:39 holdFederalCapture
   lib/sources/plural/votes.ts:51 PluralVoteAcquisition
   scripts/convert-embedded-captures.mts:34 convertEmbeddedCaptures
Doc comments over two lines (cut to two lines max):
   lib/ops/bounded-beat.ts (4 lines)
   lib/ops/fatal-line.ts (4 lines)
```

## Repair

Fix on stream/road and publish a new READY commit; River folds the new READY and clears this return when it integrates.
