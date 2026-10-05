build_state: active
worker: codex-admin
provider: Codex
run_id: codex-admin-97a60c06ff864ac48733751bec7f5663
lock: codex-admin-97a60c06ff864ac48733751bec7f5663
heartbeat: 2026-10-05T18:56:04Z
on_river: BR-01 BR-02 BR-03 BR-05 BR-06 BR-09 BR-10 BR-12 BR-15 BR-16 BR-24 BR-37 CH-12 CH-14 @ 85a0ad660c36 (BR-05/16/37 hooks pending)
ready: BR-07 @ f2ca419ef23849c4c941fc7f6b78752ed9727e97; BR-05 BR-06 BR-01 BR-03 @ b593ef9b1; BR-24 @ 73a952059; BR-12 @ dadebfafb; BR-15 @ cfb115b24; BR-05 test fix @ c53405a83; BR-09 @ 87e72a077; BR-02 @ a4a64e1f7; BR-10 @ b318ac51b; BR-16 BR-37 (library half, hook pending pilot-runner) @ 3945aff27; CH-12 @ 1408acfe5; CH-14 @ ae9ff8348. Not READY: BR-13 (WIP 2a2db11c2, ceiling/setting before-after built, hunt score half open). Take the latest READY commit on stream/admin; it contains all of the above.
checks: BR-07 exact tested SHA f2ca419ef23849c4c941fc7f6b78752ed9727e97: tsc PASS; eslint PASS (0 errors, pre-existing unused N warning); focused UI/live-sync 37 PASS. Actual affected selector FULL against origin/river ecf402600401783b094837c29e0c515eadbdb843. FULL 9,334 PASS, 16 could-not-run browser failures, 10 SKIP out of 9,360; no code failures. Identical baseline browser failures verified on plain ecf402600: admin-readiness-cell-state (5), mounted-live-transition (1), beacon-guard (3), chromium-pin (2), maptiler-barrier (4), reader-recent-vote-expansion (1). No Playwright Chromium build in /home/agent/.cache/ms-playwright; /opt/pw-browsers absent. reader-recent-vote-expansion leaves a server open before the failed browser launch on both SHAs; terminated that one hung FULL worker after 8+ minutes, baseline timed out at 20s. Timing artifact incomplete; never usable for scheduling. Tests used unset DATABASE_URL/WTP_ASSET_STORE, no .next, regenerated place references, full history. Per River FULL/browser guidance this is READY with browser acceptance reserved to River. See admin-checks.md for exact commands and evidence.
working_on: BR-04 BR-11 BR-26 BR-35 BR-39 in next-batch WIP; then BR-36 and remaining brief order
waiting_on: none
returned: BR-08 state hook: verified earlier, no admin enum to widen (expansion.scope.set delegates to validateScopeGeography). DB-09 doors panel: built (DoorsPanel on Workers, /api/admin/v6/doors) - needs registry's doors repo (present only once river has lib/doors/registry.ts).
needs_hook:
  - BR-05 (hunters, scripts/pilot-runner.mts): each runner pass re-read AdminConfig and call readSetting(config, DETECTIVE_SHUT_THRESHOLD, 3); record runnerSettingsEcho(config) on the heartbeat's settings field so Workers shows the value in force. auditors DP-02 consumes the setting.
  - BR-37/BR-16 (hunters, scripts/pilot-runner.mts): an always-running parent timer, separate from ownerControlTimer, that calls fireDueOrders(deps, new Date().toISOString()) from lib/control-plane/gateway/scheduled-fire.ts between rounds and outside them, restarts after each release handoff, and calls once at start for overdue orders. Idempotent per order occurrence.
needs_Sean: none
seen_not_fixed:
  - BR-11: Hosting and ZIP regexes fixed (in the BR-09 commit); capture health still buckets days in UTC because the store keys events by UTC day. Eastern days need hourly data from the store.
  - BR-12/BR-13: hunt and mission progress by place score, and score before/after at finish, are not built (no score at acceptance is stored). Ceiling and setting receipts do show Done with before and after (WIP commit 2a2db11c2, not READY because the hunt half is open).
  - BR-04/11/26/35/39 are active WIP in the next batch. BR-36 needs a River-numbered migration. BR-18/20/19/17/27/28/29 still open.
  - Updates feed (BR-24) EXPECTED items are shown labeled, never as wins; later sources call addUpdate(repos, {...}) / addUpdates from lib/control-plane/updates.ts. Fix list: addFixItem(repos, {where, says, by, at}) from lib/control-plane/fix-list.ts is the one call for shut doors, look flags, slow pages and audit flags.
runs_and_working_minutes: overflow-1 2026-10-05 run started 15:58Z
