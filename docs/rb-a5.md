# Work list

Owner: RB-A5. Branch: `stream/rb-a5`, based on River `21ae9bcfb`.

Remaining work:

- RB-A5: build the leased queue and hourly Admin read; depends on RB-A1's shared tables and types.
- RB-A5: verify current production Box data on an isolated local PostgreSQL copy, including concurrent claims, recovery, backoff, refusals and direct counts.
- RB-A5: prove the source-to-work and work-to-door-to-place connections with production evidence; depends on the door contract.
- RB-A5: merge River after its RB-A1 integration, rerun checks, push READY, and handle River returns through the passed live check.

The Box remains in service until Phase D. This lane adds the work list without rerouting Box intake or publication.

The read-only control-plane query at 2026-10-24 08:46 UTC found 328,791 Box rows (742 MB), up from the assignment baseline. No production rows have been changed.

`work_in`, `work_done` and `work_refused` are the work list's `count_hour.step` values. The database trigger counts transitions in the transaction that changes the row, including the detective row created by a refusal. Unchanged reports only append their source reference. Changed values or quotes retain the row id and reopen completed work. A change during an active lease waits for that worker to release its claim before becoming available again.

## Production copy verification

Read-only Box export: 328,791 full rows, captured 2026-10-24T08:55:15.427Z through 2026-10-24T08:57:32.194Z. Source role: wtp_cp_release_readonly. SHA-256: da80058267dc394af20e66d7b606b0799f05096017880861852ad7e8b93f964f. All writes stayed in the local PostgreSQL copy.

Two hundred independent PostgreSQL connections started claiming together: 200 claims, 200 distinct ids. The slowest of 20 measured claims was 40.58 ms (claim includes indexed lease recovery). A child worker was killed with SIGKILL; its row became ready after its 1.5-second lease. Counter totals matched direct SQL both by state and by hour.

These checks currently use the shared-table contract from RB-A1’s assignment; they must be rerun on RB-A1’s actual migration and shapes when published. The work-to-door-to-place connection, next scheduled run, live Chrome page, and River integration remain open.

| State | Rows in | Done | Refused |
| --- | ---: | ---: | ---: |
| AK | 10004 | 55 | 0 |
| AL | 17187 | 81 | 0 |
| AR | 13513 | 52 | 0 |
| AS | 1 | 0 | 0 |
| AZ | 18642 | 43 | 2 |
| CA | 29288 | 79 | 0 |
| CO | 12902 | 42 | 0 |
| CT | 21788 | 47 | 0 |
| DC | 3724 | 11 | 0 |
| DE | 12205 | 30 | 0 |
| FL | 18537 | 37 | 0 |
| GA | 24312 | 59 | 1 |
| GU | 160 | 0 | 0 |
| HI | 5077 | 17 | 0 |
| IA | 6666 | 17 | 0 |
| ID | 16457 | 47 | 0 |
| IL | 3278 | 9 | 0 |
| IN | 5697 | 13 | 0 |
| KS | 1637 | 5 | 0 |
| KY | 896 | 2 | 0 |
| LA | 0 | 0 | 0 |
| MA | 913 | 2 | 0 |
| MD | 6310 | 9 | 0 |
| ME | 0 | 0 | 0 |
| MI | 0 | 0 | 0 |
| MN | 0 | 0 | 0 |
| MO | 0 | 0 | 0 |
| MP | 8 | 0 | 0 |
| MS | 0 | 0 | 0 |
| MT | 0 | 0 | 0 |
| NC | 4 | 0 | 0 |
| ND | 0 | 0 | 0 |
| NE | 0 | 0 | 0 |
| NH | 259 | 0 | 0 |
| NJ | 647 | 0 | 0 |
| NM | 0 | 0 | 0 |
| NV | 100 | 0 | 0 |
| NY | 0 | 0 | 0 |
| OH | 250 | 0 | 0 |
| OK | 0 | 0 | 0 |
| OR | 64 | 0 | 0 |
| PA | 3 | 0 | 0 |
| PR | 0 | 0 | 0 |
| RI | 0 | 0 | 0 |
| SC | 0 | 0 | 0 |
| SD | 0 | 0 | 0 |
| SYSTEM | 11 | 0 | 0 |
| TN | 0 | 0 | 0 |
| TX | 7 | 0 | 0 |
| UT | 0 | 0 | 0 |
| VA | 0 | 0 | 0 |
| VI | 2 | 0 | 0 |
| VT | 0 | 0 | 0 |
| WA | 0 | 0 | 0 |
| WI | 115 | 0 | 0 |
| WV | 0 | 0 | 0 |
| WY | 0 | 0 | 0 |
