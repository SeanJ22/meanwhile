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

## First hour after restart

(River fills this in: the transfer delta from data_transfer_bytes, the seq-scan deltas above, cp_spend_holds rows, and ledger row size. Compare with release 6's first hour: 7.8 GB, about 5.5 GB of it ledger reads. Target: under 0.7 GB.)
