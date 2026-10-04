# Integration record

One line per batch folded into river.

## 2026-10-04T07:34:08Z — river 0b31938 → 8f6185c (first fold)

- Evidence: pnpm gates on 8f6185c (CI env): 11/12 gates PASS; test 9088 pass, 1 fail, 10 skipped. The 1 failure (deploy-paths trace sweep, 3330 data/ files) is identical on main @ 0b31938 and predates this batch; recorded as a baseline exception.

- measures: SC-01, SC-02, SC-03, SC-05, SC-08, SC-12, SC-20 · ready cc8c0cf59
- registry: DB-09, DB-10, DB-11 · ready 165e9536b
- hunters: CH-02 · ready 9ae2d28bd
- auditors: DP-01 · ready ec1157a97
- people: CA-06, CA-09, CA-12 · ready 4b5bbc1dc
- river: RL-01, RL-03, RL-06, RL-07 · ready 44bbb2a7c
- PR #695 (CH-26) · head 33646180
- PR #698 (CH-30) · head f7282ab9
- PR #703 (CH-02/BR-31) · head f46f880e
- PR #700 (CH-26) · head 8695fe92
- PR #701 (CH-26) · head 5b818a03
- PR #704 (CH-26) · head e9ff3bf9
- PR #702 (CH-26) · head bdd8e06d
- PR #696 (CH-02) · head 4771d4cc
- PR #692 (CH-26) · head edfaae4a
- PR #693 (CH-26) · head 082edb9a
- PR #691 (CH-26/CH-02) · head 466cdd4d
- PR #689 (CH-26) · head caec33db
- PR #690 (CH-09) · head 15c4b93e
- PR #686 (CH-26) · head 6568d02e
- PR #685 (CH-01/CH-08) · head d9700a66
- PR #677 (BX-02/CP-05) · head 764ba547
- PR #699 (CH-28/CH-25) · head 709309f9
- PR #694 (CH-29/DB-58) · head 9493f4b0
- PR #642 (FE-39) · head 6c43d31c
- River fold repairs on the combination: the #692 OFFICIAL_PAGE_EVENTS_VERSION re-key; a floor for the door import (registry script); the #701 history-read spy
