# Returned: ballot-three-states

lane: ballot-three-states
owner: ballot-three-states
writer: the ballot-three-states lane
check: fold-conflict
ready: no step ids unknown
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T14:35:35Z
state: returned
fix_subject: fix:0ace164a
fix: River · stream/ballot-three-states — fold-conflict failed for ballot-three-states: BL-30 (3c12d0caa) conflicts with river be06573dc in lib/civic-data/held-place-families.ts, two hunks: the Promise.all destructuring (river still reads manualBallots, njBallot and nationalBallots; your side reads one generic ballots value) a

## Failure

```
BL-30 (3c12d0caa) conflicts with river be06573dc in lib/civic-data/held-place-families.ts, two hunks: the Promise.all destructuring (river still reads manualBallots, njBallot and nationalBallots; your side reads one generic ballots value) and the heldBallots/candidateLineups lines below it. Your version replaces river's NJ and national paths: keep yours and delete whatever river's side still uses for them (njBallot, nationalBallots, manualBallots). Merge origin/river into stream/ballot-three-states, run the focused tests, push a new READY.
```

## Repair

Fix on stream/ballot-three-states and publish a new READY commit; River folds the new READY and clears this return when it integrates.
