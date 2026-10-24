# Work list

Owner: RB-A5. Branch: `stream/rb-a5`, cut from River `21ae9bcfb`, merged with promoted River and its reader-pool hotfix `dfb076b40`. River recorded RB-A1 READY `5bde46615` in integration.md at 11:25 a.m. Eastern on October 24; both that READY and tested River `166fa32ab` are ancestors of this stream.

Remaining work:

- RB-A5: monitor River's return file, fix any returned issue, and continue until board/river status.md records the passed live check.

The Box stays in service until Phase D. No production database rows were changed by this lane.

`lib/core/work.ts` shares one row per canonical link or stable claim slot. Repeat notes retain their supplied referring URLs and source references. Unchanged values and quotes preserve status, priority and backoff; changed evidence retains the id and reopens the row. Evidence changing during a lease becomes ready when the old worker releases it. Claim and expired-lease recovery use bounded, indexed FOR UPDATE SKIP LOCKED queries. Claims take a short lease immediately; lease tokens fence stale finish, refusal and retry calls. Retries back off exponentially, and a refusal creates one detective row. Database time governs leases and hourly events.

`state` is the postal state; US means national or system work. `status` is ready, taken, done or refused. A stable claim key preserves separate seats or people within a multivalued field. `work_in`, `work_done` and `work_refused` are count_hour steps. Triggers count transitions in their transaction. Outcome timestamps retain completions and refusals across reopened versions so direct SQL can also verify every hour.

## Production-copy checks

The read-only Box export contains 328,791 complete rows from a 742 MB source relation, captured October 24, 4:55–4:57 a.m. Eastern. Source: withered-sunset-39821877 / br-tiny-frog-aeufpjeq, role wtp_cp_release_readonly. SHA-256: da80058267dc394af20e66d7b606b0799f05096017880861852ad7e8b93f964f. Mutations stayed in local PostgreSQL 18.4.

The actual RB-A1 and RB-A5 migrations applied to the copy. All 328,791 reports passed through add(), producing 243,681 distinct links or claims. Direct SQL found all 328,791 distinct Box ids in their notes, with zero missing reports. Source references were retained.

Twenty measured claims included indexed recovery. The slowest was 15.29 ms; the plan uses work_row_claim_ready. Two hundred independent connections claimed together: 200 rows, 200 distinct ids. A worker was killed with SIGKILL; the normal claim method reclaimed and completed its row after its 1.5-second lease. The two timer-driven runs were 12:13:19 and 12:13:20 p.m. Eastern, October 24. This is next scheduled run proof on the production copy; deployed queue scheduling remains for the connected rollout.

Separate local schemas also verified that a worker clock ten minutes ahead preserves another worker's valid lease, and that concurrent parent/detective refusals preserve one detective with the newer value and matching counters. These synthetic probes did not change the copied queue.

After the detective and contact probes, the copy contains 243,683 incoming rows, 222 completions and one refusal. All 57 regions and every hour match direct SQL. Authenticated local Chrome rendered the actual hourly query in Admin Work, including California's refusal, the national scope and a zero-row state. The obsolete Work redirect and inactive legacy row renderer were removed. Run `node --experimental-strip-types scripts/rb-a5-production-copy.mts counts` on the loaded copy to export the actual workCounts response for `scripts/rb-a5-admin-browser.mts`; its fixture server uses port 3145 and WTP_ADMIN_SESSION_KEY=rb-a5-local-browser-only, with production database variables unset.

## Connected end to end

1. Production Box to work: all 328,791 original report ids survive in 243,681 distinct work rows, with their source references. This verifies the incoming connection using real production data without moving the live Box.
2. Work to door to place page: work-bd914e099d0889ef5fc4f17c4bcdf64e5b4fc8e0bc4c14a2735646bdcc1d7cd1 was claimed, published through RB-A3's door and finished. Production fact 1711874 and source-copy 62692 became 520-866-6854 for az:county:county-of-pinal#office-recorder, with [the original government source](https://www.azcleanelections.gov/november-3-2026/pinal). The current stream's ordinary readPlacePackage returned it for ocd-division/country:us/state:az/county:pinal and the door queued a rebuild. A refreshed ZIP 85139 baseline retained all seven body ids and every meeting. Pinned Chrome 151 opened the ordinary production reader using the copy's GET responses: the Recorder card had no phone before the work and showed it afterward; its source link was visible. Six log/event writes were blocked. Reader data came from tiny-hill-13996172 / br-delicate-lab-ax02xuo5, role readonly. The door checkpoint was 5585a6458; the proof checkout loaded this stream's reader module, verified by module identity. All publication writes stayed in local copies.

Replay scripts: scripts/rb-a5-production-copy.mts, scripts/rb-a5-connection-copy.mts, scripts/rb-a5-copy-browser.mts and scripts/rb-a5-admin-browser.mts. Numeric evidence is in [measurements/rb-a5](measurements/rb-a5/). New captures remain local under .scratch/rb-a5; the committed public place images are from the earlier replay.

## Checks and live reader

All nine standard checks pass on the merged code: 9,777 tests pass, zero fail, two optional saved-capture cases are skipped; bundle tests pass 16 of 16. Lint, TypeScript, dead code, pinned-browser guard, read-only database gate and both builds pass. The task host's Node 24.19.0 intermittently aborted in PGlite's native WASM allocator. The successful full rerun disables WASM code reclamation in the local test process with v8.setFlagsFromString('--no-wasm-code-gc'); no assertions are disabled and no production setting changes. Details, code tree and skipped files are in measurements/rb-a5/checks.json.

The stream includes River's one-line release-98 reader-pool fix. Its actual startup option connected to the production pooled reader endpoint with role readonly and transaction_read_only=on, reading 104,048 places. This transport check is separate from the Chrome check.

Fresh Chrome 151.0.7922.34 read meanwhileusa.com/ballot?zip=85003 without copied API responses. The November 3 election, deadlines, candidates, measures and 87 source controls remained visible. The Katie Hobbs / John Giles battlecard opened with its existing subject id and Speak Your Mind control. DOM arrival was 2.16 s and candidate controls were usable in 2.76 s; two event writes were blocked. No A5 page-speed improvement is claimed. Browser containers used task-only CA stores with TLS verification enabled and were removed. RB-A1's copied-event proof retains all 36 distinct existing event ids; the queue does not replace those public ids.

## Counts by every state

Copy audit: 2026-10-24T17:01:29.870Z. Direct totals and every hourly bucket agree. The incoming total includes the one detective and one contact probe added after the Box import.

| State | Rows in | Done | Refused |
| --- | ---: | ---: | ---: |
| AK | 11,090 | 20 | 0 |
| AL | 18,669 | 28 | 0 |
| AR | 14,906 | 22 | 0 |
| AS | 1 | 0 | 0 |
| AZ | 20,032 | 21 | 0 |
| CA | 30,723 | 22 | 1 |
| CO | 13,584 | 12 | 0 |
| CT | 22,599 | 10 | 0 |
| DC | 4,014 | 1 | 0 |
| DE | 12,635 | 12 | 0 |
| FL | 19,823 | 9 | 0 |
| GA | 25,318 | 23 | 0 |
| GU | 160 | 0 | 0 |
| HI | 5,158 | 3 | 0 |
| IA | 7,334 | 5 | 0 |
| ID | 16,780 | 20 | 0 |
| IL | 3,389 | 4 | 0 |
| IN | 5,888 | 5 | 0 |
| KS | 1,711 | 2 | 0 |
| KY | 948 | 1 | 0 |
| LA | 0 | 0 | 0 |
| MA | 964 | 1 | 0 |
| MD | 6,449 | 1 | 0 |
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
