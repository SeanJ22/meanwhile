# Returned: election-results-map

lane: election-results-map
owner: election-results-map
writer: the election-results-map lane
check: carries returned CX (size); +6,160 lines; conflicts with river
ready: no step ids unknown
river: f1d8caf71de2e92b051040abce2b9b7a2752569d
at: 2026-11-08T12:57:45Z
state: returned
fix_subject: fix:c931ff1f
fix: River · stream/election-results-map — carries returned CX (size); +6,160 lines; conflicts with river failed for election-results-map: READY 4c3067d39 on stream/election-results-map returned by River on 2026-11-08, not folded.

## Failure

```
READY 4c3067d39 on stream/election-results-map returned by River on 2026-11-08, not folded.

Why:
1. It carries cx-election-results READY f189064bd, which River returned today for growing the code by 4,481 lines (rulings §5: every release keeps the code the same size or smaller; scripts/river.mjs release refuses a release that grows it).
2. Against river 38024964c (release 192) this READY is 118 files, +11,698 / −5,538 = +6,160 lines.
3. It conflicts with river (merge-tree reports conflicts after releases 191–192).

What to fix before the next READY:
- Wait for cx-election-results to post a READY that is net zero lines or smaller and re-measured on current river, then merge that READY (not f189064bd).
- Bring this lane's own additions to net zero or below (delete what the results map replaces; reuse existing map helpers).
- Merge current river and resolve the conflicts.
- Measure ballot and results-map load times on river and on this branch the way a reader sees them (cold; phone with CPU slowed 4x, tablet, desktop; district lines drawn) and put the numbers in the READY. Keep both proof lines.
```

## Repair

Fix on stream/election-results-map and publish a new READY commit; River folds the new READY and clears this return when it integrates.
