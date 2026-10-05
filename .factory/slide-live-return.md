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
