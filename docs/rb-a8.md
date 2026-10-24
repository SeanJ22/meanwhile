# RB-A8 — Hourly counts

Work in progress on `stream/rb-a8`. READY waits for RB-A1 in both River's integration log and `origin/river`, then the River merge and a complete check run.

Readers keep their current facts, civic payloads and identifiers. Writer transactions update `count_hour`; the observer reads counters and grouped oldest ages. Admin shows counts by state, kind, step and Eastern hour. The first partial hour is unknown, and timestamp-only rechecks earn no movement. Doors have a unique source count plus a separate family breakdown, so a source serving two families still counts once in the source total.

The independent Netlify schedule is five minutes past every hour (Eastern: :05 in both EDT and EST). Each run updates the existing owned fix list and daily brief, removes `line-keeper:current`, and retains at most three small run checkpoints. Admin states when the keeper is late. No settings, budgets, publishing conditions or reader identifiers change.

## Production connection proofs

Read-only access only: reader project `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, role `readonly`; control plane `withered-sunset-39821877`, branch `br-tiny-frog-aeufpjeq`, role `wtp_cp_release_readonly`.

1. The production Tucson Parks Connections door (encoded scope ending `2018-parks-connections-bond-oversight-commission`) points to the `MEETING` publication `cv-9ae69ffd18df730d6e995424f31e95b2`. Its scope resolves to AZ despite percent encoding. A copy of the real door and pointer passes the actual counter migrations. Chrome 151 on meanwhileusa.com with ZIP 85701 showed 245 meetings, 139 bodies and 64 officials. After dismissing the quick tour, clicking Body and selecting that Parks Commission worked in 205 ms; the page showed its two meetings. This is a real reader-page check, with writes blocked.
2. Production reader facts 1711494–1711500 for Tucson Unified's election and service offices include live, held and superseded values; fact 1711517 names its Audit Committee. The copy's real fact/status counts equal direct SQL after the migration; reader rows are unchanged. Selecting that Audit Committee on Tucson's live page worked in 194 ms, with no page errors. The existing Phoenix 85003 ballot in Chrome still showed the November 3, 2026 election, deadlines, Arizona election and campaign offices and candidates. RB-A1's separate production event-ID check remains a dependency; A8 writes neither reader content nor event targets.

A local replay uses only the counter input projections captured at 5:56 AM EDT on October 24: 8 facts, 4 entities, 4 published sets, 4 doors, 12 findings and 20 work-list segments. It is not a whole-database clone. An injected waiting pile becomes an owned fix and a daily-brief item. The retired 65,062,742-byte inventory row is deleted, and the configured spending ceiling stays unchanged.

## Next-run proof

With the clock advanced to the configured :05 boundary, the same observer runs at 7:05 AM and 8:05 AM EDT, October 24. Both complete; the two saved checkpoints total 332 bytes. The real copied reader inputs are unchanged. With a waiting pile in all 57 buckets, five invocations retain three checkpoints totalling 8,901 bytes. A focused integration test compares the hourly work counts with direct SQL in every bucket. Focused tests additionally check lease expiry and future due boundaries while the runner is stopped, rechecks, rollback, archival, new families, and a missing or late keeper. These are controlled-clock scheduling checks. An actual deployed hourly invocation and River's Chrome live check remain owed after integration.

## Counts for every state

Direct production SQL at about 6:26 AM EDT, October 24, before these counters are installed. Live means the stored fact status; it does not claim that each record was seen on a page. Published sets count pointers, sources count distinct door rows, and waiting work counts currently effective work-list segments. All 50 states, DC, five territories and the national/system bucket are present, including zeros.

| State | Live | Held | Superseded | Pulled | Published sets | Doors | Open doors | Waiting findings | Waiting work |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| AK | 1388 | 1966 | 294 | 0 | 51 | 96 | 90 | 22044 | 844 |
| AL | 1312 | 689 | 283 | 0 | 34 | 164 | 103 | 31598 | 1563 |
| AR | 464 | 893 | 74 | 0 | 16 | 28 | 23 | 22535 | 2002 |
| AS | 0 | 0 | 0 | 0 | 10 | 13 | 11 | 1 | 139 |
| AZ | 3569 | 173 | 166 | 124 | 124 | 249 | 224 | 28238 | 1869 |
| CA | 26861 | 152 | 33 | 0 | 246 | 1777 | 1772 | 38753 | 10441 |
| CO | 3224 | 61 | 12 | 0 | 83 | 325 | 239 | 21692 | 5200 |
| CT | 89915 | 53 | 48110 | 0 | 52 | 236 | 231 | 25616 | 1789 |
| DC | 13 | 4 | 1 | 0 | 16 | 18 | 12 | 4984 | 169 |
| DE | 137 | 62 | 7 | 0 | 18 | 206 | 198 | 16846 | 654 |
| FL | 8789 | 168 | 34 | 0 | 166 | 837 | 735 | 21047 | 3923 |
| GA | 1284 | 137 | 31 | 0 | 35 | 69 | 62 | 26373 | 2934 |
| GU | 0 | 0 | 0 | 0 | 10 | 13 | 11 | 167 | 5 |
| HI | 37425 | 1 | 37225 | 0 | 22 | 79 | 74 | 5972 | 351 |
| IA | 178 | 26 | 6 | 0 | 14 | 60 | 51 | 8065 | 3221 |
| ID | 727 | 38 | 14 | 0 | 48 | 109 | 97 | 17387 | 3085 |
| IL | 7040 | 2 | 2 | 0 | 113 | 240 | 233 | 4740 | 10927 |
| IN | 70 | 10 | 4 | 0 | 14 | 41 | 36 | 7181 | 4363 |
| KS | 36 | 15 | 3 | 0 | 15 | 105 | 100 | 2308 | 5270 |
| KY | 98751 | 2 | 209586 | 0 | 16 | 134 | 130 | 1046 | 2304 |
| LA | 0 | 0 | 0 | 0 | 15 | 30 | 27 | 0 | 1034 |
| MA | 486 | 0 | 0 | 0 | 51 | 404 | 226 | 1366 | 2696 |
| MD | 802 | 20 | 5 | 0 | 17 | 82 | 63 | 6991 | 1566 |
| ME | 412 | 0 | 0 | 0 | 24 | 69 | 63 | 0 | 2530 |
| MI | 2453 | 0 | 0 | 0 | 133 | 164 | 159 | 0 | 6563 |
| MN | 1451 | 0 | 0 | 0 | 67 | 106 | 100 | 0 | 6641 |
| MO | 5707 | 0 | 0 | 0 | 91 | 286 | 250 | 0 | 6010 |
| MP | 0 | 0 | 0 | 0 | 10 | 14 | 11 | 11 | 72 |
| MS | 36 | 0 | 0 | 0 | 16 | 33 | 30 | 0 | 1663 |
| MT | 9 | 0 | 0 | 0 | 15 | 21 | 13 | 1507 | 2460 |
| NC | 1493 | 0 | 0 | 0 | 67 | 164 | 160 | 31 | 3938 |
| ND | 0 | 0 | 0 | 0 | 16 | 72 | 68 | 0 | 4257 |
| NE | 0 | 0 | 0 | 0 | 15 | 39 | 24 | 0 | 3412 |
| NH | 797 | 0 | 0 | 0 | 83 | 165 | 118 | 259 | 1904 |
| NJ | 779 | 0 | 0 | 0 | 32 | 116 | 68 | 647 | 2469 |
| NM | 1728 | 1 | 0 | 0 | 39 | 66 | 63 | 884 | 2009 |
| NV | 1213 | 0 | 0 | 0 | 28 | 71 | 67 | 179 | 568 |
| NY | 2292 | 0 | 0 | 0 | 69 | 161 | 157 | 1083 | 7471 |
| OH | 1499 | 0 | 1 | 0 | 64 | 119 | 115 | 1326 | 7864 |
| OK | 1429 | 0 | 0 | 0 | 30 | 103 | 100 | 2 | 3455 |
| OR | 796 | 2 | 0 | 0 | 36 | 60 | 57 | 2907 | 2887 |
| PA | 330 | 0 | 0 | 0 | 31 | 107 | 103 | 123 | 8299 |
| PR | 0 | 0 | 0 | 0 | 11 | 18 | 14 | 0 | 52 |
| RI | 62 | 0 | 0 | 0 | 25 | 36 | 31 | 0 | 645 |
| SC | 117369 | 0 | 185708 | 0 | 14 | 47 | 45 | 0 | 1839 |
| SD | 55 | 0 | 0 | 0 | 22 | 66 | 62 | 0 | 2601 |
| TN | 8 | 0 | 0 | 0 | 14 | 35 | 31 | 0 | 1959 |
| TX | 6406 | 0 | 0 | 0 | 155 | 720 | 718 | 228 | 13355 |
| US | 14 | 0 | 0 | 21 | 9826 | 1102 | 991 | 11 | 1174 |
| UT | 244 | 0 | 0 | 0 | 22 | 289 | 55 | 2026 | 1457 |
| VA | 1083 | 0 | 0 | 0 | 56 | 219 | 217 | 0 | 3553 |
| VI | 2 | 0 | 0 | 0 | 10 | 14 | 11 | 1 | 71 |
| VT | 0 | 0 | 0 | 0 | 13 | 35 | 30 | 0 | 1478 |
| WA | 3297 | 0 | 40 | 0 | 79 | 224 | 221 | 0 | 3650 |
| WI | 18250 | 74 | 5 | 0 | 278 | 512 | 508 | 121 | 5883 |
| WV | 107 | 0 | 0 | 0 | 44 | 73 | 70 | 0 | 1391 |
| WY | 164 | 0 | 0 | 0 | 17 | 52 | 50 | 0 | 1329 |

## Checks

- First full run: 7/9 gates; 9,617 tests passed, two assertions failed and two were skipped. The failures were the new selects' missing shell class and missing identity-domain declarations for the new tables. Both are fixed and their focused checks pass.
- The schema gate's first connection attempt could not reach Neon because Node had not enabled the environment proxy. With `NODE_USE_ENV_PROXY=1`, the same read-only gate passes, including all 51 applied migration hashes.
- All 52 focused tests pass with complete test-runner reports. The full rerun found an existing Now render expectation for the former metric label; it now requires “Facts marked live” and still requires a dash for unmeasured hours. The 21 keeper, vital-sign and Now checks pass together.
- The second full run passed 8/9 checks (9,615 tests passed, two failed, two skipped). Besides the corrected Now expectation, Node 24 aborted in native V8 WebAssembly code cleanup during ZIP-people tests. The unchanged ZIP tests and their adjacent ZIP-place test pass all eight assertions in the same canonical runner on replay; the final full combined run remains owed.
- Latest RB-A1 builds pass on the 20-minute cadence; final combined full checks and the deployed scheduled run are still pending.

