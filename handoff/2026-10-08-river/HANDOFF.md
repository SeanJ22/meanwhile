# Handoff: River releases 15–20 (Oct 7–8, 2026)

Written 2026-10-08 at 3:55 PM ET (19:55 UTC), when Sean stopped the session.

**Sean's instruction at the stop: no more releases.** Ship nothing to `main` unless Sean asks again. Everything below that says "fix" is a finding to bring to Sean, not permission to release.

Read first: `CLAUDE.md` and `docs/rulings.md` (never edit rulings).

---

## 1. Where things stand

### Merged and live on production

| Release | PR | What it does | Post-deploy check |
|---|---|---|---|
| 15 | [#722](https://github.com/SeanJ22/meanwhile/pull/722) | Claude Haiku 5.5 everywhere; docs-only PRs certified on open; cancelled CI runs leave no red checks | passed |
| 16 | [#723](https://github.com/SeanJ22/meanwhile/pull/723) | Runner processes read only what changed (held copies on the runner disk, keyed by database and schema version); worker-reader-publication reads its own items; research state uses CAS without a re-read; publish-now wired into pilot-runner | passed on re-run (the first run failed only because the schema hadn't moved yet) |
| 17 | [#724](https://github.com/SeanJ22/meanwhile/pull/724) | Field manual is one row per lesson (`cp_field_manual_entries`, schema 27); fix map; ranking; platform scoping; auto-try (`planSpread`); lesson copy; the door registry is the only door list (code list and door switches deleted). Also PN-01: an empty publish-now minute exits 0 | passed |
| 18 | [#725](https://github.com/SeanJ22/meanwhile/pull/725) | Research-leads upload in Admin (schema 28, `cp_lead_orders`) | passed |
| 19 | [#726](https://github.com/SeanJ22/meanwhile/pull/726) | Fixes 17's crash loop: the research cycle read the manual once per due place, all at once (~1,700 × 5.6 MB). It now reads once and shares the rows | passed |
| 20 | [#727](https://github.com/SeanJ22/meanwhile/pull/727) | Cuts steady Neon reads (NR-01…NR-08, below); fixes Admin's daily transfer undercount | not checked yet |

`main` = `e8abc6e7` (release 20 merge). `river` = `6358f063` (the tested commit of release 20). Every lane is folded; nothing is waiting on River.

### Production runner at handoff (19:52 UTC)

- On release 20 (`e8abc6e7`); it switched at 19:34 UTC by itself.
- First cycle on 20 started 19:34:37 UTC and was **still running** at 19:52, so its outcome is unknown.
- Memory is tight:
  - At 19:44 the runner tree was 6.58 GB of the 8.33 GB host, with 1.74 GB available and fitLeaseWorkers 0.
  - At 19:52 it was 4.48 GB, with 3.61 GB available.
  - One process, pid 2520982 (very likely `scripts/freshness-shadow.mts`, the research cycle), was at 2.24 GB RSS with a peak of 3.07 GB.
- Publishing lanes (routine civic data, publish-now) kept running through all of today's crashes.

---

## 2. Open problem #1: intermittent out-of-memory abort in the research cycle

**Symptom:** the cycle child `scripts/freshness-shadow.mts` (started by `scripts/pilot-runner.mts`) dies with SIGABRT. The heartbeat (`cp_runner_heartbeat`, row `pilot-runner`) shows `cycle.signal = "SIGABRT"` and `lastError` holding native frames 3–10.

**History today (UTC):**
- 10:19–13:07, on releases 17 and 18: every cycle died about 3.5 min in. Cause found and fixed in release 19 (per-place manual copies).
- Release 19's cycles at 13:34 (30 min long), 14:37 and 17:02 finished OK.
- **18:52:11 → 19:12:14, on release 19: died after 20 min.**
  - Frames 3–5 are the same out-of-memory path (`0xc70d60`, `0xc70e4f`, `0xf14725` = OOMErrorHandler → ReportOOMFailure → FatalProcessOutOfMemory).
  - Frames 6–10 differ (`0xf2608c`, `0xefb543`, `0xed1050`, `0x13c8948`): a different allocation site.
  - Tree RSS at the crash was 2.70 GB, with 5.3 GB still available, so the process hit its own V8 heap limit, not the machine's RAM.
- Production runs Node v22 at `/usr/bin/node` with **no** `--max-old-space-size`, so the heap limit is Node's default, about 2 GB on that host.

**Why staged runs miss it:** without a model key, the model lane is off ("LANE_DISABLED"), so model dispatch and result handling never run locally.

**Investigation in progress when stopped** (tools saved in `tools/cycle-heap/`):
- `stub.mjs` is a local stand-in for the Anthropic Messages and Batches APIs plus Brave/Exa search. It replays recorded scout walks from `cp_log_scout_results` and never forwards anywhere.
  - It needs a `plans.json` built from the copy's scout results. That file was not saved (about 2 MB of copied data); rebuild it from `cp_log_scout_results`.
- `run.sh <worktree> <label> <heapMB> [cycles] [port]` runs staged cycles with the model lane on (stub key, never a real model), under a chosen heap, using `harness.mjs` for heap profiling.
- **Lead:** the one stub run on release 20 (`repro-memory-release20.log`) reached **1,544 MB heap used and 4.1 GB RSS in the "vault-index" phase**, about 16 min in. Start there: whatever "vault-index" builds or holds in `freshness-shadow` (artifacts, canonical URLs, vault records).
- **Earlier heap snapshot**, taken 37 s into a cycle: 573 MB live, 391 MB of it strings. 125 MB of that is the `canonicalUrl` of about 24k artifacts, some of them 0.5 MB TIGERweb query URLs with geometry inlined.
- **Also check release 20's NR-03 and NR-07**, the civic read cache host in the standing runner and the held-copy row tracking. Production RSS rose after 20 went live; it isn't proven they caused it.
- **Done looks like:** two full model-lane cycles finish under `--max-old-space-size=1536`, with peak heap and RSS per process shown before and after. The fix must not just raise the limit (rulings §5: no switches; delete what you replace).

---

## 3. Neon transfer (Sean asked: why so high)

**Answer:**
- The month's 2,033 GB (control plane 1,887 GB plus reader 147 GB on Neon's meter, Oct 1–8) came mostly from Oct 1–5. Before release 16, the runner re-read the whole field manual document on every job: about 157–207 GB a day.
- On release 19 the measured rate was **about 1.0 GB/hour** (0.62 GB/h control plane plus 0.38 GB/h reader).
- Neon's meter: 15:07Z sample `cp=1884734057760 reader=145457783761`; 18:12Z sample `cp=1886607871762 reader=146586075122` (`tools/neon-meter.log`).
- The runner's own counter (`cp_vital_signs`) agreed with the meter within about 8%.

**Release 20** should cut a projected 0.4–0.55 GB/h more (measured locally as −44% on a warm cycle). It is **not yet verified on production**.

**To verify:** compare the first full hour on 20 (20:00–21:00 UTC) in `cp_vital_signs.neon_bytes_by_caller` and the heartbeat's `neonBytes.lastFullHour` against 14:00–18:00 UTC (CP 0.61–0.79 GB/h, reader 0.28–0.39 GB/h). Then sample Neon's meter with `describe_project`:
- `withered-sunset-39821877` (control plane)
- `tiny-hill-13996172` (reader, "we-the-people")

**Release 20 steps:**
- NR-01: the latest freshness-cycle digest is read alone.
- NR-02: the owner snapshot is read in parts.
- NR-03: the civic read cache is hosted for every runner child.
- NR-04: callers are attributed.
- NR-05: the daily transfer table is written from hourly reports, and WebSocket bytes are counted.
- NR-06: workers read only the settings they need.
- NR-07: held copies skip rows they already hold.
- NR-08: the method-candidate store is reused while its revision is unchanged.

**Remaining Neon items, not done:**
- New candidate and promotion versions transfer whole. Storing payloads as content-addressed parts would cut more, but it changes the storage format, so it needs Sean's OK.
- Spend-window reads, `cp_log_costs.readSince` (about 46 MB/h, plus 23–34 MB/h from `lib/frontend/look-spend.ts:64`), are not held. The held log copy lacks the record time.
- The research cycle read the whole Admin config about 400 times per staged cycle (about 17 MB); the call site isn't pinned yet.

---

## 4. Other open items (none started)

- **Duplicate-record failures:** about 1,380 worker-publication tasks per staged run fail with `AppendOnlyViolation` (concurrent appends of different records under one id). This is existing behavior.
- **Method-candidate contention:** `proposeScoutCandidates` takes 10–50 s per scout result, and at 10 concurrent hits `ConcurrentModification` on the method-candidate store even after retries.
- **Processes over the 0.75 GiB margin:** freshness-shadow, publish-owner-snapshot and routine-civic-data-runner all exceed it.
- **Release 18's leads upload** was checked against a stand-in website only, never with a real upload in Admin.
- **Unused readers:** `readLatestIntakeRuntimeDigest` and `readMapTilerUsageDigests` in `lib/control-plane/admin-data.ts` are unused (tests only) and still read every matching digest.
- **Missing doc:** `CLAUDE.md` points to `docs/how-meanwhile-works.md`, which does not exist. That's Sean's file to change.
- **Stale board:** `board/river` `status.md` is out of date; its narrative stops at release 15. `releases/16..20.json` and `integration.json` are current.
- **Blank counter:** the hourly "facts published" count on the vital-signs dashboard is blank for every hour.
- **Ask follow-ups** (school-board district binding, the labeled AI answer, cold start over 3 s) belong to the lane that owns Ask, not this one.

---

## 5. Sean's standing rules for this work (verbatim where quoted)

- "production databases are read-only to you. Never edit docs/rulings.md, change Admin settings, add a paid service, or print a secret."
- "Per rulings §5, replaced code is deleted in the same change. No on/off switches that keep the old way."
- **No heavy queries on production:** size-estimate queries ran the production reader database out of temp disk around 4 PM ET on Oct 7. Use only tiny, indexed or point reads. For copies, read by ctid ranges (`tools/localprod/tools/copy-cp-ctid.mjs`): no sorts, no temp disk.
- **Merging:** Sean said to merge release PRs once every check is green, and that the runner restart goes through him. In practice the runner picks up new `main` by itself at its next cycle. **Now superseded by "no more releases."**
- Report in plain English, in Eastern time.

---

## 6. How to work here (this container is gone; rebuild what you need)

- **River:** `scripts/river.mjs` does scan, fold, migrations, test, promote and release.
  - Run it with `GITHUB_TOKEN` and `GH_TOKEN` unset (otherwise `release` enables auto-merge), and open the PR through the GitHub MCP.
  - Merge `origin/main` into `river-next` after fold, then set `.scratch/river/fold.json` `head` to the new HEAD before `test`.
  - Add the `run-full-ci` label to release PRs.
  - The lock on `board/river` was **released** at 19:52 UTC.
- **Neon from Node:** set `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
  - Read-only URLs: `WTP_PRODUCTION_DATABASE_URL_READONLY` and `WTP_CONTROL_PLANE_DATABASE_URL_READONLY`.
  - `tools/localprod/tools/neonsrc.mjs` wraps them, and `hbread.mjs <out.json>` reads the runner heartbeat.
- **Local copy of production:** Postgres 16 on 127.0.0.1:54329 plus a Neon HTTP/WebSocket stand-in on 54330 (`tools/localprod/`; see its README).
  - Make runs on private databases from read-only templates: `rundb.sh <label>` and `source env-run.sh <label>`. Never reset the cluster while others use it.
  - `runner-pair.sh` stages two runner cycles with RSS sampling. `walk-set.sh` walks Admin, 36 reader pages and Ask (needs a built worktree and the local admin session key).
- **Builder brief rules** for sub-agents: `tools/brief-common.md`.
- **Shell gotcha:** `pkill -f <pattern>` and `pgrep -f <pattern>` match your own shell; use the `[x]yz` bracket trick.

---

## 7. Suggested next steps (for Sean to approve)

1. Read the heartbeat: did release 20's first cycle (started 19:34 UTC) finish or abort, and has the tree RSS stayed under about 5 GB?
2. Verify release 20's Neon savings on the 20:00–21:00 UTC hour and on Neon's meter.
3. If cycles keep aborting, continue §2 with the saved stub harness. Bring the cause and the fix to Sean before any release.
