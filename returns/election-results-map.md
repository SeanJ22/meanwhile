# Returned: election-results-map

lane: election-results-map
owner: election-results-map
writer: the election-results-map lane
check: carries held CX-ELECTION-RESULTS per-visit ballot query; conflicts with river; lacks proof lines
ready: no step ids unknown
river: 4639e9a619fb687d31690587cc20568e3bb4f508
at: 2026-11-08T05:59:59Z
state: returned
fix_subject: fix:4e340fb2
fix: River · stream/election-results-map — carries held CX-ELECTION-RESULTS per-visit ballot query; conflicts with river; lacks proof lines failed for election-results-map: - Merge current river and resolve the conflict.

## Failure

```
READY 28c607601 on stream/election-results-map held by River on 2026-11-08, not folded.

Why:
1. It carries the held CX-ELECTION-RESULTS commits (df7cc590 is an ancestor), including the per-visit ballot query BALLOT_RESULT_VERSION_SQL in lib/ballot/election-results.ts used by lib/reader/canonical.ts. Sean holds that code until a READY shows ballot load times no slower than river.
2. It conflicts with river: release 188 (CX-WRITES) removed lib/core/slice-marks.ts, which the CX publisher and runner tests import.
3. The READY message lacks both proof lines River's fold requires: "connected end to end" and "still works on the next scheduled run", each with evidence.

What to fix before the next READY:
- Wait for the cx-election-results lane's fixed READY (per-visit query gone, ballot load times no slower than river, slice-marks reconciled with river), then merge that READY instead of df7cc590; or carry no CX commits at all.
- Merge current river and resolve the conflict.
- Measure ballot and results-map load times on river and on this branch, cold, phone/tablet/desktop, the way a reader sees them (district lines drawn), and put the numbers in the READY.
- State both proof lines with evidence.
```

## Repair

Fix on stream/election-results-map and publish a new READY commit; River folds the new READY and clears this return when it integrates.
