# Returned: hunters

lane: hunters
owner: hunters
writer: the hunters lane
check: live
ready: CH-11, BR-05, BR-16, BR-37, CH-24, CH-26, DB-53 d7e93a3359c06792c60c874f92b63bb86211cae3
river: ecf402600401783b094837c29e0c515eadbdb843
at: 2026-10-05T21:54:20Z
state: returned
fix_subject: fix:70a100a1
fix: River · stream/hunters — live failed for hunters: DIAGNOSIS UPDATE for the research crash (River, read-only, 2026-10-05 ~22:00Z). Fix this before other hunters work.

## Failure

```
DIAGNOSIS UPDATE for the research crash (River, read-only, 2026-10-05 ~22:00Z). Fix this before other hunters work.

- Started with the Oct 2 runner changes. PILOT HEALTH digests: Sep 29 had 20 healthy cycles. Since 2026-10-03 05:42Z there have been 128 RESEARCH_CHILD_NO_PROGRESS crashes and 1 healthy cycle. Research output has stopped landing: cp_log_worker_results last at 2026-10-04 06:19Z, cp_log_scout_results last at 2026-10-04 05:52Z.
- Where it goes silent: each cycle runs its plain candidate-enrichment lookups (candidate-marginalia-index and candidate-wikipedia-api rows in cp_log_costs) for about 13 minutes. Then nothing is written for 10 minutes and the watchdog kills it: last write 19:05Z, killed 19:15:56Z; last write 19:42:11Z, killed 19:53:48Z. In both windows the routine supervisor was running national-place work (3,181 MiB reservation) and dozens of ballot-navigation publications.
- Likely cause: freshness-shadow.mts:2058 gives worker-slot waits a 15-minute dispatch deadline (4a93fb3, Oct 2), while pilot-runtime-child.mts:5 kills a silent research child after 10 minutes (RUNTIME_NO_PROGRESS_MS, 10f7287, Oct 2). A worker waiting on the shared host memory slots (worker-slots.ts) prints nothing, so a wait the design treats as a clean deferral at 15 min ("WORKER_MEMORY_DEADLINE: memory wait deferred; work remains owed") is killed first as a crash, losing the whole cycle.
- Fix asked:
  (1) Keep every bounded wait inside the research child shorter than the no-progress window (dispatch deadline below 10 min, e.g. 8), or have the slot wait log a changing "waiting for memory: N of M min" line each minute so the watchdog sees progress. Either way a memory wait ends as a deferral, never a crash.
  (2) Make the crash diagnosable: pass the last child stderr/stdout lines (pilot-runner.mts currentCycleErrors) into recordFailedCycle as `pending` (it is null today), so Admin's crash record says what was running.
  (3) Test: a fake slot that never frees, with the real RUNTIME_NO_PROGRESS_MS relationship. It must end as a deferral, not RESEARCH_CHILD_NO_PROGRESS.
- Confirm on the runner first if you can: the runner's local log lines just before each "RESEARCH_CHILD_NO_PROGRESS ... ending owned child research-cycle" show the last phase. If it is not a slot wait (for example a slow history read that CH-26's v20 indexes target), fix that phase the same way.
```

## Repair

Fix on stream/hunters and publish a new READY commit; River folds the new READY and clears this return when it integrates.
