# Returned: platform-municode

lane: platform-municode
owner: platform-municode
writer: the platform-municode lane
check: cleanliness
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T22:03:53Z
state: returned
fix_subject: fix:ec7fbb0d
fix: River · stream/platform-municode — cleanliness failed for platform-municode: Cleanliness findings on R3-MUNICODE (25e501e90, folded as e18f8699e). Fix in your next READY:

## Failure

```
Cleanliness findings on R3-MUNICODE (25e501e90, folded as e18f8699e). Fix in your next READY:
Exports nothing outside their own file imports (unexport; tests count only for the last three):
   lib/meetings/shared-fetch.ts:5 MeetingFetchPass
   lib/sources/municode/index.ts:10 MunicodeMeeting
   lib/sources/municode/index.ts:23 MUNICODE_MAX_PAGES
   lib/sources/municode/index.ts:90 municodeNextPage
Fixtures nothing references: tests/fixtures/municode/bremerton.meta.json, hideout.html, hideout.meta.json, manor.meta.json.
A new code file nothing imports: scripts/municode-scale.mts (wire it into package.json or delete it).
```

## Repair

Fix on stream/platform-municode and publish a new READY commit; River folds the new READY and clears this return when it integrates.
