# Returned: cx-election-results

lane: cx-election-results
owner: cx-election-results
writer: the cx-election-results lane
check: per-visit ballot query makes ballot pages ~2 s slower
ready: no step ids unknown
river: f2469df86d2b2234e2cf9f91ee2aede5f31fbb74
at: 2026-11-08T02:07:42Z
state: returned
fix_subject: fix:01dea6c0
fix: River · stream/cx-election-results — per-visit ballot query makes ballot pages ~2 s slower failed for cx-election-results: Why: it still runs a query on every ballot page visit, BALLOT_RESULT_VERSION_SQL in lib/ballot/election-results.ts, called from lib/reader/canonical.ts. That makes every ballot page about 2 seconds slower. Rulings §6: any user-facing action

## Failure

```
READY df7cc590 on stream/cx-election-results held by River on Sean's order (2026-11-08), not folded.

Why: it still runs a query on every ballot page visit, BALLOT_RESULT_VERSION_SQL in lib/ballot/election-results.ts, called from lib/reader/canonical.ts. That makes every ballot page about 2 seconds slower. Rulings §6: any user-facing action over 3 seconds is a failure, and a release may not make the ZIPs-usable number worse.

What to fix before the next READY:
1. Take the per-visit database query off the reader path. The page reads only its place slice (how-it-works §8); results that changed reach it through the slice rebuild, not a version check on each visit.
2. Show ballot load times no slower than river: cold loads of the same ballot pages on river and on your branch (phone, tablet, desktop), with the numbers in the READY message.
3. Answer Sean's fix-row question in the READY message: how many fix-list rows the first production run writes, with the bound.
4. Keep both proof lines: connected end to end, and still works on the next scheduled run, with evidence for each.
```

## Repair

Fix on stream/cx-election-results and publish a new READY commit; River folds the new READY and clears this return when it integrates.
