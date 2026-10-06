> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

## TOP ITEM: FAILED LIVE (River live ledger, Oct 6, 2:45 AM EDT)

Sean, Oct 6: a step is done only when it works live. Integrated is not done. These steps were integrated, but the live check of their Done-when line failed on production a5fd753 (release 8). Fix them before any new step. After a fix, say in your READY status what a reader or Admin will now see, and River re-checks it live in that release's measured hour. Full table: board/river releases/live-ledger.md.

- **CA-27 · The translator, part 3: what an office does.** Seen: Office cards show the older hand-written blurbs, not translator definitions written from each state's law. Examples: /ballot?zip=07866, county commissioner card: "(Powers defined in: State statutes on county government.)"; 03255, sheriff: "State statutes on county officers". Those texts were already in lib/officials/office-blurbs.ts at release 2. In live code, readOfficeTranslation (lib/translate/reader.ts) is called by no app or component file, and no translation record is published (the commit says "hooks pending").
- **CA-29 · Existing definitions become translation records.** Seen: The static files are still in the live commit a5fd753: lib/officials/body-definitions.ts, form-definitions.ts, office-blurbs.ts, data/states/az/reference/body-blurbs.json and body-description.ts. lib/officials/curated-definition-reader.ts keeps them as 'the way back until River checks the replacement'. Cards still render that legacy text, and no translation records have been promoted to replace them.
- **CA-36 · Ask fetches full detail through the keys when asked.** Seen: Ask at 85701 'List every PAC that gave to Adelita Grijalva this year' (asked twice) and at 03255 'List every PAC that gave to Jeanne Shaheen this year' each answered in about 4.5 s with 'The full filing detail could not be read before the answer deadline.' plus the stored cycle summary. No rows were fetched and no per-row filing links shown; Records list only county/state/federal filing notes. The live FEC fetch through the key never completes before its deadline.
- **CA-54 · Budgets on the body card and in Ask.** Seen: GovernmentMoneySection (components/funding/government-money-section.tsx) isn't mounted on any card in a5fd753, so no body card can show a Money section. /api/government-finance returns NOT_HELD for Pima, Tucson, Morris, Chicago and Seattle, and no government-budgets record has ever been promoted. Ask at 85701, 'What is Pima County's budget?', said 'The county has not published this financial information', which wrongly puts our gap on the county.
- **Ask says Mesa's June 1 budget votes aren't recorded, but they are.** Seen: At 85201, Ask said the June 1 budget resolution votes aren't recorded. The promoted Mesa results record holds them (Resolution 12542, Taylor voting no). Ask is not reading the meeting-results records it should.
- **Ask blames a government for a gap that is ours.** Seen: At 85701 Ask said 'The county has not published this financial information' when we simply hold no budget record. Rulings: a gap of ours reads 'We're working on getting this info', never a claim about the government.
- **An off-target vote answer.** Seen: Asked how Goodlander voted on the continuing appropriations bill, Ask listed unrelated September votes.

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

## River note, 2026-10-06 ~03:50Z

Batch API (Sean, 2026-10-06): plain-English summaries (CA-25 translations) are single requests with nobody waiting; send them through model-batch.ts as a registered lane (BATCH_LANES entry with its flag and reason). Ask stays on Messages.
