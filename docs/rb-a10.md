# Switch readers to the place map

Owner: RB-A10. Branch: stream/rb-a10, cut from river 21ae9bcfb. Current dependency: RB-A2 af8c2e48a, including RB-A1. Work in progress; no READY claim.

Reader and Admin memberships and typed-ZIP display points now use the place map. The recurring state import writes `zip_location` from the acquired Census and postal coordinates; reader requests and browser startup query those imported rows. The old server ZIP coordinate module and browser shard projection are deleted. Typed ZIPs that cross a state line read every touched state’s boards and calendars. The request shares the point result and raw rows across current-representation and election-year selections. Nearest-centroid lookup and the second resolver-geometry pass are deleted. The acquired ZIP seed decoder remains only in the map import and isolated test fixtures; no reader loads a seed shard.

Remaining work, owned by RB-A10:

- Move the remaining postal metadata reads in address resolution, ballot qualification and line-keeper destinations to the imported map, and remove the retired postal-file adapter.

- Verify complete ZIP coverage and every referenced identity against the production map. Depends on the RB-A1 schema and RB-A2 import. Production had no `zip_place`, `zcta_place` or `place_boundary` tables at the October 24 read. The new additive `RB-A10_zip_locations` migration and an import must also be applied by the production pipeline; this session has only read-only database authorization.
- Complete the Chrome 20-ZIP comparison and ten boundary map moves, including each first visit under three seconds. This session currently exposes no browser-control tool. HTTP snapshots below are not Chrome verification.
- Verify the next scheduled production refresh and two complete reader connections on real production data. Local refresh tests are useful evidence but are not a claim that a production run occurred.
- After board/river integration.md names rb-a2 and origin/river contains its folded commit, merge river, rerun every check, push READY, then handle returns until River records the live-check pass.

Verification so far: the imported-coordinate preservation test checks all 33,791 acquired Census ZIPs across all 56 jurisdictions. Type checking and lint pass after the switch (lint has 30 existing warnings). Four focused address and state-crossing checks pass after repairing string latitude/longitude selection. Starting reader and geography checks passed; the newest focused run passed 94 checks. A regression test reproduced stale local memberships returning an older boundary after refresh; selecting the current local boundary before intersection fixes it. Eight map tests pass after that repair, retaining earlier boundary rows and the place ID. The imported RB-A1 test type errors were fixed. The build against RB-A2 a9295c221 passes, including deployment trace checks.

Production references captured read-only: 56 reactions referring to 33 distinct target IDs, three demand signals, one Ask interaction, and zero Speak your mind rows. No production database writes were made.

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
