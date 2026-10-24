# SO-01 — READY for River

Code and the production-copy scheduled replay are ready for River. Per Sean’s current instruction, lanes do not write production: River ships the code, the runner publishes through the standing data path, and River plus oversight perform the live checks below. This READY does not claim deployment or a live pass.

Branch `stream/so-01` was cut from `origin/river` at `21ae9bcfb663794953b07a9d7977b228cab67c2d`. No changes to `SeanJ22/meanwhile-signal`. No production database writes, deployments, settings changes or pull requests. The scheduled replay writes only to a disposable local PostgreSQL copy.

## Changes

- Shared `personName` validation covers national intake, official-page verification, merged source records, carried registry rows and readers.
- Both holder lists are deduplicated by office, state and person. Distinct commission seats remain separate. Official values beat Open States; each field uses its own source date.
- Normal publication removes malformed carried rows and consolidates duplicate statewide rows. Old person IDs remain aliases. Candidacy, funding and portrait records attached to those IDs remain available.
- Person resolution and funding lookup follow those aliases. A verified statewide holder no longer waits for its page to explain the election or appointment method. Published contact links are captured from the office page.
- Parser versions advance so standing jobs reparse held data. The registry parser version now has one shared definition. Replaced implementations were removed.
- Official-page parsing now decodes named HTML entities, keeps published accents and middle initials, recognizes short office titles only with their full agency on the same page, and accepts an office landing page’s explicit holder. Directory links alone cannot establish the holder. Fallback discovery follows the requested person or office and avoids unrelated biographies and news archives.
- Duplicate commission members join across source IDs without collapsing the commission’s distinct members or local council namesakes.
- The production-copy replay exposed the indexed inheritance path: change auditing releases prior rows before authority validation. The prior index now keeps only the deterministic statewide selection hashes, so exact merges validate after those rows are released. The replaced raw-row retention code was removed. A regression test also rejects an invented contact even if its supplied hash is changed to match it.

## Production connection traces

1. Reader database `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, role confirmed as `readonly`: current `REGISTRY_RUNTIME_BINDING:US-AZ:reader-registry-runtime`, promoted `2026-10-24T01:14:43.264Z`, contains `statewide:az/ea6ba5142439cff90e79598c`, name **Actions**, office Attorney General, source `https://www.azag.gov/`. The production [Arizona representation response](https://meanwhileusa.com/api/representation/ocd-division/country:us/state:az) returned that same ID and name. The captured [official profile](https://www.azag.gov/kris-mayes) names **Kris Mayes**; the production-data replay verifies and displays her. This does not prove live delivery of the correction.
2. The same read-only database holds `STATE_LEGISLATOR:US-AZ:openstates-people:v1`, promoted `2026-10-24T07:37:13.435Z`. Its Katie Hobbs row, `plural:az:6e522a2a-e7b7-4713-a40f-c897e4341a87`, carries `sosadmin@azsos.gov`, acquired `2026-10-24T06:52:36.135Z` from Open States revision `0360b5d278b84420ba88a238917bb5aaf7f6d6bb`. Production representation carried that email on one governor copy and `engage@az.gov` on another. The saved [governor page](https://azgovernor.gov/) contains Katie Hobbs, `engage@az.gov` and the [constituent services link](https://azgovernor.gov/constituent-services). The replay returns one governor with the official contact and retains both former registry IDs as aliases.

The activity inventory contains 60 references in 37 target groups across reactions, Speak your mind, Ask and demand signals. None targets the malformed Actions ID. The production-data replay retains every prior real statewide holder ID. Resolution of all activity through the deployed application remains unverified.

## Counts for every state

The first count is the actual production representation response, excluding Congress. The second is an offline replay of those rows through the fixed selector, with Kris Mayes verified from the saved official profile. The last column counts people independently verified from saved own-government pages during the separate source acquisition. It can include an officer absent from today’s reader rows; it does not measure the completeness of either list. All 50 replayed states show one governor. The own-page audit verifies governors in 40 states. These are offline results, not a production correction or a Chrome check.

| State | Production before | Offline replay | Governors in replay | Own-page verified |
| --- | ---: | ---: | ---: | ---: |
| AL | 6 | 6 | 1 | 6 |
| AK | 3 | 3 | 1 | 2 |
| AZ | 12 | 11 | 1 | 11 |
| AR | 6 | 6 | 1 | 5 |
| CA | 4 | 4 | 1 | 3 |
| CO | 4 | 4 | 1 | 2 |
| CT | 4 | 4 | 1 | 3 |
| DE | 4 | 4 | 1 | 4 |
| FL | 4 | 4 | 1 | 0 |
| GA | 4 | 4 | 1 | 4 |
| HI | 3 | 3 | 1 | 2 |
| ID | 4 | 4 | 1 | 4 |
| IL | 3 | 3 | 1 | 3 |
| IN | 4 | 4 | 1 | 4 |
| IA | 4 | 4 | 1 | 4 |
| KS | 4 | 4 | 1 | 1 |
| KY | 3 | 3 | 1 | 4 |
| LA | 3 | 3 | 1 | 2 |
| ME | 2 | 2 | 1 | 0 |
| MD | 3 | 3 | 1 | 4 |
| MA | 6 | 6 | 1 | 4 |
| MI | 4 | 4 | 1 | 4 |
| MN | 4 | 4 | 1 | 2 |
| MS | 3 | 3 | 1 | 3 |
| MO | 3 | 3 | 1 | 4 |
| MT | 3 | 3 | 1 | 4 |
| NE | 4 | 4 | 1 | 4 |
| NV | 4 | 4 | 1 | 1 |
| NH | 1 | 1 | 1 | 0 |
| NJ | 3 | 3 | 1 | 3 |
| NM | 3 | 3 | 1 | 3 |
| NY | 3 | 3 | 1 | 4 |
| NC | 3 | 3 | 1 | 3 |
| ND | 4 | 4 | 1 | 4 |
| OH | 4 | 4 | 1 | 1 |
| OK | 3 | 3 | 1 | 4 |
| OR | 3 | 3 | 1 | 2 |
| PA | 4 | 4 | 1 | 2 |
| RI | 4 | 4 | 1 | 4 |
| SC | 4 | 4 | 1 | 4 |
| SD | 4 | 4 | 1 | 2 |
| TN | 2 | 2 | 1 | 1 |
| TX | 4 | 4 | 1 | 3 |
| UT | 3 | 3 | 1 | 3 |
| VT | 4 | 4 | 1 | 0 |
| VA | 3 | 3 | 1 | 2 |
| WA | 4 | 4 | 1 | 4 |
| WV | 2 | 2 | 1 | 2 |
| WI | 3 | 3 | 1 | 2 |
| WY | 3 | 3 | 1 | 1 |
| **Total** | **186** | **185** | **50** | **148** |

All 50 states were acquired separately using the standard statewide acquisition code, production-held Open States profiles and production reader profiles. Raw pages were saved in a local evidence store; no database or remote evidence store was written. A second pass reopened each accepted page by its hash and ran the final verifier: 148 officers passed. Three initially accepted pages (AR John Thurston, PA Dave Sunday and WI Josh Kaul) lacked the final own-page identity binding and remain open. No accepted source is a former legislative profile or a news archive.

Arizona’s 11 verified officers are Katie Hobbs, Kris Mayes, Adrian Fontes, Les Presmyk, Kimberly Yee, Tom Horne, René Lopez, Lea Márquez Peterson, Nick Myers, Kevin Thompson and Rachel Walden. Their own pages are on azgovernor.gov, azag.gov, azsos.gov, asmi.az.gov, aztreasury.gov, azed.gov and azcc.gov. The normal source-publication test also verifies that the accented commissioner names and shortened published titles reach a promoted record.

The source pass also finds New Jersey Secretary of State Shirley U. Emehelu, who is absent from the captured reader list, and confirms Utah’s published names Spencer J. Cox, Derek Brown and Deidre M. Henderson. They have not been published. Florida, Maine, New Hampshire and Vermont still have zero own-page verifications in this pass. Other gaps include inaccessible pages, missing current profile links, non-.gov government sites without saved .gov endorsements, and pages that do not bind the current person to the office. Checking and correcting every statewide officer remains open; a failed source read does not authorize deleting a previously visible real person.

## Next scheduled run

The actual standing `refreshStateBinding` handler was run twice on a local copy of the complete promoted Arizona record, using `PostgresRoutineDataStore` and the real integrity migrations. The copy was read with role `readonly` from reader project `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`:

- Production base: `cv-06d1655dd1d0a7e67fbbcc65e29f0410`, promoted `2026-10-24T01:14:43.264Z`.
- The copied full reader model hashes to the production value `f0fbce7b39258ae59cf5ae6a11ade9cbc6b10fff7b0dce7b00265aef703461b1`. It contains 560 divisions, 734 bodies, 9 body rosters, 85 candidacy rows, 131 portraits and all 53 source reviews.
- First controlled run, October 24 at 2:00 PM EDT (`18:00Z`): promotion `cv-c3b210c60e8d137fd73ecb00f3140945`; registry statewide rows 12 → 10; Actions 1 → 0; Katie Hobbs 2 → 1, with `engage@az.gov`. The malformed Actions candidacy is removed. Every prior real statewide ID remains an alias, and every unrelated civic record retains its exact hash, including portraits and candidacy links.
- The real task clock says the next run is not due one millisecond before its daily cadence and is due at the cadence. The handler runs again on October 25 at 2:00 PM EDT (`18:00Z`), promoting `cv-c8e62ffe98fcfcf42251887b0ca6e776`. Its complete reader-model hash equals the corrected first-run model: Actions remains absent and Hobbs remains once.
- Composing that next-run record with the saved own-page Arizona source roster and the production Open States statewide leads produces 11 officers: **Kris Mayes**, Attorney General, and **one Katie Hobbs** with `engage@az.gov`. Distinct commissioners remain present.

The replay uses saved official Census reference bytes as the injected acquisition response at controlled clock dates. It makes no claim of a future network observation or a real scheduled production run. Additional intake tests reject a later attempt to publish Actions. The production runner and post-release observation belong to River and oversight.

## Validation

- 173 focused tests passed at READY, with none failed, cancelled or skipped. They cover publication, aliases, reader identities, candidacy, funding, portraits, source acquisition, the standing daily refresh and the indexed inheritance regression. The production-copy replay above also passes through the PostgreSQL adapter and real integrity migrations.
- Full `tsc --noEmit`, lint of every changed TypeScript file and `git diff --check` passed. Stale generated Next route types were regenerated or cleared before the compiler check.
- Two broader runner tests fail on both this lane and untouched `origin/river` at `21ae9bcfb`: `the pilot outer bound contains the source and meeting frontier` (line 1449), and `scoped source passes repair only matching reader pointers, including narrow meeting domains` (line 2425). They were not changed in this lane.
- A broader 129-test run had 127 passes and two failures in `campaign-money-people.test.ts`: its card-rendering helper refuses to run without the pinned Chromium build. These are environment failures, not passing browser checks.
- No production Chrome checks were performed. An API response or offline replay is not counted as a live check.

## After-release live checks — River and oversight

Use Chrome on meanwhileusa.com as a reader. Enter each ZIP through the normal “Who governs here?” flow and open the officials’ cards. An API count does not complete these checks.

| ZIP | State | What should show |
| --- | --- | --- |
| 85004 | AZ | Kris Mayes once as Attorney General, matching azag.gov; no Actions row. Katie Hobbs once, with engage@az.gov and the azgovernor.gov constituent-services contact. All five distinct Corporation Commissioners remain. |
| 95814 | CA | Governor Gavin Newsom once. |
| 80203 | CO | Governor Jared Polis once. |
| 30303 | GA | Governor Brian Kemp once. |
| 48933 | MI | Governor Gretchen Whitmer once. |
| 08608 | NJ | Governor Mikie Sherrill once. |
| 12207 | NY | Governor Kathy Hochul once. |
| 17101 | PA | Governor Josh Shapiro once. |
| 78701 | TX | Governor Greg Abbott once. |
| 84111 | UT | Governor Spencer J. Cox once; existing source aliases still resolve. |
| 98501 | WA | Governor Bob Ferguson once. |

Check existing officials’ portraits, contacts and funding links. Follow the prior Arizona governor IDs `statewide:az/9c569bd1e5b6eb90ff6fb207`, `statewide:az/governor` and `plural:az:6e522a2a-e7b7-4713-a40f-c897e4341a87`; they must resolve to the same current person. Check the existing 60 activity references in 37 target groups across reactions, Speak your mind, Ask and demand signals without creating new posts. No real target may stop resolving. Compare the full state lists with the production baseline above; acquisition can add verified officers, and no previously visible real officer or attached fact may disappear.

After the first real scheduled state-binding and statewide people-source passes on the released code, repeat 85004 and the ten governor checks: Actions stays absent, governors stay single, and official contacts continue to beat the stale Open States Secretary of State email. Review source gaps as standing acquisition work; the zero own-page counts above are not claims that those states lack officers.

The existing jobs are `scripts/state-binding-refresh.mts --promote --state=<STATE>` and `scripts/national-people-refresh.mts --promote --state=<state> --source=statewide-executive-sources`. They handle one state through the established data path. No new publication door, approval step or production writer was added. Per Sean’s latest instruction, SO-01 stops when the READY commit is pushed; River and oversight own publication and live acceptance.
