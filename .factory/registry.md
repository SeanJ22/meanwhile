build_state: active
worker: registry
provider: Claude
run_id: session_012Br3oqBisWocYf2w8VnPPs (Claude Sonnet 5.5)
lock: registry-20261004T061107Z-30911
heartbeat: 2026-10-04T06:16:58Z
on_river: none
ready: DB-09 at b8c61d41d47b4d2a2a7137404bc69f8ba619437b
checks: tsc --noEmit clean; eslint on changed files clean; tests/door-registry.test.ts 4/4; 119 repository-touching test files: 1313/1322 pass, the 9 failures (ask-gap-observation x5, plural x3, control-plane-request-bounds x1) fail identically without this change. Tested SHA = ready SHA (status-file commit after it only).
working_on: DB-10 next (seed registry from SOURCE_WIRING)
waiting_on: none
returned: none
needs_hook: (1) DB-09 Admin door list + receipt log: Admin lane must render lib/doors/registry.ts listDoors(repos.doors) and the door.save receipts in the command center, and add "doors" to the AGGREGATES list in scripts/pilot-runtime-publish.mts (hunters-owned) so the console-input hash moves when a door changes. (2) River: DB-09 bumps BOOTSTRAP_VERSION 18 -> 19 (cp_doors); renumber at integration if another lane also bumped. (3) Registered door.save with one spread (...DOOR_ACTIONS) in lib/control-plane/gateway/registry.ts (admin-owned, 2 lines).
needs_Sean: none
seen_not_fixed: tests/ask-gap-observation (5), tests/plural (3), tests/control-plane-request-bounds (1) already fail on river @ 0b31938.
runs_and_working_minutes: 1 run so far; working minutes unknown
