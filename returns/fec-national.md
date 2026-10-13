# Returned: fec-national

lane: fec-national
owner: fec-national
writer: the fec-national lane
check: fold-conflict
ready: FEC-01 64e8ed70fba6e40f50662b5af43546ea1c17c238
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T01:55:30Z
state: returned
fix_subject: fix:7a62c2af
fix: River · stream/fec-national — fold-conflict failed for fec-national: fec-national READY 64e8ed70fba6 conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/fec-national, resolve, and mark READY again.

## Failure

```
fec-national READY 64e8ed70fba6 conflicts with river-next (river 593be2416b30 plus other release-25 lanes) when folded in dependency order; merge river and the lanes it overlaps into stream/fec-national, resolve, and mark READY again.
```

## Repair

Fix on stream/fec-national and publish a new READY commit; River folds the new READY and clears this return when it integrates.
