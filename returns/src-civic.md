# Returned: src-civic

## src-civic — cleanup list (River's review at fold; delete in stream/src-civic, then mark READY again)

Lane src-civic (VS-01), cut from river ac3ccf885, tip 6b207dedc. Added 83,484 lines, deleted 1,668 lines. Files: 158 added, 4 deleted, 62 modified. Code and tests alone: +14,070 / −1,668 (79 files added, 4 deleted, 62 modified). Fixtures: +69,414 (79 files added). It also carries the statewide-and-portraits (SL-03) commits, so that lane's cleanup list applies here too.

Delete:
1. Remove the unused `export` (used only inside its own file): lib/ballot/voting-answer.ts:54 (precinctsFor) and :91 (VotingAnswerDependencies); lib/ballot/voting-source-discovery.ts:12 (votingDoorShape), :23 (votingDoorCoverage) and :38 (VotingDiscoveryResult); lib/ballot/voting-source-pages.ts:5 (VotingPageRequest); lib/ballot/voting-source-publication.ts:7 (VOTING_SOURCE_DOOR_KIND); lib/ballot/voting-source-readers.ts:47 (officialElectionLinkMatches) and :102 (powerBiVotingRows); lib/ballot/voting-source-types.ts:87 (VotingSourceContact); lib/reference/index.ts:43 (ReferenceJsonDataset), :79 (jsonDataPath) and :84 (readJsonReference); lib/sources/google-civic/acquisition.ts:68 (civicCatalogIdentity); lib/sources/google-civic/model.ts:5, :13, :47, :55, :60 and :66 (CivicAttribution, CivicFact, CivicCatalog, civicObject, civicArray, civicSources); lib/sources/google-civic/reader-lookup.ts:10 (civicVotingJurisdictions); scripts/fetch-voting-sites.mts:108 (registeredElectionOfficeDoors) and :135 (votingLookupDiscoveryRead).
2. Delete comments that quote rulings (rulings §5 forbids it): lib/ballot/voting-source-fetch.ts lines 17–21, a five-line comment that opens "Rulings §2: robots.txt alone never blocks acquisition."; replace it with at most two lines saying why. In lib/ballot/voting-source-blanks.ts:126, delete the words "(rulings §2)" from the string.
3. Cut these comments to two lines or less: lib/civic-data/people-source-read.ts lines 5–8; lib/photos/portrait-work.ts lines 23–25.
4. Delete two assertions that test for code this lane already deleted: tests/voting-answer-display.test.ts:29 (data-polling-lookup-fallback) and tests/voting-dates-and-place.test.ts:168 (PollingLookupFallback).

Checked and clean: no commented-out code; the old path it replaced is deleted (components/ballot/polling-lookup-fallback.tsx, lib/ballot/polling-lookup-fallback.ts, lib/sources/cochise-vote-centers.ts and tests/reader-polling-fallback.test.ts are gone and no code imports them); every new code file is imported; every new fixture is referenced.

For Sean to rule, not ordered for deletion: lib/sources/google-civic/* keeps Google Civic voterinfo as a second source of voting facts beside the official voting-source path. The READY message names it an explicit fallback for places where official facts have not loaded.

The READY commit gives no line or file counts; it predates that requirement.


lane: src-civic
owner: src-civic
writer: the src-civic lane
check: cleanliness
ready: no step ids unknown
river: edd7652c5bb585c8d6bdc5b01f31c77b556e6207
at: 2026-10-13T21:04:56Z
state: returned
fix_subject: fix:0f18d9c8
fix: River · stream/src-civic — cleanliness failed for src-civic: ## src-civic — cleanup list (River's review at fold; delete in stream/src-civic, then mark READY again)

## Failure

```
## src-civic — cleanup list (River's review at fold; delete in stream/src-civic, then mark READY again)

Lane src-civic (VS-01), cut from river ac3ccf885, tip 6b207dedc. Added 83,484 lines, deleted 1,668 lines. Files: 158 added, 4 deleted, 62 modified. Code and tests alone: +14,070 / −1,668 (79 files added, 4 deleted, 62 modified). Fixtures: +69,414 (79 files added). It also carries the statewide-and-portraits (SL-03) commits, so that lane's cleanup list applies here too.

Delete:
1. Remove the unused `export` (used only inside its own file): lib/ballot/voting-answer.ts:54 (precinctsFor) and :91 (VotingAnswerDependencies); lib/ballot/voting-source-discovery.ts:12 (votingDoorShape), :23 (votingDoorCoverage) and :38 (VotingDiscoveryResult); lib/ballot/voting-source-pages.ts:5 (VotingPageRequest); lib/ballot/voting-source-publication.ts:7 (VOTING_SOURCE_DOOR_KIND); lib/ballot/voting-source-readers.ts:47 (officialElectionLinkMatches) and :102 (powerBiVotingRows); lib/ballot/voting-source-types.ts:87 (VotingSourceContact); lib/reference/index.ts:43 (ReferenceJsonDataset), :79 (jsonDataPath) and :84 (readJsonReference); lib/sources/google-civic/acquisition.ts:68 (civicCatalogIdentity); lib/sources/google-civic/model.ts:5, :13, :47, :55, :60 and :66 (CivicAttribution, CivicFact, CivicCatalog, civicObject, civicArray, civicSources); lib/sources/google-civic/reader-lookup.ts:10 (civicVotingJurisdictions); scripts/fetch-voting-sites.mts:108 (registeredElectionOfficeDoors) and :135 (votingLookupDiscoveryRead).
2. Delete comments that quote rulings (rulings §5 forbids it): lib/ballot/voting-source-fetch.ts lines 17–21, a five-line comment that opens "Rulings §2: robots.txt alone never blocks acquisition."; replace it with at most two lines saying why. In lib/ballot/voting-source-blanks.ts:126, delete the words "(rulings §2)" from the string.
3. Cut these comments to two lines or less: lib/civic-data/people-source-read.ts lines 5–8; lib/photos/portrait-work.ts lines 23–25.
4. Delete two assertions that test for code this lane already deleted: tests/voting-answer-display.test.ts:29 (data-polling-lookup-fallback) and tests/voting-dates-and-place.test.ts:168 (PollingLookupFallback).

Checked and clean: no commented-out code; the old path it replaced is deleted (components/ballot/polling-lookup-fallback.tsx, lib/ballot/polling-lookup-fallback.ts, lib/sources/cochise-vote-centers.ts and tests/reader-polling-fallback.test.ts are gone and no code imports them); every new code file is imported; every new fixture is referenced.

For Sean to rule, not ordered for deletion: lib/sources/google-civic/* keeps Google Civic voterinfo as a second source of voting facts beside the official voting-source path. The READY message names it an explicit fallback for places where official facts have not loaded.

The READY commit gives no line or file counts; it predates that requirement.
```

## Repair

Fix on stream/src-civic and publish a new READY commit; River folds the new READY and clears this return when it integrates.
