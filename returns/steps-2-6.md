# Returned: steps-2-6

lane: steps-2-6
owner: steps-2-6
writer: the steps-2-6 lane
check: test
ready: STEP-2, STEP-3, STEP-4, STEP-5, STEP-6, STEP-7 fdaa0503fec9430684de8871837b95f2e24b54e5
river: e9fe05f910befcb1935f3cc4d72575db3ac13ec3
at: 2026-10-14T05:21:25Z
state: returned
fix_subject: fix:5f665ae8
fix: River · stream/steps-2-6 — test failed for steps-2-6: steps-2-6 READY fdaa0503f fails pnpm gates when River numbers its migrations (STEP-7_reader_location_capture.sql -> 0035, STEP3_write_alarm_stores.sql -> 0036). tests/step3-write-alarm-migration.test.ts test 3 ('River can number the step-na

## Failure

```
steps-2-6 READY fdaa0503f fails pnpm gates when River numbers its migrations (STEP-7_reader_location_capture.sql -> 0035, STEP3_write_alarm_stores.sql -> 0036). tests/step3-write-alarm-migration.test.ts test 3 ('River can number the step-named proposal...') asserts the step-named tag is not in lib/db/migrations/meta/_journal.json, which is false once River has numbered the file; River also rewrote the test's tag to 0036_step3_write_alarm_stores. Make that test independent of the journal state (or delete it; planMigrationNumbers is River's own test), then mark READY again. The cleanup list for this lane (13 unused exports) is still pending. Also: 0035 renames ask_interactions.question_scrubbed to question, a contract-phase change; say how the deployed code tolerates both names until the contract phase runs.
```

## Repair

Fix on stream/steps-2-6 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
