# Returned: ballot-three-states

lane: ballot-three-states
owner: ballot-three-states
writer: the ballot-three-states lane
check: at-scale
ready: no step ids unknown
river: 965bf002ea7ba2dd209f8d07852708e5e1fa1a8d
at: 2026-10-16T03:31:31Z
state: returned
fix_subject: fix:d362cc1a
fix: River · stream/ballot-three-states — at-scale failed for ballot-three-states: BL-30 (3d2b6615f), re-reviewed under the corrected memory rule (peak must come from the one unit the job publishes; a state's own ballot is that unit; return when the peak is a multiple of it): the peaks are multiples of the unit. Largest-s

## Failure

```
BL-30 (3d2b6615f), re-reviewed under the corrected memory rule (peak must come from the one unit the job publishes; a state's own ballot is that unit; return when the peak is a multiple of it): the peaks are multiples of the unit. Largest-state Illinois ballot artifact is 41,640,984 bytes and its profiles file 55,611,594 bytes, but the ballot worker peaks at 3,743,342,592 B initial / 3,818,700,800 B highest (about 90 times the artifact) and the profile worker at 3,324,014,592 / 3,705,548,800 B (about 65 times); publications (1.46-1.93 GB) and voting sites (1.13-1.43 GB) are 15-30 times their inputs. Name the stages that hold the copies (re-serialization, prior versions held beside the new one, whole-file parse) and bring each worker to a small multiple of its one state's artifact; report the new peaks. At 4096 MiB reservations only 1 ballot and 1 profile worker fit the runner, which is the same finding. Other open items: the 6.7 MB migration breaks scripts/apply-migrations.mts (git show ENOBUFS); it conflicts with river 1d3d303d7 in 34 files (reader routes, manual-read-models, edge-serving, edge-artifacts, runtime-edge, pg-schema and tests). Cleanliness list is the section above.
```

## Repair

Fix on stream/ballot-three-states and publish a new READY commit; River folds the new READY and clears this return when it integrates.
