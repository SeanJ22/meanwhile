# Hook requests routed by River

| Time | From | To | File | Status |
|---|---|---|---|---|
| 06:45Z | people CA-12 | ballot | app/api/ask/grounded/route.ts | sent |
| 06:45Z | slide CP-01 | ballot | lib/ask (filedAddress removal) | sent |
| 06:45Z | measures BR-08 | admin | lib/control-plane/gateway/registry.ts | sent |
| 06:45Z | measures BR-08 | hunters | scripts/freshness-shadow.mts | sent |
| 06:45Z | registry DB-09 | admin | command center door list | sent |
| 06:45Z | registry DB-09 | hunters | scripts/pilot-runtime-publish.mts AGGREGATES | sent |
| 06:45Z | admin BR-05 | hunters | runner reads DETECTIVE_SHUT_THRESHOLD | sent |
| 06:45Z | admin BR-05 | auditors | DP-02 reads the setting | sent |
| 06:45Z | registry DB-09 | river | BOOTSTRAP_VERSION 18→19; renumber if another lane bumps | River watches at fold |
| 2026-10-05 16:55Z | admin BR-05 (ready ae9ff834, folding) | hunters | scripts/pilot-runner.mts: each pass re-reads AdminConfig, `readSetting(config, DETECTIVE_SHUT_THRESHOLD, 3)`, writes `runnerSettingsEcho(config)` into the heartbeat `settings` | sent |
| 2026-10-05 16:55Z | admin BR-16/BR-37 (ready ae9ff834, folding) | hunters | scripts/pilot-runner.mts: always-on parent timer (separate from ownerControlTimer) calling `fireDueOrders(deps, nowIso)` from lib/control-plane/gateway/scheduled-fire.ts between rounds, after each handoff, once at start | sent |
| 2026-10-05 16:55Z | slide CP-19 (ready 6921176c, folding) | auditors | DP-03 routes INFO FIELD_OUTSIDE_RECORD_BLOCK findings to a detective without holding a valid minimum record | sent |
| 2026-10-05 16:55Z | slide BX-01 | river | boxFindings repository and schema; standing-runtime, freshness-shadow and Admin connections (see .factory/slide-continuation.md) | River, next |
