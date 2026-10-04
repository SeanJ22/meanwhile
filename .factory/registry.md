build_state: active
worker: registry
provider: Claude
run_id: session_012Br3oqBisWocYf2w8VnPPs (Claude Sonnet 5.5)
lock: registry-20261004T061107Z-30911
heartbeat: 2026-10-04T07:23:30Z
on_river: none
ready: DB-09, DB-10, DB-11, DB-12 at 713fb9b8eef7280faca1895b0ba34627fd21bda8 (cumulative; DB-09 alone at b8c61d41d47b4d2a2a7137404bc69f8ba619437b; DB-11 at 165e9536bbadb0f587bfefc897fb71457691a27c)
checks: DB-12 @ 713fb9b8eef7280faca1895b0ba34627fd21bda8: tsc clean; eslint clean; affected selector (base 0b31938, .factory excluded) chose 659 of 989 files: 248 fail vs 268 on an untouched 0b31938 for the same files; the one failure only in mine (official-page-events version key, because source-wiring.ts is in that parser closure) was fixed by setting OFFICIAL_PAGE_EVENTS_VERSION to official-page-events@b874a896cb94 and re-passing meetings-official-page, derived-wiring-reading, route-hints. door-registry*.test.ts all pass.
working_on: DB-25 next, then DB-17, DB-21, DB-13
waiting_on: none
returned: none
needs_hook: (1) DB-09 Admin door list + receipt log: Admin lane must render lib/doors/registry.ts listDoors(repos.doors) and the door.save receipts in the command center, and add "doors" to the AGGREGATES list in scripts/pilot-runtime-publish.mts (hunters-owned) so the console-input hash moves when a door changes. (2) River: DB-09 bumps BOOTSTRAP_VERSION 18 -> 19 (cp_doors); renumber at integration if another lane also bumped. (3) Registered door.save with one spread (...DOOR_ACTIONS) in lib/control-plane/gateway/registry.ts (admin-owned, 2 lines). (4) DB-10: run `node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/seed-doors-from-meetings.mts --apply` once on the production runner after the cp_doors table exists (not run here: production is read-only for this worker). Derived rows (promoted wiring) could not be read from the cloud session, so only the 129 hand-wired doors were verified here; the script reads them on the runner. (5) DB-12: scripts/ingest.ts (meetings) must call `await installDoorWiringFromRegistry(repos.doors)` (lib/doors/install.ts) at the start of each pass; switch WTP_DOORS_READ=registry stays OFF until checked live. River: DB-12 changed the official-page-events extractor id (re-keys saved methods/wiring rows) because lib/registry/source-wiring.ts is in its closure. Still reading SOURCE_WIRING at module load (need DB-13): lib/civic-data/meeting-partitions.ts, lib/meetings/notice-pages.ts, lib/meetings/history-gaps.ts, lib/registry/curated-bodies.ts, scripts/ingest.ts lines ~218/1430.
needs_Sean: none
seen_not_fixed: ~248 tests (ask-code-reading-money, routing/Ask, plural, ask-gap-observation, control-plane-request-bounds, etc.) already fail on river @ 0b31938; full list of names kept by this worker in the run logs.
runs_and_working_minutes: 1 run so far; working minutes unknown
