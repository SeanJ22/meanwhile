# Release 10 live check

- **Merged:** #716 at 12:24Z (8:24 AM EDT) as d79f179, tree identical to tested river 211c48c (`pnpm gates` 12/12: 9,907 tests, 9,896 pass, 0 fail). river fast-forwarded to d79f179.
- **CI:** run 37459131819 green (admission, verify, both builds, affected tests, gates). The earlier run 37459094605 was cancelled by the concurrency rule.
- **Deployed:** `/api/build` reports d79f179 at 12:26:45Z (8:26 AM EDT). **Post-deploy integrity:** run 37463036646 succeeded (reused).
- **Runner:** still stopped. Restart steps were pushed to Sean at 8:28 AM EDT. The release handoff installs d79f179 and the bootstrap applies v25.
- **Neon baseline, runner stopped:** control-plane project data_transfer_bytes = 1,857,008,371,257 at 12:27Z (Neon MCP describe_project, withered-sunset-39821877). The first measured hour is the delta from the restart, cross-checked against cp_runner_heartbeat value->'neonBytes'->'lastFullHour'.

| Step | State | Evidence |
|---|---|---|
| vital signs (hunters) | Needs time | After the restart: journal "neon bytes so far this hour" lines, heartbeat neonBytes, and cp_vital_signs rows. |
| v25 cp_vital_signs | Needs time | to_regclass('cp_vital_signs') non-null after the restart bootstrap. |
| CA-12 repair | Failed live (harm gone) | Ask at 85701 returns no answer (answer null, 94 records); no headline quoted. Done-when needs her dated sentence. Returned to people. |
| CA-11, CA-05, CA-14 | Needs time | Stances, portraits and topic answers publish through the runner. |
| CP-04 repair, owner snapshot | Needs time | Runner side. |
