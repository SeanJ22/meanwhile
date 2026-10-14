# Returned: ballot-national

## ballot-national — cleanup list (River's review at fold; delete in stream/ballot-national, then mark READY again)

Lane ballot-national (BL-10), READY 78cbc5a56, folded into river-next. Measured effect against river 0a0daac9af64: +343 / −5 lines across 7 files (3 added, 0 deleted, 4 modified). The READY commit's counts match.

Delete:
1. Remove the unused `export` keyword (nothing imports it, tests included): lib/ballot/voting-source-types.ts:5 (VotingDoorCoverage).

Test-only exports left alone: scripts/assemble-ballot-package.mts:16 (BallotStateFile) and :65 (assembleBallotPackage).


lane: ballot-national
owner: ballot-national
writer: the ballot-national lane
check: cleanliness
ready: BL-10 78cbc5a5631805bfb357a8d36e3d64271930b978
river: 0a0daac9af64ce2d9546863cd13ffedaf16f745b
at: 2026-10-14T07:11:51Z
state: returned
fix_subject: fix:cfb93114
fix: River · stream/ballot-national — cleanliness failed for ballot-national: ## ballot-national — cleanup list (River's review at fold; delete in stream/ballot-national, then mark READY again)

## Failure

```
## ballot-national — cleanup list (River's review at fold; delete in stream/ballot-national, then mark READY again)

Lane ballot-national (BL-10), READY 78cbc5a56, folded into river-next. Measured effect against river 0a0daac9af64: +343 / −5 lines across 7 files (3 added, 0 deleted, 4 modified). The READY commit's counts match.

Delete:
1. Remove the unused `export` keyword (nothing imports it, tests included): lib/ballot/voting-source-types.ts:5 (VotingDoorCoverage).

Test-only exports left alone: scripts/assemble-ballot-package.mts:16 (BallotStateFile) and :65 (assembleBallotPackage).
```

## Repair

Fix on stream/ballot-national and publish a new READY commit; River folds the new READY and clears this return when it integrates.
