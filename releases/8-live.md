# Release 8: live check and first measured hour

Measured by hand (Neon MCP, read-only) until the hourly vital-signs row exists. All times EDT.

## Baseline, runner stopped (Oct 6, 1:23 AM EDT)

- **Runner heartbeat:** last beat 1:08 AM EDT, on release 7 f545fcf. Schema version 23.
- **Control-plane project (withered-sunset-39821877):**
  - data_transfer_bytes this billing period: **1,840,099,187,583** (Neon's counter, updated 1:20 AM EDT);
  - compute_time 281,542 s.
- **Ledger row** (cp_budget 'shared-budget-ledger'):
  - 422,619 bytes, holding 2,117 spend holds;
  - cp_budget: 81,208 seq scans and 34,220 updates since the stats reset.
- **cp_field_manual:** one row, 1.73 MB stored (TOAST-compressed; 6.6 MB as text per Sean).
- **Postgres read counters** (cumulative; the hour's delta is what counts):

| Table | Live rows | Seq scans | Rows read by seq scan | Total size |
|---|---|---|---|---|
| cp_attempts | 43,022 | 130,964 | 1,527,370,289 | 66.7 MB |
| cp_log_artifacts | 22,154 | 10,147 | 127,111,613 | 71.8 MB |
| cp_route_tasks | 22,788 | 9,061 | 85,068,381 | 31.2 MB |
| cp_log_owner_digests | 82,394 | 28,609 | 84,297,147 | 286.8 MB |
| cp_log_scout_results | 3,356 | 17,089 | 43,640,748 | 28.6 MB |
| cp_work_items | 21,445 | 3,240 | 16,916,865 | 44.9 MB |

cp_attempts has been read whole about 131,000 times. The whole-table `repos.attempts.list()` call at campaign-publication-cycle.ts:56 is one of those callers; returns/hunters.md has the details.

## Runner restarted on release 8 (River's own reading, 2:07 AM EDT)

- The runner is on a5fd753 and schema version 24. Its first cycle started at 2:02:01 AM EDT. (Sean's oversight session started it after checking the settings file.)
- **The one-time move worked.** The ledger row is now 1,088 bytes (it was 422,619), with spendHolds empty. cp_spend_holds has 2,794 rows: the 2,117 moved holds plus new ones admitted since the start.
- **First cycle's lastError:** "incremental reads: cp_attempts changed-since read failed (Neon request timed out); reading it whole". So the first round fell back to a whole-table read of cp_attempts (43,130 rows, 67 MB). One fallback a round is acceptable. If it repeats every round, it is a transfer source (hunters).
- **Neon's own project counter had not moved** since 1:20 AM EDT: 1,840,099,187,583 bytes, updated 2:04 AM EDT. Neon updates it in batches. The hour is read again at about 3:05 AM EDT, and later once the counter catches up.
- **Read counters at 2:07 AM EDT** (cumulative; the hour's delta is what counts):

| Table | Seq scans | Rows read by seq scan | Rows fetched by index |
|---|---|---|---|
| cp_attempts | 130,980 | 1,527,714,465 | 313,731,913 |
| cp_log_artifacts | 10,152 | 127,222,383 | 76,178,508 |
| cp_route_tasks | 9,061 | 85,068,381 | 28,371,707 |
| cp_log_owner_digests | 28,622 | 85,032,898 | 7,372,401 |
| cp_log_scout_results | 17,142 | 43,815,941 | 6,540,358 |
| cp_log_costs | 5,536 | 29,085,729 | 25,612,219 |
| cp_work_items | 3,241 | 16,938,310 | 242,075,745 |
| cp_budget | 81,255 | n/a | n/a |
| cp_spend_holds | 239 | 451,622 | 2,835,526 |

These are rows Postgres touched, not bytes sent to the runner. Reads inside cp_admit_spend_hold() never leave the database. So this table says which code is scanning, not what Sean pays for. Neon's project total is the billable number. This project has no pg_stat_statements to break the transfer down by query, which is why the hourly vital-signs row needs its own per-query byte counter (vital-signs.md).

## First hour after restart (2:02 to 3:02 AM EDT): CLEARLY WORSE

- **Neon project transfer: about 9.4 GB.** Neon's counter read 1,840,099,187,583 bytes from 1:20 to 2:04 AM EDT (unchanged while the runner was off), and 1,849,523,516,847 at 3:02 AM EDT. The delta is 9,424,329,264 bytes. It covers the counter's last batch before the restart to 3:02 AM, and the runner was off for nearly all of that before 2:02 AM.
- Compare **release 6's first hour: 7.8 GB** (Sean's figure, 11:23 PM to 12:29 AM EDT). **Target: 0.7 GB. Sean's stop line: 1.5 GB.**
- **Ledger row:** 1,088 bytes (the move held). cp_budget: 791 seq scans of a 1 KB row (negligible).
- **cp_spend_holds:** 3,862 rows at 3:03 AM EDT (2,794 at 2:07). 2,230 holds were admitted in the hour; 76 are unsettled; the oldest is from 11:22 PM EDT. Average row 1,272 bytes, 4.9 MB of rows in all. **2,244 seq scans this hour, 3.04M rows read by seq scan, 13.1M fetched by index.**
- **Other read deltas this hour:**
  - cp_log_artifacts: 4,043 seq scans and 91.8M rows read by seq scan (a whole-log read about once a second);
  - cp_attempts: 8 seq scans (the incremental read is working) and 1.37M rows fetched by index;
  - cp_work_items: 21 seq scans;
  - cp_route_tasks: 3 seq scans.

### Cause: NOT YET IDENTIFIED (corrected 3:20 AM EDT)
River first blamed `SpendHoldGate.left()`, which fetches counting holds as rows. **That was wrong.** Nothing in production calls `left()` or `liveFor()`. cp_spend_holds' 2,244 seq scans this hour match its 2,230 admissions: `cp_admit_spend_hold()` scans the table **inside Postgres**, and those reads never reach the runner. They cost compute, not transfer. The holds reads that do return rows are `readLiveSpendHolds` at each round's start and in the owner snapshot: about 3,800 rows (4.9 MB) each, a few times an hour, so tens of MB.

Upper bounds from this hour's counters. Rows fetched by index times average row size; some of these fetches are internal and never reach the runner:

| Table | Index fetches this hour | Approx. ceiling |
|---|---|---|
| cp_attempts | 1,369,086 | ~2.1 GB |
| cp_log_artifacts | 260,290 (+4,043 whole scans, filtered in the database) | ~0.8 GB |
| cp_work_items | 246,926 | ~0.5 GB |
| cp_log_costs | 189,072 (+517k rows by seq scan) | ~0.3 GB + |
| cp_occurrences | 179,648 | ~0.3 GB |
| cp_route_tasks | 118,091 | ~0.1 GB |

These sum to about 4 GB at most; the remaining 5 GB or more is in reads these counters can't show (seq-scan results returned whole). This database has no pg_stat_statements, so **the source cannot be named from here.** The per-query byte counter tagged by calling code (vital-signs.md, hunters) is what names it. River sent no fix on a guess.

### Verdict
**Clearly worse**: transfer 9.4 GB against 7.8 GB for release 6's hour (+21%), and 13 times the target. Under Sean's gate it would roll back. **No rollback was done.** Sean's rule says River first shows him how "clearly worse" is decided, using real hours, and the rollback screen (DB-47) is not on any Admin view (live ledger). Sean's oversight session holds the stop line (1.5 GB a full hour). Sean was pushed at 3:10 AM EDT.
