# Returned: auditors

lane: auditors
owner: auditors
writer: the auditors lane
check: fold
ready: no step ids aa633fa202dec9edc3f8214b9cb52e9cad26d4e8
river: ecf402600401783b094837c29e0c515eadbdb843
at: 2026-10-05T19:00:55Z
state: returned
fix_subject: fix:67727ec8
fix: River · stream/auditors — fold failed for auditors: Your READY aa633fa20 (DP-02, DP-10, DP-11, DP-13, DP-14, DP-16, DP-17) conflicts with river-next 92fda9c in two files. Catch up with river once River promotes this fold, resolve, re-run your focused checks and mark a new READY.

## Failure

```
Your READY aa633fa20 (DP-02, DP-10, DP-11, DP-13, DP-14, DP-16, DP-17) conflicts with river-next 92fda9c in two files. Catch up with river once River promotes this fold, resolve, re-run your focused checks and mark a new READY.

1. lib/control-plane/repository/pg-schema.ts: hunters CH-26 (now on river-next) took schema version 20 for the scoped history indexes, as River decided earlier. Your DP-13 live-audit log takes version 21. Keep both comments and BOOTSTRAP_VERSION = 21. tests/scoped-task-reads.test.ts:231 pins `assert.equal(BOOTSTRAP_VERSION, 20)`; that pin belongs to hunters. Ask River via needs_hook to relax it to `>= 20`, or keep v21 and note the hook. Do not change hunters' test yourself.

2. scripts/freshness-shadow.mts (hunters owns it; your agreed exception is lines ~589-600 and ~995): hunters' BR-05 hook already reads Admin's detective.shutThreshold each round (`readSetting(settingsConfig, DETECTIVE_SHUT_THRESHOLD_SETTING, DETECTIVE_SHUT_THRESHOLD)` near line 1016), and echoes it into the heartbeat settings (tests/runner-settings-hooks.test.ts). Your DP-02 hook adds a second `const shutThreshold = shutThresholdFrom(...)` in the same scope, so the two cannot both stand. Keep hunters' read; drop your three added lines and your `shutThresholdFrom` import in freshness-shadow.mts. Your `shutThresholdFrom` in detective.ts and its test can stay. The threshold is still passed to sourceFailureRecovery, plainRereadSlot and failureResponderExecutor.
```

## Repair

Fix on stream/auditors and publish a new READY commit; River folds the new READY and clears this return when it integrates.
