# RB-A8 — Hourly counts

READY on `stream/rb-a8`. River recorded RB-A1 (`5bde46615`) at 11:25 AM EDT on October 24; merged River commit `59b7c5577` contains that exact commit. The final code commit `d98ffc587` includes River's release-98 reader-pool fix (`dfb076b40`) and passes all nine required checks. River's numbered RB-A1 migration and RIVER-KEYS migration precede RB-A8. Deployment, the actual hourly invocation and River's Chrome live check remain pending.

Readers keep their current facts, civic payloads and identifiers. Writer transactions update `count_hour`; the observer reads counters and grouped oldest ages. Admin shows counts by state, kind, step and Eastern hour. Counting coverage starts after every hook and baseline is installed, so the first partial hour is unknown, and timestamp-only rechecks earn no movement. Doors have a unique source count plus a separate family breakdown, so a source serving two families still counts once in the source total. Growth checks compare the current total with both known hour-end totals. New work is caught when the previous hour is unmeasured, after an older pile clears, and when ages are grouped by owner.

The production deploy initializer takes a first reading. The independent Netlify schedule is five minutes past every hour (Eastern: :05 in both EDT and EST). Each run updates the existing owned fix list and daily brief, removes `line-keeper:current`, and retains at most three small run checkpoints. Admin states when the keeper is late. No settings, budgets, publishing conditions or reader identifiers change.

## Production connection proofs

Read-only access only: reader project `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, role `readonly`; control plane `withered-sunset-39821877`, branch `br-tiny-frog-aeufpjeq`, role `wtp_cp_release_readonly`.

The actual reader adapter also connects through the production pooled endpoint with role `readonly` and read-only mode on; it counted 271,352 subjects. The merged release-98 fix removes the startup option that the pooler rejected.

1. The production Tucson Parks Connections door (encoded scope ending `2018-parks-connections-bond-oversight-commission`) points to the `MEETING` publication `cv-9ae69ffd18df730d6e995424f31e95b2`. Its scope resolves to AZ despite percent encoding. A copy of the real door and pointer passes the actual counter migrations. Chrome 151 on meanwhileusa.com with ZIP 85701 showed 245 meetings, 139 bodies and 64 officials. After dismissing the quick tour, clicking Body and selecting that Parks Commission worked in 205 ms; the page showed its two meetings. This is a real reader-page check, with writes blocked.
2. Production reader facts 1711494–1711500 for Tucson Unified's election and service offices include live, held and superseded values; fact 1711517 names its Audit Committee. The copy's real fact/status counts equal direct SQL after the migration; reader rows are unchanged. Selecting that Audit Committee on Tucson's live page worked in 194 ms, with no page errors. The existing Phoenix 85003 ballot in Chrome still showed the November 3, 2026 election, deadlines, Arizona election and campaign offices and candidates. RB-A1's separate production event-ID check remains a dependency; A8 writes neither reader content nor event targets.

A local replay uses only the counter input projections captured at 5:56 AM EDT on October 24: 8 facts, 4 entities, 4 published sets, 4 doors, 12 findings and 20 work-list segments. It is not a whole-database clone. An injected waiting pile becomes an owned fix and a daily-brief item. The retired 65,062,742-byte inventory row is deleted, and the configured spending ceiling stays unchanged.

## Reader preservation after RB-A1 deployment

Read-only production SQL at 2:42 PM EDT, after migration 0051 was applied, resolves all 60 stored event references: 56 reactions, one Ask and three demand signals, with zero unresolved references. No Speak posts are stored. Chrome still selects the Tucson Parks Commission and Audit Committee after that migration.

The Phoenix 85003 reader check remains open. Before RB-A8 was deployed, Chrome showed two dated items rather than the six in the release-96 baseline. Waiting another 15 seconds left two items, with no page errors. The October 5 registration deadline disappeared and the page now says it is still gathering that deadline. The election date, election-office contact and campaign-finance office remain visible. This is a current production reader regression, not a passing preservation check.

Owner: River / the ballot-navigation reader. In `app/ballot/page.tsx`, the `!navigation.has(set.election.state)` condition suppresses `builtInElectionDatesFor` as soon as any state navigation is published. The native calendar reads only `info.dates`, so a partial publication drops previously visible dates. River must address this in the reader release before RB-A8 can pass its live preservation check. The A8 counts code does not change that reader path.

The lane now includes a date-selector repair for that preservation condition. It retains previously sourced dates for the same state and election cycle when the current publication omits that topic; a supplied date or explicit no-date rule replaces the earlier value. Provenance stays with each retained date. Fifteen focused checks, including the acquired-navigation browser checks across states and DC, pass. The full check run and production verification of this repair are pending before the replacement READY.

## Next-run proof

With the clock advanced to the configured :05 boundary, the same observer runs at 2:05 PM and 3:05 PM EDT, October 24. Work eligible at 2:02 PM becomes a stored Admin fix owned by diggers and a stored daily-brief item at the first tick, three minutes later. Both invocations complete; the two saved checkpoints total 332 bytes. The real copied reader inputs are unchanged. With a waiting pile in all 57 buckets, five invocations retain three checkpoints totalling 8,901 bytes. Direct SQL equals every stock dimension on both databases in all 57 buckets. Focused coverage includes future due boundaries and leases while the runner is stopped, refusal, rollback, archival, new families, missing waiting times, and a missing or late keeper. These are controlled-clock scheduling checks. An actual deployed hourly invocation and River's Chrome live check remain owed after integration.

## Counts for every state

Direct production SQL at 11:15 AM EDT, October 24, before these counters are installed. Live means the stored fact status; it does not claim that each record was seen on a page. Published sets count pointers, sources count distinct door rows, and waiting work counts currently effective work-list segments. All 50 states, DC, five territories and the national/system bucket are present, including zeros. RB-A1's shared work table did not exist at this capture; the waiting-work column counts the legacy work list then present.

| State | Live | Held | Superseded | Pulled | Published sets | Doors | Open doors | Waiting findings | Waiting work |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| AK | 1587 | 1968 | 296 | 0 | 68 | 96 | 90 | 21993 | 868 |
| AL | 1395 | 693 | 285 | 0 | 44 | 173 | 112 | 31586 | 1582 |
| AR | 471 | 899 | 75 | 0 | 16 | 43 | 38 | 22470 | 1993 |
| AS | 0 | 0 | 0 | 0 | 10 | 13 | 10 | 1 | 140 |
| AZ | 3576 | 175 | 167 | 124 | 124 | 261 | 236 | 28227 | 2512 |
| CA | 28504 | 160 | 34 | 0 | 435 | 1803 | 1798 | 39125 | 10609 |
| CO | 3748 | 62 | 13 | 0 | 120 | 350 | 264 | 22499 | 5260 |
| CT | 90168 | 57 | 48134 | 0 | 73 | 286 | 281 | 29062 | 1803 |
| DC | 13 | 6 | 1 | 0 | 16 | 20 | 13 | 4982 | 174 |
| DE | 145 | 73 | 12 | 0 | 18 | 226 | 218 | 17187 | 633 |
| FL | 10740 | 178 | 35 | 0 | 320 | 884 | 782 | 21025 | 4043 |
| GA | 1366 | 145 | 33 | 0 | 40 | 88 | 81 | 26692 | 2967 |
| GU | 0 | 0 | 0 | 0 | 10 | 13 | 10 | 167 | 5 |
| HI | 37505 | 1 | 74407 | 0 | 28 | 90 | 85 | 5972 | 351 |
| IA | 191 | 32 | 7 | 0 | 15 | 113 | 104 | 8054 | 3213 |
| ID | 760 | 42 | 15 | 0 | 49 | 114 | 102 | 17374 | 3083 |
| IL | 7464 | 2 | 2 | 0 | 160 | 267 | 260 | 4762 | 10975 |
| IN | 118 | 11 | 4 | 0 | 14 | 43 | 38 | 8584 | 4321 |
| KS | 36 | 19 | 3 | 0 | 15 | 123 | 118 | 2307 | 5270 |
| KY | 98762 | 2 | 219728 | 0 | 16 | 142 | 138 | 1382 | 2268 |
| LA | 0 | 0 | 0 | 0 | 15 | 48 | 45 | 0 | 1023 |
| MA | 696 | 0 | 0 | 0 | 91 | 419 | 240 | 1763 | 2701 |
| MD | 818 | 26 | 8 | 0 | 19 | 84 | 65 | 8150 | 1538 |
| ME | 455 | 0 | 0 | 0 | 31 | 70 | 63 | 0 | 2472 |
| MI | 2623 | 0 | 0 | 0 | 154 | 174 | 169 | 0 | 6537 |
| MN | 1708 | 1 | 0 | 0 | 71 | 110 | 105 | 1406 | 6654 |
| MO | 6761 | 0 | 0 | 0 | 170 | 330 | 294 | 0 | 6013 |
| MP | 0 | 0 | 0 | 0 | 10 | 14 | 11 | 105 | 72 |
| MS | 49 | 1 | 0 | 0 | 16 | 51 | 48 | 317 | 1718 |
| MT | 9 | 0 | 0 | 0 | 15 | 21 | 13 | 1644 | 2320 |
| NC | 1537 | 0 | 0 | 0 | 70 | 195 | 189 | 31 | 3955 |
| ND | 31 | 1 | 0 | 0 | 16 | 72 | 68 | 382 | 4201 |
| NE | 0 | 0 | 0 | 0 | 15 | 40 | 26 | 0 | 3411 |
| NH | 797 | 0 | 0 | 0 | 89 | 199 | 152 | 259 | 1828 |
| NJ | 779 | 0 | 0 | 0 | 32 | 132 | 84 | 647 | 2472 |
| NM | 1925 | 2 | 0 | 0 | 55 | 328 | 325 | 1375 | 1935 |
| NV | 1604 | 0 | 0 | 0 | 61 | 72 | 69 | 473 | 565 |
| NY | 2749 | 1 | 0 | 0 | 96 | 183 | 179 | 1522 | 7466 |
| OH | 1514 | 0 | 1 | 0 | 66 | 137 | 133 | 1352 | 7859 |
| OK | 1782 | 0 | 0 | 0 | 46 | 103 | 100 | 2 | 3468 |
| OR | 842 | 2 | 0 | 0 | 42 | 60 | 57 | 2907 | 2854 |
| PA | 557 | 0 | 0 | 0 | 45 | 107 | 103 | 722 | 8211 |
| PR | 0 | 0 | 0 | 0 | 11 | 18 | 12 | 0 | 52 |
| RI | 121 | 0 | 0 | 0 | 29 | 36 | 31 | 0 | 652 |
| SC | 117378 | 0 | 185708 | 0 | 15 | 47 | 45 | 0 | 1841 |
| SD | 60 | 0 | 0 | 0 | 23 | 66 | 62 | 0 | 2614 |
| TN | 8 | 0 | 0 | 0 | 14 | 35 | 31 | 19 | 1945 |
| TX | 8287 | 0 | 0 | 0 | 326 | 721 | 719 | 268 | 13531 |
| US | 14 | 0 | 0 | 21 | 13171 | 1105 | 997 | 11 | 1324 |
| UT | 372 | 0 | 0 | 0 | 26 | 289 | 54 | 2110 | 1441 |
| VA | 1314 | 0 | 0 | 0 | 85 | 252 | 250 | 0 | 3547 |
| VI | 2 | 0 | 0 | 0 | 10 | 14 | 10 | 1 | 72 |
| VT | 5 | 0 | 0 | 0 | 13 | 42 | 37 | 1600 | 1436 |
| WA | 3602 | 0 | 40 | 0 | 98 | 224 | 221 | 0 | 3693 |
| WI | 19360 | 74 | 5 | 0 | 423 | 519 | 515 | 259 | 6009 |
| WV | 115 | 0 | 0 | 0 | 49 | 73 | 70 | 62 | 1415 |
| WY | 186 | 7 | 2 | 0 | 17 | 52 | 50 | 891 | 1287 |

## Checks

- After the required River fold and merge, all nine checks pass on `d98ffc587`: lint, TypeScript, dead code, browser policy, the complete test suite, schema, default build, bundle checks and standalone build.
- The complete suite registers 9,762 tests: 9,760 pass, zero fail and two are skipped. All 16 bundle tests pass. No native runtime crash occurred in this combined run.
- All ten keeper tests pass, including fresh work after an hour closes, partial installation coverage, an earlier large pile clearing, and ages grouped by owner.
- The final copy replay compares every stock dimension with direct SQL on both databases across all 57 buckets. The injected pile creates a stored owned fix and a stored daily-brief item within three minutes; subsequent hourly invocations retain three checkpoints totalling 8,901 bytes. Reader rows and spending settings remain unchanged.
- Chrome checks cover the real production reader connections above and the Admin component on desktop and mobile: changing the step clears an irrelevant kind filter; all 57 state rows remain available and the mobile page does not overflow.
- The 20-minute dependency builds pass against RB-A1 through 1:38 PM EDT. The actual deployed schedule, SQL parity and River's Chrome live check remain for release verification.
