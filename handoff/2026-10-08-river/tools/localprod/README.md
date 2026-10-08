# localprod: a local copy of Meanwhile production

Built 2026-10-07 (UTC) from repo `/home/user/meanwhile` at `f566ec0f`. Nothing in the repo was modified.

- Postgres 16.15 on `127.0.0.1:54329`. It holds two databases: `reader` (production reader DB `neondb`, including the `drizzle` schema) and `controlplane`.
- A Neon shim on `127.0.0.1:54330`:
  - `POST /sql` speaks the Neon HTTP SQL protocol.
  - `WS /v2` speaks the Neon wsproxy protocol (raw Postgres wire).
  - `GET /stats` shows request counters by database.
  - It writes one log line per request to `run/neon-shim.log`.
- `shim/preload.mjs` is loaded with `node --import` via `NODE_OPTIONS`.
  - It rewrites `fetch` and `WebSocket` calls to `*.localprod.test` so they go to the shim.
  - It refuses any request to `neon.tech` or `api.netlify.com`.
  - It patches globals rather than `neonConfig`, so it works for every copy of `@neondatabase/serverless`: plain node, tsx, and the Next server bundle.

## Start / stop / reset

```bash
LP=/tmp/claude-0/-home-user-meanwhile/d66f8503-5066-5aa1-9543-6c62b6fc4036/scratchpad/localprod
$LP/up.sh      # start Postgres (inside a user namespace, so the root-owned data dir works) + shim
$LP/down.sh    # stop both; data kept
$LP/reset.sh   # stop, replace pgdata with pristine/pgdata (identical data), start  (~15 s)
```

`pristine/pgdata` is a cold copy of the data dir, taken right after the copy was verified (5.7 GB).
Run `reset.sh` before each before/after run.

Postgres must run in a user namespace (`unshare --user --map-user=1000`) for two reasons:
- initdb and postgres refuse to run as root.
- The scratch path is mode 700 under root, and something resets the parent dirs to 700.

It listens on TCP only, because the socket path would be over 107 bytes. Postgres-side passwords are
`localprod` for the roles `neondb_owner` (owner of everything), `readonly` and `wtp_cp_release_readonly`.
User `postgres` is trusted over TCP from 127.0.0.1.

## Env recipe

Base, for every case:

```bash
cd /home/user/meanwhile
$LP/up.sh
source $LP/env.sh                      # DATABASE_URL, WTP_CONTROL_PLANE_DATABASE_URL, *_READONLY -> fake local hosts,
                                       # WTP_DB_ROLE=local, NODE_OPTIONS=--import preload, blocks neon.tech/netlify api,
                                       # unsets WTP_PRODUCTION_DATABASE_URL_WRITE / WTP_SANCTIONED_WRITE / NETLIFY_* tokens
export NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt   # only for outbound non-DB HTTPS (sources)
```

`WTP_ASSET_STORE` is left unchanged (`/tmp/wtp-assets`).

**(a) node / tsx scripts:** `node_modules/.bin/tsx scripts/<x>.mts ...` or `node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/<x>.mts`.
The `NODE_OPTIONS` preload covers both. Proof: `tools/cp-bootstrap-check.mts` ran the app's own control-plane bootstrap through the shim. That was 150 HTTP queries, and `pg_dump --schema-only` was byte-identical before and after.

**(b) Next:** `pnpm dev`, or `pnpm build && pnpm start`. Port 3000 must be free (the `predev` check).
Proof with `pnpm dev`:
- `GET /ballot?zip=85701` returned 200 with the full Arizona ballot (Governor and so on, election dates).
- That one request made 62 shim requests to `reader`.
- `/about-area?zip=85701` and `/` returned 200.
- The Next server's own fetches went through the preload. Next 16 / Turbopack bundles the driver, but the global patch still applies.

Admin:
- Send `Host: admin.meanwhileusa.com` (middleware routes by host).
- Sign in through Google (not possible locally) or the break-glass path: `WTP_ADMIN_BREAK_GLASS=enabled`, with a local-only `WTP_ADMIN_SECRET`. This was not exercised.

Ask reads `ANTHROPIC_API_KEY`, which is not set in this environment.

**(c) Runner, one cycle:**
```bash
node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/pilot-runner.mts --staging --cycles=1
```
- `--staging` requires `WTP_DB_ROLE=local` and both URLs, which `env.sh` sets.
- It writes only local DBs and `.runtime/`/`.mirror/` in the repo (gitignored), and skips billing and live-site readbacks.
- Netlify Blobs writes cannot happen because no `NETLIFY_*` credentials exist and `api.netlify.com` is blocked.

**NOT RUN.** See "Did not work / caveats".

## Data: row counts (local vs source count at read time)

Source counts were taken when each table was read (UTC):
- Reader tables: about 19:55.
- `civic_data_candidates`: 20:20 to 20:24.
- cp tables: 19:55 to 20:07.

This is not a single-instant snapshot. All copied tables match. Full list: `notes/row-counts.json`.

| db | table | rows |
|---|---|---|
| reader | civic_data_candidates | 31,730 (every row md5-checked per jsonb column against the source) |
| reader | civic_data_candidate_events | 123,274 |
| reader | civic_data_promotions | 633 |
| reader | civic_data_payload_parts | 752 (also re-copied and checked equal row for row) |
| reader | civic_data_reader_projections | 1 |
| reader | search_log | 5,637 |
| reader | reader_event_members / totals / batches | 5,876 / 368 / 569 |
| reader | reactions / database_transfer_daily / drizzle.__drizzle_migrations | 49 / 30 / 35 |
| reader | demand_signals / feedback / feedback_contact / write_alarm / cp_log_heads / cp_log_software_release_reviews / cp_schema_version | 2 / 3 / 3 / 1 / 1 / 1 / 1 |
| reader | the 31 other tables (legacy cp_* copies, meetings, questionnaire_*, ask_interactions, agenda_documents, intake_limiter, speak_your_mind) | 0 at source, 0 local |
| controlplane | cp_log_heads | 41,555 |
| controlplane | cp_log_owner_digests | 85,970 (every row md5-checked) |
| controlplane | cp_log_software_release_reviews | 333 |
| controlplane | cp_schema_version | 1, written locally as version 25 = `BOOTSTRAP_VERSION` (table was unreadable) |

Structure-only controlplane tables. These were EMPTY because the role had no SELECT at copy time. Their structure is exact: catalog-derived, then checked against the app's bootstrap DDL.
- cp_admin_action_history_projection, _readiness, _scope_ref
- cp_admin_config, cp_admin_evidence_copy_requests, cp_ask_gap_observations, cp_attempts, cp_budget, cp_cache_observations
- cp_checklist_instance_projections, cp_checklist_scope_heads, cp_debts, cp_doors, cp_field_manual, cp_leases
- cp_log_admin_receipts, cp_log_agent_jobs, cp_log_artifacts, cp_log_costs, cp_log_discovery_attempts, cp_log_dispositions
- cp_log_escalations, cp_log_live_audits, cp_log_owner_decisions, cp_log_promotion_pipeline, cp_log_research_intents
- cp_log_scout_results, cp_log_transitions, cp_log_window_incidents, cp_log_window_intents, cp_log_window_runs
- cp_log_worker_results, cp_method_candidates, cp_obligations, cp_occurrences, cp_owner_snapshots
- cp_readiness_snapshots, cp_research_state, cp_route_tasks, cp_runner_heartbeat, cp_spend_holds, cp_vital_signs, cp_work_items

## Schema

The schema was rebuilt from the source catalogs (`catalog/*.json`, generated by `tools/extract-catalog.mjs`) into `ddl/*-pre.sql` and `ddl/*-post.sql`.
That covers columns, types, defaults, PKs, unique, check and FK constraints, indexes, functions, triggers, and the sequence.

Numbers:
- reader: 58 tables, 110 indexes, 77 constraints, 6 functions, 7 triggers.
- controlplane: 47 tables, 103 indexes, 69 constraints, 7 functions, 43 triggers.

The drizzle sequence was not readable, so it was set to max(id) = 35.
Source session settings are matched: TimeZone GMT, DateStyle ISO, extra_float_digits 1, C.UTF-8 collation.

## How the copy was made (and what it cost)

All source access went through `tools/neonsrc.mjs`. It only accepts SELECT, runs each query in a READ ONLY batch, and counts response bytes.
- Small tables: `tools/copy-data.mjs` (keyset chunks of about 16 MB, resumable through `state/`).
- `civic_data_candidates`: 11.4 GB of jsonb text naively. Copied with `tools/copy-merkle.mjs`:
  - rows are read one level deep;
  - each distinct subtree over 512 B is read once (872,888 nodes);
  - values are rebuilt locally;
  - every row's md5 is checked.
- `cp_log_owner_digests`: copied with `tools/copy-dedup.mjs` (depth 4, 512 B).

**Total read from Neon: 4,021 MB** of decoded HTTP bodies (`notes/neon-bytes.log`). Of that:
- candidates: 2,904 MB
- owner_digests: 652 MB
- the rest of reader: 339 MB
- a verification re-copy of payload_parts: 81 MB
- catalogs, plans and probes: the remainder

## Did not work / caveats

- **44 controlplane tables are structure-only.** The coordinator relayed that SELECT is now granted. A catalog re-read confirms it: all 47 tables now show `has_table_privilege = true`, and the structure is unchanged.
  - My next production reads (per-table stats, then verification) were refused by the session's auto-mode permission classifier ("PII Data Handling"). The copy was not done.
  - To finish once that is allowed:
    ```bash
    $LP/up.sh
    cd $LP/tools
    NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_NO_WARNINGS=1 REPLICA=1 \
      EXCLUDE=cp_log_heads,cp_log_owner_digests,cp_log_software_release_reviews node copy-data.mjs cp
    ```
    - Then delete local `cp_schema_version` first, or skip it: it will be overwritten from the source.
    - `REPLICA=1` keeps the immutability and `changed_at` triggers from firing or rewriting data.
    - Then run `node tools/local-counts.mjs` (point it at `catalog/cp.json`), `down.sh`, and refresh `pristine/`.
- **The runner cycle was not run.**
  - Production spending limits and pauses live in `cp_budget` and `cp_admin_config`, which are empty locally.
  - `WTP_WORKERS_ANTHROPIC_API_KEY` is present, so a cycle would spend real money with no Admin limits.
  - Run it only after the cp tables are copied, or with that key unset.
- Postgres 16 locally versus 18.6 at the source. The app uses no PG 17/18-only SQL (grepped).
- **Not byte-identical to the source:**
  - `database_transfer_daily` (the row for 2026-10-07 reader/reader) was incremented by local app runs before the snapshot. Re-copy it once reads are allowed if that matters.
  - `cp_schema_version.applied_at` is local.
- Three of my read-only estimate queries (recursive CTEs, about 20:00 UTC) hit the reader compute's temp-file quota ("Disk quota exceeded") and failed. They were replaced by non-materializing queries. Production queries may have seen temp-space pressure for those minutes.
- A long single HTTP query (over 2 min) was cut by the proxy ("other side closed"). Plans are now split into key ranges.
