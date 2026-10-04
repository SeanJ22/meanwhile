build_state: active
worker: registry
provider: Claude
run_id: session_012Br3oqBisWocYf2w8VnPPs (Claude Sonnet 5.5)
lock: registry-20261004T061107Z-30911
heartbeat: 2026-10-04T07:25:41Z
on_river: none
ready: DB-09..DB-12 at 713fb9b8eef7280faca1895b0ba34627fd21bda8; DB-25 (library: lib/doors/probe.ts, tested with a counting fake feed) at 74a5bb6591038388b3680da5a66ea79fd7f17733, cumulative. DB-25 is NOT complete for its live done-when: the runner must call probeDoors before each scheduled read and record results (hook below).
checks: DB-25 @ 74a5bb6591038388b3680da5a66ea79fd7f17733: tsc clean; eslint clean; door-registry*.test.ts 15/15; control-plane-conformance + admin-action-gateway 71/71. Change is confined to lib/doors and tests, so no wider selection was run. Earlier DB-12 wide run recorded above in git history.
working_on: none right now; next: DB-17, DB-21, DB-13 (lock released at this checkpoint)
waiting_on: none
returned: none
needs_hook: (1) DB-09 Admin door list + receipt log: Admin lane must render lib/doors/registry.ts listDoors(repos.doors) and the door.save receipts in the command center, and add "doors" to the AGGREGATES list in scripts/pilot-runtime-publish.mts (hunters-owned) so the console-input hash moves when a door changes. (2) River: DB-09 bumps BOOTSTRAP_VERSION 18 -> 19 (cp_doors); renumber at integration if another lane also bumped. (3) Registered door.save with one spread (...DOOR_ACTIONS) in lib/control-plane/gateway/registry.ts (admin-owned, 2 lines). (4) DB-10: run `node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/seed-doors-from-meetings.mts --apply` once on the production runner after the cp_doors table exists (not run here: production is read-only for this worker). Derived rows (promoted wiring) could not be read from the cloud session, so only the 129 hand-wired doors were verified here; the script reads them on the runner. (5) DB-12: scripts/ingest.ts (meetings) must call `await installDoorWiringFromRegistry(repos.doors)` (lib/doors/install.ts) at the start of each pass; switch WTP_DOORS_READ=registry stays OFF until checked live. River: DB-12 changed the official-page-events extractor id (re-keys saved methods/wiring rows) because lib/registry/source-wiring.ts is in its closure. Still reading SOURCE_WIRING at module load (need DB-13): lib/civic-data/meeting-partitions.ts, lib/meetings/notice-pages.ts, lib/meetings/history-gaps.ts, lib/registry/curated-bodies.ts, scripts/ingest.ts lines ~218/1430. (6) DB-25: the meeting runner (meetings lane, scripts/ingest.ts / lib/civic-data/runner.ts) should call probeDoors(doors, pacedFetch, now) before each scheduled read, skip the read on UNCHANGED, read on CHANGED/FAILED/NOT_PROBEABLE, and recordProbe() each result; Admin door list shows validators.checkedAt as "last looked".
needs_Sean: none
seen_not_fixed: ~248 tests (ask-code-reading-money, routing/Ask, plural, ask-gap-observation, control-plane-request-bounds, etc.) already fail on river @ 0b31938; full list of names kept by this worker in the run logs.
runs_and_working_minutes: 1 run so far; working minutes unknown
