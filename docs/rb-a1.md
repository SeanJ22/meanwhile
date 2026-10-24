# Shared place, work and identity contracts

RB-A1 extends the existing reader entity and alias tables. Reader event ids and event rows are retained. The reader tables are in lib/db/migrations/RB-A1_shared.sql; the control-plane tables are in lib/control-plane/repository/migrations/RB-A1.ts. River numbers the reader migration. The reader migration is contract-phase because it replaces the place primary key and widens the entity-kind check; the control-plane migration is expand-phase.

ZIP delivery areas and Census ZCTAs are separate tables. Each association is keyed by code, place and boundary year. entity_place adds boundary_year to its existing key; year 0 means the old association had no recorded year. Existing inserts that omit a year still work. place_page holds the current JSON body and version for each place. work_row.state is the postal state (US for national work); lease_until and lease_owner are set or cleared together. Its ready index excludes leased and refused rows; consumers also filter not_before. count_hour is keyed by state, hour and step. Public TypeScript contracts are in lib/core/shapes.ts.

resolveId reads one existing entity or exact alias, accepts raw and fec-prefixed FEC ids, congressional person keys and raw meeting ids, returns null for an unknown id and raises on ambiguous aliases. Reconciliation reuses the held FEC target crosswalk; an exact source target takes precedence over another source's native-id spelling. It adds vote_event identities for House/Senate roll-call keys and measure_provision identities for measure fragments. Saved aliases survive source refreshes. A missing congressional person uses the existing importer's congress-api id, so a later import reuses it. Future-id tests cover all Speak subject kinds, new FEC crosswalks, later Congresses and new measure fragments. The ordinary scheduled fact-maintenance pass invokes the same reconciliation and reports its resolved count in the existing runner log. Reader event writers are unchanged. The candidate target lookup also retains previously accepted keys through their exact saved entity when a later ballot renames a ticket, within the same state.

The existing River step-id parser now recognizes RB-A1 through RB-A11, so the shared lane and its downstream rebuild lanes retain their step ids when folded.

## Production connections

Reader: tiny-hill-13996172 / br-delicate-lab-ax02xuo5 / neondb / readonly. SELECT allowed, INSERT/UPDATE/DELETE denied. Real data: 104,047 place entities and 56 reaction rows. Snapshot at 2026-10-24T08:55:19.116856+00:00.

Control plane: withered-sunset-39821877 / br-tiny-frog-aeufpjeq / neondb / wtp_cp_release_readonly. SELECT allowed, INSERT/UPDATE/DELETE denied. Real data at 2026-10-24T09:06:21.683415+00:00: 161,846 work items and 328,791 box findings. All production database queries used the specified read-only roles.

## Focused checks

A local reader copy uses the production table definitions and every event row, its related entities, aliases and place links (38 existing entities, 76 aliases, 29 place links; 56 reactions, 1 Ask, 3 demand, 0 Speak). Production's named NOT NULL catalog entries were represented as column NOT NULL for the local Postgres version. Both migrations apply to their isolated copies. All 36 distinct event ids (38 table/type/id references) resolve exactly once. Existing copied entity rows and all event rows remain. The six FEC ids add six aliases, reusing five people and adding the missing Mark Kelly entity from its exact source id. Seven vote events, three provisions and their two measures are added.

A controlled next maintenance invocation preserves the mappings; adding a later-congress roll call then invoking the same maintenance function resolves it. The next control-plane migration invocation performs zero writes. This verifies repeat behavior; the automatic production pass is addressed in the production verification below.

Identity/schema/Admin tests, control-plane migration tests, migration-order checks, reaction tests, TypeScript, focused lint and unused-code checks passed. The actual local reaction handler recognizes all 17 saved candidate ids against the committed ballots and copied governor aliases. Its off-scale test value returns before any event write. The test first caught two rejected governor keys after combined tickets changed; the candidate lookup now preserves them. The baseline production ballots for 85701 (AZ), 03255 (NH) and 80202 (CO) were opened in Chromium 151 with certificate validation enabled. All 17 saved candidate targets were found on the pages, and a battlecard opened in each state. Candidate controls were usable in 1,402 / 1,772 / 2,029 ms. AZ and NH kept the November 3 election date; CO had no such date at baseline. Automatic browser POSTs were intercepted during these read-only checks. Live reaction POST probes were rejected by automatic approval review under the read-only rule and were not executed. Post-deployment results follow.

## Production verification after shipping

Reader migration 0051 is applied. At 2026-10-24T18:11:59.203718Z, role readonly on tiny-hill-13996172 / br-delicate-lab-ax02xuo5 / neondb read 104,048 places, 56 reactions, 4 Ask rows, 3 demand signals and 0 Speak posts. All 36 distinct referenced ids resolve exactly once; all 17 saved candidate ids resolve. Three new Ask rows have empty subject-id arrays, so there remains one Ask subject reference. A separate event-id comparison against the original production snapshot found zero lost rows in each table. SELECT is allowed; INSERT/UPDATE/DELETE on entity are denied.

At 2026-10-24T18:11:53.995Z, role wtp_cp_release_readonly on withered-sunset-39821877 / br-tiny-frog-aeufpjeq / neondb read 180,916 real work items and 360,007 box findings. RB-A1_expand has exactly one migration entry. work_row and count_hour exist and are readable; the checked write privileges are denied.

At 18:12–18:14 UTC, Chromium 151 opened meanwhileusa.com/ballot for AZ 85701, NH 03255 and CO 80202 with TLS validation and all POSTs intercepted. Candidate controls were usable in 2,443 / 2,711 / 2,616 ms and a battlecard opened in each state. All three pages show the November 3 election date. All eight previously referenced Arizona candidates remain visible under current candidate keys; NH and CO retain the original nine keys. The saved Arizona keys remain exact aliases. River's board reports that reacting to renamed candidates works again after 0051. My direct live POST probes were rejected by automatic approval review under the read-only rule and were not executed. The authenticated Admin display remains River's live check; the public host correctly hides its API with 404.

The next full ordinary scheduled cycle after migration ran from 2026-10-24T18:17:25.721Z to 18:40:47.620Z on release 99 (388d02c51c7ffc88f3c26bb9ee9502b83614c4c0), with 558 attempted tasks. Its complete failure-code aggregate has no READER_ENTITY_IDS_FAILED or FACT_MAINTENANCE_FAILED. Other tasks failed (7 RECEIPT_COUNT_INVALID, 219 MEETING_PARTITION_READ_FAILED, 1 PUBLICATION_INPUT_CLOCK_UNREAD, 5 CHILD_EXIT_CONTRADICTED_PARTITION_RECEIPT); the whole cycle is not claimed to pass. A read-only production check at 18:48:43.391Z, after that scheduled pass, again resolves all 36 distinct ids, including all 17 candidate ids, with zero unresolved ids and the same event row counts (56 reactions, 4 Ask, 3 demand, 0 Speak).

The original scoped-copy migration check missed the production runner's one-second statement limit. River reproduced the full-size index cost and shipped RV-0051 in release 99, giving this established migration a ten-second statement budget while retaining the lock wait. The migration SQL was not rewritten.

## Remaining live check — River

The implementation and production verification above are live through release 102 (4ae2e14e6); the evidence update was 1d6df41d9. After release 101's candidate changes, a further read-only check at 2026-10-24T19:56:53.089Z still resolved all 36 ids, including all 17 saved candidate ids, with zero unresolved ids.

The lane remains open for River to verify the authenticated Admin Data screen's “Record aliases by state” table (all 56 jurisdictions plus National) and the live reaction endpoint for all 17 saved candidate targets in tests/rb-a1-reactions.test.ts. River's board currently confirms the renamed-candidate case; my direct live POST probes were rejected by automatic approval review under the read-only rule. The user's stop condition is for board/river status.md to say RB-A1 passed its live check. The lane continues its 20-minute return/status watch until that result is recorded.

## Counts by every state and territory

Counts below are live after migration at 2026-10-24T18:11:59.203718Z. Ask refs counts subject references rather than rows with empty subject lists. All 56 jurisdictions plus US are included. Alias total: 593,217.

| State | Reactions | Ask refs | Demand | Speak | Unresolved | Aliases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AK | 0 | 0 | 0 | 0 | 0 | 1,985 |
| AL | 0 | 0 | 0 | 0 | 0 | 4,200 |
| AR | 0 | 0 | 0 | 0 | 0 | 5,016 |
| AS | 0 | 0 | 0 | 0 | 0 | 144 |
| AZ | 25 | 1 | 3 | 0 | 0 | 4,065 |
| CA | 0 | 0 | 0 | 0 | 0 | 28,386 |
| CO | 5 | 0 | 0 | 0 | 0 | 9,073 |
| CT | 0 | 0 | 0 | 0 | 0 | 87,178 |
| DC | 0 | 0 | 0 | 0 | 0 | 201 |
| DE | 0 | 0 | 0 | 0 | 0 | 1,405 |
| FL | 0 | 0 | 0 | 0 | 0 | 11,473 |
| GA | 0 | 0 | 0 | 0 | 0 | 5,527 |
| GU | 0 | 0 | 0 | 0 | 0 | 79 |
| HI | 0 | 0 | 0 | 0 | 0 | 28,749 |
| IA | 0 | 0 | 0 | 0 | 0 | 6,137 |
| ID | 0 | 0 | 0 | 0 | 0 | 2,946 |
| IL | 0 | 0 | 0 | 0 | 0 | 16,971 |
| IN | 0 | 0 | 0 | 0 | 0 | 6,516 |
| KS | 0 | 0 | 0 | 0 | 0 | 7,756 |
| KY | 0 | 0 | 0 | 0 | 0 | 78,919 |
| LA | 0 | 0 | 0 | 0 | 0 | 2,678 |
| MA | 0 | 0 | 0 | 0 | 0 | 3,917 |
| MD | 0 | 0 | 0 | 0 | 0 | 3,366 |
| ME | 0 | 0 | 0 | 0 | 0 | 3,799 |
| MI | 0 | 0 | 0 | 0 | 0 | 8,884 |
| MN | 0 | 0 | 0 | 0 | 0 | 10,299 |
| MO | 0 | 0 | 0 | 0 | 0 | 12,028 |
| MP | 0 | 0 | 0 | 0 | 0 | 221 |
| MS | 0 | 0 | 0 | 0 | 0 | 3,193 |
| MT | 0 | 0 | 0 | 0 | 0 | 3,807 |
| NC | 0 | 0 | 0 | 0 | 0 | 5,653 |
| ND | 0 | 0 | 0 | 0 | 0 | 6,771 |
| NE | 0 | 0 | 0 | 0 | 0 | 5,494 |
| NH | 8 | 0 | 0 | 0 | 0 | 3,423 |
| NJ | 1 | 0 | 0 | 0 | 0 | 4,936 |
| NM | 0 | 0 | 0 | 0 | 0 | 4,221 |
| NV | 0 | 0 | 0 | 0 | 0 | 1,982 |
| NY | 0 | 0 | 0 | 0 | 0 | 9,901 |
| OH | 0 | 0 | 0 | 0 | 0 | 9,412 |
| OK | 0 | 0 | 0 | 0 | 0 | 5,437 |
| OR | 0 | 0 | 0 | 0 | 0 | 3,871 |
| PA | 0 | 0 | 0 | 0 | 0 | 12,076 |
| PR | 0 | 0 | 0 | 0 | 0 | 1,734 |
| RI | 0 | 0 | 0 | 0 | 0 | 1,111 |
| SC | 0 | 0 | 0 | 0 | 0 | 89,746 |
| SD | 0 | 0 | 0 | 0 | 0 | 4,786 |
| TN | 0 | 0 | 0 | 0 | 0 | 3,853 |
| TX | 0 | 0 | 0 | 0 | 0 | 18,049 |
| US | 17 | 0 | 0 | 0 | 0 | 0 |
| UT | 0 | 0 | 0 | 0 | 0 | 2,265 |
| VA | 0 | 0 | 0 | 0 | 0 | 4,717 |
| VI | 0 | 0 | 0 | 0 | 0 | 105 |
| VT | 0 | 0 | 0 | 0 | 0 | 2,588 |
| WA | 0 | 0 | 0 | 0 | 0 | 6,470 |
| WI | 0 | 0 | 0 | 0 | 0 | 20,977 |
| WV | 0 | 0 | 0 | 0 | 0 | 2,528 |
| WY | 0 | 0 | 0 | 0 | 0 | 2,193 |
