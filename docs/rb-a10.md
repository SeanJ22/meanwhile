# Switch readers to the place map

Owner: RB-A10. Branch: stream/rb-a10, cut from river 21ae9bcfb. Current dependency: RB-A2 83b96a9b3, including integrated River 59b7c5577 and RB-A1. Work in progress; no READY claim.

Reader and Admin memberships and typed-ZIP display points now use the place map. Coordinate and postal imports stream the captured national files and retain only the requested state’s rows; the shared decoder also rejects incomplete captures. The recurring state import writes `zip_location` from the acquired Census and postal coordinates; reader requests and browser startup query those imported rows. The old server ZIP coordinate and postal-file modules and browser shard projection are deleted. Known postal destinations retain their metadata even when they have no display coordinate. Typed ZIPs that cross a state line read every touched state’s boards and calendars. The request shares the point result and raw rows across current-representation and election-year selections. Nearest-centroid lookup and the second resolver-geometry pass are deleted. The acquired ZIP seed decoder remains only in the map import and isolated test fixtures; no reader loads a seed shard.

Remaining work, owned by RB-A10:

- Verify complete ZIP coverage and every referenced identity against the production map. Depends on the RB-A1 schema and RB-A2 import. Production had no `zip_place`, `zcta_place` or `place_boundary` tables at the October 24 read. The new additive `RB-A10_zip_locations` migration seeds the existing source coordinates and postal metadata before deployment and must also be applied by the production pipeline; this session has only read-only database authorization.
- Complete the Chrome 20-ZIP comparison and ten boundary map moves, including each first visit under three seconds. This session currently exposes no browser-control tool. HTTP snapshots below are not Chrome verification.
- Verify the deployed map and actual scheduled production refresh after RB-A2 ships. The two production-data copy reader connections and controlled-clock standing refresh below pass; they are not a claim that a production map run occurred.
- After board/river integration.md names rb-a2 and origin/river contains its folded commit, merge river, rerun every check, push READY, then handle returns until River records the live-check pass.

The integrated 83b96a9b3 revision passes 113 canonical focused checks, the default build and merge-file lint. River's paged open-data reader and ballot navigation are retained. Four incoming EPA replay/test imports of the retired ZIP module are replaced; the replays use an explicit read-only map connection and preserve their local evidence stores. The production pre-deploy schema check passes with 51 of 54 migrations applied; A1 remains owed from the earlier release and A2 plus the ZIP seed remain pending. This is not deployed-map verification.

Verification so far: default and standalone builds against RB-A2 208f03964 pass, including deployment traces. Type checking, dead-code checking, both preflight checks and the read-only pre-deploy schema check pass. Lint has zero errors and 30 existing warnings. All 16 bundle checks pass. The imported-coordinate check preserves all 33,791 Census ZIP points and known postal metadata across all 56 jurisdictions; 22 ZIP import, reader and cache checks pass. Focused trace, resolver and standing-contract checks pass (87 checks). The subsequent standalone build against f81d93a60 passes, along with 19 canonical point-map and reader checks. Default and standalone builds against 0dae4d53f with the border-ZIP retention fix below pass, along with 27 canonical reader, point-map and cache checks. Lint remains at zero errors and 30 existing warnings; dead-code checking passes. The latest server traces pack none of the retired ZIP, centroid or resolver lookup files. The subsequent default build against 9b7681df3 passes with the shared membership SQL and covering indexes retained; its read-only pre-deploy schema check passes. The bounded source importer passes its standalone build and 35 canonical checks, including every acquired coordinate and postal record across all 56 jurisdictions, split Unicode rows and a truncated-source rejection. The default build against 6f1cc7c55 passes. Its national bulk handoff is implemented: ZIP reads have no point-only boundary predicate, and `placeEntry` trusts the provider’s state list including fringe memberships. All 36 canonical focused checks pass; ZIP 47025 remains in Ohio enumeration with its 19 complete memberships (11 ordinary, eight fringe, including three Ohio fringe memberships), and ballot access retains all 19. Imported mailing-state ordering still keeps Indiana first.

The complete canonical suite on 2aba095a4 passes 9,638 checks with two existing acquisition-repair skips (roster and profile). Shard 1 passed 4,754 checks and shard 2 passed 4,884. The first shard-2 run remains a failed measurement: its first Bodies list exceeded three seconds while RB-A10's source-overlap acquisition competed for the same four CPU cores. Running the complete second shard without that competing acquisition passes every unchanged first-use and click-through limit on desktop and phone. Heavy source acquisition is now kept separate from timed browser checks. The subsequent f81d93a60 point and source-shape changes pass their standalone build and 19 canonical focused checks; the full suite will run again after the required River fold. None of these fixture browser checks replaces the requested production Chrome walk.

The latest provider exposes a real Arkansas sliver for Bloomburg, TX ZIP 75556 that the old sampled state row missed. A read-only production query confirms its Arkansas Census district memberships. The adapter keeps the ZIP's mailing state from imported `zip_location` metadata first, retaining Texas statewide information while preserving all Arkansas memberships. It batches that metadata read for state enumerations and only needs it for ZIPs touching more than one state. Exact map-point reads are unchanged.

The original ballot choice between a saved ZIP and a named map point is preserved using imported postal metadata. An Ohio point replaces saved Indiana ZIP 47025 even though that ZIP also has Ohio fringe memberships; request selection, state, and ballot divisions share one exact point query. A typed crossing ZIP with its mailing state and display point stays a ZIP-area selection and performs no point query. All 44 canonical focused checks and both default and standalone builds against 6f1cc7c55 pass after this change. The subsequent 4f7edfeb4 merge also passes all 44 checks and the default build. Its bounded plan-decision cache and faster JSON aggregation are retained, with the aggregation shared by single-ZIP reads and state enumeration. The provider's count cache remains on the import path. Every check will run again with River before READY.

The Arizona and New Hampshire production-copy replays preserve every held ZIP membership and all 1,034 and 763 held place IDs respectively. Production still has no map tables at the latest read. The shipping check permits the pending RB-A1 and RB-A2 contracts and the new additive ZIP seed at pre-deploy; it is not proof that those migrations are deployed.

Production references captured read-only: 56 reactions referring to 33 distinct target IDs, three demand signals, one Ask interaction, and zero Speak your mind rows. Across these 60 references, all 36 distinct IDs resolve in the shared identity schema in disposable PostgreSQL; their resolved identities remain identical after the Arizona and New Hampshire map refreshes. The copy includes 31 existing entities and 72 existing aliases from production. This is a production-data copy proof, not a claim that RB-A1 is deployed. No production database writes were made.

## Production-data connections on the imported map

Both checks used current official map rows imported into disposable local PostgreSQL and downstream civic facts from the production reader's `readonly` role in read-only transactions. They called the real meetings and ballot-scope readers and the voting-site projection. These are not Chrome live checks or claims that the new map is deployed.

| ZIP | Baseline boards retained | Baseline race IDs retained | Baseline site IDs retained |
| --- | ---: | ---: | ---: |
| 85701, AZ | 139 / 139 | 24 / 24 | 345 / 345 |
| 03301, NH | 7 / 7 | 33 / 33 | 0 / 0 |

Concord also returned five additional board IDs. The 4f7edfeb4 reader replay retains all baseline IDs in both places and returns one voting site for Concord, compared with zero in the saved ZIP snapshot. The ballot-scope endpoint includes held elections, so its total is not presented as the current ballot page's race count. All comparisons preserve the baseline IDs themselves.

The first statewide New Hampshire replay exposed three held Newfound ZIP memberships suppressed by an extra global year filter in RB-A10. That filter is removed from ZIP reads: the provider retains unreplaced ZIP evidence. Point reads select the current local polygon before intersection, and district election plans still use selection.ts. The full replay against 3b392c823 passed: Arizona has zero missing memberships across 572 ZIPs and New Hampshire has zero across 284. The replay against 5ba76fa0c also passed for both states with the same preserved IDs and no missing memberships.

The ballot cache verdict also reads the place map, including purge tags for every state a ZIP touches; no runtime reader imports postal ZIP JSON. The existing national diagnostic scripts now query the imported map too. Twenty-two ZIP import, reader and cache checks pass, including cross-state invalidation, unknown ZIPs, map selections and map outages.

The complete Arizona standing refresh against current production reads and cached official source bytes publishes successfully. Its controlled clock verifies that it is not due one millisecond before its cadence and is due at the next cadence; at that due time the second import keeps all 32,164 ZIP memberships and the next publication is PROMOTED. After that next import, the actual meetings and ballot-scope readers and voting-site projection still retain all 139 Tucson board IDs, 24 baseline race IDs and 345 site IDs, with no missing IDs. The replay against 4f7edfeb4 also publishes both imports successfully, preserves those memberships, and passes those same post-refresh reader comparisons. Its peak RSS is 1,109,716,992 bytes; worker reservations are unchanged. The latest computed due time is November 23 at 10:37 AM Eastern. All writes are in the disposable copy. This proves the scheduled code path under a controlled clock, not an actual production scheduler execution.

Twenty points on both sides of ten state lines resolve to the expected state using one point query each. After f81d93a60, the native Tucson point lookup returns 15 place IDs in one query; PostgreSQL EXPLAIN confirms `place_boundary_point_idx` is used on the official Arizona production-data copy. The check uses current [Census 2026 state boundaries](https://www2.census.gov/geo/tiger/TIGER2026/STATE/tl_2026_us_state.zip), SHA-256 `2e17ea40dff3e00163eec87a26efa0b0ff7e8fe364a191bf1a7754dcb49ea326`. These are source-map checks in PostgreSQL, not the outstanding Chrome map moves. A source search finds no imports of the retired ZIP lookup modules or the old `lookupIn`, `resolveIn`, `nearestIn` or `nearestZcta` functions. Source JSON is read only by the map importer.

The additive seed has 42,883 source rows, including known postal destinations with no coordinates. Migration verification now sizes its committed-file read for the actual migration, retaining exact byte comparison; all 21 migration tests pass after that fix.

## Production baseline by state

Boards count distinct runtime-registry IDs plus sourced body and committee IDs with a live name fact. Races count distinct contests in the current promoted ballot records. Sites count distinct IDs in promoted voting records. These describe held production data, not rendered-page completeness. After counts remain open until the new map is loaded and checked.

| State | Boards before | Races before | Sites before |
| --- | ---: | ---: | ---: |
| AK | 115 | 76 | 0 |
| AL | 271 | 187 | 78 |
| AR | 117 | 179 | 0 |
| AS | 0 | 18 | 0 |
| AZ | 1012 | 169 | 345 |
| CA | 1851 | 346 | 0 |
| CO | 214 | 165 | 0 |
| CT | 148 | 197 | 0 |
| DC | 4 | 16 | 0 |
| DE | 42 | 77 | 297 |
| FL | 618 | 307 | 1 |
| GA | 223 | 279 | 132 |
| GU | 0 | 0 | 0 |
| HI | 68 | 92 | 60 |
| IA | 48 | 140 | 64 |
| ID | 99 | 423 | 0 |
| IL | 431 | 166 | 24 |
| IN | 18 | 142 | 0 |
| KS | 10 | 248 | 0 |
| KY | 13 | 127 | 1690 |
| LA | 0 | 18 | 0 |
| MA | 53 | 232 | 164 |
| MD | 293 | 336 | 102 |
| ME | 10 | 278 | 0 |
| MI | 142 | 340 | 0 |
| MN | 33 | 392 | 0 |
| MO | 453 | 195 | 0 |
| MP | 0 | 21 | 0 |
| MS | 0 | 102 | 0 |
| MT | 0 | 146 | 0 |
| NC | 159 | 561 | 0 |
| ND | 0 | 409 | 209 |
| NE | 0 | 48 | 0 |
| NH | 650 | 98 | 1 |
| NJ | 694 | 109 | 156 |
| NM | 74 | 255 | 0 |
| NV | 53 | 78 | 0 |
| NY | 128 | 268 | 0 |
| OH | 112 | 223 | 0 |
| OK | 33 | 95 | 0 |
| OR | 79 | 116 | 0 |
| PA | 15 | 188 | 0 |
| PR | 0 | 0 | 0 |
| RI | 0 | 126 | 0 |
| SC | 0 | 298 | 1956 |
| SD | 0 | 89 | 0 |
| TN | 0 | 129 | 0 |
| TX | 474 | 1736 | 0 |
| UT | 10 | 142 | 0 |
| VA | 28 | 427 | 0 |
| VI | 1 | 10 | 0 |
| VT | 0 | 140 | 0 |
| WA | 68 | 156 | 0 |
| WI | 1000 | 195 | 0 |
| WV | 0 | 196 | 0 |
| WY | 3 | 98 | 0 |

## Twenty ZIP snapshots

Captured from meanwhileusa.com on production commit 16eead35c. Every HTTP request returned 200 and completed under three seconds. These are saved response and HTML snapshots; they are not first-visit Chrome measurements.

| State | ZIP | Boards | Races | Sites |
| --- | --- | ---: | ---: | ---: |
| AZ | 85701 | 139 | 24 | 345 |
| CA | 94102 | 151 | 39 | 0 |
| CO | 80202 | 65 | 48 | 0 |
| FL | 33130 | 5 | 23 | 0 |
| GA | 30303 | 0 | 22 | 0 |
| IL | 60602 | 109 | 10 | 0 |
| MN | 55401 | 15 | 42 | 0 |
| NH | 03301 | 7 | 33 | 0 |
| NJ | 07102 | 3 | 3 | 0 |
| NY | 10007 | 0 | 16 | 0 |
| OR | 97204 | 0 | 13 | 0 |
| TX | 78701 | 0 | 53 | 0 |
| WA | 98101 | 0 | 26 | 0 |
| WI | 53703 | 419 | 12 | 0 |
| NC | 28203 | 0 | 31 | 0 |
| OH | 43215 | 0 | 28 | 0 |
| MI | 48226 | 0 | 23 | 0 |
| PA | 19147 | 0 | 8 | 0 |
| MA | 02108 | 0 | 16 | 164 |
| NM | 87501 | 0 | 24 | 0 |
