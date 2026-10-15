# Returned: fact-store

lane: fact-store
owner: fact-store
writer: the fact-store lane
check: at-scale
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:05:06Z
state: returned
fix_subject: fix:8d2fa768
fix: River · stream/fact-store — at-scale failed for fact-store: R1 (77bddad74) merges clean with river 3282584e2 and fixes a production stall (the hourly candidate job timed out every run since Oct 14), but the READY message has no AT SCALE numbers: peak memory per worker, database bytes read and writte

## Failure

```
R1 (77bddad74) merges clean with river 3282584e2 and fixes a production stall (the hourly candidate job timed out every run since Oct 14), but the READY message has no AT SCALE numbers: peak memory per worker, database bytes read and written per run and per day, run time, copies that fit at the 0.75 GiB margin, largest input tested (name anything not tested at full size). Add them and push a new READY; as a production-stall fix it ships alone in its own release ahead of anything else.
```

## Repair

Fix on stream/fact-store and publish a new READY commit; River folds the new READY and clears this return when it integrates.
