# SO-01 — in progress, not READY

Code is implemented and tested locally. Production has not been republished, Chrome has not been checked, and River has not passed this lane.

Branch `stream/so-01` was cut from `origin/river` at `21ae9bcfb663794953b07a9d7977b228cab67c2d`. No changes to `SeanJ22/meanwhile-signal`. No database writes, deployments, settings changes or pull requests.

## Changes

- Shared `personName` validation covers national intake, official-page verification, merged source records, carried registry rows and readers.
- Both holder lists are deduplicated by office, state and person. Distinct commission seats remain separate. Official values beat Open States; each field uses its own source date.
- Normal publication removes malformed carried rows and consolidates duplicate statewide rows. Old person IDs remain aliases. Candidacy, funding and portrait records attached to those IDs remain available.
- Person resolution and funding lookup follow those aliases. A verified statewide holder no longer waits for its page to explain the election or appointment method. Published contact links are captured from the office page.
- Parser versions advance so standing jobs reparse held data. The registry parser version now has one shared definition. Replaced implementations were removed.
- Official-page parsing now decodes named HTML entities, keeps published accents and middle initials, recognizes short office titles only with their full agency on the same page, and accepts an office landing page’s explicit holder. Directory links alone cannot establish the holder. Fallback discovery follows the requested person or office and avoids unrelated biographies and news archives.
- Duplicate commission members join across source IDs without collapsing the commission’s distinct members or local council namesakes.

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

Controlled-clock tests exercise the actual daily state-binding task, its due decision and its publication handler. They remove a carried malformed row, advance to the next daily run, retain the correction and reject another attempt to publish Actions. Duplicate-record tests retain the other ID’s candidacy and portrait records.

The next production scheduled run is unverified. The read-only control-plane check (`withered-sunset-39821877`, `br-tiny-frog-aeufpjeq`, role `wtp_cp_release_readonly`) found statewide source tasks deferred on release `16eead35c` with `PASS_TIME_BUDGET` at `2026-10-24T09:03:25Z`. Local tests do not resolve that delivery issue.

## Validation

- 146 focused tests passed, with none failed, cancelled or skipped. After the final commission and acquisition changes, the affected suites passed again: 40 identity/publication/funding tests and 53 source/publication/HTTP tests. They cover publication, aliases, reader identities, candidacy, funding, portraits, source acquisition and the standing daily refresh.
- Full `tsc --noEmit`, lint of every changed TypeScript file and `git diff --check` passed. Stale generated Next route types were regenerated or cleared before the compiler check.
- Two broader runner tests fail on both this lane and untouched `origin/river` at `21ae9bcfb`: `the pilot outer bound contains the source and meeting frontier` (line 1449), and `scoped source passes repair only matching reader pointers, including narrow meeting domains` (line 2425). They were not changed in this lane.
- A broader 129-test run had 127 passes and two failures in `campaign-money-people.test.ts`: its card-rendering helper refuses to run without the pinned Chromium build. These are environment failures, not passing browser checks.
- No production Chrome checks were performed. An API response or offline replay is not counted as a live check.

## Remaining work and access limits

Owner: SO-01 / Codex. Finish the official-page discrepancies; republish every state through the existing state-binding and people-source jobs; check reader-visible content and the current activity IDs in Chrome; observe the next production run. Only then push the lane’s READY and begin the requested River return cycle.

The existing publication command refuses before any write because `WTP_PRODUCTION_DATABASE_URL_WRITE` is absent. Both connected database roles are read-only. No Chrome/browser-control tool is exposed in this session; discovery was repeated and the browser skill was read. No connected alternate publication workflow was found among the GitHub workflows. `origin/board/river` was checked again at `f3974cd5b`; no SO-01 return or live-check pass is present. The lane has not sent READY, so the post-READY return cycle has not begun. These are access limits, not a new approval requirement.

Existing job entry points: `scripts/state-binding-refresh.mts --promote --state=<STATE>` and `scripts/national-people-refresh.mts --promote --state=<state> --source=statewide-executive-sources`. Each handles one state through the established production data path. No new publication door or approval step was added.
