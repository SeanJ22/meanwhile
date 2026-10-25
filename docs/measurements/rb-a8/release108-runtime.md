# RB-A8 note — release 108 runtime verification

Verified after release 108. This is a note, not READY; migration locking remains River's RV-LOCK.

Release 108 (`c0500807ba773fbc19d21ad8913f724cbaafc112`) published at Oct 24, 2026, 8:31:51.846 PM MST. Netlify and the production `/api/build` agreed on that commit and deploy `6add76db32a73cdbdc05c6d2`.

Production read-only SQL after publication verified `RB-A8_count_hour` at journal timestamp `1792834200003`, hash `aaea8f9348e658bdc5dc5b32b5d1194445a9a94a5d4f8c74636a8dec286c9834`. All four reader hooks are enabled. The control-plane `RB-A8_expand` journal hash is `2b5a0d015795b2d83c8fa58cece4c5d6974da0e8eec4f3dd6328bd1702283d66`.

Two actual scheduled checkpoints were observed 3,599.824 seconds apart, effectively one hour. The deployed Netlify schedule is `5 * * * *`.

| Recorded invocation, Phoenix | Recorded invocation, Eastern | State buckets |
|---|---|---:|
| Oct 24, 2026, 9:05:15.025 PM MST | Oct 25, 2026, 12:05:15.025 AM EDT | 57 |
| Oct 24, 2026, 10:05:14.849 PM MST | Oct 25, 2026, 1:05:14.849 AM EDT | 57 |

The deploy initializer first wrote at Oct 24, 2026, 8:32:26.419 PM MST. Another production deploy published at Oct 24, 2026, 9:08:46.232 PM MST and initialized the existing hour again. The earlier scheduled reading was captured before that replacement and is preserved in the evidence. The keeper's `hour` identifies the completed hour; `checked_at` identifies the invocation.

Final saved-state measurement:

- Three active `line_keeper_run` checkpoints: **9,461 JSON bytes**.
- All 56 remaining `line-keeper:%` legacy snapshot metadata rows: **9,568 JSON bytes**; zero retain `capture` or `inputs`.
- Combined observer state: **19,029 bytes**, below 100,000 bytes.
- Retired `line-keeper:current` inventory: **zero rows**.

Inspection used only reader project `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, role `readonly`, and control-plane project `withered-sunset-39821877`, branch `br-tiny-frog-aeufpjeq`, role `wtp_cp_release_readonly`. Both deny INSERT and UPDATE on the checked tables. This lane made no production writes or manual job invocations.

Evidence: [release108-runtime.json](release108-runtime.json). The requested post-release runtime check is complete; RB-A8 stops after pushing this note, as Sean directed.
