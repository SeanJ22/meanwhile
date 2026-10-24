# Work list

Owner: RB-A5. Branch: `stream/rb-a5`, based on River `21ae9bcfb` and merged with RB-A1 `5bde46615`.

Remaining work:

- RB-A5: merge River after its RB-A1 integration, rerun every check, push READY, and handle River returns through the passed live check.

The Box remains in service until Phase D. No production rows have been changed.

`state` is the postal state from RB-A1; national and system work uses US. `status` is ready, taken, done or refused. `sources` holds the shared source references, and `reports` holds repeat notes with their supplied referring URLs. A claim's stable key distinguishes separate people or seats within a multivalued field. Changed values or quotes retain the row id and update its source URL; unchanged reports preserve its place and backoff. Changed evidence during an active lease waits for that worker to release the claim before becoming available again. Leases and hourly event times use the database clock. A worker clock ten minutes ahead retained another worker's valid lease in the PostgreSQL copy probe.

`work_in`, `work_done` and `work_refused` are the work list's `count_hour.step` values. The database trigger counts transitions in their transaction, including the detective row created by a refusal. Outcome timestamps stay on the row so direct SQL can count every completion or refusal after changed evidence reopens it, including outcomes in different hours.

## Production copy verification

Read-only Box export: 328,791 complete rows (742 MB source relation), captured October 24, 1:55–1:57 a.m. Arizona time. Source role: wtp_cp_release_readonly; project withered-sunset-39821877, branch br-tiny-frog-aeufpjeq. SHA-256: da80058267dc394af20e66d7b606b0799f05096017880861852ad7e8b93f964f. All writes stayed in local PostgreSQL 18.4.

The actual RB-A1 and RB-A5 migrations applied cleanly. Feeding every copied report through add produced 243,681 distinct links or claims, plus one detective in the probe. Two hundred independent connections started claiming together: 200 claims, 200 distinct ids. The slowest of 20 measured claims was 32.14 ms, including indexed lease recovery. The plan uses work_row_claim_ready.

A child worker was killed with SIGKILL. Two timer-driven runs used the normal claim method; the second reclaimed and completed its row after its 1.5-second lease. Runs: 2026-10-24T12:21:13.517Z, 2026-10-24T12:21:14.518Z. This is scheduled behavior on the production copy; deployed queue scheduling remains for the connected rollout.

Counter totals matched direct SQL both by state and by hour. The authenticated local Admin Work screen rendered the copy's actual hourly query results in Eastern time. Its obsolete redirect to Queue was removed so these counts are reachable without the former work-row read. The Chrome screenshot is .scratch/rb-a5/admin-work.png.

Measurements and Chrome captures are in [docs/measurements/rb-a5](measurements/rb-a5/).

## Connection proofs

1. All 328,791 production Box reports passed through work.add() and became 243,681 distinct links or claims. Direct SQL found all 328,791 distinct Box ids in the row notes, with zero missing reports. Source references were retained. This used the read-only export and wrote only the local copy.
2. A real work row (work-bd914e099d0889ef5fc4f17c4bcdf64e5b4fc8e0bc4c14a2735646bdcc1d7cd1) was claimed, passed through the RB-A3 door, finished, and appeared in the ordinary readPlacePackage payload for ocd-division/country:us/state:az/county:pinal. Production fact 1711874, source-copy 62692, became “520-866-6854” with [its original government source](https://www.azcleanelections.gov/november-3-2026/pinal). The door also queued that place for rebuilding. Pinned Chrome 151 then opened meanwhileusa.com/?zip=85139 with the copy's response: the Recorder card had no phone before the work and showed this phone afterward; its source link was visible. All body ids and meetings in the baseline response were retained. Five log/event writes were blocked. Reader data used role readonly and its actual parents and source records; mutations stayed in local copies. Replay scripts: scripts/rb-a5-connection-copy.mts and scripts/rb-a5-copy-browser.mts. The browser uses the normal production reader with copied API responses, leaving production data untouched.

The isolated connected checkout also compiled and passed 22 focused identity, candidate-reaction, door and queue checks against RB-A1 READY (5bde46615) and door checkpoint (5d3e4f4ab). The main stream awaits River's foundation fold before its final merge and full rerun.

## Live reader check

Google Chrome for Testing 156 read meanwhileusa.com/ballot?zip=85003. The November 3 election, deadlines, candidates, measures and Sources remained visible. The walk blocked three attempted event writes. DOM arrival was 2.24 s; the observed usable time was 3.07 s, over the three-second target. No page speed improvement is claimed. Chrome used a disposable container with a task-only CA store and TLS verification enabled; the container was removed.

## Counts by state

After the concurrency and connection probes: 2026-10-24T13:32:34.326Z. Direct counts equal the hourly totals for all states.

| State | Rows in | Done | Refused |
| --- | ---: | ---: | ---: |
| AK | 11090 | 20 | 0 |
| AL | 18669 | 29 | 0 |
| AR | 14906 | 21 | 0 |
| AS | 1 | 0 | 0 |
| AZ | 20032 | 21 | 0 |
| CA | 30723 | 23 | 1 |
| CO | 13584 | 12 | 0 |
| CT | 22599 | 10 | 0 |
| DC | 4014 | 1 | 0 |
| DE | 12635 | 12 | 0 |
| FL | 19823 | 9 | 0 |
| GA | 25318 | 23 | 0 |
| GU | 160 | 0 | 0 |
| HI | 5158 | 3 | 0 |
| IA | 7334 | 5 | 0 |
| ID | 16780 | 20 | 0 |
| IL | 3389 | 4 | 0 |
| IN | 5888 | 5 | 0 |
| KS | 1711 | 1 | 0 |
| KY | 948 | 1 | 0 |
| LA | 0 | 0 | 0 |
| MA | 964 | 1 | 0 |
| MD | 6449 | 1 | 0 |
| ME | 0 | 0 | 0 |
| MI | 0 | 0 | 0 |
| MN | 0 | 0 | 0 |
| MO | 0 | 0 | 0 |
| MP | 8 | 0 | 0 |
| MS | 0 | 0 | 0 |
| MT | 0 | 0 | 0 |
| NC | 5 | 0 | 0 |
| ND | 0 | 0 | 0 |
| NE | 0 | 0 | 0 |
| NH | 259 | 0 | 0 |
| NJ | 647 | 0 | 0 |
| NM | 0 | 0 | 0 |
| NV | 100 | 0 | 0 |
| NY | 0 | 0 | 0 |
| OH | 291 | 0 | 0 |
| OK | 0 | 0 | 0 |
| OR | 70 | 0 | 0 |
| PA | 3 | 0 | 0 |
| PR | 0 | 0 | 0 |
| RI | 0 | 0 | 0 |
| SC | 0 | 0 | 0 |
| SD | 0 | 0 | 0 |
| TN | 0 | 0 | 0 |
| TX | 7 | 0 | 0 |
| US | 0 | 0 | 0 |
| UT | 0 | 0 | 0 |
| VA | 0 | 0 | 0 |
| VI | 2 | 0 | 0 |
| VT | 0 | 0 | 0 |
| WA | 0 | 0 | 0 |
| WI | 116 | 0 | 0 |
| WV | 0 | 0 | 0 |
| WY | 0 | 0 | 0 |
