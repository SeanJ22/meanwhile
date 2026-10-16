# Returned: src-money

lane: src-money
owner: src-money
writer: the src-money lane
check: cleanliness
ready: SRC-MN 3b61add5f2e185fb6e3735106d393ee9ae6c35f5
river: e1a1071a9c2283315ac5ada017cfac9d4a42f3cc
at: 2026-10-16T05:57:12Z
state: returned
fix_subject: fix:fca0d334
fix: River · stream/src-money — cleanliness failed for src-money: Cleanliness, SRC-MN 3b61add5f. Exports with no importer outside their file (delete the export or the code):

## Failure

```
Cleanliness, SRC-MN 3b61add5f. Exports with no importer outside their file (delete the export or the code):
- lib/civic-data/store.ts:1189 federalMoneyContinuationPending (tests only)
- lib/federal-money/bulk.ts:18 FederalBulkMetadata, :40 federalBulkDirectory, :139 federalChunkWriter
- lib/federal-money/edge.ts:7 FederalMoneyPageRef, :8 FederalMoneyPlaceSegment, :48 FederalMoneySourceStatus, :70 FEDERAL_MONEY_INDEX_PAGE_SIZE (tests only)
- lib/federal-money/model.ts:101 FEDERAL_MONEY_PARTITION_ROWS, :102 FEDERAL_MONEY_PARTITION_BYTES (tests only)
- lib/federal-money/refresh.ts:15 FederalMoneyRefreshOptions
- lib/federal-money/vault.ts:7 FEDERAL_MONEY_CAPTURE_BYTES, :8 federalMoneyVault
- lib/federal-money/view.ts:28 FederalMoneyRow, :59 federalMoneyText
- scripts/lib/federal-money-benchmark-store.mts:12 BenchmarkStorageBytes
Unreferenced: tests/fixtures/federal-money/source-probe-2026-10-15.json (949 lines).
Not imported by anything: scripts/federal-money-scale.mts (reproduction script; keep only if a doc or package script runs it).
```

## Repair

Fix on stream/src-money and publish a new READY commit; River folds the new READY and clears this return when it integrates.
