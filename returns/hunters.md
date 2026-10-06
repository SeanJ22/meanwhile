# Returned: hunters

lane: hunters
owner: hunters
writer: the hunters lane
check: live
ready: CH-15, CH-16, CH-17, CH-19 671b0b567a7beb962c3f18fba60298325befdcc4
river: 6af6f8a504a7224131ad567f62f7b6f63cb52f08
at: 2026-10-06T00:17:26Z
state: returned
fix_subject: fix:57653541
fix: River · stream/hunters — live failed for hunters: SECOND CAUSE of RESEARCH_CHILD_NO_PROGRESS (River, 2026-10-06 ~01:10Z, from Sean's runner journal for the 23:13:58Z cycle on 6af6f8a, killed 23:40:50Z). Your memory-wait fix (READY 671b0b567) is integrated and ships in release 4, but it doe

## Failure

```
SECOND CAUSE of RESEARCH_CHILD_NO_PROGRESS (River, 2026-10-06 ~01:10Z, from Sean's runner journal for the 23:13:58Z cycle on 6af6f8a, killed 23:40:50Z). Your memory-wait fix (READY 671b0b567) is integrated and ships in release 4, but it does not cover this crash. Fix this next, before other hunters work.

Evidence:
- Timeline: cycle start 23:13:58Z; dispatch cutoff (dispatchDeadlineMs = start + 15 min) 23:28:58Z; plain ACQUIRER lookups written to cp_log_costs about 40 a minute from 23:18 to 23:30:21Z, then none; the research child's last output at about 23:30:50Z; killed at 23:40:50Z. Every journal line in the last 10 minutes came from the parent (ballot-navigation RCD_TASK/RCD_RECEIPT). At that point research was not waiting on memory: slot acquisition stops at the cutoff.
- Ruled out (Sean's theory): a paid job that runs to maxJobWallMs (15 min, provider.ts:122) with no output. run-host.ts (the spawnSync job runner using that wall) is reached only from scripts/agent-bridge-run.mts, not from research. Lease workers are ended at the cutoff: process-pool.ts sets their kill timer to min(childTimeoutMs, deadlineMs - now), and every exit prints "lease worker process ended". On river they are capped at 9 min (childTimeoutMs = RUNTIME_NO_PROGRESS_MS - 60s). So no worker or paid job can be running quietly at 23:30:50.
- That leaves work that runs after the cutoff with no bound: the join `await discoveryLaneRun` (freshness-shadow.mts ~3588: campaign-sites and candidate-publications lanes are not bounded by dispatchDeadlineMs; meetings-discovery walks are bounded only by deadline), then the promotion tail (pending "promotion-tail"). One unbounded read sits in that path: campaign-publication-cycle.ts:56 `artifactsByCanonicalUrl(url, Number.MAX_SAFE_INTEGER)`. Which of these hung is NOT confirmed. The runner journal has no child lines, and on 6af6f8a the stall probe was not yet wired.
- Stdout: your crash-record fix already keeps it. pilot-runner.mts passes lastChildLines(currentCycleOutput), and currentCycleOutput takes both the child's stdout and stderr. Sean's blank "last stderr" line is the old 6af6f8a code. Keep it that way, and make sure the Admin crash record shows lastOutput, not only stderrTail.

Fix asked:
1. Every wait in the research child after dispatchDeadlineMs (the discovery-lane join, the promotion tail's reads, and any lane still running) ends before the no-progress window as a deferral ("work remains owed"), never as RESEARCH_CHILD_NO_PROGRESS. For example, race the discovery-lane join against a bound that ends before RUNTIME_NO_PROGRESS_MS since the last progress. Record unfinished lanes as deferred, and pass a deadline into the candidate lanes and the promotion tail's reads. No change to the watchdog, and no heartbeat that hides a real hang.
2. Test with the real RUNTIME_NO_PROGRESS_MS relationship: a lane or job that is still running and prints nothing for more than 10 minutes after the cutoff. The round must end as a deferral with the lane named, not as RESEARCH_CHILD_NO_PROGRESS.
3. Bound campaign-publication-cycle.ts:56 (a limit, not MAX_SAFE_INTEGER).
4. After release 4 deploys, River reads the first "research stall report:" line (answerStallProbes now names the pending phase at minute 9) and adds it here. If it names a different phase, fix that phase the same way. If no stall report appears before a kill, the child's event loop is blocked by synchronous work. Look for CPU-bound or *Sync calls in that phase.
```

## Repair

Fix on stream/hunters and publish a new READY commit; River folds the new READY and clears this return when it integrates.

## River answer, 2026-10-06 ~01:30Z: CH-24 part 2 is Proposal A

Sean's direction (2026-10-06, River session): research runs continuously, without timed rounds. **Take Proposal A.** With WTP_CONTINUOUS_HUNTERS=1 the round plans and queues only: no lease workers, and its paid standing Scouts are queued as route tasks. The parent pilot-runner's standing lane is the one process that admits paid work. It arms its guards from the durable stores on its 5-minute refresh (intent log, Admin config, cost ledger, budget, research-state circuits, expansion plan). The round keeps its free work. Not B: two controllers re-reading holds keeps two admitters and the in-memory Fleet reservation race. No limit changes. Keep the old path behind the switch until it is checked live (common rule).

Spend holds under A (River's MW-021 follow-up, on stream/river c51d19d and in release 5): spend-holds.ts now has releaseOpenJobs(holds, jobs, now), and every reader of the ledger goes through liveSpendHolds. The standing lane must call releaseOpenJobs on its shutdown and crash paths for jobs it never settled. A hold older than SPEND_HOLD_STALE_MS (2 h) stops counting, so no job may hold longer than that. Bound the lane's jobs below it.

Order: the post-cutoff deferral return above (01:10Z) comes first. CH-24 part 2 replaces timed rounds, but a round that still exists must not crash in the meantime.

## River note, 2026-10-06 ~03:50Z

Batch API (Sean, 2026-10-06): after CH-24 Proposal A, unattended Scouts send each step through River's shared step batcher (model-batch.ts, coming from River): the job pauses between steps, its conversation is saved so it survives a restart, and it picks up again on the batch result. Ask and Sean's direct orders stay on Messages. Also count the round's cache pre-warm (attemptId scout-prewarm:*) as its own result kind, not a Scout with no result (Sean's no-empty-paid-endings rule, decisions.md).
