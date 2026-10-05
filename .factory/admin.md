build_state: active
worker: codex-admin
provider: Codex
run_id: codex-admin-97a60c06ff864ac48733751bec7f5663
lock: codex-admin-97a60c06ff864ac48733751bec7f5663
heartbeat: 2026-10-05T18:56:04Z
on_river: BR-01 BR-02 BR-03 BR-05 BR-06 BR-09 BR-10 BR-12 BR-15 BR-16 BR-24 BR-37 CH-12 CH-14 @ 85a0ad660c36 (BR-05/16/37 hooks pending)
ready: BR-05 BR-06 BR-01 BR-03 @ b593ef9b1; BR-24 @ 73a952059; BR-12 @ dadebfafb; BR-15 @ cfb115b24; BR-05 test fix @ c53405a83; BR-09 @ 87e72a077; BR-02 @ a4a64e1f7; BR-10 @ b318ac51b; BR-16 BR-37 (library half, hook pending pilot-runner) @ 3945aff27; CH-12 @ 1408acfe5; CH-14 @ ae9ff8348. Not READY: BR-13 (WIP 2a2db11c2, ceiling/setting before-after built, hunt score half open). Take the latest READY commit on stream/admin; it contains all of the above.
checks: tsc PASS and eslint PASS (0 errors) on every READY commit; focused tests PASS; at the last READY commit all 659 tests in tests/admin*.test.ts, tests/admin-v6-ui, operator-chat, execution-accountability-admin-v6-history and absence-defaults PASS. FULL CI-style run at b593ef9b1: 9296 of 9312 pass, 5 fail: two were mine and are fixed (absence-defaults, v6-ui connected kinds) and pass; three are load-timing (control-plane-request-bounds x2, reader-last-mile-officeholder-identity) and each PASSES alone on my branch (the first also on origin/river). No FULL re-run at the final SHA.
working_on: BR-07 full checks at local f2ca419ef; BR-04/35 separate WIP; heartbeat-only publication while checks run
waiting_on: none
returned: BR-08 state hook: verified earlier, no admin enum to widen (expansion.scope.set delegates to validateScopeGeography). DB-09 doors panel: built (DoorsPanel on Workers, /api/admin/v6/doors) - needs registry's doors repo (present only once river has lib/doors/registry.ts).
needs_hook:
  - BR-05 (hunters, scripts/pilot-runner.mts): each runner pass re-read AdminConfig and call readSetting(config, DETECTIVE_SHUT_THRESHOLD, 3); record runnerSettingsEcho(config) on the heartbeat's settings field so Workers shows the value in force. auditors DP-02 consumes the setting.
  - BR-37/BR-16 (hunters, scripts/pilot-runner.mts): an always-running parent timer, separate from ownerControlTimer, that calls fireDueOrders(deps, new Date().toISOString()) from lib/control-plane/gateway/scheduled-fire.ts between rounds and outside them, restarts after each release handoff, and calls once at start for overdue orders. Idempotent per order occurrence.
needs_Sean: none
seen_not_fixed:
  - BR-11: Hosting and ZIP regexes fixed (in the BR-09 commit); capture health still buckets days in UTC because the store keys events by UTC day. Eastern days need hourly data from the store.
  - BR-12/BR-13: hunt and mission progress by place score, and score before/after at finish, are not built (no score at acceptance is stored). Ceiling and setting receipts do show Done with before and after (WIP commit 2a2db11c2, not READY because the hunt half is open).
  - Not started: BR-07 (17 dead controls are tangled with the sample executor, instruction module and 6+ tests), BR-35 (routes are named in netlify.toml, layout and ~17 tests), BR-39, BR-04, BR-26, BR-18, BR-20, BR-19, BR-17, BR-27, BR-28, BR-29, BR-36 (needs a River-numbered migration).
  - Updates feed (BR-24) EXPECTED items are shown labeled, never as wins; later sources call addUpdate(repos, {...}) / addUpdates from lib/control-plane/updates.ts. Fix list: addFixItem(repos, {where, says, by, at}) from lib/control-plane/fix-list.ts is the one call for shut doors, look flags, slow pages and audit flags.
runs_and_working_minutes: overflow-1 2026-10-05 run started 15:58Z
