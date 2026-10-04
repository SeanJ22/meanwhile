build_state: waiting
worker: meetings
provider: Claude
run_id: session_01Dw5SZSUvMmcQc6dtK3DSpq
lock: none
heartbeat: 2026-10-04T09:19:25Z
on_river: DB-01, DB-02, BX-08 (river 4b5102044)
ready: none pending
checks: tsc clean; eslint clean on changed files; env -u DATABASE_URL -u WTP_ASSET_STORE pnpm test on 31 ingest/venue/firewall files + official-page, 364/364 pass (DB-02 62/62 earlier). New: tests/hand-wired-venue-pins.test.ts. Live pins on the map are River's post-release check.
working_on: next DB-06 (sized, not started in code), then BX-10
waiting_on: DB-59: live evidence only. Code check: readManualProjectionPrior throws inside publishWorkerReaderResults per work item (try/catch -> HELD outcome), and no meeting ingest/runner path calls it, so a curated hold cannot stop MEETING promotion. Snapshot generatedAt = newest partition generatedAt, and quiet re-checks restamp the manifest (publishReaderEdgeChecks). River read: MEETING manifest moved to 06:34Z; the Sept 29 05:38Z time is MEETING_OUTCOME (2 scopes, no new promotion since 10-01, likely no change). Not closing DB-59 until a live pass shows the hold gone; no code change made.
returned: none
needs_hook: none
needs_Sean: none. Ask River (read-only): for the curated reader scopes, the held work items whose publicationOutcome.code is MANUAL_PROMOTION_BASE_PROOF_INVALID, and whether the base candidate has retrieval.manualSourceReceipt.
seen_not_fixed: DB-06 sizing: needs a :history contract per partition (MEETING_HISTORY_CONTRACTS kept out of MEETING_PARTITION_CONTRACTS/runner tasks), a second door call for the history scope (runtime-authority.ts:374, store.ts:273, promotion.ts:90), a MOVED_TO_HISTORY removal code validated against the history pointer, a history reader; history promoted first, live row dropped after, failed history write keeps the carry. Validator meetingRowCarriesRecords (validate.ts:799) lacks ingest's agenda-document arm. | Sandbox: ~250 tests fail with DATABASE_URL set; run with env -u DATABASE_URL -u WTP_ASSET_STORE.
runs_and_working_minutes: 2 runs
