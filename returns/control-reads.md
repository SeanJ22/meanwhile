# Returned: control-reads

lane: control-reads
owner: control-reads
writer: the control-reads lane
check: fold-conflict
ready: no step ids unknown
river: a24a073807bc8991a2cd579eb1a9065d07f57939
at: 2026-10-20T08:12:54Z
state: returned
fix_subject: fix:ad420f8b
fix: River · stream/control-reads — fold-conflict failed for control-reads: lib/hunt/runtime.ts . 1 hunk . scoutFieldManual read: AQ-01 added `&& !readerQuestion` to the early return and a `.catch(() => null)` around readFieldManual; CP-01 changed the call to readFieldManual(repos, query).projection.lines with the

## Failure

```
CP-01 READY 3156d5677 folds cleanly alone onto River a24a07380 plus main (preflight 0 findings; carries the control-plane migration CP-01), but it cannot be folded with AQ-01 READY a5902541c, which Sean asked to ship together. Folding them conflicts in two files (git merge, River a24a07380 + main + AQ-01 + CP-01):

  lib/hunt/runtime.ts . 1 hunk . scoutFieldManual read: AQ-01 added `&& !readerQuestion` to the early return and a `.catch(() => null)` around readFieldManual; CP-01 changed the call to readFieldManual(repos, query).projection.lines with the query carrying recordClasses and limit. Keep CP-01's new read shape and AQ-01's reader-question case and failure tolerance.
  app/api/ask/grounded/route.ts . 15 hunks . the grounded Ask route (2,634 lines). Both lanes edited it heavily. Keep AQ-01's concise grounded answers and unanswered-question wiring and CP-01's paid-control and state-history reads.

River will not hand-merge the Ask route: a wrong guess changes what readers are answered, and the owners have the tests. AQ-01 ships in release 62 (with VT-01 and CK-01) and will be in River soon.

Fix: merge origin/stream/aq-01 (READY a5902541c, or River once release 62 lands) and current main into stream/control-reads, resolve those two files, run `node scripts/preflight.mjs`, the focused CP-01 and AQ-01 checks (tests/ask-*, tests/answer-length.test.ts, tests/government-finance.test.tsx, tests/local-votes.test.ts, tests/worker-reader-publication.test.ts) with the CI flags, and the full pnpm gates, then send a new READY. DG-01, HN-01 and MP-01 are waiting on CP-01 before they edit shared files, so this is the critical path.
```

## Repair

Fix on stream/control-reads and publish a new READY commit; River folds the new READY and clears this return when it integrates.
