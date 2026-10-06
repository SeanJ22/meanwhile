build_state: active — Oct 6 mission, WIP checked locally; live acceptance pending
worker: codex-admin
provider: Codex
run_id: codex-admin-0a20c74f8d1a49a49f492bf94bfe2e71
lock: codex-admin-0a20c74f8d1a49a49f492bf94bfe2e71
heartbeat: 2026-10-06T05:55:31.012423Z
on_river: promoted river 8e47854b1; main release 8 a5fd753b7; existing integrated Admin steps preserved
ready: none newly live-verified; historical READY 734ee9633567651c94a6bb12a0628c7b965a4102 is RETURNED and superseded, not foldable
working_on: WIP source aa40b7ba3480de6bf3796da5d12f2af73fda0a11; full gates running on this immutable source
checks: exact aa40b7ba3480de6bf3796da5d12f2af73fda0a11 types PASS; focused 43 files running; full gates running in /tmp/meanwhile-admin-mission-gates. No FULL/browser/live PASS claim. Historical exact evidence remains in admin-ready-evidence.json/admin-checks.md.
returned: fix:5abe56f2 compatibility repaired with disabled metadata for 18 gateway-null controls, conditional existing Work reader, Look/Testing/Queue/owed/target/data/settings retained. New 1:50 AM EDT BR-31 overlap reconciled against measures exact 30922c2e1 locally: one authoritative Scoreboard/chat flow reader and SPEND_AND_FACTS topic; Money summary separate. Await promoted release 9 for final catch-up.
waiting_on: River cp_vital_signs schema; hunters hourly writer/query-byte counter; slide publish/sample counters; normal deployment and named live Now/brief checks. Remaining shared writer connections below.
needs_River:
  - Live read-only Neon proof: project withered-sunset-39821877, default production branch br-tiny-frog-aeufpjeq, neondb. At 1:53:26 AM EDT cp_vital_signs and cp_spend_holds both absent (to_regclass NULL). At 1:54:20 AM EDT runner heartbeat still 1:08:44 AM EDT, testedSha f545fcf9493def91294bccf219ed65071b2093b1. No new hourly row exists to render. Do not confuse deployed web release 8 with migrated/restarted runner.
  - Hourly reader follows board/river:vital-signs.md only: readHourlyVitalSigns(sql,at,2|24) in lib/control-plane/admin-view/hourly-vital-signs.ts. One indexed cp_vital_signs query; excludes running hour and crash-left partial rows via written_at >= hour+1h. Confirm writer uses JSON numeric map top20+other for neon_bytes_by_caller and this completion signal. Missing/unpriced values remain —. No OwnerSnapshot hourly fallback.
  - Named live check: inspect actual completed row and live Now (last two) plus daily brief (last 24), confirming facts/spend/cost/Neon causes/finished/killed/empty-paid, sample counts and EDT times match that row. User requires live proof before new READY. Keep WIP available for River's normal integration/release path; resolve publication order through River, no invented READY exception.
  - Added read estimate: assuming 2 KiB per hourly row, Now 2 rows/minute ≈240 KiB/hour; daily brief 24 rows/minute ≈2.81 MiB/hour when open. Combined ≈0.0032 GB/hour per tab, request overhead excluded. Measured runner hour must check actual transfer. Formatter and compatibility add no SQL reads.
  - Money publisher: existing scripts/publish-owner-snapshot.mts should call buildSpendSummary({now,sql,transfer,billing,dailyLimitUsd,liveSetAsideUsd,neonProjects}). No duplicate BR-31 flow collection remains. Supply distinct unsettled liveSpendHolds once per hold, measured per-project transfer and actual causes. Admin GET spend reads one narrowed ownerSnapshots.current {spendSummary:true}; no raw/vendor fallback on refresh. Existing Hunts table uses exact receipt-linked allocated costs, unknown stays unknown; batch/full-price by role uses actual recorded batch flags.
  - Paid NOTHING fix: actual River/hunters ending producer calls openPaidEndingFix in lib/control-plane/fix-list.ts with actual paid/endingKind/causeKey. Missing legacy ending does not count as NOTHING. Withdrawn no-result spend line remains absent from Money/digest.
  - BR-20 hunters actual recommendation raiser -> raiseDecisionOrder; BR-36 River pg-store registeredHistoryEvidence writer + pg-schema + numbered BR-36 migration/journal; BR-19 requires BR-22 exact kind family/division preservation/enforcement. No broad replacement dispatch.
  - Live browser gap: Admin URL CONNECT403 in this environment; no signed-in Admin session. Neon connector works for read-only production inspection, so database credentials are not a blanket blocker. Use authorized River live observation path; no egress/auth bypass.
needs_Sean: none invented; genuine owner/credential decisions go through River
seen_not_fixed: pinned Playwright headless shell 1234 unavailable in prior runs; no browser pass assumed. Historical gate evidence and checkpoint SHAs preserved.
continuation: this exact chat has an enabled native every-90-minute check-in; rereads mission, fetches assignments/returns, skips while active, exits without writing after Claude handoff. Keep quiet on unchanged/non-actionable state.
runs_and_working_minutes: current run claimed 1:25 AM EDT; active minutes not measured
