# Returned: platform-granicus

## platform-granicus — cleanup list (River's review at fold; delete in stream/platform-granicus, then mark READY again)

Lane platform-granicus (R3-GRANICUS), READY df57db75a, folded into river-next. Measured effect against river 8db8c14b0739: +6,495 / −170 lines across 34 files (15 added, 0 deleted, 19 modified); code and tests +455 / −170 in 21 files. The READY commit gives no line or file counts; state them when marking READY again.

Delete:
1. Remove the unused `export` keyword (nothing outside the file imports them, tests included): lib/sources/granicus/index.ts:11 (GranicusRow) and :23 (GranicusRaw).

Test-only exports left alone: lib/sources/granicus/index.ts (granicusFeedUrls, granicusArchiveSearchUrl, parseGranicusFeed, granicusRows).

Checked and clean otherwise: the granicus fixtures are loaded by name in tests/granicus-source.test.ts; no commented-out code.


lane: platform-granicus
owner: platform-granicus
writer: the platform-granicus lane
check: cleanliness
ready: R3-GRANICUS df57db75a01bf27b9e9d41c7911b9b585417aec2
river: 8db8c14b07390a7846d873118915d93ef10cc41d
at: 2026-10-14T17:58:56Z
state: returned
fix_subject: fix:df3feeec
fix: River · stream/platform-granicus — cleanliness failed for platform-granicus: ## platform-granicus — cleanup list (River's review at fold; delete in stream/platform-granicus, then mark READY again)

## Failure

```
## platform-granicus — cleanup list (River's review at fold; delete in stream/platform-granicus, then mark READY again)

Lane platform-granicus (R3-GRANICUS), READY df57db75a, folded into river-next. Measured effect against river 8db8c14b0739: +6,495 / −170 lines across 34 files (15 added, 0 deleted, 19 modified); code and tests +455 / −170 in 21 files. The READY commit gives no line or file counts; state them when marking READY again.

Delete:
1. Remove the unused `export` keyword (nothing outside the file imports them, tests included): lib/sources/granicus/index.ts:11 (GranicusRow) and :23 (GranicusRaw).

Test-only exports left alone: lib/sources/granicus/index.ts (granicusFeedUrls, granicusArchiveSearchUrl, parseGranicusFeed, granicusRows).

Checked and clean otherwise: the granicus fixtures are loaded by name in tests/granicus-source.test.ts; no commented-out code.
```

## Repair

Fix on stream/platform-granicus and publish a new READY commit; River folds the new READY and clears this return when it integrates.
