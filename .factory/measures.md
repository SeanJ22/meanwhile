build_state: active
worker: measures
provider: Claude
run_id: session_01RkTH4irupRuJQD5Ny5gPmk
lock: measures-20261004-061450-01RkTH
heartbeat: 2026-10-04T06:44:00Z
on_river: none
ready: SC-01 @ 7d3c08528e09af8fd9eaccedc6b12073716ec470; SC-03 @ 1e2161a7d449bd7c2928ba45ed3e7435ee804a07; SC-20 @ 409187029bff1ebbe06a953c2eca71844f9595ec; SC-02 @ 5e52e0c20d51d9fc45e757a4bb410d7bbb7efc3d
checks: tsc --noEmit clean; eslint on changed files clean at 5e52e0c20d51d9fc45e757a4bb410d7bbb7efc3d. Tests: checklist-map (overlay vs profile for all 325 IDs), place-percent, held-place-capture (counts updated for REF rows 14->18, 22->26 and MTG-20 counted once 9->8), dispatch-work, coverage, admin-v6-*, admin-checklist-*, assignment-view, attempt-families: 367 pass; the only failure is the Ask-route source-ID test that also fails on the unchanged base. Full suite not run. The live checklist card was not viewed (no Admin sign-in here).
working_on: SC-02 ready (CH-15 and BX-07 can start). Next SC-05, then SC-12 (hunters wait on both); BR-08 held for shared-file hooks; BR-23 waits on BR-01.
waiting_on: BR-23: BR-01 (admin lane) not yet on river. SC-17: Sean's decision D7 (parked)
returned: none
needs_hook: BR-08: admin-owned lib/control-plane/gateway/registry.ts (expansion.scope.set accepts a "state" scope type) and hunters-owned scripts/freshness-shadow.mts:1252-1278 (runner place ordering reads "state"). Requested through River; scopes.ts, place-owed-read memo, bulk-hunts.tsx and actions.ts are mine and proceed.
needs_Sean: none
seen_not_fixed: 4 tests fail on base 0b31938 (Ask route source IDs; national geography walk; Arizona district seats x2) and 6 more (ASK-5 roster x2; one point-in-polygon sweep x2; governor coverage; tier membership). SC-20 note: the snapshot carries family only for attempts published after this lands; older snapshot rows show under no family until the next snapshot.
runs_and_working_minutes: 1 run
