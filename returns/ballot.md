# Returned: ballot

lane: ballot
owner: ballot
writer: the ballot lane
check: build
ready: no step ids unknown
river: 6af6f8a504a7224131ad567f62f7b6f63cb52f08
at: 2026-10-06T00:04:17Z
state: returned
fix_subject: fix:e8918c6e
fix: River · stream/ballot — build failed for ballot: build-output · REFUSED

## Failure

```
Your READY f984126b5 (CA-21, CA-25, CA-26, CA-27, CA-28, CA-33, CA-37, CA-52) folds and passes lint, tsc and the firewall, but the production build refuses it (River, 2026-10-06 ~00:50Z):

  build-output · REFUSED
  app trace cardinality 448 files (server/app/api/warm/route.js.nft.json) exceeds the committed ceiling of 430 (baseline 374).

Bisected by build on River's trial fold: river + measures, registry, hunters, people, auditors = 397 files on /api/warm; adding only your READY = 448. The files that join the warm route's trace are all of data/reference/ (26 files: acs5_2024_b01003_*.csv/.md, census_govt_units_2022*, boarddocs/civicplus/granicus tenants, fec_*, nces_ccd_lea_directory_2025_26, openstates_legislators, state-cf-agencies), data/prl/prl-profiles.json, data/voting-sites.json and lib/census-geography/bootstrap-az.json. That is the R23 shape: a module newly reachable from the warm route reads data/ through a computed path. Likely entry: your new imports in lib/civic-data/manual-projections.ts and the new reader-verification cases (public-records, campaign-finance, government-budgets, translations) and lib/civic-data/promotion.ts / store.ts importing scoped-manual-contracts; follow them to the reader that opens data/reference/ or voting-sites.json dynamically.

Reproduce: `CI=1 pnpm build` on your stream (unset DATABASE_URL), then `node -e 'console.log(require("./.next/server/app/api/warm/route.js.nft.json").files.filter(f=>f.includes("data/")).join("\n"))'`. Fix at the source (static map pattern in lib/sources/ballot-curated/index.ts, or keep the data reader out of the warm/verification import graph). Do not raise the ceiling. Owner decision 2026-10-05: data never rebuilds the site, so no new traced data/ files.

Also needed when you mark the new READY (River resolved these in its trial fold stream/salvage-river-next-ballot; take them or equivalent):
- lib/control-plane/workers/autonomous-plan.ts: hunters' CH-16 `...partFor(spec.recordClass)` line now sits next to your publication-door lines; keep both.
- lib/hunt/meetings-site-discovery.ts OFFICIAL_PAGE_EVENTS_VERSION: re-key from the test message after catching up.
Run `pnpm gates` (it includes the build) before marking READY. Catch up with `river` after this promotion first.
```

## Repair

Fix on stream/ballot and publish a new READY commit; River folds the new READY and clears this return when it integrates.
