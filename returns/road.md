# Returned: road

## road — cleanup list (River's review at fold; delete in stream/road, then mark READY again)

Lane road (R0), READY 2115f4f5d, folded into river-next. Measured effect against river 5bb464f06e34: +1,555 / −478 lines across 76 files (7 added, 0 deleted, 69 modified). The READY commit's counts match.

Delete:
1. Remove the unused `export` keyword from five symbols that nothing outside their own file imports (tests included): lib/control-plane/admin-view/v6-workers-read.ts:77 (V6DatabaseReads); lib/control-plane/scheduler/provider-limits.ts:18 (publishedHourlyLimit), :22 (ProviderState), :35 (HostGateInput); lib/control-plane/scheduler/shadow-loop.ts:221 (PoolLimit). If a symbol is also unused inside its file, delete it.

Checked and clean otherwise: no commented-out code; the one-at-a-time source lock the READY says is gone has no remaining reference; every added file is imported or a test.


lane: road
owner: road
writer: the road lane
check: cleanliness
ready: R0 2115f4f5d5f5dabfef55ea83721970fde9d96837
river: 5bb464f06e345165d6302377d20418f29d392409
at: 2026-10-14T01:59:45Z
state: returned
fix_subject: fix:f5c567ee
fix: River · stream/road — cleanliness failed for road: ## road — cleanup list (River's review at fold; delete in stream/road, then mark READY again)

## Failure

```
## road — cleanup list (River's review at fold; delete in stream/road, then mark READY again)

Lane road (R0), READY 2115f4f5d, folded into river-next. Measured effect against river 5bb464f06e34: +1,555 / −478 lines across 76 files (7 added, 0 deleted, 69 modified). The READY commit's counts match.

Delete:
1. Remove the unused `export` keyword from five symbols that nothing outside their own file imports (tests included): lib/control-plane/admin-view/v6-workers-read.ts:77 (V6DatabaseReads); lib/control-plane/scheduler/provider-limits.ts:18 (publishedHourlyLimit), :22 (ProviderState), :35 (HostGateInput); lib/control-plane/scheduler/shadow-loop.ts:221 (PoolLimit). If a symbol is also unused inside its file, delete it.

Checked and clean otherwise: no commented-out code; the one-at-a-time source lock the READY says is gone has no remaining reference; every added file is imported or a test.
```

## Repair

Fix on stream/road and publish a new READY commit; River folds the new READY and clears this return when it integrates.
