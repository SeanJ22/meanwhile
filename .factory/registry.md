build_state: active
worker: registry
provider: Claude
run_id: session_012Br3oqBisWocYf2w8VnPPs (Claude Sonnet 5.5)
lock: registry-20261004T061107Z-30911
heartbeat: 2026-10-04T06:21:08Z
on_river: none
ready: DB-09, DB-10, DB-11 at 165e9536bbadb0f587bfefc897fb71457691a27c (cumulative; DB-09 alone at b8c61d41d47b4d2a2a7137404bc69f8ba619437b)
checks: DB-11 @ 165e9536bbadb0f587bfefc897fb71457691a27c: tsc --noEmit clean; eslint clean; door-registry*.test.ts 9/9; seed script against a file store: 129 hand-wired + 78 feed doors created, re-run unchanged. Earlier: control-plane-conformance + admin-action-gateway pass; 9 pre-existing unrelated failures noted.
working_on: DB-17 next (chain: DB-12 needs DB-10, DB-25)
waiting_on: none
returned: none
needs_hook: (1) DB-09 Admin door list + receipt log: Admin lane must render lib/doors/registry.ts listDoors(repos.doors) and the door.save receipts in the command center, and add "doors" to the AGGREGATES list in scripts/pilot-runtime-publish.mts (hunters-owned) so the console-input hash moves when a door changes. (2) River: DB-09 bumps BOOTSTRAP_VERSION 18 -> 19 (cp_doors); renumber at integration if another lane also bumped. (3) Registered door.save with one spread (...DOOR_ACTIONS) in lib/control-plane/gateway/registry.ts (admin-owned, 2 lines). (4) DB-10: run `node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/seed-doors-from-meetings.mts --apply` once on the production runner after the cp_doors table exists (not run here: production is read-only for this worker). Derived rows (promoted wiring) could not be read from the cloud session, so only the 129 hand-wired doors were verified here; the script reads them on the runner.
needs_Sean: none
seen_not_fixed: tests/ask-gap-observation (5), tests/plural (3), tests/control-plane-request-bounds (1) already fail on river @ 0b31938.
runs_and_working_minutes: 1 run so far; working minutes unknown
