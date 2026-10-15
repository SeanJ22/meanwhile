# Returned: site-reads

lane: site-reads
owner: site-reads
writer: the site-reads lane
check: at-scale
ready: NE-01 83e9473506b6bea17e60e15794545fedb25ce46a
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:21:52Z
state: returned
fix_subject: fix:3b8fb67e
fix: River · stream/site-reads — at-scale failed for site-reads: NE-01 (83e947350, already in release 43 / PR #752): under the new AT SCALE check its peak (405 MB reader worker) comes from the national ballot index (18,144 records), the full held authority families and the 1,171-meeting corpus loaded at

## Failure

```
NE-01 (83e947350, already in release 43 / PR #752): under the new AT SCALE check its peak (405 MB reader worker) comes from the national ballot index (18,144 records), the full held authority families and the 1,171-meeting corpus loaded at once, not from one place. Name the stage (the reader worker's load of the national index and held families) and slice it to the requested place. Not pulled from release 43 (tested, in CI); the follow-up READY should carry the sliced numbers.
```

## Repair

Fix on stream/site-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
