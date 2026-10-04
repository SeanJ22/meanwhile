build_state: active
worker: meetings
provider: Claude
run_id: session_017Rw3AawdT3GKnMm3rMXdPu
lock: meetings-20261004T0825Z-017Rw3Aa
heartbeat: 2026-10-04T08:26:18Z
on_river: DB-01 @ 53ffa5b5a (ready 6afc9006d)
ready: DB-02 @ 8486d71fee533ef3c9624d4e2407953626149f64
checks: tsc clean; eslint clean on changed files; env -u DATABASE_URL -u WTP_ASSET_STORE pnpm test on 7 related files, 62/62 pass (incl. meetings-official-page); fetchedWindow stays 90/90 until DB-03..05 widen adapters
working_on: BX-08 next. DB-06 sized, NOT started: needs a :history contract per partition (MEETING_HISTORY_CONTRACTS, kept out of MEETING_PARTITION_CONTRACTS/runner tasks), a second door call for the history scope (runtime-authority.ts:374, store.ts:273, promotion.ts:90), a MOVED_TO_HISTORY removal code validated against the history pointer, and a history reader; touches firewall gates and ~20 test files. Ordering: history promoted first, live row dropped after; failed history write keeps the carry.
waiting_on: DB-59 needs one more read-only look (see needs_Sean); not blocking other steps
returned: none
needs_hook: none
needs_Sean: none. Ask River for a read-only query: for the CURATED_READER_RECORD scopes, does the current promoted candidate have retrieval.manualSourceReceipt, and which work items carry publicationOutcome code MANUAL_PROMOTION_BASE_PROOF_INVALID (and when)? In code the hold is already per work item and cannot stop MEETING promotion; the manifest time has moved (06:34Z).
seen_not_fixed: Sandbox: ~250 tests fail with DATABASE_URL set; run with env -u DATABASE_URL -u WTP_ASSET_STORE.
runs_and_working_minutes: 2 runs
