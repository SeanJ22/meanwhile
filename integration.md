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
- 2026-10-10T02:04:46Z · acquisition-known-roles · AF-09, AF-10, AF-11 · ready ed5929429cd0 · river 8d68f46721de · full hosted CI gates pass on exact checkout 8d68f46721de; run 38014509898 (7,872 passed, 0 failed, 5 skipped); source release 5f76b2d80a9b has identical tree.
- 2026-10-12T23:14:31Z · registry · DB-10, DB-11, DB-21 · ready a1aad625b667 · river 1c60322f563f · pnpm gates pass on 1c60322f563f
- 2026-10-12T23:14:31Z · adapter-ash-creek-d53-monthly-agenda-pdf-call-to-public · adapter-ash-creek-d53-monthly-agenda-pdf-call-to-public · ready 46a02f26a59c · river 1c60322f563f · pnpm gates pass on 1c60322f563f
- 2026-10-12T23:14:31Z · state-legislators · SL-01 · ready c25ef823e880 · river 1c60322f563f · pnpm gates pass on 1c60322f563f
- 2026-10-13T01:18:39Z · hunters · CH-23 · ready 05d2e5c09805 · river 593be2416b30 · pnpm gates pass on 593be2416b30
- 2026-10-13T02:55:57Z · ballot-districts · BD-01, BD-02 · ready 1e2223124450 · river 3734a8f9bb3b · pnpm gates pass on 3734a8f9bb3b
- 2026-10-13T02:55:57Z · card-gaps-sources · UI-01 · ready a476726a41b6 · river 3734a8f9bb3b · pnpm gates pass on 3734a8f9bb3b
- 2026-10-13T02:55:57Z · platform-census · PC-01 · ready 2890dedcdce1 · river 3734a8f9bb3b · pnpm gates pass on 3734a8f9bb3b
- 2026-10-13T02:55:57Z · playbooks · PB-01 · ready 69b98f96054e · river 3734a8f9bb3b · pnpm gates pass on 3734a8f9bb3b
- 2026-10-13T04:38:52Z · fec-national · FEC-01 · ready 8773b6f9fa68 · river 378e9d3625e3 · pnpm gates pass on 378e9d3625e3
- 2026-10-13T04:38:52Z · map-representation · MR-01 · ready 3c97e8642513 · river 378e9d3625e3 · pnpm gates pass on 378e9d3625e3
- 2026-10-13T06:49:29Z · playbooks-fix · PB-01 · ready 1311f8ddb7a2 · river 6c204dcd865c · pnpm gates pass on 6c204dcd865c
- 2026-10-13T07:23:12Z · src-congress · CG-2 · ready 410f571e02c3 · river 985c00c33f7a · pnpm gates pass on 985c00c33f7a
- 2026-10-13T07:23:12Z · zip-entry · ZIP-01 · ready 00179385646c · river 985c00c33f7a · pnpm gates pass on 985c00c33f7a
- 2026-10-13T07:57:14Z · national-listings · NL-01 · ready 8a4b4d85902a · river cc9589c05915 · pnpm gates pass on cc9589c05915
- 2026-10-13T07:57:14Z · office-pins · DS-01, DS-02 · ready f6cd323d7fa8 · river cc9589c05915 · pnpm gates pass on cc9589c05915
- 2026-10-13T12:10:42Z · src-open-data ·  · ready 173b60d56f11 · river 1e72570acb7e · pnpm gates pass on 1e72570acb7e
- 2026-10-13T14:54:52Z · admin · BR-07, BR-04, BR-11, BR-26, BR-35, BR-39, BR-36, BR-12, BR-13, BR-18, BR-20, BR-16, BR-17, BR-27, BR-29, BR-28, BR-31 · ready 80d9a7ff71e2 · river edd7652c5bb5 · pnpm gates pass on edd7652c5bb5
- 2026-10-13T18:54:23Z · state-votes · SV-01 · ready a5cf11addca9 · river ac3ccf885d6d · pnpm gates pass on ac3ccf885d6d
- 2026-10-13T21:36:32Z · office-pins · DS-03 · ready 2dbd472fa060 · river 691c01dd0ff4 · pnpm gates pass on 691c01dd0ff4
- 2026-10-13T21:36:32Z · platform-escribe ·  · ready c66410128bb7 · river 691c01dd0ff4 · pnpm gates pass on 691c01dd0ff4
- 2026-10-13T21:36:32Z · src-civic · SL-03, VS-01 · ready 6b207dedc758 · river 691c01dd0ff4 · pnpm gates pass on 691c01dd0ff4
- 2026-10-13T21:36:32Z · statewide-and-portraits · SL-03 · ready 864a854bd9d5 · river 691c01dd0ff4 · pnpm gates pass on 691c01dd0ff4
- 2026-10-13T21:36:32Z · token-cost ·  · ready c4d7ee39c86b · river 691c01dd0ff4 · pnpm gates pass on 691c01dd0ff4
- 2026-10-13T22:49:19Z · src-legiscan ·  · ready 5f7ec73a4c75 · river 25ef70542f9b · pnpm gates pass on 25ef70542f9b
- 2026-10-14T00:53:41Z · acquisition-leftovers ·  · ready 37080911ddf3 · river 5bb464f06e34 · pnpm gates pass on 5bb464f06e34
- 2026-10-14T00:53:41Z · census-lane ·  · ready 634e1f5fedfc · river 5bb464f06e34 · pnpm gates pass on 5bb464f06e34
- 2026-10-14T00:53:41Z · src-legiscan ·  · ready 018bd38172b8 · river 5bb464f06e34 · pnpm gates pass on 5bb464f06e34
- 2026-10-14T02:28:13Z · acquisition-leftovers · R2B · ready 0f8d836a04ab · river 1caea1bd9c88 · pnpm gates pass on 1caea1bd9c88
- 2026-10-14T02:28:13Z · census-lane · R2 · ready 93ea274c6fc8 · river 1caea1bd9c88 · pnpm gates pass on 1caea1bd9c88
- 2026-10-14T02:28:13Z · road · R0 · ready 2115f4f5d5f5 · river 1caea1bd9c88 · pnpm gates pass on 1caea1bd9c88
- 2026-10-14T04:47:56Z · platform-civicclerk · R3-CIVICCLERK · ready 59540bf2b474 · river e9fe05f910be · pnpm gates pass on e9fe05f910be
- 2026-10-14T04:47:56Z · platform-civicplus · R3-CIVICPLUS · ready 6974f285fe1b · river e9fe05f910be · pnpm gates pass on e9fe05f910be
- 2026-10-14T04:47:56Z · road · R0 · ready 53860604fce7 · river e9fe05f910be · pnpm gates pass on e9fe05f910be
- 2026-10-14T04:47:56Z · statewide-and-portraits · SL-03 · ready d7f52659bc97 · river e9fe05f910be · pnpm gates pass on e9fe05f910be
- 2026-10-14T06:42:17Z · ballot-bl-11 · BL-11 · ready aa2599161454 · river 0a0daac9af64 · pnpm gates pass on 0a0daac9af64
- 2026-10-14T06:42:17Z · ballot-bl-12 · BL-12 · ready f70d716c1e26 · river 0a0daac9af64 · pnpm gates pass on 0a0daac9af64
- 2026-10-14T06:42:17Z · ballot-bl-15 · BL-15 · ready 8e3f7bda167d · river 0a0daac9af64 · pnpm gates pass on 0a0daac9af64
- 2026-10-14T06:42:17Z · road · R0 · ready e9468c4a5ed8 · river 0a0daac9af64 · pnpm gates pass on 0a0daac9af64
- 2026-10-14T06:42:17Z · src-census · SRC-AC · ready aa3747f3c160 · river 0a0daac9af64 · pnpm gates pass on 0a0daac9af64
- 2026-10-14T06:42:17Z · src-civic · VS-01 · ready d1db579d958d · river 0a0daac9af64 · pnpm gates pass on 0a0daac9af64
- 2026-10-14T07:46:42Z · ballot-bl-11 · BL-11 · ready 5bb5ef16aa11 · river bb3a0d5d2e22 · pnpm gates pass on bb3a0d5d2e22
- 2026-10-14T07:46:42Z · ballot-bl-12 · BL-12 · ready 04a8324eb58d · river bb3a0d5d2e22 · pnpm gates pass on bb3a0d5d2e22
- 2026-10-14T07:46:42Z · ballot-bl-13 · BL-13 · ready 9d944a150961 · river bb3a0d5d2e22 · pnpm gates pass on bb3a0d5d2e22
- 2026-10-14T07:46:42Z · ballot-bl-16 · BL-16 · ready 2ed73460ceac · river bb3a0d5d2e22 · pnpm gates pass on bb3a0d5d2e22
- 2026-10-14T07:46:42Z · ballot-national · BL-10 · ready 78cbc5a56318 · river bb3a0d5d2e22 · pnpm gates pass on bb3a0d5d2e22
- 2026-10-14T07:46:42Z · ballot-parity · BL-20 · ready 1e530950acc2 · river bb3a0d5d2e22 · pnpm gates pass on bb3a0d5d2e22
- 2026-10-14T08:48:29Z · ballot-bl-12 · BL-12 · ready f5d8c17ef61d · river c3cb7721cdfa · pnpm gates pass on c3cb7721cdfa
- 2026-10-14T08:48:29Z · ballot-bl-14 · BL-14 · ready 2f69026893f9 · river c3cb7721cdfa · pnpm gates pass on c3cb7721cdfa
- 2026-10-14T08:48:29Z · src-census · SRC-AC · ready 457fd6f217f0 · river c3cb7721cdfa · pnpm gates pass on c3cb7721cdfa
- 2026-10-14T09:48:49Z · ballot-bl-11 · BL-11 · ready ad655d56a6c9 · river 769af8244a8d · pnpm gates pass on 769af8244a8d
- 2026-10-14T09:48:49Z · ballot-bl-12 · BL-12 · ready 48e015c5701d · river 769af8244a8d · pnpm gates pass on 769af8244a8d
- 2026-10-14T09:48:49Z · ballot-bl-14 · BL-14 · ready 01e15b15899e · river 769af8244a8d · pnpm gates pass on 769af8244a8d
- 2026-10-14T09:48:49Z · ballot-bl-15 · BL-15 · ready 70371cc50529 · river 769af8244a8d · pnpm gates pass on 769af8244a8d
- 2026-10-14T09:48:49Z · ballot-national · BL-10 · ready f0b7d08891bf · river 769af8244a8d · pnpm gates pass on 769af8244a8d
- 2026-10-14T09:48:49Z · ballot-parity · BL-20 · ready 9e1b506235e8 · river 769af8244a8d · pnpm gates pass on 769af8244a8d
- 2026-10-14T10:49:58Z · ballot-bl-12 · BL-12 · ready 66f98e92f50c · river e06723d0f904 · pnpm gates pass on e06723d0f904
- 2026-10-14T10:49:58Z · ballot-bl-14 · BL-14 · ready 886c26d0f8f8 · river e06723d0f904 · pnpm gates pass on e06723d0f904
- 2026-10-14T10:49:58Z · ballot-bl-15 · BL-15 · ready f3b1dcf164be · river e06723d0f904 · pnpm gates pass on e06723d0f904
- 2026-10-14T16:35:47Z · office-pins · DS-03 · ready 1ab8cad9ab93 · river dc5cddd3834a · pnpm gates pass on dc5cddd3834a
- 2026-10-14T16:35:47Z · platform-civicclerk · R3-CIVICCLERK · ready 571161016262 · river dc5cddd3834a · pnpm gates pass on dc5cddd3834a
- 2026-10-14T16:35:47Z · platform-civicplus · R3-CIVICPLUS · ready 5d90f1bf48cd · river dc5cddd3834a · pnpm gates pass on dc5cddd3834a
- 2026-10-14T16:35:47Z · platform-escribe · R3-ESCRIBE · ready ce53b8bf536a · river dc5cddd3834a · pnpm gates pass on dc5cddd3834a
- 2026-10-14T16:35:47Z · platform-novusagenda · R3-NOVUS · ready 6d8ba4a1a582 · river dc5cddd3834a · pnpm gates pass on dc5cddd3834a
- 2026-10-14T16:35:47Z · state-votes · SV-01 · ready 5b126678f6a9 · river dc5cddd3834a · pnpm gates pass on dc5cddd3834a
- 2026-10-14T16:35:47Z · token-cost · R7 · ready 88328d939d41 · river dc5cddd3834a · pnpm gates pass on dc5cddd3834a
- 2026-10-14T17:40:41Z · ballot-bl-11 · BL-11 · ready 9675256f94a3 · river 8db8c14b0739 · pnpm gates pass on 8db8c14b0739
- 2026-10-14T17:40:41Z · ballot-bl-12 · BL-12 · ready 9f21300c0684 · river 8db8c14b0739 · pnpm gates pass on 8db8c14b0739
- 2026-10-14T17:40:41Z · ballot-bl-13 · BL-13 · ready 1604fd509556 · river 8db8c14b0739 · pnpm gates pass on 8db8c14b0739
- 2026-10-14T17:40:41Z · ballot-bl-14 · BL-14 · ready e72a212907de · river 8db8c14b0739 · pnpm gates pass on 8db8c14b0739
- 2026-10-14T17:40:41Z · ballot-bl-16 · BL-16 · ready f32b510a72cf · river 8db8c14b0739 · pnpm gates pass on 8db8c14b0739
- 2026-10-14T17:40:41Z · ballot-parity · BL-20 · ready 20cc658b06f2 · river 8db8c14b0739 · pnpm gates pass on 8db8c14b0739
- 2026-10-14T18:36:33Z · platform-granicus · R3-GRANICUS · ready df57db75a01b · river 9b36ff25c9cd · pnpm gates pass on 9b36ff25c9cd
- 2026-10-14T20:06:29Z · ballot-bl-11 · BL-11 · ready 4bab43589ba0 · river 0e9d37e08299 · pnpm gates pass on 0e9d37e08299
- 2026-10-14T20:06:29Z · ballot-bl-12 · BL-12 · ready 3a255529567a · river 0e9d37e08299 · pnpm gates pass on 0e9d37e08299
- 2026-10-14T20:06:29Z · ballot-bl-13 · BL-13 · ready e34f61e7fccd · river 0e9d37e08299 · pnpm gates pass on 0e9d37e08299
- 2026-10-14T20:06:29Z · ballot-bl-15 · BL-15 · ready 9292be7293f5 · river 0e9d37e08299 · pnpm gates pass on 0e9d37e08299
- 2026-10-14T20:06:29Z · ballot-bl-16 · BL-16 · ready c13e47c06fa1 · river 0e9d37e08299 · pnpm gates pass on 0e9d37e08299
- 2026-10-14T20:06:29Z · ballot-national · BL-10 · ready 0083f9d2b201 · river 0e9d37e08299 · pnpm gates pass on 0e9d37e08299
- 2026-10-14T20:06:29Z · field-manual · FM-07 · ready 9a0201f97ff2 · river 0e9d37e08299 · pnpm gates pass on 0e9d37e08299
- 2026-10-14T21:43:45Z · platform-swagit · R3-SWAGIT · ready 1359d8e5b632 · river b9911b63edc7 · pnpm gates pass on b9911b63edc7
- 2026-10-14T22:53:43Z · fact-store · R1 · ready bff3d84a630f · river ab2f2cce6489 · pnpm gates pass on ab2f2cce6489
- 2026-10-14T23:28:59Z · platform-granicus · R3-GRANICUS · ready 941e4faa7b1a · river cace8a4c1185 · pnpm gates pass on cace8a4c1185
- 2026-10-15T04:42:15Z · ballot-national · BL-10 · ready 985778b27324 · river d9107da58a23 · pnpm gates pass on d9107da58a23
- 2026-10-15T04:42:15Z · playbooks-fix2 · PB-01 · ready 0cb2ce7c535d · river d9107da58a23 · pnpm gates pass on d9107da58a23
- 2026-10-15T14:30:33Z · fact-store · R1 · ready b28a1c41ebac · river be06573dcbd3 · pnpm gates pass on be06573dcbd3
- 2026-10-15T14:30:33Z · hunter-v2 ·  · ready 6d52165579c6 · river be06573dcbd3 · pnpm gates pass on be06573dcbd3
- 2026-10-15T14:30:33Z · road · R0 · ready 374e58d57792 · river be06573dcbd3 · pnpm gates pass on be06573dcbd3
- 2026-10-15T16:10:13Z · hunter-v2 ·  · ready d1cabd0c5c87 · river 493311674ed4 · pnpm gates pass on 493311674ed4
- 2026-10-15T16:10:13Z · platform-novusagenda · R3-NOVUS · ready 66963a0f35ce · river 493311674ed4 · pnpm gates pass on 493311674ed4
- 2026-10-15T16:10:13Z · platform-primegov · R3-PRIMEGOV · ready 7ed33b50d253 · river 493311674ed4 · pnpm gates pass on 493311674ed4
- 2026-10-15T16:10:13Z · platform-swagit · R3-SWAGIT · ready 4c13bf7e9b01 · river 493311674ed4 · pnpm gates pass on 493311674ed4
- 2026-10-15T16:10:13Z · road · R0 · ready 220805e423a0 · river 493311674ed4 · pnpm gates pass on 493311674ed4
- 2026-10-15T23:03:28Z · platform-municode · R3-MUNICODE · ready 25e501e90354 · river 3282584e25b8 · pnpm gates pass on 3282584e25b8
- 2026-10-15T23:03:28Z · site-reads · NE-01 · ready 83e9473506b6 · river 3282584e25b8 · pnpm gates pass on 3282584e25b8
- 2026-10-15T23:55:36Z · fact-store · R1 · ready 77bddad74d93 · river 965bf002ea7b · pnpm gates pass on 965bf002ea7b
- 2026-10-16T03:03:04Z · fact-store · R1 · ready efd3b12c5115 · river 1d3d303d70dc · pnpm gates pass on 1d3d303d70dc
- 2026-10-16T05:11:25Z · platform-swagit · R3-SWAGIT · ready ef48e7fbb343 · river e1a1071a9c22 · pnpm gates pass on e1a1071a9c22
- 2026-10-16T06:34:29Z · src-money · SRC-MN · ready 3b61add5f2e1 · river 229ea25863f7 · pnpm gates pass on 229ea25863f7
- 2026-10-16T07:34:39Z · neon-allow · NEON-ALLOW · ready 5acacfc74ddf · river 8b6a9150ed7b · pnpm gates pass on 8b6a9150ed7b
- 2026-10-16T17:30:47Z · ballot-three-states · BL-30 · ready 0dbc1ab21e0d · river 05b72687f2df · pnpm gates pass on 05b72687f2df
- 2026-10-17T02:26:56Z · ballot-three-states · BL-30 · ready 90f9be11d922 · river 2e16200945cd · pnpm gates pass on 2e16200945cd
- 2026-10-17T06:58:52Z · door-reads · DR-01 · ready 5a8119ffa6e9 · river 42bb436bcfa3 · pnpm gates pass on 42bb436bcfa3
- 2026-10-17T06:58:52Z · fact-store · R1 · ready 3ebc66ccb2ac · river 42bb436bcfa3 · pnpm gates pass on 42bb436bcfa3
- 2026-10-17T07:28:55Z · river · main merge (release 50, no file changes) · river 5d6a5797f01b · pnpm gates pass on 5d6a5797f01b (DR-01, R1 folded at 42bb436bc; XS-02 dropped, returned to state-crossing)
