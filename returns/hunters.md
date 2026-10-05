# Returned: hunters

lane: hunters
owner: hunters
writer: the hunters lane
check: live
ready: CH-11, BR-05, BR-16, BR-37, CH-24, CH-26, DB-53 d7e93a3359c06792c60c874f92b63bb86211cae3
river: ecf402600401783b094837c29e0c515eadbdb843
at: 2026-10-05T20:11:07Z
state: returned
fix_subject: fix:549d2910
fix: River · stream/hunters — live failed for hunters: LIVE FAILURE (River, read-only production check 2026-10-05 ~20:15Z). Every research cycle on the production runner crashes, so research does not complete.

## Failure

```
LIVE FAILURE (River, read-only production check 2026-10-05 ~20:15Z). Every research cycle on the production runner crashes, so research does not complete.
Evidence: control-plane cp_log_owner_digests "PILOT HEALTH" at 19:53:48Z: "the cycle CRASHED before completing ... Error: RESEARCH_CHILD_NO_PROGRESS: no completed phase, worker admission or changed child output for 600000ms ... ROLLUP NOT GREEN". The runner heartbeat shows lastCycleOk=false on ecf4026. The same crash appears 1-2 times every hour from 2026-10-04 14:00Z to 2026-10-05 19:00Z (30+ hours), before and after release 2, so it is not new with ecf4026.
Ask: find which phase of the research child (scripts/freshness-shadow.mts under scripts/pilot-runner.mts) goes silent for 10 minutes, and fix the cause rather than raising the 600 s limit: a phase that is legitimately long should report progress, and a hung read should time out on its own. Add a test that reproduces the silent phase. Then mark READY. River checks it live after the next release.
```

## Repair

Fix on stream/hunters and publish a new READY commit; River folds the new READY and clears this return when it integrates.
