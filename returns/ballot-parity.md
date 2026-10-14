# Returned: ballot-parity

## ballot-parity — cleanup list (River's review at fold; delete in stream/ballot-parity, then mark READY again)

Lane ballot-parity (BL-20), READY 1e530950a, folded into river-next. Measured effect against river 0a0daac9af64: +1,680 / −971 lines across 65 files (6 added, 0 deleted, 59 modified). The READY commit's counts match.

Delete:
1. Remove the unused `export` keyword (nothing imports it, tests included): lib/ballot/candidate-portraits.ts:51 (wikidataCandidatePortraitQuery). If it is also unused inside the file, delete it.

Test-only export left alone: lib/civic-data/official-candidacy-publication.ts:15 (statePeopleCandidacyHolders).


lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: cleanliness
ready: BL-20 1e530950acc278f81dd51352ff1b1f37cf1a7fe8
river: 0a0daac9af64ce2d9546863cd13ffedaf16f745b
at: 2026-10-14T07:11:59Z
state: returned
fix_subject: fix:21f6d9f0
fix: River · stream/ballot-parity — cleanliness failed for ballot-parity: ## ballot-parity — cleanup list (River's review at fold; delete in stream/ballot-parity, then mark READY again)

## Failure

```
## ballot-parity — cleanup list (River's review at fold; delete in stream/ballot-parity, then mark READY again)

Lane ballot-parity (BL-20), READY 1e530950a, folded into river-next. Measured effect against river 0a0daac9af64: +1,680 / −971 lines across 65 files (6 added, 0 deleted, 59 modified). The READY commit's counts match.

Delete:
1. Remove the unused `export` keyword (nothing imports it, tests included): lib/ballot/candidate-portraits.ts:51 (wikidataCandidatePortraitQuery). If it is also unused inside the file, delete it.

Test-only export left alone: lib/civic-data/official-candidacy-publication.ts:15 (statePeopleCandidacyHolders).
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
