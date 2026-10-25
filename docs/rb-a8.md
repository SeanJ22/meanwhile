# RB-A8 — Hourly counts

River's RV-LOCK shipped in release 108. RB-A8's competing locking implementation remains withdrawn; locking code on this branch matches RV-LOCK. The [note to River](measurements/rb-a8/river-lock-note.md) preserves the earlier copy measurements and their limits.

The requested post-release runtime check is complete. Read-only production SQL verifies the applied reader and control-plane migrations and two actual scheduled writes 3,599.824 seconds apart. Three checkpoints total 9,461 JSON bytes; retained legacy metadata adds 9,568 bytes, for **19,029 bytes** of observer state. The retired inventory row and legacy capture/input payloads are absent. The [verification note and evidence](measurements/rb-a8/release108-runtime.md) record the observations, including a later deploy initializer replacing an existing hour's row. This is a note, not READY. RB-A8 stops after pushing it, as Sean directed. The superseded full check run was stopped, not passed.

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

Production read-only SQL refreshed at 10:34 PM EDT resolves all 60 stored event references: 56 reactions, one Ask and three demand signals, with zero unresolved references. Speak has no stored posts. This lane rewrites no reader target IDs. The Chrome connection checks above use the real production pages with writes blocked.

The Phoenix 85003 walk found that a partial state publication had hidden known dates before RB-A8 was deployed. After another 15 seconds, the page still omitted the October 5 registration deadline and July 21 held primary. The native calendar used only the new projection while the page suppressed its existing sourced calendar as soon as any state navigation was published.

The shared date selector now retains previously sourced dates for the same state and election cycle when the current publication omits that topic. A supplied date or explicit no-date rule replaces the earlier value. Each retained date keeps its provenance; the election-day heading supplies the day without a duplicate list entry. The published Arizona projection was captured through `readonly` at 4:19 PM EDT and rendered through the actual ballot component in a local copy. Chrome showed the newer October 7–30 and October 23 dates plus the retained July 21 and October 5 dates, and removed the false missing-deadline message. The focused reader and migration checks passed. At the original READY, production verification of the repair was still pending.


## Next-run proof

On the merged real-input PGlite copy, the configured :05 observer runs at 8:05 PM and 9:05 PM EDT, October 24. Work eligible at 8:02 PM creates a stored Admin fix owned by diggers and a stored daily-brief item at the first tick, three minutes later. Both invocations finish; two checkpoints total 332 bytes. Five invocations with a pile in every bucket retain three checkpoints totalling 8,901 bytes, including all 57 states/territories/national buckets. Every stock dimension equals direct SQL on both databases. Reader inputs and the spending ceiling remain unchanged; the retired 65,062,742-byte inventory is deleted on the copy.

The copy uses only the real counter input projections captured at 5:56 AM EDT: 8 facts, 4 entities, 4 published sets, 4 doors, 12 findings and 20 work-list segments. It is not a whole-database clone. These are controlled-clock checks; actual deployed hourly scheduling remains owed.

## Counts for every state

Direct production SQL refreshed at 10:31 PM EDT, October 24, before A8 is deployed. Both explicit read-only roles deny INSERT and UPDATE; the raw evidence is in migration-lock-production-counts.json. Live/held/superseded/pulled are stored fact statuses, published sets are pointers, doors are distinct source rows, waiting work is currently effective legacy work-list segments, and shared work is the observed shared-table row count. All 50 states, DC, five territories and national/system are present, including zeros.

| State | Live | Held | Superseded | Pulled | Published sets | Doors | Open doors | Waiting findings | Waiting work | Shared work |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| AK | 1777 | 2004 | 299 | 0 | 69 | 97 | 91 | 21947 | 871 | 0 |
| AL | 1493 | 917 | 325 | 0 | 47 | 175 | 114 | 31505 | 1650 | 0 |
| AR | 503 | 920 | 79 | 0 | 17 | 45 | 39 | 22429 | 2200 | 0 |
| AS | 0 | 0 | 0 | 0 | 10 | 15 | 12 | 1 | 139 | 0 |
| AZ | 5826 | 200 | 190 | 124 | 145 | 295 | 272 | 28132 | 2500 | 0 |
| CA | 31780 | 213 | 59 | 0 | 601 | 1805 | 1801 | 39078 | 10667 | 0 |
| CO | 8346 | 71 | 20 | 0 | 151 | 351 | 266 | 22535 | 5285 | 0 |
| CT | 94885 | 73 | 49704 | 0 | 99 | 288 | 280 | 29747 | 1756 | 0 |
| DC | 17 | 10 | 3 | 0 | 16 | 21 | 14 | 4973 | 174 | 0 |
| DE | 187 | 98 | 19 | 0 | 18 | 227 | 220 | 17163 | 635 | 0 |
| FL | 14445 | 222 | 60 | 0 | 422 | 893 | 792 | 20980 | 4047 | 0 |
| GA | 1497 | 180 | 37 | 0 | 44 | 89 | 81 | 26609 | 2923 | 0 |
| GU | 0 | 0 | 0 | 0 | 10 | 14 | 11 | 167 | 5 | 0 |
| HI | 37577 | 5 | 74407 | 0 | 29 | 116 | 94 | 5959 | 356 | 0 |
| IA | 435 | 35 | 8 | 0 | 19 | 124 | 115 | 8691 | 3263 | 0 |
| ID | 828 | 52 | 18 | 0 | 50 | 117 | 104 | 17331 | 3126 | 0 |
| IL | 8280 | 3 | 3 | 0 | 194 | 314 | 307 | 4841 | 10991 | 0 |
| IN | 156 | 16 | 6 | 0 | 15 | 44 | 40 | 8563 | 4413 | 0 |
| KS | 46 | 21 | 3 | 0 | 16 | 124 | 120 | 2381 | 5385 | 0 |
| KY | 98770 | 2 | 223248 | 0 | 17 | 143 | 139 | 1530 | 2381 | 0 |
| LA | 0 | 0 | 0 | 0 | 16 | 49 | 46 | 0 | 994 | 0 |
| MA | 2149 | 0 | 0 | 0 | 122 | 455 | 277 | 1838 | 2721 | 0 |
| MD | 881 | 34 | 10 | 0 | 26 | 92 | 74 | 8128 | 1562 | 0 |
| ME | 770 | 0 | 23 | 0 | 44 | 80 | 73 | 0 | 2472 | 0 |
| MI | 2835 | 0 | 6 | 0 | 162 | 175 | 171 | 0 | 6620 | 0 |
| MN | 6656 | 1 | 1 | 0 | 97 | 119 | 114 | 1437 | 6638 | 0 |
| MO | 9581 | 0 | 0 | 0 | 227 | 332 | 295 | 0 | 6128 | 0 |
| MP | 0 | 0 | 0 | 0 | 10 | 17 | 14 | 105 | 72 | 0 |
| MS | 87 | 2 | 1 | 0 | 17 | 53 | 50 | 313 | 1784 | 0 |
| MT | 9 | 0 | 0 | 0 | 16 | 22 | 14 | 1644 | 2325 | 0 |
| NC | 4014 | 0 | 1 | 0 | 88 | 196 | 191 | 31 | 4055 | 0 |
| ND | 43 | 1 | 0 | 0 | 17 | 74 | 70 | 1220 | 4220 | 0 |
| NE | 0 | 0 | 0 | 0 | 16 | 59 | 45 | 0 | 3504 | 0 |
| NH | 905 | 0 | 4 | 0 | 92 | 207 | 160 | 259 | 1817 | 0 |
| NJ | 3440 | 1 | 24 | 0 | 47 | 150 | 102 | 647 | 3129 | 0 |
| NM | 1948 | 3 | 0 | 0 | 56 | 332 | 330 | 1656 | 1975 | 0 |
| NV | 1654 | 0 | 0 | 0 | 70 | 73 | 70 | 473 | 579 | 0 |
| NY | 2944 | 1 | 0 | 0 | 102 | 184 | 181 | 1741 | 7441 | 0 |
| OH | 5271 | 0 | 1 | 0 | 94 | 139 | 135 | 1368 | 7859 | 0 |
| OK | 2320 | 1 | 0 | 0 | 61 | 144 | 141 | 1443 | 3528 | 0 |
| OR | 1203 | 4 | 0 | 0 | 49 | 62 | 60 | 3191 | 2848 | 0 |
| PA | 760 | 0 | 0 | 0 | 51 | 110 | 106 | 722 | 8278 | 0 |
| PR | 0 | 0 | 0 | 0 | 11 | 20 | 15 | 0 | 52 | 0 |
| RI | 126 | 0 | 0 | 0 | 30 | 39 | 34 | 0 | 652 | 0 |
| SC | 117409 | 7 | 185709 | 0 | 16 | 48 | 46 | 764 | 1851 | 0 |
| SD | 84 | 0 | 0 | 0 | 27 | 70 | 65 | 0 | 2680 | 0 |
| TN | 23 | 2 | 3 | 0 | 15 | 69 | 66 | 1436 | 1922 | 0 |
| TX | 12893 | 0 | 0 | 0 | 424 | 797 | 794 | 334 | 13801 | 0 |
| US | 14 | 0 | 0 | 21 | 17226 | 1122 | 1002 | 11 | 1627 | 0 |
| UT | 422 | 0 | 0 | 0 | 28 | 338 | 103 | 3017 | 1446 | 0 |
| VA | 5092 | 0 | 0 | 0 | 118 | 271 | 269 | 0 | 3669 | 0 |
| VI | 2 | 0 | 0 | 0 | 10 | 19 | 15 | 1 | 72 | 0 |
| VT | 16 | 1 | 0 | 0 | 14 | 80 | 71 | 2496 | 1441 | 0 |
| WA | 5672 | 0 | 956 | 0 | 118 | 258 | 255 | 0 | 3711 | 0 |
| WI | 23099 | 74 | 5 | 0 | 559 | 521 | 516 | 259 | 6077 | 0 |
| WV | 121 | 0 | 0 | 0 | 50 | 102 | 98 | 108 | 1428 | 0 |
| WY | 491 | 9 | 3 | 0 | 30 | 69 | 68 | 1088 | 1304 | 0 |

## Earlier checks

- All nine checks pass on `997cf737a`: lint (67 s), TypeScript with a 4 GB heap (57 s), dead code (5 s), browser policy (1 s), full tests (1,620 s), schema (1 s), default build (81 s), bundle (1 s) and standalone build (16 s).
- The full suite registers 9,856 tests: 9,854 pass, zero fail and two are skipped, across 42 suites. All 16 bundle tests pass.

The requested focused set passes 141 tests with zero failures, including keeper/work/door integration, identity boundaries, dry migrations, scoreboard, cache, roster, Legistar and ballot behavior. The keeper tests cover both old leases and the merged done/retry states. All seven control-plane migration hashes match. The fresh copy proves all 57-state comparisons, bounded retention and a stored fix within three minutes. The real Chrome reader checks and refreshed production ID resolution pass as described above.

Earlier dependency builds against RB-A1 documentation commit `3a8b176aa` passed, with evidence in [the measurements directory](measurements/rb-a8). Sean then narrowed the remaining assignment to post-release migration, hourly-write and saved-state verification. Those runtime checks passed as recorded in the [release 108 note](measurements/rb-a8/release108-runtime.md); this lane stops after pushing that note.
