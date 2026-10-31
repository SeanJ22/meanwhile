# Returned: spn-01-parserstop

lane: spn-01-parserstop
owner: spn-01-parserstop
writer: the spn-01-parserstop lane
check: pnpm test (tests/bounded-beat.test.ts)
ready: SPN-01 d6bcd167e5d4
river: f1bb5dfad0b0555f1f851fbeaeb26046273a797b
at: 2026-10-31T03:22:52Z
state: returned
fix_subject: fix:d16d60dd
fix: River · stream/spn-01-parserstop — pnpm test (tests/bounded-beat.test.ts) failed for spn-01-parserstop: ✖ failing tests:

## Failure

```
✖ failing tests:

test at tests/bounded-beat.test.ts:44:1
✖ startup and the standing clock write the running code, at most once a minute, without starting research or touching cycle fields (6.228377ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + '8664f367eee4009fb9cc893a2092581efc48a52a'
  - '9352c8e143db00d1623735f02e8c419d1c697278'

      at TestContext.<anonymous> (file:///home/user/wt-168/tests/bounded-beat.test.ts:74:10)
      at async Test.run (node:internal/test_runner/test:1054:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:744:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '8664f367eee4009fb9cc893a2092581efc48a52a',
    expected: '9352c8e143db00d1623735f02e8c419d1c697278',
    operator: 'strictEqual',
    diff: 'simple'
  }
Cause: scripts/pilot-runner.mts writeLiveCycleBeat now calls privateText(), which tests/bounded-beat.test.ts does not extract into its vm sandbox, so the beat write throws and the heartbeat keeps the old testedSha. Passes on river f1bb5dfad (4/4); fails on river + d6bcd167e alone (3/4), every run.
```

## Repair

Fix on stream/spn-01-parserstop and publish a new READY commit; River folds the new READY and clears this return when it integrates.
