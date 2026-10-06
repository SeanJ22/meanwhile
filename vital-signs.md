# Vital signs: one row per hour (Sean, Oct 6). River's build spec.

The runner writes one small row per hour, and everything else reads that row. Admin Now and the daily brief read only `cp_vital_signs`, never raw tables. Neon's project total is the cross-check against Sean's bill.

## The row: `cp_vital_signs`, one per UTC hour

| Column | Meaning | Counted where | Owner |
|---|---|---|---|
| `hour` (pk, timestamptz) | start of the hour | n/a | River (schema) |
| `facts_live` | new or changed reader records published this hour, counted at publish time (BR-31's unit) | the publisher, at the moment a record goes live | slide |
| `facts_confirmed` / `facts_sampled` | a random few of this hour's facts fetched from the live site and found there | a small sampler after publish (3 a hour, public pages only) | slide |
| `spend_usd` / `unpriced_charges` | money settled this hour (cp_log_costs) | at settle | hunters |
| `cost_per_fact_usd` | spend over facts_live; null when either is unknown or facts_live is 0 | computed in the writer | hunters |
| `neon_bytes_read` | bytes the runner itself received from Postgres this hour | the per-query counter (below) | hunters |
| `neon_bytes_by_caller` (jsonb) | the same bytes split by calling code, top 20 plus "other" | the per-query counter | hunters |
| `rounds_finished` / `rounds_killed` / `rounds_deferred` | research rounds that ended normally, were killed by the watchdog, or ended with a named deferral | the round end and the watchdog | hunters |
| `paid_jobs_ended_empty` | paid jobs (Scout, Detective, model calls on budgeted work) that ended with no saved result. **Must be 0.** | the job end | hunters |
| `paid_jobs_ended` | all paid jobs that ended | the job end | hunters |
| `neon_project_bytes` | Neon's own project data_transfer_bytes at the end of the hour, when the API answers; else null | the writer, via the Neon API if a key is configured. Otherwise River fills it by hand | River |
| `release_sha` | code the runner ran this hour | the heartbeat | hunters |
| `written_at` | when written | n/a | n/a |

The row is written once at the end of each hour (upsert by `hour`), plus a running partial row every 10 minutes so a crash keeps most of the hour. The writer reads only its own in-memory counters and one `cp_log_costs` sum over the hour by index. It never scans a whole table.

## The per-query byte counter (hunters, repository layer)

- Wrap the Postgres client used by the runner (`lib/control-plane/repository/pg-store.ts`) so each query adds its result size (the sum of the row payload lengths as received) to a counter keyed by caller.
- The caller is a short tag passed with the query, or else the first frame outside `repository/` in the stack, cached per call site.
- No logging per query. In memory only; flushed into the hour row.
- Check it once against the Neon project total over a quiet hour. Expect the counter to be at or below the project total, since Admin and the site also read.

## Admin Now and the daily brief (admin)

- Now shows the last full hour and the hour before:
  - facts live;
  - cost per fact;
  - Neon GB read (against the 0.7 GB target);
  - rounds finished versus killed;
  - paid jobs that ended with nothing (red when above 0).
- A number not recorded shows "—".
- The brief shows the last 24 rows.
- Both read `cp_vital_signs` only.

## The release gate (Sean approved it, Oct 6)

A release is done only after one full hour on the droplet whose row is at or better than before and inside the targets: under 0.7 GB, 0 paid jobs ended empty, cost per fact falling. "Clearly worse" means rollback (DB-47) and a return with the numbers. **The rule for "clearly worse" is shown to Sean on real hours before any rollback happens.** River's draft is in status.md.

## Estimated Neon cost of the vital signs themselves

- One upsert of about 2 KB every 10 minutes, plus one indexed sum over the hour's cost rows (well under 1 MB).
- Admin reads at most 48 rows of about 2 KB.
- Total: well under 1 MB an hour.
