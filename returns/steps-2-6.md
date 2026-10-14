# Returned: steps-2-6

lane: steps-2-6
owner: steps-2-6
writer: the steps-2-6 lane
check: fold-conflict
ready: no step ids unknown
river: 5bb464f06e345165d6302377d20418f29d392409
at: 2026-10-14T02:00:03Z
state: returned
fix_subject: fix:43c53388
fix: River · stream/steps-2-6 — fold-conflict failed for steps-2-6: steps-2-6 READY 25c7e046c conflicts with river 5bb464f06e34 by itself in app/api/address/resolve/route.ts, components/address/address-prompt.tsx, lib/civic-data/promotion.ts, lib/civic-data/validate.ts, lib/civic-data/worker-ballot-contests

## Failure

```
steps-2-6 READY 25c7e046c conflicts with river 5bb464f06e34 by itself in app/api/address/resolve/route.ts, components/address/address-prompt.tsx, lib/civic-data/promotion.ts, lib/civic-data/validate.ts, lib/civic-data/worker-ballot-contests.ts, lib/geo/census-geocoder.ts, lib/geo/session-address.ts, lib/outcomes/minutes-ingest.ts, lib/sources/archive-download.ts, lib/sources/known-release.ts, lib/sources/plural/acquisition.ts and others; merge river into stream/steps-2-6, resolve, and mark READY again.
```

## Repair

Fix on stream/steps-2-6 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
