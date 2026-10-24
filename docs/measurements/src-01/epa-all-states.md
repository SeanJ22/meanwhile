# EPA ECHO national read-only replay

Status: PASS. The complete real exporter publishes **3,229,294 verified facilities** across all **90 native state codes**, with **17 named minimum-field gaps**. All **56 registered U.S. jurisdictions** pass the actual normal GET, card renderer and grounded Ask evidence adapter at the initial, tomorrow and next-weekly clocks: **168 actions, no failures**. The slowest actual API page is 1701.56 ms and the slowest SQL query is 1525.81 ms, within the 3,000 ms and 1,800 ms limits. See `epa-all-states.json` and `epa-reader-all-states.json`.

The official archive was captured at `2026-10-23T09:06:56.174Z` from `https://echo.epa.gov/files/echodownloads/echo_exporter.zip`: 445,388,175 bytes, SHA-256 `116f6e53117b52f7891c6d2466d662f4ee5e29946b065fdb7b97eaf095615899`, publisher Last-Modified `2026-10-18T06:44:46Z`. Every one of its **3,229,311 rows and 133 columns** was read. The replay uses the existing production `readonly` role, verifies that it cannot write candidates, and reads each state's actual production registration. All publication, database and artifact writes remain local; production writes are zero.

The feeding step is the official archive plus the held production government registrations. The production archive reader, CSV parser and normalizer feed one national bounded `OpenDataSpool`, followed by the same shared four-writer artifact materializer used by the scheduled worker. Its output feeds the registered `publishOpenData` publisher and complete national canonical manifest. The downstream proof then uses normal selected PostgreSQL SQL, the actual Netlify SDK over exact held local bytes, `GET /api/open-data`, the actual `OpenDataFacts` React renderer and the grounded Ask evidence adapter. A complete grounded model response is not timed or claimed.

The archive key now includes a unique run identity. Actual initial and next-weekly archive receipts use distinct keys and retain the same real source bytes. The complete exporter also revealed facilities with blank FRS IDs. An exact captured AIR, NPDES, RCRA, SDWA or TRI ID is accepted only when the official EPA report URL unambiguously names that same token. The distinct `epa-echo:program:<program>:<id>` namespace preserves native identity without inventing a registry ID. Existing FRS IDs and raw blank registry cells remain unchanged; tests cover real AZ/CA rows, including `CABAA 324110`, and reject ambiguous, untrusted or absent identities.

Seventeen rows have a blank facility name. Their exact IDs, state codes and `EPA_FACILITY_MINIMUM_MISSING` reasons are recorded in the normal candidate receipt and in the aggregate JSON. Working facts publish and the source stays open. A rejected identity that previously had a verified fact retains its original source row and capture. The mixed valid/bad-row regression proves this changed-input behavior; a missing required source column or unreadable archive still holds the previous publication.

Temporary SQLite storage keeps each exact native fact once and uses small location references. Deferred indexes preserve native-ID uniqueness without random index updates for every source row. Consumption uses bounded 1,000-row / 4 MiB immutable chunks; it does not cap the country. The artifact writer verifies each full record against captured source rows before retaining the exact source cells interpreted by the normalizer. The complete original exporter stays archived. Exhaustive comparison proves **all 55,806 emitted partitions byte-exact** to that projection, **3,229,294 globally unique primary IDs**, **6,396,691 physical location rows**, and **9,697,325,867 logical referenced bytes** retained. No accepted artifact was removed.

The original eager reader loaded all selected facility artifacts before returning 50 rows. The shared bounded cursor iterator now serves the first page without that full scan and keeps every record reachable through Show more. ZIP partitions precede disjoint nearby cells; exact native identity and radius predicates remain unchanged. A cursor binds to the request scope and accepted source versions; a changed version returns 409, and the component clears old rows and loads the new first page. Empty bounded pages retain their continuation. Complete shared-iterator enumeration reproduces all 106,013 CA90001 and 23,370 NJ07001 records without duplicates, and actual normal GET continuations plus the real browser's 50-to-100-row action pass. Ask fully consumes the same shared iterator, preserving its existing complete evidence semantics.

The normal selected SQL keeps the exact logical ZIP, nearby-cell and division keys, including state/chunk suffixes. On the real plain-array manifest, native JSONPath filters before row expansion. Matched NJ/RI SQL results and order are byte-identical; all six new plans use **zero temporary blocks**, compared with 3,799 blocks (about 30 MiB) per old plan. Every matched new query is faster, with 24–25% median reductions. Source/class/scope and GOOD/hash/version checks remain in place. Tests cover similarly prefixed ZIP refusal, quoted selector inputs, encoded interleaved groups, corrupt ordinals and missing parts.

Initial publication follows the actual capture and processing. Tomorrow correctly reports `due:false`. The next weekly clock reports `due:true`, confirms the same held official edition and reads all 56 jurisdictions again without changing source dates. Every clock verifies the typed reader, exact reports, and matching existence, hash and length metadata for all 55,806 artifact references. The separate exhaustive comparison reads and checks every artifact body. These controlled clocks do not claim future HTTP observations. A genuinely changed edition still scans all 47,274 prior primary references when the 17 current minimum gaps need retention. The actual bounded four-read function over those real references and all 3,229,294 prior rows takes **105,505.18 ms**, versus the preserved serial **174,258.08 ms**; result order, exclusions and retained rows match exactly. This measures that branch without fabricating changed future bytes.

The source's actual HTTP download takes 96,377 ms, followed by 450,365 ms of complete held-byte ingestion, below the unchanged 20-minute source limit. The continuous shared four-writer materializer takes **887,595.42 ms**, including every proof-local gzip and write cost, with four pending writes and no pauses or deductions. Including the actual HTTP, source ingestion, conservative index/setup cost, all production registration reads, the newly measured initial national publisher (14374.20 ms), and the complete changed-edition retention scan gives **1731.54 seconds (28.86 minutes)**, below the unchanged 30-minute parent budget. The retention optimization saves 68.75 seconds on the same full input; this conclusion does not depend on publisher timing variance. Future official-source and production remote-vault latency/QPS remain unmeasured and require the live scheduled check after shipping. See `epa-four-writer-performance.json` and `epa-retention-performance.json`.

The four-writer materializer reached 670,797,824 bytes RSS. Adding 5% and rounding up gives 672 MiB. Memory-only arithmetic on an 8 GiB server minus a 768 MiB reserve allows 11 copies of that phase, or six with a 2,928 MiB research parent. These are phase-only calculations, not a whole-worker peak or observed admission. The actual routine entry is `epa-echo/open-data-refresh.mts`; Socrata uses `socrata-discovery/open-data-refresh.mts`. Neither script has a `ROUTINE_ENTRY_PEAK_MIB` override, so the no-history fallback is the 342 MiB lease value. The largest of the host's last five job-family peaks, with 5% added, can replace that default; available memory and other reservations also affect admission. Production host peak history was not measured. Worker slots and Admin settings remain unchanged. The precise mapping and conditional calculations are in `epa-four-writer-performance.json`.

The transparent proof-local gzip store returns and hashes exact production artifact bytes and metadata. Its work remains in the measured materializer total; no compression or readback duration is subtracted to claim a deadline. The local Netlify proxy permits only SDK artifact reads and rejects `/api/v1/purge` before any external request, producing a replay-only post-publication cache warning. Direct normal reads pass; deployed edge-cache invalidation is not measured or claimed.

Actual published counts follow. The remaining 34 publisher codes retain 63,424 verified rows in the same national manifest with status `PUBLISHED_OUTSIDE_US_LOCATION_SCOPE`; no U.S. location-page claim is made for them. Every native code and every named gap is listed in the JSON.

| Jurisdiction | Published facilities | Minimum gaps | Program identities |
| --- | ---: | ---: | ---: |
| AK | 15,524 | 1 | 33 |
| AL | 58,122 | 0 | 154 |
| AR | 22,403 | 0 | 30 |
| AS | 231 | 0 | 0 |
| AZ | 24,352 | 0 | 105 |
| CA | 690,454 | 0 | 14,202 |
| CO | 79,856 | 0 | 115 |
| CT | 25,152 | 0 | 66 |
| DC | 3,954 | 0 | 7 |
| DE | 4,343 | 0 | 9 |
| FL | 167,579 | 1 | 681 |
| GA | 173,643 | 0 | 81 |
| GU | 799 | 0 | 5 |
| HI | 9,915 | 0 | 28 |
| IA | 22,725 | 0 | 14 |
| ID | 17,208 | 0 | 70 |
| IL | 108,312 | 1 | 523 |
| IN | 58,345 | 0 | 115 |
| KS | 43,154 | 0 | 76 |
| KY | 40,618 | 1 | 97 |
| LA | 73,528 | 0 | 83 |
| MA | 51,609 | 0 | 375 |
| MD | 38,691 | 0 | 47 |
| ME | 13,127 | 1 | 94 |
| MI | 66,169 | 0 | 350 |
| MN | 73,105 | 0 | 136 |
| MO | 61,865 | 1 | 492 |
| MP | 395 | 0 | 1 |
| MS | 16,743 | 0 | 42 |
| MT | 21,402 | 0 | 61 |
| NC | 67,412 | 0 | 236 |
| ND | 11,908 | 0 | 59 |
| NE | 14,569 | 0 | 20 |
| NH | 28,401 | 0 | 87 |
| NJ | 74,020 | 0 | 189 |
| NM | 27,976 | 0 | 84 |
| NV | 12,535 | 0 | 30 |
| NY | 160,767 | 0 | 191 |
| OH | 63,611 | 0 | 284 |
| OK | 35,651 | 0 | 33 |
| OR | 25,116 | 0 | 44 |
| PA | 100,464 | 0 | 205 |
| PR | 10,135 | 0 | 13 |
| RI | 10,278 | 0 | 42 |
| SC | 36,588 | 0 | 299 |
| SD | 8,664 | 0 | 22 |
| TN | 48,261 | 1 | 114 |
| TX | 171,749 | 1 | 538 |
| UT | 48,739 | 0 | 210 |
| VA | 49,168 | 0 | 145 |
| VI | 1,498 | 0 | 3 |
| VT | 13,088 | 0 | 60 |
| WA | 46,849 | 0 | 82 |
| WI | 57,392 | 0 | 66 |
| WV | 46,420 | 0 | 119 |
| WY | 11,288 | 1 | 18 |

The reproducible source, materializer, normal reader and paging drivers are `scripts/replay-epa-all-states.mts`, `scripts/replay-epa-materialization.mts`, `scripts/replay-epa-reader.mts`, and `scripts/replay-epa-pages.mts`. They take protected connection-file paths rather than embedding credentials. The final reader invocation reuses the exact complete held manifest:

```sh
node --import tsx scripts/replay-epa-reader.mts \
  --cache=.scratch/src01-epa \
  --vault=.scratch/src01-epa/national-reader-vault-national-fc8b79c7-5f7b-4a48-ab7b-b623f31ba1e0 \
  --manifest=.scratch/src01-epa/four-writer-compact-manifest.json \
  --native-postgres-file=/path/to/protected-local-postgres-url \
  --database=.scratch/src01-epa/reader-native-jsonpath-final \
  --states=all --clocks=3 \
  --output=docs/measurements/src-01/epa-reader-all-states.json
```

Use a fresh local database path for a new three-clock run. Large temporary files use an outside-repository directory such as `/workspace/src01-scratch`. The source replay verifies the cached archive SHA-256 and reads the official archive when no cache is held. No credentials occur in scripts or evidence.

Historical failures remain explicit: `epa-original-national.json` preserves the original serial proof; `epa-runtime.json` preserves source/spool timeouts and the verification-only live SQLite lock; `epa-four-writer-failed-raw.json` preserves the proof-storage reserve failure; `epa-reader-before-paging.json` and `epa-reader-before-sql.json` preserve reader deadline failures. Partial raw proof artifacts were retained losslessly before duplicate cleanup. No failed action is counted as a passing final action. Final validation includes the 36 focused source/spool/cursor/normal-GET tests, the bounded-retention regressions, the actual cursor browser proof, and the final shared TypeScript/lint/preflight checks.
