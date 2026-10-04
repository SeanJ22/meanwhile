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

## 2026-10-04T08:07:39Z — river 8f6185c → c7914e8

- Evidence: pnpm gates on c7914e8 (CI env): 12/12 PASS; 9088 tests pass, 0 fail, 11 skipped (the deploy-paths trace sweep reports a named skip because .next was absent before build, as in CI).
- river: RL-03 · ready d45831c1f
- measures: SC-04, SC-06, SC-07, SC-09, SC-11 · ready 21c587968
- registry: DB-12, DB-25 · ready 426c69a20
- hunters: CH-06, CH-10, BR-08 hook, DB-09 hook · ready 19cb8dafd
- meetings: DB-01 · ready 6afc9006d
- people: CA-03, CA-13, CA-42, SC-15 · ready 9a185c1c0
- Fold repairs: official-page key re-keyed twice (registry, meetings); admin-bridge-runner keeps #685's deadline and hunters' funded-scope read; SC-15 vs SC-03 resolved to keep both intents.

## 2026-10-04T08:39:26Z — river c7914e8 → 8c67d4b65

- Evidence: pnpm gates on 2c1223f (CI env): 11/12 PASS, test 8999 pass 0 fail; feedback:sweep failed on SC-18's removed ADM-1/ADM-23 tests -> repaired in 8c67d4b (checkDebt), then feedback:sweep PASS and the 3 test files reading the ledger 40/40.
- measures: BR-08 · ready d8e596990
- people: SC-18 · ready c022a0df9
- river: RL-03 · ready fc14ff341

## 2026-10-04T09:06:50Z — river 8c67d4b → 4b5102044

- Evidence: pnpm gates on 4b5102044 (CI env): 12/12 PASS; 9020 tests pass, 0 fail, 11 skipped.
- registry: DB-13, DB-21 · ready ffa73d305
- hunters: DB-48 · ready 902041c35
- meetings: DB-02, BX-08 · ready fd0917fa2
- auditors: DP-02, DP-04, DP-06 · ready 29ce64461

## 2026-10-04T09:34:14Z — river 4b51020 → d69e9760e

- Evidence: pnpm gates on d69e9760e (CI env): 12/12 PASS; 9063 tests pass, 0 fail, 11 skipped.
- measures: BR-21, BR-23, SC-13, SC-16 · ready 940b11c58
- registry: DB-17, DB-23 · ready 8cd6e7034
- hunters: CH-03 · ready 643a3a373

## 2026-10-04T10:02:25Z — river d69e976 → d67aa5e29

- Evidence: pnpm gates on d67aa5e29 (CI env): 12/12 PASS; 9120 tests pass, 0 fail, 11 skipped.
- registry: DB-14 · ready 156fdb754
- bank: DB-37, DB-38, DB-40, DB-41, DB-42, DB-43, DB-49, DB-51, DP-07, DP-08, DP-09, DP-19 · ready 7eb22ae28
- ballot: CA-20, CA-24, CA-30, CA-44, CA-45, CA-51 · ready bfc11e7b5
- Fold repair: tests/readiness-reader-delivery.test.ts stays deleted (SC-18 removed its imports; ballot only moved a count there).

## 2026-10-04T10:29:36Z — river d67aa5e → 616f91a1c

- Evidence: pnpm gates on 616f91a1c (CI env): 12/12 PASS; 9132 tests pass, 0 fail, 11 skipped.
- registry: DB-15 · ready 44a3a3caa
- hunters: CH-04 · ready d8075f82d
- bank: DP-20 · ready ee1c356ca

## 2026-10-04T10:58:17Z — river 616f91a → 8bbe9eeb5

- Evidence: pnpm gates on 39e119d (CI env): 11/12, test 9162 pass 2 fail (auditors' live-write guard: origins rule, RULING 14). Repaired in 8bbe9ee; path-separator, live-write-guard and origins tests 18/18, tsc and eslint clean.
- registry: DB-16 · ready d8eed916d
- auditors: DP-03, FE-16 · ready 4a20e1bf9
- people: CA-15 · ready ac936387a
- bank: DB-57, DP-21, DP-22, DP-27 · ready 92f237c74

## 2026-10-04T11:27:36Z — river 8bbe9ee → 3690498b5

- Evidence: pnpm gates on ba758a7 (CI env): 11/12, test 9191 pass 1 fail (RULING 107 freshness stamp in lib/sources/feed-kinds.ts, bank DB-50). Repaired in 3690498 (header declaration); freshness-provenance + feed-kinds tests 11/11, eslint clean.
- registry: DB-18, DB-32 · ready 18eed9afa
- hunters: CH-05 · ready 89c49c1d6
- auditors: DP-05, DP-15, FE-03, FE-17, FE-18 · ready 1f9769067
- bank: DB-50, DP-24 · ready 20ae5c0c9

## 2026-10-04T11:59:37Z — river 3690498 → bbe97c72a

- Evidence: pnpm gates on bbe97c72a (CI env): 12/12 PASS; 9242 tests pass, 0 fail, 11 skipped.
- registry: DB-33 · ready 5fecfca32
- meetings: BX-10, DB-06, DB-07, DB-55 · ready 615092663
- auditors: DP-10, DP-13, DP-14, DP-16, DP-18 · ready e19d677d4
- bank: DP-28 · ready fa4a868ef
- Fold repair: RoutineRemovalEvidence union carries both AuditPull (auditors) and MovedToHistory (meetings).

## 2026-10-04T12:29:10Z — river bbe97c7 → 1abac17ea

- Evidence: pnpm gates on 1abac17ea (CI env): 12/12 PASS; 9243 tests pass, 0 fail, 11 skipped.
- hunters: CH-07 · ready f75a8a8cf
