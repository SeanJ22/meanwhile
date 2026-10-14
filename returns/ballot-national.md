# Returned: ballot-national

lane: ballot-national
owner: ballot-national
writer: the ballot-national lane
check: fold-conflict
ready: no step ids unknown
river: 0e9d37e0829974dbf3c91800fe7e3cb12360f00e
at: 2026-10-14T20:56:07Z
state: returned
fix_subject: fix:d85f62ab
fix: River · stream/ballot-national — fold-conflict failed for ballot-national: ballot-national READY 4aad315fb (BL-10) conflicts with river 0e9d37e08299 by itself (the lane's last river merge is 9b36ff25c; release 38 landed after it). Conflicts: data/ballot/2026-general/hi.json, ia.json, il.json, in.json, ks.json, ky.

## Failure

```
ballot-national READY 4aad315fb (BL-10) conflicts with river 0e9d37e08299 by itself (the lane's last river merge is 9b36ff25c; release 38 landed after it). Conflicts: data/ballot/2026-general/hi.json, ia.json, il.json, in.json, ks.json, ky.json, mo.json — this lane's last commit rewrites those state ballot files and BL-11, BL-12 and BL-13 changed the same files in release 38. Merge river into stream/ballot-national and re-run the assembler-shape change on the river versions of those files (do not keep both copies), then mark READY again.
```

## Repair

Fix on stream/ballot-national and publish a new READY commit; River folds the new READY and clears this return when it integrates.
