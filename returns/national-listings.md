# Returned: national-listings

lane: national-listings
owner: national-listings
writer: the national-listings lane
check: fold-conflict
ready: no step ids unknown
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T03:38:01Z
state: returned
fix_subject: fix:05dc767e
fix: River · stream/national-listings — fold-conflict failed for national-listings: national-listings READY 49a98f2d6f1f conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/government-listings.tsx   Merge river into stream/national-listings, resolve, and mark READY again.

## Failure

```
national-listings READY 49a98f2d6f1f conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/government-listings.tsx   Merge river into stream/national-listings, resolve, and mark READY again.
```

## Repair

Fix on stream/national-listings and publish a new READY commit; River folds the new READY and clears this return when it integrates.
