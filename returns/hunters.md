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

## River, 2026-10-06 ~04:00Z: no paid worker ends with nothing (Sean's rule, decisions.md)

River's investigation (read-only, production) reproduced Sean's $85.36 Scout and Detective spend over 14 days, of which $40.40 left nothing (cost rows whose resultKind is missing, NO_DISPOSITION, DISPOSITION_REFUSED or REQUIRES_NEW_ADAPTER). Causes in your code, in order of spend:
1. **Route candidates are almost never followed.** 176 paid ROUTE_CANDIDATE jobs ($36.36) had no later disposition on their work item. 321 of 331 Scout ROUTE_CANDIDATE items never got past SCOUTED, because CONFIRMED needs an ACQUIRER artifact at that URL (promotion/pipeline.ts confirmationFromArtifacts) and nothing queues one. DISCOVERED becomes debt AWAITING_ROUTINE_READ (debt.ts:79), which nothing reads. 25 jobs paid for another Scout on the same obligation; 33 ($10.02) got no follow-up at all. **Fix: an opened candidate URL queues an ACQUIRER task for it.** Also, freshness-shadow.mts:3238 prints DISCOVERED as "NOTHING_FOUND"; say what it found.
2. **NO_PROGRESS** (17 jobs, about $3): dispositionForScout returns null (scout-executor.ts:1171-1173, 2200-2207; dispatch.ts:982), so the attempt is ABORTED. The next rungs survive only on the scout result. Record a disposition so the rungs tried count as a result, and write an "exhausted on these rungs" lesson to the field manual (bank owns field-manual.ts; ask under needs_hook).
3. **SCOUT_RESULT_REFUSED** (5 jobs, $0.49; scout-executor.ts:2190): keep the rungs as tried and ask the model for a repaired finish instead of discarding the walk.
4. **DISPOSITION_REFUSED** (45 jobs, $1.56, all on 09-28): EVIDENCE_FOUND cited artifacts already logged by other attempts, the new-artifact list was empty, and INGESTED was refused (route-task.ts:281; dispatch.ts:906-930, 1040). Example: at-0406fa3f6592ed9b6b2fdeb5. Pass the cited, already-logged artifacts into the disposition. It has not been seen since 09-28; confirm whether fecc5f262 fixed it.
5. **REQUIRES_NEW_ADAPTER** (dispatch.ts; debt.ts:78; shadow-loop.ts:533): no engineering task is ever created. autonomous-plan.ts:53 hard-codes engineering: [], and one ENGINEERING task has existed, in total. Queue the adapter task from the disposition.
6. **Spend that never reaches cp_log_costs:**
   - The thrown-worker path writes cost: null (dispatch.ts:804-830). Three Scouts on 09-28 threw "r.nextRungs.join is not a function".
   - LEASE_EXPIRED attempts write no cost row: at-f9f2400a, at-4a193a32, at-0b2a7caa, at-02718cf3.
   - Cost is written only after executor.run returns, so a SIGKILLed round loses all in-flight spend.
   
   Price spend from usage saved as it accrues, and write it on throw and on lease expiry. River adds the repository side (CostEntry.endingKind, see below).
7. **The cache pre-warm** (freshness-shadow.mts:2608-2661; 31 rows over 14 days) is labelled CACHE_WARMUP, not left blank.
Result kind: River is adding `endingKind` to CostEntry (lib/control-plane/cost.ts). It is a closed set: FINDING, INGEST, ROUTE_FOUND, BLOCKED_WITH_TRIES, UNPUBLISHED_WITH_TRIES, ADAPTER_REQUESTED, LESSON_SAVED, CACHE_WARMUP, NOTHING, UNKNOWN_LEGACY. Each kind except the last three carries the id of its disposition, task or field-manual entry. Set it at every ledgerCost/recordCost call in dispatch.ts (which already stamps resultKind at :734-760 and :1054-1070).

Update 2026-10-06 ~04:10Z (Sean): **hold per-step batching of Scouts.** Hunts stay on Messages, fast, provided their findings are promoted rapidly and readers see them. River will show the speed versus cost trade first. The route-candidate follow-up (ACQUIRER task) above is the way hunts reach readers quickly: do it first.

## Sean's replacement rule, 2026-10-06 ~04:20Z (decisions.md): design out paid jobs that end with nothing
Build these in this order. Each is a fix at the cause, not a cap or a counter.
1. **Admission before dispatch** (scheduler/dispatch.ts, the paid admission in freshness-shadow.mts): skip a paid job when its target is already held, when the same work is already leased or running, when it is a recorded dead end whose unlock condition hasn't changed, or when it repeats a failed route with nothing new (no new rung, door or evidence since the failure). Record the skip as the job's ending, with no spend.
2. **Route candidate to a builder, at once:** every ROUTE_CANDIDATE queues the ACQUIRER/builder task for that URL in the same dispatch (today 321 of 331 never left SCOUTED). The task ends as a working door (registry) or a recorded dead end with what was tried. An unfollowed lead is a defect: one older than its expected turnaround opens a fix item.
3. **Every paid ending writes to the field manual:** what it tried and what it learned, through bank's lesson (returns/bank.md), so the next worker starts past it. **NO_PROGRESS is a bug:** take each recent NO_PROGRESS (rung limit or model stop; scout-executor.ts:1171-1173, 2200-2207) to its stall, fix that cause, and add a test reproducing it.
4. **A killed round keeps its findings:** what jobs found before a kill (evidence vaulted, rungs walked, candidates) is saved as it happens, not only after executor.run returns, and the next round resumes from it. Cost is written as usage accrues (River's repository side is coming).
The earlier item list above stands as the detail behind these four (cache pre-warm label, refused finishes, the 09-28 disposition refusal, adapter tasks).

## TOP ITEM, Oct 6, 12:07 AM EDT (Sean): bound the campaign-sites lane so the round finishes
Confirmed by the stall probe on release 6's first cycle, killed at 12:01 AM EDT after 43 minutes: "pending: campaign-sites; last phase: occurrence-and-debt-commit". Every killed round also kills its running Scouts (two tonight, mid-work), which is money spent for nothing.
- runCampaignSitesPass (freshness-shadow.mts ~3391) has no deadline. Inside it, readRoundVault, heldMarginaliaFromManifest, readStagingManifest and runCampaignSiteCycle (lib/control-plane/promotion/campaign-site-cycle.ts) run unbounded. Find which one hangs (the probe says the lane was pending after the occurrence-and-debt commit phase finished), bound it to the round's dispatch deadline, and end it as a deferral naming what remains owed, never a kill.
- campaign-publication-cycle.ts:56 `artifactsByCanonicalUrl(url, Number.MAX_SAFE_INTEGER)`: give it a real limit.
- The discovery-lane join in the round (`await discoveryLaneRun`) and the promotion tail must also end before the no-progress window, as a deferral (the 01:10 return above).
- Test: a campaign-sites lane that never returns ends the round as a deferral with the lane named, within the window.
Do this before every other item. Then the design-it-out items above.

## Oct 6, 12:14 AM EDT (Sean): one lane must never crash another — your order is now
1. **Bound campaign-sites** (the top item above).
2. **Isolation as the basis for CH-24 Proposal A**, ahead of everything else:
   - One long-lived parent (pilot-runner's standing research lane) holds release 6's shared incremental read cache (withIncrementalReads), so no job re-reads a table on its own.
   - Each lane and job inside it runs with its own deadline and its own progress signal, and saves as it goes (findings, rungs, cost).
   - A stuck job is ended alone, its state recorded for you (what it was waiting on, the last progress, the rungs walked), and the others keep running. No single watchdog kill covers a whole round.
   - Nothing joins on the slowest lane.
   - Use a separate process only for work that can freeze the event loop: synchronous or CPU-bound parsing, Playwright browse. Give it its own memory reservation through worker-slots.
   - Fit inside the droplet's current memory at the 0.75 GiB margin (WORKER_MEMORY_HEADROOM_MIB).
   - Record host total memory, current RSS and reservations in the runner heartbeat, so River can report how many jobs fit and what more memory would buy.
   - Keep the old timed-round path behind a switch until the new one is checked live.
3. Then the design-it-out items (admission, route candidate to builder, lessons, saving before a kill) and the rest.
