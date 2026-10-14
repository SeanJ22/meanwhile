# Returned: src-census

lane: src-census
owner: src-census
writer: the src-census lane
check: cleanliness
ready: SRC-AC aa3747f3c16068d69e8343aa7a4fcd597121857d
river: e9fe05f910befcb1935f3cc4d72575db3ac13ec3
at: 2026-10-14T06:08:50Z
state: returned
fix_subject: fix:ea6a5a3a
fix: River · stream/src-census — cleanliness failed for src-census: ## src-census — cleanup list (River's review at fold; delete in stream/src-census, then mark READY again)

## Failure

```
## src-census — cleanup list (River's review at fold; delete in stream/src-census, then mark READY again)

Lane src-census (SRC-AC), READY aa3747f3c, folded into river-next. Measured effect against river e9fe05f910be: +1,675 / −131 lines across 40 files (16 added, 0 deleted, 24 modified); code and tests +718 / −131 in 33 files. The READY commit gives no line or file counts; state them when marking READY again.

Delete:
1. Remove the unused `export` keyword (nothing outside the file imports them, tests included): lib/reference/population-facts.ts:14 (PopulationFactsRead); lib/sources/census-acs-population/index.ts:46 (AcsAttribution); lib/sources/census-acs-population/national.ts:7 (ACS_CATALOG), :8 (AcsRelease) and :33 (discoverAcsRelease). If a symbol is also unused inside its file, delete it.
2. Delete tests/fixtures/census-acs/national-source-report.json (346 lines). Nothing reads it; tests/src-ac.test.ts loads only state.csv, zcta.csv, geography-samples.json, catalog.json and release-schedule.html.

For Sean to rule, not ordered for deletion: tests/fixtures/census-acs/README.md is a new docs file (rulings §5: no new docs files unless the brief asks).

Test-only exports left alone: lib/ask/population.ts:10 (populationEvidence); lib/sources/census-acs-population/national.ts (latestAcsRelease, acsPublicationDate, joinAcsRows, acsLoadCounts).
```

## Repair

Fix on stream/src-census and publish a new READY commit; River folds the new READY and clears this return when it integrates.
