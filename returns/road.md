# Returned: road

lane: road
owner: road
writer: the road lane
check: fold-conflict
ready: no step ids unknown
river: ac3ccf885d6de2934f43f931a3092f735f05f0e1
at: 2026-10-13T22:18:44Z
state: returned
fix_subject: fix:0d30d393
fix: River · stream/road — fold-conflict failed for road: road READY da9a3e39df32 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: app/(admin)/_mw/admin-v6/screen-money.tsx app/(admin)/_mw/admin-v6/screen-workers.tsx lib/ask/cost.ts lib/control-plane/repo

## Failure

```
road READY da9a3e39df32 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: app/(admin)/_mw/admin-v6/screen-money.tsx app/(admin)/_mw/admin-v6/screen-workers.tsx lib/ask/cost.ts lib/control-plane/repository/coordinator.ts lib/control-plane/scheduler/scout-executor.ts lib/frontend/look-spend.ts scripts/freshness-shadow.mts   Merge river into stream/road, resolve, and mark READY again.
```

## Repair

Fix on stream/road and publish a new READY commit; River folds the new READY and clears this return when it integrates.
