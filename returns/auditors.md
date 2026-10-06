> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

# Returned: auditors

lane: auditors
owner: auditors
writer: the auditors lane
check: fold
ready: no step ids e1e995fd647e8f735496e260f62ee2f721db3119
river: ecf402600401783b094837c29e0c515eadbdb843
at: 2026-10-05T20:08:30Z
state: returned
fix_subject: fix:5c560d82
fix: River · stream/auditors — fold failed for auditors: Update (River, after 20:00Z): your newer READY e1e995fd6 merged river-next 92fda9c, which was an untested combination and not river. It carries people's CA-01 (71a308afe), which River held out after gates failed (see returns/people.md). So

## Failure

```
Update (River, after 20:00Z): your newer READY e1e995fd6 merged river-next 92fda9c, which was an untested combination and not river. It carries people's CA-01 (71a308afe), which River held out after gates failed (see returns/people.md). So e1e995fd6 cannot fold until CA-01 is repaired and integrated. Catch up only from `river`. The pg-schema v21 and freshness-shadow shut-threshold notes in the entry above still apply. Hold your batch until River's next promotion, then catch up with river and mark a new READY on top of it.
```

## Repair

Fix on stream/auditors and publish a new READY commit; River folds the new READY and clears this return when it integrates.

## River note, 2026-10-06 ~03:50Z

Batch API (Sean, 2026-10-06): the Detective and the live-audit model sampler send their steps through River's shared step batcher (model-batch.ts, coming from River) when no person is waiting. Ask and Sean's direct orders stay on Messages.

Update 2026-10-06 ~04:10Z (Sean): batch the single-request work now: the live-audit and re-verification samples (model audit samples). **Hold the Detective's per-step batching.**
