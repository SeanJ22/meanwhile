build_state: active
worker: overflow-1
provider: Claude (River-run overflow)
run_id: overflow-1 2026-10-05 session_012Ufwyxx6iej1CSEX6khMyg
lock: overflow-1-20261005T1600Z-c91d
heartbeat: 2026-10-05T16:39:00Z
on_river: none confirmed
ready: BR-05 BR-06 BR-01 BR-03 @ b593ef9b1; BR-24 @ 73a952059; BR-12 @ dadebfafb; BR-15 @ cfb115b24; BR-05 fix @ c53405a83; BR-09 @ 87e72a077; BR-02 @ a4a64e1f7; BR-10 @ b318ac51b; BR-16 BR-37 (library half) @ 3945aff27
checks: per step: tsc PASS, eslint on changed files PASS (0 errors), focused tests PASS (admin-fix-list, admin-action-gateway, admin-settings, admin-history-*, admin-runner-confirmation, admin-v6-ui, admin-v6-stuck-causes, operator-chat, absence-defaults). FULL run at b593ef9b1 (env -u DATABASE_URL -u WTP_ASSET_STORE, CI-style): only failures were absence-defaults and v6-ui connected-kinds (both mine, fixed in c53405a83 and re-run PASS) plus two transport-timing tests under load (tests/control-plane-request-bounds.test.ts) that PASS alone on both my branch and origin/river.
working_on: choosing next from brief order (BR-07 is large and tangled with the sample executor and instruction module; BR-26, BR-04 next)
waiting_on: none
returned: BR-08 state hook: verified earlier, no admin enum to widen (expansion.scope.set delegates to validateScopeGeography). DB-09 doors panel: built (DoorsPanel on Workers, /api/admin/v6/doors) - needs registry's doors repo (present only once river has lib/doors/registry.ts).
needs_hook:
  - BR-05 (hunters, scripts/pilot-runner.mts): each runner pass re-read AdminConfig and call readSetting(config, DETECTIVE_SHUT_THRESHOLD, 3); record runnerSettingsEcho(config) on the heartbeat's settings field so Workers shows the value in force. auditors DP-02 consumes the setting.
  - BR-37/BR-16 (hunters, scripts/pilot-runner.mts): an always-running parent timer, separate from ownerControlTimer, that calls fireDueOrders(deps, new Date().toISOString()) from lib/control-plane/gateway/scheduled-fire.ts between rounds and outside them, restarts after each release handoff, and calls once at start for overdue orders. Idempotent per order occurrence.
needs_Sean: none
seen_not_fixed:
  - BR-11: Hosting and ZIP regexes fixed (in the BR-09 commit); capture health still buckets days in UTC because the store keys events by UTC day. Eastern days need hourly data from the store.
  - BR-12/BR-13: hunt and mission progress by place score, and score before/after at finish, are not built (no score at acceptance is stored). Ceiling and setting receipts do show Done with before and after (WIP commit 2a2db11c2, not READY because the hunt half is open).
  - BR-07, BR-35, BR-39, BR-04, BR-26, CH-12, CH-14, BR-18, BR-20 not started.
  - Updates feed (BR-24) EXPECTED items are shown labeled, never as wins; later sources call addUpdate(repos, {...}) / addUpdates from lib/control-plane/updates.ts. Fix list: addFixItem(repos, {where, says, by, at}) from lib/control-plane/fix-list.ts is the one call for shut doors, look flags, slow pages and audit flags.
runs_and_working_minutes: overflow-1 2026-10-05 run started 15:58Z
