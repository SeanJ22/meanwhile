# Returned: steps-2-6

## steps-2-6 — cleanup list (River's review at fold; delete in stream/steps-2-6, then mark READY again)

Lane steps-2-6 (STEP-2 to STEP-7), READY fdaa0503f, folded into river-next 0e49b37b15b0. Measured effect against river e9fe05f910be: +8,240 / −2,853 lines across 231 files (37 added, 1 deleted [hooks/use-narrowing.ts], 193 modified). The READY commit gives no line or file counts; state them when marking READY again.

Delete:
1. Remove the unused `export` keyword (nothing outside the file imports them, tests included): app/api/votes/holdings.ts:15 (FederalVoteSupportingReaders), :20 (FederalVoteSupportingHoldings), :34 (StateVoteScopeReaders), :38 (StateVoteMemberHolding); app/api/warm/priming.ts:33 (PRIME_PLACES_BUDGET_MS), :35 (PRIME_ASK_BUDGET_MS), :59 (AskPrimed), :72 (ReaderEdgePrimed); lib/db/search-log.ts:189 (searchLogInsertSql); lib/geo/address-geographies.ts:10 (AddressGeographyLookup); lib/hunt/egress.ts:6 (PublicAddress); lib/hunt/public-transport.ts:15 (PinnedRequest); lib/sources/acquisition-trace.ts:15 (AcquiredResponse). If a symbol is also unused inside its file, delete it.

Test-only exports left alone: app/api/votes/holdings.ts (HeldStateVoteScope, stateVoteAttributionForHolding), app/api/warm/priming.ts (ASK_SOURCE_PRELOADS), lib/db/search-log.ts (searchLogKeyHash, prepareSearchLogEvent), lib/hunt/egress.ts (isPublicAddress), lib/hunt/public-transport.ts (requestPinned, createPublicFetch).

Checked and clean otherwise: no commented-out code; no unreferenced new file or fixture.


lane: steps-2-6
owner: steps-2-6
writer: the steps-2-6 lane
check: cleanliness
ready: STEP-2, STEP-3, STEP-4, STEP-5, STEP-6, STEP-7 fdaa0503fec9430684de8871837b95f2e24b54e5
river: e9fe05f910befcb1935f3cc4d72575db3ac13ec3
at: 2026-10-14T04:49:36Z
state: returned
fix_subject: fix:f9ab4a5c
fix: River · stream/steps-2-6 — cleanliness failed for steps-2-6: ## steps-2-6 — cleanup list (River's review at fold; delete in stream/steps-2-6, then mark READY again)

## Failure

```
## steps-2-6 — cleanup list (River's review at fold; delete in stream/steps-2-6, then mark READY again)

Lane steps-2-6 (STEP-2 to STEP-7), READY fdaa0503f, folded into river-next 0e49b37b15b0. Measured effect against river e9fe05f910be: +8,240 / −2,853 lines across 231 files (37 added, 1 deleted [hooks/use-narrowing.ts], 193 modified). The READY commit gives no line or file counts; state them when marking READY again.

Delete:
1. Remove the unused `export` keyword (nothing outside the file imports them, tests included): app/api/votes/holdings.ts:15 (FederalVoteSupportingReaders), :20 (FederalVoteSupportingHoldings), :34 (StateVoteScopeReaders), :38 (StateVoteMemberHolding); app/api/warm/priming.ts:33 (PRIME_PLACES_BUDGET_MS), :35 (PRIME_ASK_BUDGET_MS), :59 (AskPrimed), :72 (ReaderEdgePrimed); lib/db/search-log.ts:189 (searchLogInsertSql); lib/geo/address-geographies.ts:10 (AddressGeographyLookup); lib/hunt/egress.ts:6 (PublicAddress); lib/hunt/public-transport.ts:15 (PinnedRequest); lib/sources/acquisition-trace.ts:15 (AcquiredResponse). If a symbol is also unused inside its file, delete it.

Test-only exports left alone: app/api/votes/holdings.ts (HeldStateVoteScope, stateVoteAttributionForHolding), app/api/warm/priming.ts (ASK_SOURCE_PRELOADS), lib/db/search-log.ts (searchLogKeyHash, prepareSearchLogEvent), lib/hunt/egress.ts (isPublicAddress), lib/hunt/public-transport.ts (requestPinned, createPublicFetch).

Checked and clean otherwise: no commented-out code; no unreferenced new file or fixture.
```

## Repair

Fix on stream/steps-2-6 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
