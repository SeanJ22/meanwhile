# Shared place, work and identity contracts

RB-A1 extends the existing reader entity and alias tables. Reader event ids and event rows are retained. The reader tables are in lib/db/migrations/RB-A1_shared.sql; the control-plane tables are in lib/control-plane/repository/migrations/RB-A1.ts. River numbers the reader migration. The reader migration is contract-phase because it replaces the place primary key and widens the entity-kind check; the control-plane migration is expand-phase.

ZIP delivery areas and Census ZCTAs are separate tables. Each association is keyed by code, place and boundary year. entity_place adds boundary_year to its existing key; year 0 means the old association had no recorded year. Existing inserts that omit a year still work. place_page holds the current JSON body and version for each place. work_row.state is the postal state (US for national work); lease_until and lease_owner are set or cleared together. Its ready index excludes leased and refused rows; consumers also filter not_before. count_hour is keyed by state, hour and step. Public TypeScript contracts are in lib/core/shapes.ts.

resolveId reads one existing entity or exact alias, accepts raw and fec-prefixed FEC ids, returns null for an unknown id and raises on ambiguous aliases. Reconciliation reuses the held FEC target crosswalk; an exact source target takes precedence over another source's native-id spelling. It adds vote_event identities for House/Senate roll-call keys and measure_provision identities for measure fragments. Saved aliases survive source refreshes. The ordinary scheduled fact-maintenance pass invokes the same reconciliation and reports its resolved count in the existing runner log. Reader event writers are unchanged. The candidate target lookup also retains previously accepted keys through their exact saved entity when a later ballot renames a ticket, within the same state.

## Production connections

Reader: tiny-hill-13996172 / br-delicate-lab-ax02xuo5 / neondb / readonly. SELECT allowed, INSERT/UPDATE/DELETE denied. Real data: 104,047 place entities and 56 reaction rows. Snapshot at 2026-10-24T08:55:19.116856+00:00.

Control plane: withered-sunset-39821877 / br-tiny-frog-aeufpjeq / neondb / wtp_cp_release_readonly. SELECT allowed, INSERT/UPDATE/DELETE denied. Real data at 2026-10-24T09:06:21.683415+00:00: 161,846 work items and 328,791 box findings. No production writes were made.

## Focused checks

A local reader copy uses the production table definitions and every event row, its related entities, aliases and place links (38 existing entities, 76 aliases, 29 place links; 56 reactions, 1 Ask, 3 demand, 0 Speak). Production's named NOT NULL catalog entries were represented as column NOT NULL for the local Postgres version. Both migrations apply to their isolated copies. All 36 distinct event ids (38 table/type/id references) resolve exactly once. Existing copied entity rows and all event rows remain. The six FEC ids add six aliases, reusing five people and adding the missing Mark Kelly entity from its exact source id. Seven vote events, three provisions and their two measures are added.

A controlled next maintenance invocation preserves the mappings; adding a later-congress roll call then invoking the same maintenance function resolves it. The next control-plane migration invocation performs zero writes. This verifies repeat behavior; the first automatic production pass after shipping remains a live check.

Identity/schema/Admin tests, control-plane migration tests, migration-order checks, reaction tests, TypeScript, focused lint and unused-code checks passed. The actual local reaction handler recognizes all 17 saved candidate ids against the committed ballots and copied governor aliases. Its off-scale test value returns before any event write. The test first caught two rejected governor keys after combined tickets changed; the candidate lookup now preserves them. The production ballots for 85701 (AZ), 03255 (NH) and 80202 (CO) were opened in Chromium 151 with certificate validation enabled. All 17 saved candidate targets were found on the pages, and a battlecard opened in each state. Candidate controls were usable in 1,402 / 1,772 / 2,029 ms. AZ and NH kept the November 3 election date; CO had no such date at baseline. Automatic browser POSTs were intercepted during these read-only checks. Live reaction POST probes were rejected by automatic approval review under the read-only rule and were not executed. Deployment, the next automatic production pass, the production Admin counts and the post-deploy endpoint behavior remain for the live check.

## Counts by every state and territory

Event counts below are the subject entity's state after reconciliation on the reader copy; national roll calls are US. All event ids resolve, including the state rows with zero events. Alias counts are the live pre-migration production reading at 2026-10-24T09:12:31.443Z; applying RB-A1 adds AZ 2, NH 3, NJ 1.

| State | Reactions | Ask | Demand | Speak | Unresolved | Existing aliases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AK | 0 | 0 | 0 | 0 | 0 | 1,950 |
| AL | 0 | 0 | 0 | 0 | 0 | 4,168 |
| AR | 0 | 0 | 0 | 0 | 0 | 5,005 |
| AS | 0 | 0 | 0 | 0 | 0 | 144 |
| AZ | 25 | 1 | 3 | 0 | 0 | 4,041 |
| CA | 0 | 0 | 0 | 0 | 0 | 28,373 |
| CO | 5 | 0 | 0 | 0 | 0 | 9,055 |
| CT | 0 | 0 | 0 | 0 | 0 | 86,831 |
| DC | 0 | 0 | 0 | 0 | 0 | 201 |
| DE | 0 | 0 | 0 | 0 | 0 | 1,393 |
| FL | 0 | 0 | 0 | 0 | 0 | 11,227 |
| GA | 0 | 0 | 0 | 0 | 0 | 5,497 |
| GU | 0 | 0 | 0 | 0 | 0 | 79 |
| HI | 0 | 0 | 0 | 0 | 0 | 28,745 |
| IA | 0 | 0 | 0 | 0 | 0 | 6,123 |
| ID | 0 | 0 | 0 | 0 | 0 | 2,927 |
| IL | 0 | 0 | 0 | 0 | 0 | 16,967 |
| IN | 0 | 0 | 0 | 0 | 0 | 6,484 |
| KS | 0 | 0 | 0 | 0 | 0 | 7,755 |
| KY | 0 | 0 | 0 | 0 | 0 | 78,870 |
| LA | 0 | 0 | 0 | 0 | 0 | 2,678 |
| MA | 0 | 0 | 0 | 0 | 0 | 3,917 |
| MD | 0 | 0 | 0 | 0 | 0 | 3,363 |
| ME | 0 | 0 | 0 | 0 | 0 | 3,799 |
| MI | 0 | 0 | 0 | 0 | 0 | 8,884 |
| MN | 0 | 0 | 0 | 0 | 0 | 10,089 |
| MO | 0 | 0 | 0 | 0 | 0 | 12,028 |
| MP | 0 | 0 | 0 | 0 | 0 | 221 |
| MS | 0 | 0 | 0 | 0 | 0 | 3,185 |
| MT | 0 | 0 | 0 | 0 | 0 | 3,805 |
| NC | 0 | 0 | 0 | 0 | 0 | 5,653 |
| ND | 0 | 0 | 0 | 0 | 0 | 6,751 |
| NE | 0 | 0 | 0 | 0 | 0 | 5,494 |
| NH | 8 | 0 | 0 | 0 | 0 | 3,420 |
| NJ | 1 | 0 | 0 | 0 | 0 | 4,935 |
| NM | 0 | 0 | 0 | 0 | 0 | 4,214 |
| NV | 0 | 0 | 0 | 0 | 0 | 1,982 |
| NY | 0 | 0 | 0 | 0 | 0 | 9,901 |
| OH | 0 | 0 | 0 | 0 | 0 | 9,410 |
| OK | 0 | 0 | 0 | 0 | 0 | 5,423 |
| OR | 0 | 0 | 0 | 0 | 0 | 3,859 |
| PA | 0 | 0 | 0 | 0 | 0 | 12,062 |
| PR | 0 | 0 | 0 | 0 | 0 | 1,734 |
| RI | 0 | 0 | 0 | 0 | 0 | 1,111 |
| SC | 0 | 0 | 0 | 0 | 0 | 89,736 |
| SD | 0 | 0 | 0 | 0 | 0 | 4,786 |
| TN | 0 | 0 | 0 | 0 | 0 | 3,847 |
| TX | 0 | 0 | 0 | 0 | 0 | 18,049 |
| US | 17 | 0 | 0 | 0 | 0 | 0 |
| UT | 0 | 0 | 0 | 0 | 0 | 2,265 |
| VA | 0 | 0 | 0 | 0 | 0 | 4,717 |
| VI | 0 | 0 | 0 | 0 | 0 | 105 |
| VT | 0 | 0 | 0 | 0 | 0 | 2,588 |
| WA | 0 | 0 | 0 | 0 | 0 | 6,313 |
| WI | 0 | 0 | 0 | 0 | 0 | 20,977 |
| WV | 0 | 0 | 0 | 0 | 0 | 2,528 |
| WY | 0 | 0 | 0 | 0 | 0 | 2,181 |
