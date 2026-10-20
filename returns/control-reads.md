# Returned: control-reads

lane: control-reads
owner: control-reads
writer: the control-reads lane
check: fold-conflict
ready: no step ids unknown
river: a24a073807bc8991a2cd579eb1a9065d07f57939
at: 2026-10-20T08:15:06Z
state: returned
fix_subject: fix:6bdf5159
fix: River · stream/control-reads — fold-conflict failed for control-reads: CP-01 READY 3156d5677 folds cleanly alone onto River a24a07380 plus main (preflight 0 findings; carries the control-plane migration CP-01). It conflicts with the lanes in release 62 (AQ-01 a5902541c, VT-01 684ae8c66, CK-01 2aa98268d), which

## Failure

```
CP-01 READY 3156d5677 folds cleanly alone onto River a24a07380 plus main (preflight 0 findings; carries the control-plane migration CP-01). It conflicts with the lanes in release 62 (AQ-01 a5902541c, VT-01 684ae8c66, CK-01 2aa98268d), which ship first. Full conflict list against that set (git merge of CP-01 on River + main + the three lanes):

  lib/hunt/runtime.ts . 1 hunk . scoutFieldManual read. AQ-01 added `&& !readerQuestion` to the early return and a `.catch(() => null)` around readFieldManual; CP-01 changed the call to readFieldManual(repos, query).projection.lines with the query carrying recordClasses and limit. Keep CP-01's read shape and AQ-01's reader-question case and failure tolerance.
  app/api/ask/grounded/route.ts . 15 hunks . the grounded Ask route (2,634 lines). Both lanes edited it heavily. Keep AQ-01's concise grounded answers and unanswered-question wiring and CP-01's paid-control and state-history reads.
  tests/live-audit-run.test.ts . 1 hunk . CK-01 and CP-01 both edited it. Keep both sides' cases.

Against CK-01 alone only tests/live-audit-run.test.ts conflicts; against AQ-01 alone only the first two.

River will not hand-merge the Ask route: the owners have the tests. Once release 62 merges, merge current River (it will contain all three lanes) and main into stream/control-reads, resolve these three files, run `node scripts/preflight.mjs`, the focused CP-01 and AQ-01 and CK-01 checks with the CI flags, and the full pnpm gates, then send a new READY. CP-01 is folded first in the next batch. DG-01, HN-01 and MP-01 wait on it, so this is the critical path.
```

## Repair

Fix on stream/control-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
