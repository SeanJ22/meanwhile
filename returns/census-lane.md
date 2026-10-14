# Returned: census-lane

## census-lane — cleanup list (River's review at fold; delete in stream/census-lane, then mark READY again)

Lane census-lane (R2), READY 634e1f5fe, folded into river-next 5bb464f06e34. Measured effect against river 25ef70542f9b: +1,717 / −2,871 lines across 62 code and test files (7 added, 55 modified) and one fixture (+11 lines). The READY commit states +620 / −245 lines and 4 files added, so its counts do not match the diff; state the real counts when marking READY again.

Delete:
1. Remove the unused `export` keyword from nine symbols that nothing outside their own file imports (tests included): lib/control-plane/discovery/census-lane.ts:20 (CensusPage) and :177 (CensusStateReport); lib/control-plane/discovery/platform-census.ts:19 (PLATFORM_CENSUS_RECHECK_HOURS); lib/control-plane/field-manual.ts:108 (BOOKKEEPING_KINDS); lib/doors/page-check.ts:18 (bindPageGovernment); lib/doors/page-doors.ts:112 (SourceCaptureReader); lib/doors/source-capture.ts:12 (SourceObservation); lib/doors/source-content.ts:5 (SourceFamily) and :6 (SourceContent). If a symbol is also unused inside its file, delete it.

Checked and clean otherwise: no commented-out code, no unreferenced new file, no second path beside the one it replaced that I could find.


lane: census-lane
owner: census-lane
writer: the census-lane lane
check: cleanliness
ready: no step ids 634e1f5fedfc09c2e986556d2d17da7f5848673c
river: 25ef70542f9bf5cffd93368ce29dcb11576e46cf
at: 2026-10-14T00:24:43Z
state: returned
fix_subject: fix:dc483048
fix: River · stream/census-lane — cleanliness failed for census-lane: ## census-lane — cleanup list (River's review at fold; delete in stream/census-lane, then mark READY again)

## Failure

```
## census-lane — cleanup list (River's review at fold; delete in stream/census-lane, then mark READY again)

Lane census-lane (R2), READY 634e1f5fe, folded into river-next 5bb464f06e34. Measured effect against river 25ef70542f9b: +1,717 / −2,871 lines across 62 code and test files (7 added, 55 modified) and one fixture (+11 lines). The READY commit states +620 / −245 lines and 4 files added, so its counts do not match the diff; state the real counts when marking READY again.

Delete:
1. Remove the unused `export` keyword from nine symbols that nothing outside their own file imports (tests included): lib/control-plane/discovery/census-lane.ts:20 (CensusPage) and :177 (CensusStateReport); lib/control-plane/discovery/platform-census.ts:19 (PLATFORM_CENSUS_RECHECK_HOURS); lib/control-plane/field-manual.ts:108 (BOOKKEEPING_KINDS); lib/doors/page-check.ts:18 (bindPageGovernment); lib/doors/page-doors.ts:112 (SourceCaptureReader); lib/doors/source-capture.ts:12 (SourceObservation); lib/doors/source-content.ts:5 (SourceFamily) and :6 (SourceContent). If a symbol is also unused inside its file, delete it.

Checked and clean otherwise: no commented-out code, no unreferenced new file, no second path beside the one it replaced that I could find.
```

## Repair

Fix on stream/census-lane and publish a new READY commit; River folds the new READY and clears this return when it integrates.
