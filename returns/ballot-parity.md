# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: fold-conflict
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:04:34Z
state: returned
fix_subject: fix:4d5a349c
fix: River · stream/ballot-parity — fold-conflict failed for ballot-parity: BL-20 (97b0b7a3b) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: lib/civic-data/curated-reader-read-model.ts, lib/civic-data/promoted-edge-publication.ts, lib/civic-data/reader-edge-publication.ts, lib/meeting

## Failure

```
BL-20 (97b0b7a3b) conflicts with river 3282584e2 (release 43: R3-MUNICODE and NE-01 folded) in: lib/civic-data/curated-reader-read-model.ts, lib/civic-data/promoted-edge-publication.ts, lib/civic-data/reader-edge-publication.ts, lib/meetings/edge-artifacts.ts, lib/meetings/edge-serving.ts. Merge origin/river into stream/ballot-parity, settle those files so both sides' behavior is kept (NE-01's reader-edge reads and request accounting, municode's bounded portal reads), run the focused tests, push a new READY with AT SCALE numbers in the message.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
