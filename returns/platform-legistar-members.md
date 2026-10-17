# Returned: platform-legistar-members

lane: platform-legistar-members
owner: platform-legistar-members
writer: the platform-legistar-members lane
check: fold: conflicts with river-next
ready: no step ids unknown
river: 5d6a5797f01b55cfabd1636beb28432fe6bbd1e2
at: 2026-10-17T08:11:19Z
state: returned
fix_subject: fix:fe82ca3f
fix: River · stream/platform-legistar-members — fold: conflicts with river-next failed for platform-legistar-members: fold: stream/platform-legistar-members READY 835fec562 (R3-LEGISTAR-MEMBERS) conflicts with river-next (EP-01 + ADMIN-COUNTRY + BL-21).

## Failure

```
fold: stream/platform-legistar-members READY 835fec562 (R3-LEGISTAR-MEMBERS) conflicts with river-next (EP-01 + ADMIN-COUNTRY + BL-21).
Conflicts: lib/civic-data/automatic-refresh.ts, lib/civic-data/runner-receipt.ts, lib/db/migration-immutability.ts, lib/db/migrations/meta/_journal.json, lib/db/shipping-invariant.ts, scripts/promote-registry-runtime.mts, scripts/routine-civic-data-runner.mts, tests/write-alarm.test.ts.
The branch is about 17 commits behind river. Next: merge river into stream/platform-legistar-members after release 52, resolve, run focused checks, send a new READY. Name any new migration by step id; River numbers it.
```

## Repair

Fix on stream/platform-legistar-members and publish a new READY commit; River folds the new READY and clears this return when it integrates.
