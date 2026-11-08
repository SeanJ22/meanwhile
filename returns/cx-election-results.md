# Returned: cx-election-results

lane: cx-election-results
owner: cx-election-results
writer: the cx-election-results lane
check: release would grow the code by 4,481 lines (rulings §5)
ready: no step ids unknown
river: 326ec16319cfe1c194cbaf027ebc771e11b74429
at: 2026-11-08T10:42:35Z
state: returned
fix_subject: fix:87457e57
fix: River · stream/cx-election-results — release would grow the code by 4,481 lines (rulings §5) failed for cx-election-results: READY f189064bd on stream/cx-election-results returned by River on 2026-11-08, not folded. It fixed everything Sean held df7cc590 for:

## Failure

```
READY f189064bd on stream/cx-election-results returned by River on 2026-11-08, not folded. It fixed everything Sean held df7cc590 for:
- BALLOT_RESULT_VERSION_SQL is gone and lib/reader/canonical.ts no longer runs a per-visit result query.
- The READY reports all 30 primary ZIP/device readiness medians faster than river (measured against b9b559588) and all 90 branch loads usable under 851 ms.
- Fix-row answer: 2,808 expected kind=fix rows on the 50-state snapshot, capped at 100 upserts per run.
- Both proof lines are present.

Why it is returned: rulings §5 — every release keeps the code the same size or smaller, and scripts/river.mjs release refuses a release that grows it. Against river f1d8caf71 this READY is 98 files, +10,001 / −5,520 = +4,481 lines. No other lane in the queue offsets that.

What to fix before the next READY:
1. Bring the net line count to zero or below: delete code the results work replaces, consolidate duplicates (e.g. lib/map/results-*.ts and lib/election-results/* helpers that overlap existing ballot/map code), and drop test setup an existing helper provides. Say the net in the READY.
2. Merge current river and re-measure ballot load times against it the same way (cold; phone with CPU slowed 4x, tablet, desktop; district lines drawn), with the numbers in the READY.
3. Keep both proof lines.
If the feature cannot fit, say so plainly in the lane's status so River can put the decision to Sean.
```

## Repair

Fix on stream/cx-election-results and publish a new READY commit; River folds the new READY and clears this return when it integrates.
