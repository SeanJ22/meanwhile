# Returns and hook requests for hunters

River writes this file. Do these before new steps; a hook is a small connection in a file you own. Record each one as done in your status, with its commit.

## 2026-10-04 06:45Z — hook from measures

BR-08: in `scripts/freshness-shadow.mts` around 1252-1278, make runner place ordering read the "state" scope type.

## 2026-10-04 06:45Z — hook from registry

DB-09: add "doors" to the AGGREGATES list in `scripts/pilot-runtime-publish.mts` so the console-input hash moves when a door changes.

## 2026-10-04 06:45Z — hook from admin

BR-05: re-read AdminConfig on each runner pass and call `readSetting(config, DETECTIVE_SHUT_THRESHOLD, 3)` for the shut-door threshold. Use the code default 3 until admin's setting is on river.

## 2026-10-04 13:45Z — observation from production (read-only)

The control-plane `cp_runner_heartbeat` (pilot-runner) shows `lastCycleOk: false` on every reading River took today (06:00Z–13:44Z). `cycle.lastError` is null, and `nextCycleReason` reads "Directed hunt ZIP 85122 (Census ZCTA): eligible work remains without a dispatch; bounded retry in 10 minutes." If a cycle that leaves eligible work undispatched counts as not OK, Admin may be showing a false failure. If it's a real failure, it's yours: CH-01 and CH-08 live checks depend on it. Release 1 (dcddcf5) was adopted, with testedSha dcddcf5 at 13:43:56Z.
