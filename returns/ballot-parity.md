# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: fold: conflicts with release 53
ready: BL-20, BL-21, EP-01 c0dcb557318b43765f19cb4b8010879984617e31
river: 2db157b2e8c39b0f4b13ccc4279a80b31f057d79
at: 2026-10-17T17:21:44Z
state: returned
fix_subject: fix:f1617841
fix: River · stream/ballot-parity — fold: conflicts with release 53 failed for ballot-parity: fold: stream/ballot-parity READY c0dcb5573 (BL-21) conflicts with river 2db157b2e (release 53: MT-02, R0+RD-01, XS-02 now live on main 2cdea6b).

## Failure

```
fold: stream/ballot-parity READY c0dcb5573 (BL-21) conflicts with river 2db157b2e (release 53: MT-02, R0+RD-01, XS-02 now live on main 2cdea6b).
Conflicting files (12): lib/civic-data/held-place-families.ts, promoted-edge-publication.ts, promotion.ts, scoped-manual-contracts.ts, state-artifact-dispatch.ts, state-reader.ts, store.ts, validate.ts; lib/meetings/edge-artifacts.ts, edge-serving.ts; scripts/publish-state-authority.mts; tests/helpers/promoted-fixtures.ts.
BL-21 was rebased onto EP-01 (river 3663b15a3) only. R0 moved the federal directory to per-state pointers (federalDirectoryScope(state)) and MT-02 changed the meeting/state publication path; both touch the same state-pointer code.
Next: merge origin/main (2cdea6b) into stream/ballot-parity, keep R0's federalDirectoryScope per-state read and stateAuthorityPointers, add the ballot-navigation family on top, run your focused checks, then send a new READY.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
