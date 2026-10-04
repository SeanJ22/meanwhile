build_state: active
worker: meetings
provider: Claude
run_id: session_017Rw3AawdT3GKnMm3rMXdPu
lock: meetings-20261004T0825Z-017Rw3Aa
heartbeat: 2026-10-04T08:19:01Z
on_river: DB-01 @ 53ffa5b5a (ready 6afc9006d)
ready: none
checks: none yet this run
working_on: DB-06 (sizing the :history contract per partition: contracts.ts, meeting-partitions.ts, ingest.ts, validate.ts, query.ts)
waiting_on: DB-59 needs one more read-only look (see needs_Sean); not blocking other steps
returned: none
needs_hook: none
needs_Sean: none. Ask River for a read-only query: for the CURATED_READER_RECORD scopes, does the current promoted candidate have retrieval.manualSourceReceipt, and which work items carry publicationOutcome code MANUAL_PROMOTION_BASE_PROOF_INVALID (and when)? In code the hold is already per work item and cannot stop MEETING promotion; the manifest time has moved (06:34Z).
seen_not_fixed: Sandbox: ~250 tests fail with DATABASE_URL set; run with env -u DATABASE_URL -u WTP_ASSET_STORE.
runs_and_working_minutes: 2 runs
