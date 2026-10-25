# Switch readers to the place map

RB-A10 · stream/rb-a10 · implementation `765e56473` · merged River `829f38c05` with RB-A2 `78a2a9f14`, RB-A3, RB-A5 and RB-A8 retained.

The imported production-data copy retains every board, displayed race and held voting-site ID across 20 ZIPs in 20 states: 937 board entries retained and five additional held boards for ZIP 03301, 547 races and 1,966 sites. Twenty point endpoints across ten state-line moves return the correct state, with one indexed point query each. Two actual map-only ballot pages also share one point query across representation and election reads.

Production release dependency: A2's schema is live, but the snapshot has zero `zip_place` and `place_boundary` rows. River must run the existing map imports before releasing the switched readers and apply the additive `RB-A10_zip_locations` expand migration. This lane made no production database writes.

## Reader behavior

Meetings, /ballot, voting sites, reader state/places, address and ZIP resolution, Ask, Admin hunts/data slices, open data and reader traces read the shared map. Election boundaries still follow the unchanged `selection.ts` rules. A map move retains its exact coordinates; ballot navigation omits a retained ZIP and infers the point's state from the map. Request-local reads share the raw point rows across map-year selections.

The retired ZIP lookup, nearest-centroid lookup, second resolver-geometry pass and browser ZIP-shard projection are deleted. Captured Census/postal ZIP files remain acquisition inputs to the state importer. ZIP display coordinates and mailing metadata live in `zip_location`, with all 33,791 acquired Census display points and 42,883 total known postal rows retained. Cross-state ZIPs keep every sourced state and preserve mailing-state ordering.

## Production connections

1. Tucson 85701: 139/139 boards, 37/37 displayed races including retention cards, and 345/345 voting-site IDs retained through the actual meetings route, ballot page and voting projection.
2. Concord 03301: all 7 baseline boards retained, with 12 now visible; 33/33 displayed races and 1/1 voting-site IDs retained through those same readers.

The Phoenix map ballot at (33.4484, -112.074), with no ZIP or named state, returns 81 races through one point query, including House district 3 and legislative district 11. A point on Arizona's side of the New Mexico line returns 22 races through one point query. The complete meetings route verifies both endpoints of ten border crossings.

Both cohorts read one production `REPEATABLE READ READ ONLY` snapshot at 2026-10-25T03:44:41.765Z. The before code is River `829f38c05`; the after code is the implementation above. A2's real importer builds the local PostgreSQL map from held production Census records, captured source evidence and official Census polygons. Every current ID in fresh meanwhileusa.com meetings and ballot GET snapshots is also retained. The comparison resolves the actual ballot page's streamed element tree, including retention cards; scope-endpoint totals are recorded separately.

[Connection results, border points and next-run proof](measurements/rb-a10-reader-connections.json) · [before IDs](measurements/rb-a10-copy-before.json) · [after IDs](measurements/rb-a10-copy-after.json) · [fresh public baseline](measurements/rb-a10-live-baseline.json)

| State | ZIP | Boards before → after | Races before → after | Sites before → after |
| --- | --- | ---: | ---: | ---: |
| AZ | 85701 | 139 → 139 | 37 → 37 | 345 → 345 |
| CA | 94102 | 151 → 151 | 53 → 53 | 0 → 0 |
| CO | 80202 | 68 → 68 | 55 → 55 | 0 → 0 |
| FL | 33130 | 5 → 5 | 30 → 30 | 56 → 56 |
| GA | 30303 | 0 → 0 | 22 → 22 | 33 → 33 |
| IL | 60602 | 116 → 116 | 10 → 10 | 0 → 0 |
| MN | 55401 | 15 → 15 | 42 → 42 | 0 → 0 |
| NH | 03301 | 7 → 12 | 33 → 33 | 1 → 1 |
| NJ | 07102 | 3 → 3 | 3 → 3 | 28 → 28 |
| NY | 10007 | 0 → 0 | 16 → 16 | 263 → 263 |
| OR | 97204 | 13 → 13 | 13 → 13 | 32 → 32 |
| TX | 78701 | 0 → 0 | 55 → 55 | 0 → 0 |
| WA | 98101 | 0 → 0 | 26 → 26 | 105 → 105 |
| WI | 53703 | 420 → 420 | 12 → 12 | 0 → 0 |
| NC | 28203 | 0 → 0 | 32 → 32 | 212 → 212 |
| OH | 43215 | 0 → 0 | 30 → 30 | 1 → 1 |
| MI | 48226 | 0 → 0 | 24 → 24 | 6 → 6 |
| PA | 19147 | 0 → 0 | 8 → 8 | 683 → 683 |
| MA | 02108 | 0 → 0 | 16 → 16 | 164 → 164 |
| NM | 87501 | 0 → 0 | 30 → 30 | 37 → 37 |

## Identity and next scheduled run

All 60 current references across 36 distinct IDs resolve in production: 56 reactions, one Ask interaction, three demand signals and zero Speak your mind rows. The copy restores 44 existing entities and 78 aliases; all resolved identities remain identical after all 20 state imports. No reader event is rewritten.

The full standing Arizona acquisition/import publishes successfully. At the controlled next-due time, 2026-11-24T03:38:33.732Z, the next publication is PROMOTED and all 32,164 ZIP memberships remain. The post-refresh readers retain the same 139 boards, 37 races and 345 sites in the same civic-data snapshot. This verifies the scheduled code path under a controlled clock.

## Counts by state

The same inventory SELECT runs before and after the reader comparisons in the protected production snapshot. Boards count runtime body IDs plus sourced bodies/committees with live names; races and sites count distinct IDs in current promoted records. These inventory totals are separate from the visible-ID checks above. All 56 jurisdictions are unchanged: 10,180 boards, 11,604 races and 20,165 sites. [Definitions, SQL and captured values](measurements/rb-a10-state-counts.json).

| State | Boards before | Boards after | Races before | Races after | Sites before | Sites after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AK | 118 | 118 | 76 | 76 | 0 | 0 |
| AL | 272 | 272 | 187 | 187 | 78 | 78 |
| AR | 119 | 119 | 179 | 179 | 3 | 3 |
| AS | 0 | 0 | 18 | 18 | 0 | 0 |
| AZ | 1015 | 1015 | 169 | 169 | 368 | 368 |
| CA | 1863 | 1863 | 346 | 346 | 1828 | 1828 |
| CO | 233 | 233 | 165 | 165 | 56 | 56 |
| CT | 166 | 166 | 197 | 197 | 174 | 174 |
| DC | 5 | 5 | 16 | 16 | 129 | 129 |
| DE | 50 | 50 | 77 | 77 | 297 | 297 |
| FL | 682 | 682 | 307 | 307 | 824 | 824 |
| GA | 244 | 244 | 279 | 279 | 178 | 178 |
| GU | 0 | 0 | 0 | 0 | 0 | 0 |
| HI | 71 | 71 | 92 | 92 | 60 | 60 |
| IA | 66 | 66 | 140 | 140 | 64 | 64 |
| ID | 113 | 113 | 423 | 423 | 2 | 2 |
| IL | 432 | 432 | 166 | 166 | 25 | 25 |
| IN | 28 | 28 | 142 | 142 | 182 | 182 |
| KS | 11 | 11 | 248 | 248 | 23 | 23 |
| KY | 16 | 16 | 127 | 127 | 1690 | 1690 |
| LA | 0 | 0 | 18 | 18 | 112 | 112 |
| MA | 54 | 54 | 232 | 232 | 164 | 164 |
| MD | 306 | 306 | 336 | 336 | 102 | 102 |
| ME | 10 | 10 | 278 | 278 | 0 | 0 |
| MI | 142 | 142 | 340 | 340 | 51 | 51 |
| MN | 52 | 52 | 392 | 392 | 25 | 25 |
| MO | 453 | 453 | 195 | 195 | 57 | 57 |
| MP | 0 | 0 | 21 | 21 | 15 | 15 |
| MS | 5 | 5 | 102 | 102 | 0 | 0 |
| MT | 4 | 4 | 146 | 146 | 0 | 0 |
| NC | 159 | 159 | 561 | 561 | 2806 | 2806 |
| ND | 13 | 13 | 409 | 409 | 209 | 209 |
| NE | 0 | 0 | 48 | 48 | 13 | 13 |
| NH | 650 | 650 | 98 | 98 | 2 | 2 |
| NJ | 694 | 694 | 109 | 109 | 614 | 614 |
| NM | 76 | 76 | 255 | 255 | 37 | 37 |
| NV | 56 | 56 | 78 | 78 | 48 | 48 |
| NY | 130 | 130 | 268 | 268 | 1292 | 1292 |
| OH | 113 | 113 | 223 | 223 | 269 | 269 |
| OK | 46 | 46 | 95 | 95 | 93 | 93 |
| OR | 88 | 88 | 116 | 116 | 340 | 340 |
| PA | 16 | 16 | 188 | 188 | 683 | 683 |
| PR | 0 | 0 | 0 | 0 | 0 | 0 |
| RI | 0 | 0 | 126 | 126 | 0 | 0 |
| SC | 7 | 7 | 298 | 298 | 1956 | 1956 |
| SD | 0 | 0 | 89 | 89 | 456 | 456 |
| TN | 3 | 3 | 129 | 129 | 15 | 15 |
| TX | 475 | 475 | 1736 | 1736 | 1375 | 1375 |
| UT | 10 | 10 | 142 | 142 | 38 | 38 |
| VA | 28 | 28 | 427 | 427 | 2651 | 2651 |
| VI | 1 | 1 | 10 | 10 | 14 | 14 |
| VT | 8 | 8 | 140 | 140 | 0 | 0 |
| WA | 68 | 68 | 156 | 156 | 627 | 627 |
| WI | 1000 | 1000 | 195 | 195 | 0 | 0 |
| WV | 0 | 0 | 196 | 196 | 98 | 98 |
| WY | 9 | 9 | 98 | 98 | 22 | 22 |

## Validation

All nine existing checks pass for implementation `765e56473` with the test-only expectation updates `9a480e58c`: lint, type checking, dead-code checking, pinned-browser availability, the complete canonical suite, the read-only pre-deploy database check, default build, bundle checks and standalone build. Both preflight checks pass. The suite registers 9,885 tests: 9,883 pass, zero fail, and 2 existing acquisition-repair capture-fixture skips (roster and profile). The two canonical shards cover all 1,377 files with complete timing records. The complete second shard was rerun after correcting a synthetic-origin fixture and two legacy point/ZIP expectations. Runtime code and all first-shard selected files were unchanged. Lint has zero errors and 57 existing warnings; all 16 bundle checks pass. The database check reports 56 of 57 migrations applied, with only A10's expand pending. [Captured validation](measurements/rb-a10-checks.json).

The resume comparisons are native reader checks on the imported production-data copy. Chrome first-visit timing remains unverified. Live HTTP durations and native function durations are retained as measurements. The request-only Google voting fallback is unchanged and was not exercised. The next-run proof uses a controlled clock. The switched map is not deployed by this lane.
