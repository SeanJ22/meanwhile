# Returned: cx-writes

lane: cx-writes
owner: cx-writes
writer: the cx-writes lane
check: GitHub CI
ready: CX-WRITES 413cb58eaf75072b3c033c9b3eeae734a2ddeb6f
river: 97a693b6948a504d07eb53ea1818d4a17ee7447f
at: 2026-11-08T04:24:03Z
state: returned
fix_subject: fix:ba7a166d
fix: River · stream/cx-writes — GitHub CI failed for cx-writes: 2026-11-08T04:14:31.3672825Z   AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:

## Failure

```
2026-11-08T04:14:31.3672056Z ✖ an empty calendar's new source check queues its consuming place without rereading payloads (1597.022119ms)
2026-11-08T04:14:31.3672825Z   AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
2026-11-08T04:14:31.3673312Z   + actual - expected
2026-11-08T04:14:31.3673637Z
2026-11-08T04:14:31.3673920Z   + []
2026-11-08T04:14:31.3674205Z   - [
2026-11-08T04:14:31.3674578Z   -   'ocd-division/country:us/state:az/place:own-zip'
2026-11-08T04:14:31.3674954Z   - ]
2026-11-08T04:14:31.3675234Z
2026-11-08T04:14:31.3675788Z       at TestContext.<anonymous> (file:///home/runner/work/meanwhile/meanwhile/tests/reader-cache.test.ts:249:12)
2026-11-08T04:14:31.3676687Z       at async Test.run (node:internal/test_runner/test:1409:7)
2026-11-08T04:14:31.3677270Z       at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
2026-11-08T04:14:31.3687159Z     generatedMessage: true,
2026-11-08T04:14:31.3687702Z     code: 'ERR_ASSERTION',
2026-11-08T04:14:31.3688077Z     actual: [],
2026-11-08T04:14:31.3688567Z     expected: [ 'ocd-division/country:us/state:az/place:own-zip' ],
2026-11-08T04:14:31.3689087Z     operator: 'deepStrictEqual',
2026-11-08T04:14:31.3689457Z     diff: 'simple'
2026-11-08T04:14:31.3689774Z   }
2026-11-08T04:14:31.3948149Z ##[error]Process completed with exit code 1.
2026-11-08T04:14:31.4006716Z ##[group]Run actions/upload-artifact@v5
2026-11-08T04:14:31.4006905Z with:
2026-11-08T04:14:31.4007076Z   name: test-2-c7fd11b34fb99c18fa28a0f0dd3b1afa81655343-1
2026-11-08T04:14:31.4007279Z   path: .scratch/ci/
```

## Repair

Fix on stream/cx-writes and publish a new READY commit; River folds the new READY and clears this return when it integrates.
