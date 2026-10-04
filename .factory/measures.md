build_state: active
worker: measures
provider: Claude
run_id: session_01RkTH4irupRuJQD5Ny5gPmk
lock: measures-20261004-061450-01RkTH
heartbeat: 2026-10-04T06:35:27Z
on_river: none
ready: SC-01 @ 7d3c08528e09af8fd9eaccedc6b12073716ec470; SC-03 @ 1e2161a7d449bd7c2928ba45ed3e7435ee804a07; SC-20 @ 409187029bff1ebbe06a953c2eca71844f9595ec
checks: tsc --noEmit clean; eslint on changed files clean at 409187029bff1ebbe06a953c2eca71844f9595ec. Tests: new tests/attempt-families.test.ts, assignment-view, SC-01/SC-03 sets pass; registry/coverage/panel set has 6 failures identical on the unchanged base (ASK-5 roster x2, one point-in-polygon sweep x2, governor coverage, tier membership). Full suite not run. Admin screens and live map popup not viewed (no Admin sign-in here).
working_on: SC-20 ready; next SC-02
waiting_on: BR-23: BR-01 (admin lane) not yet on river. SC-17: Sean's decision D7 (parked)
returned: none
needs_hook: BR-08: admin-owned lib/control-plane/gateway/registry.ts (expansion.scope.set accepts a "state" scope type) and hunters-owned scripts/freshness-shadow.mts:1252-1278 (runner place ordering reads "state"). Requested through River; scopes.ts, place-owed-read memo, bulk-hunts.tsx and actions.ts are mine and proceed.
needs_Sean: none
seen_not_fixed: 4 tests fail on base 0b31938 (Ask route source IDs; national geography walk; Arizona district seats x2) and 6 more (ASK-5 roster x2; one point-in-polygon sweep x2; governor coverage; tier membership). SC-20 note: the snapshot carries family only for attempts published after this lands; older snapshot rows show under no family until the next snapshot.
runs_and_working_minutes: 1 run
