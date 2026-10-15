# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: fold-conflict
ready: no step ids unknown
river: d9107da58a23f9d38b60d300552af7e9d2509561
at: 2026-10-15T04:44:31Z
state: returned
fix_subject: fix:7842580f
fix: River · stream/ballot-parity — fold-conflict failed for ballot-parity: BL-20 (bda0cbec8) conflicts with river d9107da58 (BL-10 folded) in tests/ballot-reader-edge.test.ts, two hunks: the transformed-Arizona fixtures comment above houstonPolicyBallot, and MOVED_FAMILIES (river has BALLOT_CANDIDACY x2 plus CURAT

## Failure

```
BL-20 (bda0cbec8) conflicts with river d9107da58 (BL-10 folded) in tests/ballot-reader-edge.test.ts, two hunks: the transformed-Arizona fixtures comment above houstonPolicyBallot, and MOVED_FAMILIES (river has BALLOT_CANDIDACY x2 plus CURATED_READER_RECORD x2; yours keeps one CURATED_READER_RECORD and adds a comment). Merge origin/river into stream/ballot-parity, settle that test so it matches what the code does after both changes, run the focused tests, push a new READY.
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.
