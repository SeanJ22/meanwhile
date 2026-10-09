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

## 2026-10-04T12:59:35Z — river 1abac17 → a88a0726c

- Evidence: pnpm gates on a88a0726c (CI env): 12/12 PASS; 9282 tests pass, 0 fail, 11 skipped.
- registry: DB-54 · ready ea37c9c0b
- meetings: DB-03, DB-04, DB-05, DB-08, DB-27, DB-31, DB-56 · ready 653e1d6cb
- people: CA-40, CA-41 · ready 10677c503

## 2026-10-04T13:30:31Z — river a88a072 → ef13298 (after release 1)

- Evidence: pnpm gates on 4dd5c7b (CI env): 12/12 PASS; 9286 tests pass, 0 fail, 11 skipped. main (dcddcf5) reconciled into river as ef13298 with zero tree change.
- hunters: CH-08 · ready ec8eb4982
- meetings: DB-06 safety net · ready 4ca547ae4
- 2026-10-05T17:26:09Z · registry · DB-10, DB-11, DB-23 · ready 93a5669a07a4 · river 85a0ad660c36 · pnpm gates pass on 85a0ad660c36
- 2026-10-05T17:26:09Z · hunters · CH-09, CH-13, CH-29, CH-30 · ready dc3017d4d18d · river 85a0ad660c36 · pnpm gates pass on 85a0ad660c36
- 2026-10-05T17:26:09Z · meetings · BX-09, DB-30 · ready cd567d362830 · river 85a0ad660c36 · pnpm gates pass on 85a0ad660c36
- 2026-10-05T17:26:09Z · admin · BR-05, BR-06, BR-01, BR-03, BR-24, BR-12, BR-15, BR-09, BR-02, BR-10, BR-16, BR-37, CH-12, CH-14 · ready ae9ff83485e5 · river 85a0ad660c36 · pnpm gates pass on 85a0ad660c36
- 2026-10-05T17:26:09Z · slide · CP-01, CP-19 · ready 6921176ca005 · river 85a0ad660c36 · pnpm gates pass on 85a0ad660c36

- 2026-10-05 19:06Z: river-next replaced by fold 92fda9c (base river ecf4026; measures BR-23, registry DB-34/35, hunters CH-11/BR-05/BR-16/BR-37/CH-24/CH-26, meetings DB-28, people CA-01, admin BR-07, slide reader-edge-publication-return). Previous remote river-next tip was 150a8728 (older BX-09/DB-30 fold, already integrated).
- 2026-10-05T21:41:06Z · measures · BR-23, BR-14, BR-25 · ready e47bf4a5f4f2 · river 13d29c572dc8 · pnpm gates pass on 13d29c572dc8
- 2026-10-05T21:41:06Z · registry · DB-34, DB-35, DB-36, DP-12 · ready 06fed3b4384d · river 13d29c572dc8 · pnpm gates pass on 13d29c572dc8
- 2026-10-05T21:41:06Z · hunters · CH-11, BR-05, BR-16, BR-37, CH-24, CH-26, DB-53 · ready d7e93a3359c0 · river 13d29c572dc8 · pnpm gates pass on 13d29c572dc8
- 2026-10-05T21:41:06Z · meetings · DB-28, DB-58 · ready 9750e9f7cd42 · river 13d29c572dc8 · pnpm gates pass on 13d29c572dc8
- 2026-10-05T21:41:06Z · slide · CP-02, CP-09, BX-12, BX-03, CP-10, CP-13, CP-16, CP-06, BX-13, reader-edge-publication-return · ready 483737aec779 · river 13d29c572dc8 · pnpm gates pass on 13d29c572dc8
- 2026-10-05T21:41:06Z · ballot · CA-30, CA-51 · ready 8760257b3400 · river 13d29c572dc8 · pnpm gates pass on 13d29c572dc8
- 2026-10-05T21:41:06Z · bank · DB-44, DB-46, DP-23, DB-57 · ready cf0df0cb0acb · river 13d29c572dc8 · pnpm gates pass on 13d29c572dc8
- 2026-10-05T21:41:06Z · frontend · FE-05, FE-06, FE-07, FE-10, FE-39, FE-43, FE-44 · ready a5e7197a1855 · river 13d29c572dc8 · pnpm gates pass on 13d29c572dc8
- 2026-10-06T00:34:24Z · measures · SC-10, SC-14, BR-33, BR-34, BR-30, SC-19 · ready 3ebea50717bb · river 186f747a8769 · pnpm gates pass on 186f747a8769
- 2026-10-06T00:34:24Z · registry · FE-20, FE-21 · ready a302a9393304 · river 186f747a8769 · pnpm gates pass on 186f747a8769
- 2026-10-06T00:34:24Z · hunters · CH-15, CH-16, CH-17, CH-19 · ready 671b0b567a7b · river 186f747a8769 · pnpm gates pass on 186f747a8769
- 2026-10-06T00:34:24Z · people · CA-01, CA-46 · ready 0fa3d0c1b0fb · river 186f747a8769 · pnpm gates pass on 186f747a8769
- 2026-10-06T00:34:24Z · auditors · DP-02, DP-10, DP-11, DP-13, DP-14, DP-16, DP-17, DP-18, DP-30, DP-31, DP-32, FE-02, FE-18 · ready 498a4140cb52 · river 186f747a8769 · pnpm gates pass on 186f747a8769
- 2026-10-06T00:34:24Z · frontend · FE-08, FE-09, FE-11, FE-13, FE-15, FE-28, FE-29, FE-30, FE-31, FE-32, FE-34, FE-38, FE-41, FE-42, FE-45 · ready de644b38c2bf · river 186f747a8769 · pnpm gates pass on 186f747a8769
- 2026-10-06T01:42:33Z · river · MW-021, CH-26 · ready 227399e2cd72 · river 005800718335 · pnpm gates pass on 005800718335
- 2026-10-06T02:27:12Z · river · CH-26 · ready f26f5807c9b8 · river 64528dfb416b · pnpm gates pass on 64528dfb416b
- 2026-10-06T02:27:54Z: main 3a5ed2b reconciled into river as 45fbf4e (tree identical to tested 64528df, gates 12/12).
- 2026-10-06T03:41:32Z · measures · BR-32 · ready df6f5e2f1103 · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T03:41:32Z · hunters · CH-21 · ready 9be549cb1278 · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T03:41:32Z · meetings · DB-22, DB-26, BX-11 · ready 2395df94ec07 · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T03:41:32Z · auditors · DP-25, DP-26, DP-29, DP-33, DP-34, FE-21 · ready c428dc394e42 · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T03:41:32Z · people · CA-02, CA-07, CA-08, CA-16 · ready 058085829420 · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T03:41:32Z · slide · CP-03, CP-04, CP-05, CP-07, CP-08, CP-11, CP-12, CP-18, BX-01, BX-02, BX-06, BX-07 · ready 66f6ed84a8ce · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T03:41:32Z · ballot · CA-21, CA-22, CA-25, CA-26, CA-27, CA-28, CA-29, CA-31, CA-32, CA-33, CA-34, CA-35, CA-36, CA-37, CA-38, CA-39, CA-52, CA-53, CA-54, CA-55 · ready 0fc6ef6d21a6 · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T03:41:32Z · bank · DB-47 · ready f92b4d4f1bf1 · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T03:41:32Z · frontend · FE-12, FE-14, FE-22 · ready b3a24040e8b3 · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T03:41:32Z · river · CH-26 · ready acd6efcb8f80 · river 458f0a196f52 · pnpm gates pass on 458f0a196f52
- 2026-10-06T05:11:10Z · hunters · CH-24 · ready e1c4a1903b4d · river 8e47854b1a50 · pnpm gates pass on 8e47854b1a50
- 2026-10-06T05:11:10Z · river · MW-021 · ready 7981365a4fc9 · river 8e47854b1a50 · pnpm gates pass on 8e47854b1a50
- 2026-10-06T06:48:50Z · measures · BR-31 · ready 30922c2e15c0 · river fb10f50e15ad · pnpm gates pass on fb10f50e15ad
- 2026-10-06T06:48:50Z · registry · FE-24, FE-21, FE-37, FE-25, FE-40 · ready c6dbda0a32ff · river fb10f50e15ad · pnpm gates pass on fb10f50e15ad
- 2026-10-06T06:48:50Z · meetings · DB-32, DB-34, FE-26, FE-27, FE-23 · ready 28d94df7d568 · river fb10f50e15ad · pnpm gates pass on fb10f50e15ad
- 2026-10-06T06:48:50Z · auditors · FE-21 · ready e51a93c6c4f1 · river fb10f50e15ad · pnpm gates pass on fb10f50e15ad
- 2026-10-06T06:48:50Z · slide · BX-03, BX-12 · ready e6ffab73b816 · river fb10f50e15ad · pnpm gates pass on fb10f50e15ad
- 2026-10-06T06:48:50Z · bank · DB-37, DP-08, DB-45, DB-52 · ready 34bb40ec6731 · river fb10f50e15ad · pnpm gates pass on fb10f50e15ad
- 2026-10-06T06:48:50Z · frontend · FE-35, FE-36 · ready 16a36b422b6a · river fb10f50e15ad · pnpm gates pass on fb10f50e15ad
- 2026-10-06T10:12:30Z · hunters ·  · ready f34b81aaab8a · river 4fabb668cdce · pnpm gates pass on 4fabb668cdce
- 2026-10-06T10:12:30Z · meetings · BX-08, BX-10 · ready 375d7afb11de · river 4fabb668cdce · pnpm gates pass on 4fabb668cdce
- 2026-10-06T10:12:30Z · auditors · DP-13, DP-16, DP-17, FE-18, FE-21 · ready 78aa3f5edfce · river 4fabb668cdce · pnpm gates pass on 4fabb668cdce
- 2026-10-06T11:50:21Z · hunters · CP-04 · ready 6e463129544e · river 211c48c6cf84 · pnpm gates pass on 211c48c6cf84
- 2026-10-06T11:50:21Z · people · CA-11, CA-05, CA-14, CA-12 · ready 64842457be2e · river 211c48c6cf84 · pnpm gates pass on 211c48c6cf84
- 2026-10-06T11:50:21Z · river ·  · ready 69fc6b1ed248 · river 211c48c6cf84 · pnpm gates pass on 211c48c6cf84
- 2026-10-06T14:16:28Z · measures · VS-01 · ready 551ee41dcb26 · river 92102c8b81be · pnpm gates pass on 92102c8b81be
- 2026-10-06T14:16:28Z · hunters · BX-13, CP-10 · ready 9a7965c677cc · river 92102c8b81be · pnpm gates pass on 92102c8b81be
- 2026-10-06T15:49:55Z · hunters · CH-22 · ready 76b84e3a4318 · river 405a7f67b635 · pnpm gates pass on 405a7f67b635
- 2026-10-06T15:49:55Z · auditors · DP-06 · ready 2830c4bfb3d1 · river 405a7f67b635 · pnpm gates pass on 405a7f67b635
- 2026-10-06T17:37:54Z · hunters · CH-23 · ready cbb51190e6ab · river c83c04d79089 · pnpm gates pass on c83c04d79089
- 2026-10-06T19:41:12Z · hunters · CH-20, CH-23 · ready 544e2032310c · river d89746be4470 · pnpm gates pass on d89746be4470
- 2026-10-07T21:25:20Z · ci · CI-01 · ready 5693402700d4 · river ce52ee5a4a7e · pnpm gates pass on ce52ee5a4a7e
- 2026-10-07T21:25:20Z · models · HK-01 · ready 498b766c410f · river ce52ee5a4a7e · pnpm gates pass on ce52ee5a4a7e
- 2026-10-07T22:25:57Z · ci · CI-02 · ready 44763e59267f · river 3c2a470eb136 · pnpm gates pass on 3c2a470eb136
- 2026-10-08T02:07:52Z · reads · IR-01, IR-02, IR-03, IR-04, IR-05 · ready 318c2d5e19d7 · river 321ac4975de4 · pnpm gates pass on 321ac4975de4
- 2026-10-08T04:32:59Z · manual · FM-01, FM-02, FM-03, FM-04, FM-05, FM-06, FM-07, FM-08, FM-09, FM-10 · ready ebabcf290173 · river b568ef168007 · pnpm gates pass on b568ef168007
- 2026-10-08T09:33:17Z · manual · FM-01, FM-07, FM-09 · ready 979e4bbaf92a · river 89e0cc4b02a4 · pnpm gates pass on 89e0cc4b02a4
- 2026-10-08T09:33:17Z · publish-now · PN-01 · ready e18f68884228 · river 89e0cc4b02a4 · pnpm gates pass on 89e0cc4b02a4
- 2026-10-08T10:23:48Z · leads · LD-01, LD-02, LD-03, LD-04 · ready 27bdeed2f294 · river 415133742a60 · pnpm gates pass on 415133742a60
- 2026-10-08T12:33:18Z · cycle-memory · CM-01 · ready 592129c925ba · river e845b4b75b6f · pnpm gates pass on e845b4b75b6f
- 2026-10-08T18:19:55Z · neon-reads · NR-01, NR-02, NR-03, NR-04, NR-05, NR-06, NR-07, NR-08 · ready 626b0dcfa46c · river 6358f0634fba · pnpm gates pass on 6358f0634fba
- 2026-10-09T18:28:47Z · acquisition-first · AF-01, AF-02, AF-03, AF-04, AF-05 · ready e83fb2c09771 · river 3196f36f9064 · hosted full CI gates pass on exact checkout 3196f36f9064; run 37966354018 (7,815 passed, 0 failed, 5 skipped); source release 5d558d9e916b has identical tree.
