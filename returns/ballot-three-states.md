# Returned: ballot-three-states

lane: ballot-three-states
owner: ballot-three-states
writer: the ballot-three-states lane
check: at-scale
ready: no step ids unknown
river: 493311674ed4c1f3d15c14f70e19e7be9b9f58aa
at: 2026-10-15T23:21:26Z
state: returned
fix_subject: fix:92f7c14b
fix: River · stream/ballot-three-states — at-scale failed for ballot-three-states: BL-30 (3d2b6615f): AT SCALE peak comes from a whole state. The message says each assembler child reads one state's file and worker results; a job's peak must come from the largest single item it handles at once (one contest, one candidate f

## Failure

```
BL-30 (3d2b6615f): AT SCALE peak comes from a whole state. The message says each assembler child reads one state's file and worker results; a job's peak must come from the largest single item it handles at once (one contest, one candidate file, one place), never a whole state. Name the stage that holds the state (the assembler child's read of the state file and its worker results) and make it stream one contest at a time, then report the peak at the largest contest. Also open: the 6.7 MB migration breaks scripts/apply-migrations.mts (git show ENOBUFS); 34 files conflict with river 3282584e2 (reader routes, manual-read-models, edge-serving, edge-artifacts, runtime-edge, pg-schema and tests); cleanliness list is the section above.
```

## Repair

Fix on stream/ballot-three-states and publish a new READY commit; River folds the new READY and clears this return when it integrates.
