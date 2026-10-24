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
