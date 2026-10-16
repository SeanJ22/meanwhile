# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: at-scale
ready: no step ids unknown
river: 1d3d303d70dc9d14aab69d61ea9b0d76d76b6e6f
at: 2026-10-16T05:13:58Z
state: returned
fix_subject: fix:15bea633
fix: River · stream/ballot-parity — at-scale failed for ballot-parity: Not folded: BL-20 f3558fa8c fails the memory check on one path.

## Failure

```
Not folded: BL-20 f3558fa8c fails the memory check on one path.
Unit = one state's own publication (Illinois: 55,392 fields).
Passes: unchanged sweep (788 MiB, prior payload no longer read) and the initial publish.
Fails: the changed publication (20,772 deadlines revised, losing values kept) peaks 1.427 GiB, about 1.8x the unchanged run on the same Illinois publication, with 397 MB read from the database. That is the prior version held alongside the new one while losing values are carried over. The READY gives stage peaks only for the unchanged case, so the holding stage is not named.
Needed in the next READY: per-stage peaks for the changed case on Illinois; carry losing values forward by streaming (one field or one government at a time) so the prior version is not held alongside the new one; peak for the changed case no higher than the initial publish. Everything else in this READY stands and merges clean against river e1a1071a9.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
