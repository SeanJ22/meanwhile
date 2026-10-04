build_state: active
worker: meetings
provider: Claude
run_id: session_01TeLefpaQ8bqbZr1e4re9jE
lock: meetings-20261004T1020Z-a7c3
heartbeat: 2026-10-04T11:08:48Z
on_river: DB-01, DB-02, BX-08 (river 4b5102044)
ready: DB-06 (f910791e7692db5948c28e87e50638446dbdf0d6); BX-10 (ebde2efb9dba19013457511ad277a0fe6812b612) includes DB-06
checks: On river 8bbe9eeb5 + DB-06: tsc clean; eslint clean (one old warning in firewall.ts); FULL `pnpm test` as CI (env -u DATABASE_URL -u WTP_ASSET_STORE, no .next) before the last river catch-up: 9124/9138 pass, 3 fails all mine and fixed (batched-reader scope list now includes history scopes; authority registry lists meetings-history; official-page version); then 170 meeting/civic-data/validate/promotion/reader test files 1325/1325; after the catch-up, tsc + 6 key files 107/107. BX-10: tsc clean, eslint clean (old warnings only), 407/407 on legistar/card-sources/adapter/agenda/carried/venue test files, new tests/meeting-video-link.test.ts (4). New: tests/meeting-history.test.ts (7). OFFICIAL_PAGE_EVENTS_VERSION on the combined tree = official-page-events@7716ae8033c2 (River re-sets at fold). Live check (Admin publication view, ask for a >120-day sitting) is River's after release.
working_on: next in order: DB-08 (Congress daily refresh, append-only votes); DB-59 and DB-24 wait on live reads
waiting_on: DB-59: live evidence only. Code check: readManualProjectionPrior throws inside publishWorkerReaderResults per work item (try/catch -> HELD outcome), and no meeting ingest/runner path calls it, so a curated hold cannot stop MEETING promotion. Snapshot generatedAt = newest partition generatedAt, and quiet re-checks restamp the manifest (publishReaderEdgeChecks). River read: MEETING manifest moved to 06:34Z; the Sept 29 05:38Z time is MEETING_OUTCOME (2 scopes, no new promotion since 10-01, likely no change). Not closing DB-59 until a live pass shows the hold gone; no code change made.
returned: none
needs_hook: none
needs_Sean: none. Ask River (read-only): for the curated reader scopes, the held work items whose publicationOutcome.code is MANUAL_PROMOTION_BASE_PROOF_INVALID, and whether the base candidate has retrieval.manualSourceReceipt.
seen_not_fixed: Admin: promotions under the new meetings-history authority are not in observableRoutineContracts (on purpose: no clock, no task), so the Admin publication view will not list them until an Admin reader is added (admin lane hook: list `<partition>:history` scopes as one "kept history" row). | DB-06 follows a read-merge: each composition now reads 2N scopes in one batch (history included); web route app/api/ask/agenda/route.ts:135 composes live and so reads them too. | Validator meetingRowCarriesRecords (validate.ts) lacks ingest's agenda-document arm (harmless: ingest never removes such a row). | Sandbox: ~250 tests fail with DATABASE_URL set; run with env -u DATABASE_URL -u WTP_ASSET_STORE.
runs_and_working_minutes: 2 runs
