# Returned: cx-election-results

lane: cx-election-results
owner: cx-election-results
writer: the cx-election-results lane
check: duplicates, unrelated churn and padded tests (Sean's 2026-11-08 code-size ruling)
ready: no step ids unknown
river: ddfe674f2f5723f889e3bee8db94e334cbb5df0b
at: 2026-11-08T15:30:01Z
state: returned
fix_subject: fix:27d55560
fix: River · stream/cx-election-results — duplicates, unrelated churn and padded tests (Sean's 2026-11-08 code-size ruling) failed for cx-election-results: 2. Non-election test refactor, about 1,000 lines. This covers tests/helpers/routine-candidate-fixture.ts, which has 8 importers and none are election tests, and the rewrite of tests/routine-civic-data-observability.test.ts (54 tests before

## Failure

```
READY f189064bd is not folded. Size is no longer the reason. Sean ruled on 2026-11-08 that a genuinely new feature like election results may grow the code by what is genuinely new. This branch has about 3,600 new product lines and about 2,330 new election test lines, and those are welcome. The per-visit BALLOT_RESULT_VERSION_SQL query is gone, as asked.

The branch is returned for the parts that duplicate code, keep a replaced path, pad tests, or are unrelated. Fix each item below, merge origin/river, and push a new READY.

Unrelated churn. Revert each of these to origin/river.
1. Fixture relocation, about 4,480 lines. The branch moves tests/fixtures/rosters-nj-morris.ts, held-body-rosters.ts and comment-access.ts to JSON, and moves the inline fixture in tests/trusted-lkg-import.test.ts to tests/fixtures/retained-lkg-promotion.json. None of this is election work.
2. Non-election test refactor, about 1,000 lines. This covers tests/helpers/routine-candidate-fixture.ts, which has 8 importers and none are election tests, and the rewrite of tests/routine-civic-data-observability.test.ts (54 tests before and 54 after). It also covers the matching edits to civic-data-read-model*.test.ts, civic-data-store-integrity, routine-clock-narrow-read, meeting-refresh-schedule-clock, source-acquisition-failure, readiness-authority and the other files in this set. These are also the five files that conflict with river.
3. scripts/routine-civic-data-runner.mts around lines 795–800: the batched readPassCursor rewrite. Reverting it also removes the rulings-read-baseline.json line bumps.

Duplicates existing code. Reuse the existing helper and delete the new one.
4. lib/time/result-state-time-zones.ts, scripts/build-result-state-time-zones.mts, data/reference/result_state_time_zones.{json,md} and tests/result-state-time-zones.test.ts. Export stateClockZone(state) from lib/time/county-time-zones.ts (governmentTimeZone / COUNTY_TIME_ZONES) instead.
5. lib/election-results/feed-store.ts has two Netlify store wirings. Keep one createStore(io), and replace nativeResultFeedScope with resultFeedScope({ CONTEXT }). Follow the getStore pattern already used in lib/photos/store.ts.
6. Use the existing helpers:
   - lib/extract/html-text.ts extractHtmlText, in place of text() in lib/election-results/ballotpedia.ts:6.
   - lib/facts/roster-facts.ts nameKey, in place of the name key in lib/election-results/matcher.ts:20, or comment why NFKC differs.
   - lib/ballot/reader-place.ts, in place of statePlace in publisher.ts:38 and deferred-result-enhancer.tsx:12.

Padded tests. Merge the overlaps.
7. Use one scope-table test, not both tests/election-results-native-function.test.ts:43–52 and feed-store.test.ts:14–24.
8. Use one "race boundary checkpoint" test, not one in both publisher and runner tests.

After these fixes the diff should be about 6,000 genuinely new lines and few deletions.
```

## Repair

Fix on stream/cx-election-results and publish a new READY commit; River folds the new READY and clears this return when it integrates.
