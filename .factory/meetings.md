build_state: waiting
worker: meetings
provider: Claude
run_id: session_017Rw3AawdT3GKnMm3rMXdPu
lock: none
heartbeat: 2026-10-04T08:30:35Z
on_river: DB-01 @ 53ffa5b5a (ready 6afc9006d)
ready: DB-02 @ 8486d71fee533ef3c9624d4e2407953626149f64; BX-08 @ fd0917fa2080bd31aefb35d9241113038d98d383
checks: tsc clean; eslint clean on changed files; env -u DATABASE_URL -u WTP_ASSET_STORE pnpm test on 31 ingest/venue/firewall files + official-page, 364/364 pass (DB-02 62/62 earlier). New: tests/hand-wired-venue-pins.test.ts. Live pins on the map are River's post-release check.
working_on: next DB-06 (sized; see seen_not_fixed), else BX-10
waiting_on: DB-59 needs one more read-only look (see needs_Sean); not blocking other steps
returned: none
needs_hook: none
needs_Sean: none. Ask River for a read-only query: for the CURATED_READER_RECORD scopes, does the current promoted candidate have retrieval.manualSourceReceipt, and which work items carry publicationOutcome code MANUAL_PROMOTION_BASE_PROOF_INVALID (and when)? In code the hold is already per work item and cannot stop MEETING promotion; the manifest time has moved (06:34Z).
seen_not_fixed: DB-06 sizing: needs a :history contract per partition (MEETING_HISTORY_CONTRACTS kept out of MEETING_PARTITION_CONTRACTS/runner tasks), a second door call for the history scope (runtime-authority.ts:374, store.ts:273, promotion.ts:90), a MOVED_TO_HISTORY removal code validated against the history pointer, a history reader; history promoted first, live row dropped after, failed history write keeps the carry. Validator meetingRowCarriesRecords (validate.ts:799) lacks ingest's agenda-document arm. | Sandbox: ~250 tests fail with DATABASE_URL set; run with env -u DATABASE_URL -u WTP_ASSET_STORE.
runs_and_working_minutes: 2 runs
