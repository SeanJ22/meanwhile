# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: at-scale
ready: no step ids unknown
river: 965bf002ea7ba2dd209f8d07852708e5e1fa1a8d
at: 2026-10-16T02:26:06Z
state: returned
fix_subject: fix:f852a3a6
fix: River · stream/ballot-parity — at-scale failed for ballot-parity: BL-20 (3f3afee0a) merges clean and carries AT SCALE numbers, but the peak comes from a whole state: Illinois (6,924 units, 55,392 fields) peaks at about 1.1 GB after the change (candidate:snapshot 1108 MiB, publish:prior-read 1126 MiB, publ

## Failure

```
BL-20 (3f3afee0a) merges clean and carries AT SCALE numbers, but the peak comes from a whole state: Illinois (6,924 units, 55,392 fields) peaks at about 1.1 GB after the change (candidate:snapshot 1108 MiB, publish:prior-read 1126 MiB, publish:validate 1081 MiB, candidate:published 1080 MiB in the unchanged run), while the single-document stages (source:acquire-verify, normalize:*) sit near 700-770 MiB. A job's peak must come from the largest single item handled at once (one document, one place), never a whole state. Name those stages (the state-wide candidate snapshot, prior-read and validate) and make them work one document or one place at a time, then report the peak at the largest single item. Database totals (2.18 GB read initial, 2.80 GB read per unchanged run, 67 GB read per day at 24 refreshes) are also state-sized per run; show the unchanged run reads one state's changed documents only.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
