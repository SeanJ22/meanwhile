# Returned: state-votes

## state-votes — cleanup list (River's review at fold; delete in stream/state-votes, then mark READY again)

Lane state-votes (SV-01), folded at river ac3ccf885d6d. Added 18,758 lines, deleted 502 lines. Files: 89 added, 1 deleted, 1 renamed, 29 modified. Code and tests alone: +1,892 / −502 lines (9 files added, 1 deleted, 1 renamed, 29 modified). Fixtures: +16,866 lines (80 files added).

Delete:
1. lib/state-rollcalls/reader-vote-visibility.ts lines 4–13: the constant READER_VOTE_RENDERABLE_STATE_SCOPES and its nine-line comment. Nothing references it anywhere. Keep the PLURAL_STATES import on line 2, which line 24 still uses.
2. Remove the unused `export` keyword from four types that nothing outside their own file imports: lib/ask/person-votes.ts:42 (ReaderPersonVotesQuestion), lib/sources/legiscan/dataset.ts:59 (LegiscanPersonJoin), lib/sources/legiscan/vote-acquisition.ts:12 (LegiscanDatasetResult), lib/sources/plural/vote-acquisition.ts:8 (PluralBillResult).
3. Delete eight fixture files that no test, manifest or code reads: tests/fixtures/state-votes/openstates/session-json-catalog.html (6,453 lines) and tests/fixtures/state-votes/openstates/{az,ga,il,ne,nh,nj,wa}/README.source (each state's session.zip carries its own README, which lib/sources/plural/vote-bulk.ts reads).

Checked and clean: no commented-out code; no leftover AZ-only path (scripts/az-votes-refresh.mts is deleted and nothing refers to it); no comment over two lines or telling history in code outside the item above; every new code file is imported.

For Sean to rule, not ordered for deletion: lib/sources/legiscan/* and lib/sources/plural/* each carry their own acquire, merge, candidate and publish chain, and scripts/openstates-votes-refresh.mts and scripts/legiscan-votes-refresh.mts repeat the same publish skeleton (read prior projection, processRegisteredRoutineCandidate, refusal error). They are two independent sources by design. Say if they should share one publisher. Test-only exports kept: legiscanIdentityJoins (lib/sources/legiscan/dataset.ts:73) and PLURAL_SESSION_CATALOG (lib/sources/plural/vote-acquisition.ts:5).

The READY commit a5cf11add gives no line or file counts; it predates that requirement.


lane: state-votes
owner: state-votes
writer: the state-votes lane
check: cleanliness
ready: SV-01 a5cf11addca92f6d408713a86e454631371adcd2
river: edd7652c5bb585c8d6bdc5b01f31c77b556e6207
at: 2026-10-13T19:25:36Z
state: returned
fix_subject: fix:02dbeb4a
fix: River · stream/state-votes — cleanliness failed for state-votes: For Sean to rule, not ordered for deletion: lib/sources/legiscan/* and lib/sources/plural/* each carry their own acquire, merge, candidate and publish chain, and scripts/openstates-votes-refresh.mts and scripts/legiscan-votes-refresh.mts re

## Failure

```
## state-votes — cleanup list (River's review at fold; delete in stream/state-votes, then mark READY again)

Lane state-votes (SV-01), folded at river ac3ccf885d6d. Added 18,758 lines, deleted 502 lines. Files: 89 added, 1 deleted, 1 renamed, 29 modified. Code and tests alone: +1,892 / −502 lines (9 files added, 1 deleted, 1 renamed, 29 modified). Fixtures: +16,866 lines (80 files added).

Delete:
1. lib/state-rollcalls/reader-vote-visibility.ts lines 4–13: the constant READER_VOTE_RENDERABLE_STATE_SCOPES and its nine-line comment. Nothing references it anywhere. Keep the PLURAL_STATES import on line 2, which line 24 still uses.
2. Remove the unused `export` keyword from four types that nothing outside their own file imports: lib/ask/person-votes.ts:42 (ReaderPersonVotesQuestion), lib/sources/legiscan/dataset.ts:59 (LegiscanPersonJoin), lib/sources/legiscan/vote-acquisition.ts:12 (LegiscanDatasetResult), lib/sources/plural/vote-acquisition.ts:8 (PluralBillResult).
3. Delete eight fixture files that no test, manifest or code reads: tests/fixtures/state-votes/openstates/session-json-catalog.html (6,453 lines) and tests/fixtures/state-votes/openstates/{az,ga,il,ne,nh,nj,wa}/README.source (each state's session.zip carries its own README, which lib/sources/plural/vote-bulk.ts reads).

Checked and clean: no commented-out code; no leftover AZ-only path (scripts/az-votes-refresh.mts is deleted and nothing refers to it); no comment over two lines or telling history in code outside the item above; every new code file is imported.

For Sean to rule, not ordered for deletion: lib/sources/legiscan/* and lib/sources/plural/* each carry their own acquire, merge, candidate and publish chain, and scripts/openstates-votes-refresh.mts and scripts/legiscan-votes-refresh.mts repeat the same publish skeleton (read prior projection, processRegisteredRoutineCandidate, refusal error). They are two independent sources by design. Say if they should share one publisher. Test-only exports kept: legiscanIdentityJoins (lib/sources/legiscan/dataset.ts:73) and PLURAL_SESSION_CATALOG (lib/sources/plural/vote-acquisition.ts:5).

The READY commit a5cf11add gives no line or file counts; it predates that requirement.
```

## Repair

Fix on stream/state-votes and publish a new READY commit; River folds the new READY and clears this return when it integrates.
