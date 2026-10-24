# SO-01 — in progress, not READY

Code is implemented and tested locally. Production has not been republished, Chrome has not been checked, and River has not passed this lane.

Branch `stream/so-01` was cut from `origin/river` at `21ae9bcfb663794953b07a9d7977b228cab67c2d`. No changes to `SeanJ22/meanwhile-signal`. No database writes, deployments, settings changes or pull requests.

## Changes

- Shared `personName` validation covers national intake, official-page verification, merged source records, carried registry rows and readers.
- Both holder lists are deduplicated by office, state and person. Distinct commission seats remain separate. Official values beat Open States; each field uses its own source date.
- Normal publication removes malformed carried rows and consolidates duplicate statewide rows. Old person IDs remain aliases. Candidacy, funding and portrait records attached to those IDs remain available.
- Person resolution and funding lookup follow those aliases. A verified statewide holder no longer waits for its page to explain the election or appointment method. Published contact links are captured from the office page.
- Parser versions advance so standing jobs reparse held data. The registry parser version now has one shared definition. Replaced implementations were removed.

## Production connection traces

1. Reader database `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, role confirmed as `readonly`: current `REGISTRY_RUNTIME_BINDING:US-AZ:reader-registry-runtime`, promoted `2026-10-24T01:14:43.264Z`, contains `statewide:az/ea6ba5142439cff90e79598c`, name **Actions**, office Attorney General, source `https://www.azag.gov/`. The production [Arizona representation response](https://meanwhileusa.com/api/representation/ocd-division/country:us/state:az) returned that same ID and name. The captured [official profile](https://www.azag.gov/kris-mayes) names **Kris Mayes**; the production-data replay verifies and displays her. This does not prove live delivery of the correction.
2. The same read-only database holds `STATE_LEGISLATOR:US-AZ:openstates-people:v1`, promoted `2026-10-24T07:37:13.435Z`. Its Katie Hobbs row, `plural:az:6e522a2a-e7b7-4713-a40f-c897e4341a87`, carries `sosadmin@azsos.gov`, acquired `2026-10-24T06:52:36.135Z` from Open States revision `0360b5d278b84420ba88a238917bb5aaf7f6d6bb`. Production representation carried that email on one governor copy and `engage@az.gov` on another. The saved [governor page](https://azgovernor.gov/) contains Katie Hobbs, `engage@az.gov` and the [constituent services link](https://azgovernor.gov/constituent-services). The replay returns one governor with the official contact and retains both former registry IDs as aliases.

The activity inventory contains 60 references in 37 target groups across reactions, Speak your mind, Ask and demand signals. None targets the malformed Actions ID. The production-data replay retains every prior real statewide holder ID. Resolution of all activity through the deployed application remains unverified.

## Counts for every state

The first count is the actual production representation response, excluding Congress. The second is an offline replay of those rows through the fixed selector, with Kris Mayes verified from the saved official profile. These are reader-row counts, not complete verified-office coverage. All 50 replayed states show one governor.

| State | Production before | Offline replay | Governors in replay |
| --- | ---: | ---: | ---: |
| AL | 6 | 6 | 1 |
| AK | 3 | 3 | 1 |
| AZ | 12 | 11 | 1 |
| AR | 6 | 6 | 1 |
| CA | 4 | 4 | 1 |
| CO | 4 | 4 | 1 |
| CT | 4 | 4 | 1 |
| DE | 4 | 4 | 1 |
| FL | 4 | 4 | 1 |
| GA | 4 | 4 | 1 |
| HI | 3 | 3 | 1 |
| ID | 4 | 4 | 1 |
| IL | 3 | 3 | 1 |
| IN | 4 | 4 | 1 |
| IA | 4 | 4 | 1 |
| KS | 4 | 4 | 1 |
| KY | 3 | 3 | 1 |
| LA | 3 | 3 | 1 |
| ME | 2 | 2 | 1 |
| MD | 3 | 3 | 1 |
| MA | 6 | 6 | 1 |
| MI | 4 | 4 | 1 |
| MN | 4 | 4 | 1 |
| MS | 3 | 3 | 1 |
| MO | 3 | 3 | 1 |
| MT | 3 | 3 | 1 |
| NE | 4 | 4 | 1 |
| NV | 4 | 4 | 1 |
| NH | 1 | 1 | 1 |
| NJ | 3 | 3 | 1 |
| NM | 3 | 3 | 1 |
| NY | 3 | 3 | 1 |
| NC | 3 | 3 | 1 |
| ND | 4 | 4 | 1 |
| OH | 4 | 4 | 1 |
| OK | 3 | 3 | 1 |
| OR | 3 | 3 | 1 |
| PA | 4 | 4 | 1 |
| RI | 4 | 4 | 1 |
| SC | 4 | 4 | 1 |
| SD | 4 | 4 | 1 |
| TN | 2 | 2 | 1 |
| TX | 4 | 4 | 1 |
| UT | 3 | 3 | 1 |
| VT | 4 | 4 | 1 |
| VA | 3 | 3 | 1 |
| WA | 4 | 4 | 1 |
| WV | 2 | 2 | 1 |
| WI | 3 | 3 | 1 |
| WY | 3 | 3 | 1 |
| **Total** | **186** | **185** | **50** |

All states were collected separately. The preliminary government-page pass saved pages and found the displayed name and office text for 97 of 186 rows. Text matching alone does not establish current officeholding. The remaining rows still need review, including former legislative profile links in SD, UT, TX and VA, missing websites, and pages returning 403 or 404. Checking every officer against its own government remains open.

## Next scheduled run

Controlled-clock tests exercise the actual daily state-binding task, its due decision and its publication handler. They remove a carried malformed row, advance to the next daily run, retain the correction and reject another attempt to publish Actions. Duplicate-record tests retain the other ID’s candidacy and portrait records.

The next production scheduled run is unverified. The read-only control-plane check (`withered-sunset-39821877`, `br-tiny-frog-aeufpjeq`, role `wtp_cp_release_readonly`) found statewide source tasks deferred on release `16eead35c` with `PASS_TIME_BUDGET` at `2026-10-24T09:03:25Z`. Local tests do not resolve that delivery issue.

## Validation

- 132 focused tests passed, with none failed, cancelled or skipped. They cover publication, aliases, reader identities, candidacy, funding, portraits, source acquisition and the standing daily refresh.
- Full `tsc --noEmit`, lint of every changed TypeScript file and `git diff --check` passed. Stale generated Next route types were regenerated or cleared before the compiler check.
- Two broader runner tests fail on both this lane and untouched `origin/river` at `21ae9bcfb`: `the pilot outer bound contains the source and meeting frontier` (line 1449), and `scoped source passes repair only matching reader pointers, including narrow meeting domains` (line 2425). They were not changed in this lane.
- No production Chrome checks were performed. An API response or offline replay is not counted as a live check.

## Remaining work and access limits

Owner: SO-01 / Codex. Finish the official-page discrepancies; republish every state through the existing state-binding and people-source jobs; check reader-visible content and the current activity IDs in Chrome; observe the next production run. Only then push the lane’s READY and begin the requested River return cycle.

The existing publication command refuses before any write because `WTP_PRODUCTION_DATABASE_URL_WRITE` is absent. Both connected database roles are read-only. No Chrome/browser-control tool is exposed in this session; discovery was repeated and the browser skill was read. No connected alternate publication workflow was found among the GitHub workflows. These are access limits, not a new approval requirement.

Existing job entry points: `scripts/state-binding-refresh.mts --promote --state=<STATE>` and `scripts/national-people-refresh.mts --promote --state=<state> --source=statewide-executive-sources`. Each handles one state through the established production data path. No new publication door or approval step was added.
