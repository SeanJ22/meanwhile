# RB-A8 — Hourly counts

On `stream/rb-a8`, with current River `90d0f445e` and RV-LOCK `94e9053e8` merged. RB-A1's shared migration (`5bde46615`) is recorded in River's integration log and is contained in `origin/river`. The earlier READY `fb1783a62` passed all nine checks and merged into release 107, but its production migration deadlocked and rolled back at 9:47 PM EDT October 24. Release 106 remains live. The correction below has passed its focused checks; the full checks are running again. Production rollout, the actual automatic hourly invocation and River's Chrome Admin live pass remain pending.

## Production migration deadlock

The failed migration held `fact` while waiting for `entity`; a runner transaction held `entity` while waiting for `fact`. RV-LOCK's single blocking multi-table `LOCK` still acquires the tables sequentially. Both cases reproduce PostgreSQL error `40P01` on native PostgreSQL 18.4, using separate writer, migration and observer connections.

The migration runner now uses `NOWAIT` inside an exception subtransaction. Any conflicting table rolls back every partial lock before sleeping; acquisition retries for at most ten seconds before returning the actual error. The successful attempt retains all four existing source/counter table locks through the atomic baseline and trigger installation. Reader SELECTs remain compatible. The committed migration SQL and its journal hash remain unchanged.

The [native copy evidence](measurements/rb-a8/migration-lock-copy.json) passes writers taking entity then fact, fact then entity, and the existing counter table then entity. Every writer and migration commits, the observer sees zero partial locks while waiting, reader SELECTs finish within 500 ms, and every stored stock dimension equals direct SQL after the complete original 19-statement migration. The reproducible script creates and removes its own local database and never reads production connection settings: `node --import tsx scripts/rb-a8-migration-lock-copy.mjs 55438` against a local PostgreSQL server with role `rb_a8_copy`.

Writer transactions update `count_hour` for every fact family, publication pointer, cache invalidation, door and work-list change. The keeper reads counters and grouped oldest ages; Admin shows state, family, step and Eastern hour, including the oldest wait. Counting starts after every hook and baseline is installed, so the first partial hour is unknown. Timestamp-only rechecks add no movement. Unique door totals and their family breakdown are separate. Growth is compared with both known hour-end totals, including fresh work after an earlier pile clears.

The deploy initializer takes a first reading. The independent Netlify schedule is five minutes past every hour, in both EDT and EST. Runs update the existing owned fix list and daily brief, delete `line-keeper:current` without loading its inventory, and retain at most three small checkpoints. Admin says when the keeper stops reporting. Spending limits, pauses and reader target IDs are preserved.

## River return resolved

The shared fact-table hooks are the one fact counter source for both the door and compatibility publishers. RB-A3's extra increments and separate hour table are deleted. Its publisher, official/checked source handling, rebuild requests, blank reasons and sources remain. A real local Postgres test covers new and compatibility calls, a replacement, a later recheck and an exact replay without duplicate arrivals.

The scoreboard reads native vital signs, existing blank reasons and the native runner heartbeat for its existing health rows. The full reading retains its readiness witnesses. Those unrelated readings are not put back into the keeper's compact state. RB-A5's completed work counts as done; a delayed retry stays scheduled rather than becoming a terminal refusal. RB-A1 lease/timer behavior is retained. A5's completion-history measures remain distinct from current work stock.

All four identity domains are retained: `place_map_counts`, `place_boundary`, `count_hour` and `line_keeper_run`. Reader migrations remain dated and the pending A8 entry has a unique timestamp after A3/A2. The seven control-plane migrations are ordered CP-01, DT-01, RB-A1, RIVER-KEYS, RIVER-KEYS-FX, RB-A5, RB-A8. Existing definitions and hashes are unchanged; the pending A8 definition is refreshed for the merged work schema.

## Production connection proofs

Only the requested read-only roles were used: reader project `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, role `readonly`; control plane `withered-sunset-39821877`, branch `br-tiny-frog-aeufpjeq`, role `wtp_cp_release_readonly`. Both connections deny INSERT and UPDATE on their checked tables.

1. The real Tucson Parks Connections door points to `MEETING` publication `cv-9ae69ffd18df730d6e995424f31e95b2`. Its encoded scope retains AZ in the real-input counter copy. Chrome 151 on meanwhileusa.com, ZIP 85701, selected the Parks Commission at 7:32 PM EDT in 211 ms and showed two meetings. At 7:29 PM EDT, the production reader query counted 513,545 live facts and 21,607 publication pointers across all 57 buckets.
2. Fact 1711517 names Tucson Unified's Audit Committee; real facts 1711494-1711500 exercise live, held and superseded counts on the copy without changing reader rows. Chrome selected that Audit Committee at 7:32 PM EDT in 212 ms and showed three meetings. Both selections had no page errors. The separate control-plane query at 7:29 PM EDT counted 11,718 unique doors and 182,357 currently waiting legacy work segments. The shared work table exists with zero rows; A5's status columns are not deployed at this capture.

The actual reader adapter also connects through the production pooler as `readonly`, with read-only mode on; its recorded query counted 271,352 subjects. The release-98 pool startup fix is retained.

## Reader preservation

Production read-only SQL at 7:30 PM EDT resolves all 60 stored event references: 56 reactions, one Ask and three demand signals, with zero unresolved references. Speak has no stored posts. This lane rewrites no reader target IDs. The Chrome connection checks above use the real production pages with writes blocked.

The Phoenix 85003 walk found that a partial state publication had hidden known dates before RB-A8 was deployed. After another 15 seconds, the page still omitted the October 5 registration deadline and July 21 held primary. The native calendar used only the new projection while the page suppressed its existing sourced calendar as soon as any state navigation was published.

The shared date selector now retains previously sourced dates for the same state and election cycle when the current publication omits that topic. A supplied date or explicit no-date rule replaces the earlier value. Each retained date keeps its provenance; the election-day heading supplies the day without a duplicate list entry. The published Arizona projection was captured through `readonly` at 4:19 PM EDT and rendered through the actual ballot component in a local copy. Chrome showed the newer October 7–30 and October 23 dates plus the retained July 21 and October 5 dates, and removed the false missing-deadline message. The focused reader and migration checks pass. Production verification of the repair remains pending until deployment.


## Next-run proof

On the merged real-input PGlite copy, the configured :05 observer runs at 8:05 PM and 9:05 PM EDT, October 24. Work eligible at 8:02 PM creates a stored Admin fix owned by diggers and a stored daily-brief item at the first tick, three minutes later. Both invocations finish; two checkpoints total 332 bytes. Five invocations with a pile in every bucket retain three checkpoints totalling 8,901 bytes, including all 57 states/territories/national buckets. Every stock dimension equals direct SQL on both databases. Reader inputs and the spending ceiling remain unchanged; the retired 65,062,742-byte inventory is deleted on the copy.

The copy uses only the real counter input projections captured at 5:56 AM EDT: 8 facts, 4 entities, 4 published sets, 4 doors, 12 findings and 20 work-list segments. It is not a whole-database clone. These are controlled-clock checks; actual deployed hourly scheduling remains owed.

## Counts for every state

Direct production SQL at 7:29 PM EDT, October 24, before A8 is deployed. Live/held/superseded/pulled are stored fact statuses, published sets are pointers, doors are distinct source rows, waiting work is currently effective legacy work-list segments, and shared work is the observed shared-table row count. All 50 states, DC, five territories and national/system are present, including zeros.

| State | Live | Held | Superseded | Pulled | Published sets | Doors | Open doors | Waiting findings | Waiting work | Shared work |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| AK | 1772 | 2003 | 298 | 0 | 69 | 96 | 90 | 21945 | 868 | 0 |
| AL | 1492 | 876 | 320 | 0 | 47 | 174 | 113 | 31516 | 1582 | 0 |
| AR | 495 | 920 | 77 | 0 | 17 | 43 | 38 | 22436 | 1993 | 0 |
| AS | 0 | 0 | 0 | 0 | 10 | 13 | 10 | 1 | 140 | 0 |
| AZ | 5776 | 199 | 180 | 124 | 142 | 279 | 256 | 28137 | 2512 | 0 |
| CA | 31765 | 207 | 59 | 0 | 600 | 1804 | 1799 | 39075 | 10609 | 0 |
| CO | 7944 | 70 | 19 | 0 | 150 | 350 | 264 | 22458 | 5260 | 0 |
| CT | 94516 | 71 | 49673 | 0 | 97 | 286 | 281 | 29023 | 1803 | 0 |
| DC | 17 | 9 | 2 | 0 | 16 | 20 | 13 | 4974 | 174 | 0 |
| DE | 180 | 78 | 16 | 0 | 18 | 226 | 218 | 17169 | 633 | 0 |
| FL | 14291 | 214 | 59 | 0 | 421 | 884 | 782 | 20939 | 4043 | 0 |
| GA | 1473 | 177 | 36 | 0 | 43 | 88 | 80 | 26636 | 2967 | 0 |
| GU | 0 | 0 | 0 | 0 | 10 | 13 | 10 | 167 | 5 | 0 |
| HI | 37574 | 5 | 74407 | 0 | 29 | 90 | 85 | 5962 | 351 | 0 |
| IA | 237 | 34 | 8 | 0 | 18 | 113 | 104 | 8034 | 3213 | 0 |
| ID | 816 | 50 | 18 | 0 | 50 | 114 | 102 | 17341 | 3083 | 0 |
| IL | 7963 | 2 | 3 | 0 | 191 | 313 | 305 | 4759 | 10975 | 0 |
| IN | 150 | 13 | 5 | 0 | 15 | 43 | 38 | 8567 | 4321 | 0 |
| KS | 44 | 21 | 3 | 0 | 16 | 123 | 118 | 2382 | 5270 | 0 |
| KY | 98770 | 2 | 223248 | 0 | 17 | 142 | 138 | 1379 | 2268 | 0 |
| LA | 0 | 0 | 0 | 0 | 16 | 48 | 45 | 0 | 994 | 0 |
| MA | 1930 | 0 | 0 | 0 | 120 | 453 | 274 | 1763 | 2721 | 0 |
| MD | 847 | 28 | 8 | 0 | 23 | 84 | 65 | 8135 | 1538 | 0 |
| ME | 638 | 0 | 23 | 0 | 43 | 79 | 72 | 0 | 2472 | 0 |
| MI | 2820 | 0 | 6 | 0 | 161 | 174 | 169 | 0 | 6537 | 0 |
| MN | 6434 | 1 | 1 | 0 | 96 | 111 | 106 | 1406 | 6638 | 0 |
| MO | 9042 | 0 | 0 | 0 | 224 | 330 | 294 | 0 | 6013 | 0 |
| MP | 0 | 0 | 0 | 0 | 10 | 14 | 10 | 105 | 72 | 0 |
| MS | 86 | 2 | 1 | 0 | 17 | 51 | 48 | 313 | 1702 | 0 |
| MT | 9 | 0 | 0 | 0 | 16 | 21 | 13 | 1644 | 2325 | 0 |
| NC | 3804 | 0 | 1 | 0 | 86 | 195 | 189 | 31 | 3955 | 0 |
| ND | 41 | 1 | 0 | 0 | 17 | 72 | 68 | 1221 | 4167 | 0 |
| NE | 0 | 0 | 0 | 0 | 16 | 40 | 26 | 0 | 3411 | 0 |
| NH | 905 | 0 | 4 | 0 | 92 | 199 | 152 | 259 | 1817 | 0 |
| NJ | 3039 | 1 | 24 | 0 | 46 | 132 | 84 | 647 | 2473 | 0 |
| NM | 1945 | 3 | 0 | 0 | 56 | 328 | 325 | 1657 | 1942 | 0 |
| NV | 1654 | 0 | 0 | 0 | 70 | 72 | 69 | 473 | 579 | 0 |
| NY | 2944 | 1 | 0 | 0 | 102 | 183 | 179 | 1741 | 7441 | 0 |
| OH | 4618 | 0 | 1 | 0 | 88 | 137 | 132 | 1368 | 7859 | 0 |
| OK | 2194 | 1 | 0 | 0 | 57 | 103 | 100 | 1443 | 3451 | 0 |
| OR | 858 | 4 | 0 | 0 | 47 | 60 | 57 | 3191 | 2848 | 0 |
| PA | 724 | 0 | 0 | 0 | 49 | 107 | 103 | 722 | 8211 | 0 |
| PR | 0 | 0 | 0 | 0 | 11 | 18 | 12 | 0 | 52 | 0 |
| RI | 126 | 0 | 0 | 0 | 30 | 36 | 31 | 0 | 652 | 0 |
| SC | 117409 | 7 | 185709 | 0 | 16 | 47 | 45 | 764 | 1805 | 0 |
| SD | 60 | 0 | 0 | 0 | 24 | 66 | 62 | 0 | 2614 | 0 |
| TN | 23 | 2 | 3 | 0 | 15 | 35 | 31 | 1436 | 1922 | 0 |
| TX | 12303 | 0 | 0 | 0 | 421 | 722 | 720 | 334 | 13547 | 0 |
| US | 14 | 0 | 0 | 21 | 16745 | 1122 | 1012 | 11 | 1600 | 0 |
| UT | 422 | 0 | 0 | 0 | 28 | 289 | 54 | 3017 | 1425 | 0 |
| VA | 4268 | 0 | 0 | 0 | 113 | 252 | 250 | 0 | 3536 | 0 |
| VI | 2 | 0 | 0 | 0 | 10 | 14 | 10 | 1 | 72 | 0 |
| VT | 5 | 0 | 0 | 0 | 14 | 42 | 36 | 2499 | 1436 | 0 |
| WA | 5652 | 0 | 944 | 0 | 116 | 224 | 220 | 0 | 3693 | 0 |
| WI | 22936 | 74 | 5 | 0 | 557 | 519 | 514 | 259 | 6077 | 0 |
| WV | 121 | 0 | 0 | 0 | 50 | 73 | 69 | 108 | 1409 | 0 |
| WY | 397 | 9 | 3 | 0 | 29 | 52 | 50 | 886 | 1281 | 0 |

## Checks

- All nine checks pass on `997cf737a`: lint (67 s), TypeScript with a 4 GB heap (57 s), dead code (5 s), browser policy (1 s), full tests (1,620 s), schema (1 s), default build (81 s), bundle (1 s) and standalone build (16 s).
- The full suite registers 9,856 tests: 9,854 pass, zero fail and two are skipped, across 42 suites. All 16 bundle tests pass.

The requested focused set passes 141 tests with zero failures, including keeper/work/door integration, identity boundaries, dry migrations, scoreboard, cache, roster, Legistar and ballot behavior. The keeper tests cover both old leases and the merged done/retry states. All seven control-plane migration hashes match. The fresh copy proves all 57-state comparisons, bounded retention and a stored fix within three minutes. The real Chrome reader checks and refreshed production ID resolution pass as described above.

The dependency checkout builds against the latest RB-A1 documentation commit (`3a8b176aa`) with the repaired code; its fresh 7:45 PM EDT build passes. The evidence is saved in [the measurements directory](measurements/rb-a8). The 20-minute fetch/build/return watch stays active. Production SQL parity, the actual automatic :05 run and River's Chrome Admin pass remain pending after deployment.
