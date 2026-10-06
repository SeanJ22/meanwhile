# 20:11Z live return investigation

Assigned return: extra ~280 supervisor process/protocol failures after ecf4026.

The configured cloud DATABASE_URL is reachable read-only with Node --use-env-proxy and Neon fetchEndpoint(host)=https://host/sql, using the permitted configured endpoint. Direct SDK default api.c-4 host is not the configured endpoint. No credentials printed and no DB writes. cp_log_owner_digests has zero rows, min/max null, server now20:15Z Oct5; relrowsecurity=false. This is no evidence about the production digests River read.

needs_River: provide the actual runtimeOutcome.failures for the 18:47:55Z and20:00:29Z digests and one pre-release digest, or grouped code+task-family counts plus sample detail for each group. Include testedSha/attemptedTasks and the matching digest ID/time. The quoted `Send section3-publication ... refresh offered to the normal source frontier` lines are appended to dueRequestLines at routine-civic-data-runner.mts:697 and never directly add supervisorFailures; they cannot identify the cause. Source frontier deferrals at RCD_DEFER similarly do not add failures. We must not relabel genuine child timeouts/crashes or unverified receipt failures as benign deferrals.

Read-only query for River's existing production connection:
```sql
SELECT recorded_at, record_id,
       record->'runtimeOutcome'->>'testedSha' AS tested_sha,
       record->'runtimeOutcome'->>'attemptedTasks' AS attempted_tasks,
       record->'runtimeOutcome'->'failures' AS failures
FROM cp_log_owner_digests
WHERE record->'runtimeOutcome'->>'kind' = 'ROUTINE_CIVIC_DATA_SUPERVISOR'
  AND recorded_at >= '2026-10-05T16:00:00Z'
ORDER BY recorded_at DESC LIMIT 8;
```
If kind differs, filter the headline as in the observation and inspect keys; do not infer missing data.

Potential code path being checked: worker publication can produce HELD/no candidate; printWorkerPublicationReceipt confirms the existing canonical pointer if available, else exits2 with no receipt. Distinguish missing durable publication from ordinary source deferral using actual failures before changing the protocol. No fix or cause is claimed yet.

Further evidence20:18Z: WTP_CONTROL_PLANE_DATABASE_URL is absent (controlPlaneUrlFromEnv only reads that variable, never DATABASE_URL). Configured DATABASE_URL has cp_work_items0rows as well; both tables have RLS disabled. River can answer with its own read-only production result; no new service or spend is requested. Release2 leaves worker-publication-tasks.ts and runner-receipt.ts byte-identical to the previous main; CP-19 affects saved quote/record matching, not frontier deferral accounting. Actual failures are still needed to distinguish secondary effects from other release changes.

Local diagnostic verification: existing tests/publication-receipt.test.ts, tests/routine-civic-data-runner.test.ts, tests/routine-civic-data-frontier.test.ts pass79/79 on committed application98a8d44d9. This verifies local handling of receipted holds/deferrals, not the cause or repair of the live increase. Log /tmp/slide-live-return-diagnostic.log.

Connection discovery completed read-only: the permitted Neon endpoint exposes only neondb (current, empty cp tables) and postgres (no cp_log_owner_digests table). No alternative production control-plane database is accessible through the configured endpoint. No credentials were printed or changed.

2026-10-06T04:19:56.770Z recheck after environment spec revision8: configured DATABASE_URL reachable; read-only transaction reports cp_work_items=0, cp_log_owner_digests=0, first/last recorded_at=null, RLS=false on both. WTP_CONTROL_PLANE_DATABASE_URL remains absent. SELECT only; no credential values exposed or changed. Request for actual production failures remains open. River also observed count25to530 on the same ecf4026 source, so the aggregate headline alone cannot establish a release regression.


## Production cause established, October 6 (Codex slide)

The connected Neon tool now reaches `withered-sunset-39821877`, production `br-tiny-frog-aeufpjeq` (neondb). All inspection used SET TRANSACTION READ ONLY. The cloud DATABASE_URL was a different empty database; its absence of digests never described production.

- Oct5 18:47:55.638Z digest (cycle18:10:20.585Z): **583 failures,582 CHILD_SETTLEMENT_FAILED**. Its actual testedSha is **dcddcf57c235c1ec87ba3d6a2dc6ec4cdf13f88b**, before release2. The collisions affect558 distinct worker-publication tasks and24 national-place tasks; one other failure is Congress receipt handling.
- Oct5 20:00:29.384Z digest (cycle19:22:39.522Z): **552 failures,551 CHILD_SETTLEMENT_FAILED** on **ecf402600401783b094837c29e0c515eadbdb843**. The collisions affect528 distinct worker-publication tasks and23 national-place tasks; the other failure is an NJ clock timeout.
- Earlier baseline Oct5 12:03:12Z:250 of251 failures are the same collision. It persists in the latest Oct6 04:41:03Z digest:448 of448. On the same ecf4026 source, another cycle has only1 failure. The observed increase is more tasks entering the same failing path, not evidence that release2 introduced this bug.

**Cause:** recordHuntSourceProgress in scripts/routine-civic-data-runner.mts keys an immutable digest by cycle/task/stage. Admission appends QUEUED. routinePreSpawnMemoryDeferral then records QUEUED again with a new timestamp and memory-deferral detail before any child spawned. Its append collides; the settlement callback throws before reaching RCD_DEFER, and recordSourceSettlementFailures records CHILD_SETTLEMENT_FAILED. This explains why failure counts exceed attempted children. The actual failure text names precisely those existing QUEUED ids. No timeout, crash, receipt failure, or store error is relabeled as benign.

**Repair prepared:** lib/civic-data/hunt-source-progress.ts constructs a content-addressed event id containing cycle/task/stage plus hash of full progress and testedSha. Both observations remain immutable; exact replay remains idempotent even when timestamps match. tests/hunt-source-progress.test.ts reproduces the old collision and verifies the replacement keeps both events. The minimal runner connection is `.factory/slide-progress-runner.patch` for meetings/hunters through River; shared runner was not edited. Estimated added cost: no new read; one small progress append per memory deferral (roughly1–2KB plus protocol overhead), replacing a failed append and a much larger exception copied into the cycle digest. No extra job or budget admission.

needs_River: apply/route slide-progress-runner.patch, deploy through River, keep existing runner stop until release8live, then verify a memory-deferred task has both QUEUED observations, no child attempted, and no append-collision CHILD_SETTLEMENT_FAILED. The return is diagnosed, not live repaired. Separate Congress receipt and NJ clock failures remain genuine and owned by their source/runtime lanes.

Exact query evidence: slide-production-failure-evidence.json, slide-collision-detail.json. No production write, stats reset, schema change, restart or budget change occurred.
