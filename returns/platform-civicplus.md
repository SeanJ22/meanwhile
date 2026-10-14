# Returned: platform-civicplus

lane: platform-civicplus
owner: platform-civicplus
writer: the platform-civicplus lane
check: cleanliness
ready: R3-CIVICPLUS 6974f285fe1be881a1c4e82810cc1a6cab3a772e
river: 1caea1bd9c88fd51a5449140ea7dbf11db2b17cf
at: 2026-10-14T04:18:08Z
state: returned
fix_subject: fix:3bc5b8ca
fix: River · stream/platform-civicplus — cleanliness failed for platform-civicplus: ## platform-civicplus — cleanup list (River's review at fold; delete in stream/platform-civicplus, then mark READY again)

## Failure

```
## platform-civicplus — cleanup list (River's review at fold; delete in stream/platform-civicplus, then mark READY again)

Lane platform-civicplus (R3-CIVICPLUS), READY 6974f285f. Measured effect against river 1caea1bd9c88: +11,301 / −435 lines across 18 files (10 added, 0 deleted, 8 modified); code and tests +529 / −435 in 10 files. The READY commit's "relative to current River" counts match; its first line (against its first parent) does not describe this merge.

Delete:
1. Remove the unused `export` keyword (nothing outside the file imports them, tests included): lib/sources/civicplus/index.ts:29 (isCancelledSummary) and :33 (locationWithoutNotice).

Checked and clean otherwise: no commented-out code; every new code file and fixture is referenced.
```

## Repair

Fix on stream/platform-civicplus and publish a new READY commit; River folds the new READY and clears this return when it integrates.
