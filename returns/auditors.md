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
