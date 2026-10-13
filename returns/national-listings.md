# Returned: national-listings

lane: national-listings
owner: national-listings
writer: the national-listings lane
check: fold-conflict
ready: NL-01 49a98f2d6f1fad6b2d48a04839ccdd61ad816ea6
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T01:55:45Z
state: returned
fix_subject: fix:ecceb5ab
fix: River · stream/national-listings — fold-conflict failed for national-listings: national-listings READY 49a98f2d6f1f conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/national-listings, resolve, and mark READY ag

## Failure

```
national-listings READY 49a98f2d6f1f conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/national-listings, resolve, and mark READY again.
```

## Repair

Fix on stream/national-listings and publish a new READY commit; River folds the new READY and clears this return when it integrates.
