# OpenFEMA: all configured states and territories

70,486 actual source records publish and remain reachable for all 56 configured jurisdictions. All 168 local replay runs passed the registered publisher and reader readback: initial, next configured run after 20 minutes, and a separate tomorrow replay. Every initial state reader was paginated to exhaustion and reconciled by exact native record ID. The actual FederalMoneySection card rendered on every run; measured cold reads plus rendering were 1–179 ms.

Upstream: OpenFEMA DisasterDeclarationsSummaries, including each row's explicit state, plus the state's real production Census county identities. Downstream: registered source verification and publication → local immutable reader artifacts → readFederalMoneyForPlace pagination → the actual FederalMoneySection card. Production SQL used the existing readonly role and read-only transactions, one state at a time. No production data was written. Source observations span 2026-10-23T09:10:26.465Z through 2026-10-23T09:41:48.705Z. Final replays reuse those saved official bytes with their original URL, timestamp and SHA256; they make zero publisher requests. Source captures and rendered HTML are retained at the local paths in [the per-state evidence](openfema-all-states.json).

Exact county associations account for 68,563 records; 1,923 have only the publisher's explicit state association. A state association does not invent a county, recipient government or service boundary. CT's 266 declarations refer to former counties and a tribal area while production holds its 9 current planning regions. All 266 now reach the CT state card. None is assigned to a planning region without an exact source county match.

The standing refresh repair records checkpoint.projectionVersion=openfema-state/1. Older OpenFEMA checkpoints trigger one full source cycle while last known good partitions stay readable. Its marker is saved with the first pending page, so interrupted work resumes saved bytes and then its cursor. Verified pages reach readers during that cycle; later completed runs use incremental since again. Other federal sources keep their existing checkpoints. Four focused tests in tests/openfema-state-reader.test.ts seed an older county-only projection from actual CT rows and cover the real 266 CT rows, foreign-state and body filtering, exact county preservation, an old readable county card retained through an interruption, pending-page and cursor recovery, and the return to incremental reads.

There are no remaining state replay failures. MO initially lost an HTTP 200 response body after 1,000 rows; the saved first 2 pages were retained and only missing pagination was acquired, completing 2,883 rows. Its original failure is retained in the per-state evidence. The final proof passes for MO and CT.

Local harness failures are recorded separately in the JSON harnessInterruptions field: tmpfs exhaustion affected IL, MN, MO, MS, MT, NE and SD and interrupted the final shard; its partial WV report was excluded and WV, WI, WY, AS, GU, MP, PR and VI were replayed explicitly. An inside-repository temporary-directory retry was rejected by the existing path guard before source acquisition. The 41 completed states were preserved, relocated outside the repository, and verified again by exact reader-version and card/HTML hashes. Only affected states were rerun from the same saved source bytes, with zero new publisher calls. Final artifacts use the outside-repository OS temporary directory /workspace/src01-scratch; the source guard was not changed.

The configured cadence is 20 minutes, not daily. The next run after 20 minutes and tomorrow clocks are controlled replays of real source responses: they prove scheduler admission, publication and reader retention, not future HTTP observations or a deployed scheduled run. Later responses are previously saved incremental captures where available; CT and MO repeat the full saved response as a verified superset. Reader pagination is repeated when its immutable snapshot changes; otherwise the exact fully enumerated initial snapshot is retained and the actual card is read and rendered again.

| State/territory | Published records | Exact county | State only | Next 20 minutes | Tomorrow |
| --- | ---: | ---: | ---: | --- | --- |
| AK | 357 | 255 | 102 | PROMOTED | PROMOTED |
| AL | 1,746 | 1,734 | 12 | PROMOTED | PROMOTED |
| AR | 1,827 | 1,819 | 8 | PROMOTED | PROMOTED |
| AS | 76 | 75 | 1 | PROMOTED | PROMOTED |
| AZ | 347 | 251 | 96 | PROMOTED | PROMOTED |
| CA | 1,691 | 1,655 | 36 | PROMOTED | PROMOTED |
| CO | 675 | 657 | 18 | PROMOTED | PROMOTED |
| CT | 266 | 0 | 266 | PROMOTED | PROMOTED |
| DC | 24 | 23 | 1 | PROMOTED | PROMOTED |
| DE | 55 | 54 | 1 | PROMOTED | PROMOTED |
| FL | 2,821 | 2,732 | 89 | PROMOTED | PROMOTED |
| GA | 2,844 | 2,836 | 8 | PROMOTED | PROMOTED |
| GU | 27 | 24 | 3 | PROMOTED | PROMOTED |
| HI | 125 | 115 | 10 | PROMOTED | PROMOTED |
| IA | 1,930 | 1,917 | 13 | PROMOTED | PROMOTED |
| ID | 387 | 367 | 20 | PROMOTED | PROMOTED |
| IL | 1,313 | 1,311 | 2 | PROMOTED | PROMOTED |
| IN | 1,664 | 1,659 | 5 | PROMOTED | PROMOTED |
| KS | 1,969 | 1,954 | 15 | PROMOTED | PROMOTED |
| KY | 3,396 | 3,392 | 4 | PROMOTED | PROMOTED |
| LA | 2,680 | 2,658 | 22 | PROMOTED | PROMOTED |
| MA | 415 | 403 | 12 | PROMOTED | PROMOTED |
| MD | 471 | 470 | 1 | PROMOTED | PROMOTED |
| ME | 1,065 | 1,051 | 14 | PROMOTED | PROMOTED |
| MI | 856 | 830 | 26 | PROMOTED | PROMOTED |
| MN | 1,623 | 1,549 | 74 | PROMOTED | PROMOTED |
| MO | 2,883 | 2,878 | 5 | PROMOTED | PROMOTED |
| MP | 97 | 91 | 6 | PROMOTED | PROMOTED |
| MS | 2,143 | 2,132 | 11 | PROMOTED | PROMOTED |
| MT | 682 | 616 | 66 | PROMOTED | PROMOTED |
| NC | 2,431 | 2,403 | 28 | PROMOTED | PROMOTED |
| ND | 1,430 | 1,382 | 48 | PROMOTED | PROMOTED |
| NE | 1,603 | 1,571 | 32 | PROMOTED | PROMOTED |
| NH | 321 | 320 | 1 | PROMOTED | PROMOTED |
| NJ | 627 | 623 | 4 | PROMOTED | PROMOTED |
| NM | 545 | 411 | 134 | PROMOTED | PROMOTED |
| NV | 295 | 217 | 78 | PROMOTED | PROMOTED |
| NY | 1,537 | 1,521 | 16 | PROMOTED | PROMOTED |
| OH | 1,299 | 1,296 | 3 | PROMOTED | PROMOTED |
| OK | 2,599 | 2,488 | 111 | PROMOTED | PROMOTED |
| OR | 661 | 607 | 54 | PROMOTED | PROMOTED |
| PA | 1,252 | 1,245 | 7 | PROMOTED | PROMOTED |
| PR | 2,116 | 2,112 | 4 | PROMOTED | PROMOTED |
| RI | 123 | 115 | 8 | PROMOTED | PROMOTED |
| SC | 1,190 | 1,178 | 12 | PROMOTED | PROMOTED |
| SD | 1,483 | 1,378 | 105 | PROMOTED | PROMOTED |
| TN | 2,038 | 2,037 | 1 | PROMOTED | PROMOTED |
| TX | 5,450 | 5,338 | 112 | PROMOTED | PROMOTED |
| UT | 270 | 251 | 19 | PROMOTED | PROMOTED |
| VA | 2,756 | 2,724 | 32 | PROMOTED | PROMOTED |
| VI | 87 | 84 | 3 | PROMOTED | PROMOTED |
| VT | 405 | 403 | 2 | PROMOTED | PROMOTED |
| WA | 1,106 | 984 | 122 | PROMOTED | PROMOTED |
| WI | 921 | 892 | 29 | PROMOTED | PROMOTED |
| WV | 1,350 | 1,344 | 6 | PROMOTED | PROMOTED |
| WY | 136 | 131 | 5 | PROMOTED | PROMOTED |

To reproduce against current real source data and existing production identities, run from the repository with an existing readonly connection file (never DATABASE_URL), after creating the outside-repository temporary directory:

```sh
TMPDIR=/workspace/src01-scratch node --use-env-proxy --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/src-01-openfema-all-states-replay.mts --readonly-url-file=/path/to/existing-production-readonly-url
```

The same script accepts --states=CT for a bounded jurisdiction, --held-manifest=/tmp/src01-openfema-held-captures.json to replay the saved inputs with zero publisher calls, and --merge-parts=<comma-separated-report-paths> to aggregate independent state shards. The JSON lists every configured jurisdiction explicitly and reports incomplete or failed states individually.
