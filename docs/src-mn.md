# Federal money sources

Four national routine contracts run independently: daily USAspending, Federal Audit Clearinghouse and SAM.gov checks, and OpenFEMA every twenty minutes. Provider limits and Retry-After govern requests. Publication never needs a software release.

Bulk files stream into the evidence vault in content-addressed chunks. CSV and JSON rows are sorted on disk by native state, year, place and record hash before bounded ingestion. Interrupted downloads and extraction resume from temporary disk checkpoints. The vault holds completed chunk references, so losing scratch space does not strand a saved source cursor. Each historical FAC national year downloads once and splits into state files; records with no usable state remain in the reported ZZ inventory.

USAspending uses its custom bulk transaction endpoint, with annual initial extracts beginning October 2000 and subsequent checks filtered by last modification date. Each completed pass retains its start time so updates arriving during ingestion remain eligible for the next pass.

A stored fact partition contains at most 500 records and four MiB, except a single larger source fact. State/year/county or native division partitions split by record hash when full. SAM registrations group by their native address district, or an unlocated bucket, without asserting that the entity governs that place. Each page updates only affected partitions and verifies their incoming captures and exact predecessors. A source correction or split removes a record only after its destination has published. State checkpoints contain counts, continuation and pending-page references, never the state's facts. Pending-page baselines make replay safe after a crash between database and reader publication.

Candidates retain capture references, not source bodies. The existing evidence vault holds the bytes. Acquisition initializes the vault, and verification uses that worker's supplied context, keeping local evidence storage out of reader bundles. An index over compact native lookup keys finds UEIs, audit report IDs and corrected record locations without scanning the national fact inventory. No new database columns are introduced; the index migration uses the existing classified civic-data payload column.

Identity lookup returns only the current page's native matches. Recipient identity remains separate from geographic reach. Unmatched rows stay held with their reasons. Source outages preserve accepted facts; an unchanged check succeeds.

Cold-statistics lookup checks used 102,263 stored facts without analyzing the table or changing planner settings. A 500-ID lookup took 93.56 ms for matches and 5.98 ms for misses; the UEI crosswalk took 69.07 ms. The key index selects matching partitions first, and each matching leaf expands once. Partition change detection includes child and subtree counters so updates inside an existing split cannot retain stale totals; the regression covers several pages and interrupted child publication.

Each place has its own reader index and immutable pages of at most 100 facts. Only changed place segments publish. Government and district cards collect attribution in one bottom Sources list, and Ask reads the same place pages and historical-year selection. Missing sources and partial coverage stay visible.

Fixture provenance is in `tests/fixtures/federal-money/provenance.json` and `source-probe-2026-10-15.json` in the same directory. Generated scale inputs are marked synthetic and never seed production. `scripts/federal-money-scale.mts` exercises streaming acquisition, partition publication and place reads, and reports measured resources separately from unmeasured production traffic.

Local scale measurements use a four-core host with concurrent work. Counts describe benchmark inputs; production inventory is checked under DONE. Database traffic means decoded SQL request and response JSON through the production PostgreSQL adapter. It does not measure heap, index, TOAST, WAL, compressed network traffic or production daily changes. Fixture preparation runs separately from the measured worker.

| Completed stage | Input | Elapsed | Peak worker memory | Database traffic |
| --- | --- | ---: | ---: | --- |
| FAC historical acquisition | All 18 official 1998–2015 archives; 950,035 selected rows across 57 state buckets | 813.47 s across measured cold phases | 501,121,024 bytes, observed process tree | Zero; acquisition and vault only |
| USAspending national acquisition | 8,038,344 generated transactions across 56 jurisdictions and all 112,034 held governments | 1,184.62 s | 373,796,864 bytes | Zero; acquisition and vault only |
| USAspending single-county acquisition | 2,000,000 generated transactions; 4,403,778,095 expanded bytes | 860.92 s | 508,440,576 bytes | Zero; acquisition and vault only |
| SAM extract acquisition | 1,000,000 generated entities; 1,353,888,929 expanded bytes | 513.22 s | 357,138,432 bytes | Zero; acquisition and vault only |
| Per-place artifact publication | 2,000,000 generated county facts; 4,000 partitions and 20,000 pages | 236.90 s | 558,215,168 bytes | Zero; artifact stage only |

The FAC archives contain 10,613,289 native CSV rows in 1,902,780,166 expanded bytes. A separate strict UTF-8 and ZIP checksum pass reconciled every selected row. Raw archives total 432,697,811 bytes. Acquisition wrote 922,185,471 vault bytes and read 490,054,536 bytes. The process-tree monitor started with year 2000; the process maximum covers all years. Unknown-state records remain in ZZ: 798 rows.

The generated national USAspending input matches the live 2025 transaction count. Its 64,115,267 ZIP bytes expand to 1,364,272,836 CSV bytes, delivered as 16,107 bounded pages; the largest capture is 96,531 bytes. A separate two-million-row input exercised 4,403,778,095 expanded bytes, beyond V8's single-string limit, in 860.92 seconds at a 508,440,576-byte worker peak. Its sampled scratch-space peak was 22,333,810,017 bytes. The successful run started with empty scratch and vault storage after an earlier sort exhausted a workspace containing older benchmark files. These measurements cover streaming acquisition only.

At two million county facts, the place index is 4,847,006 bytes and retained artifacts total 163,938,640 bytes. Cold reader/API/Ask-evidence checks took 1.175/1.198/1.591 seconds. The first page reads 4,855,020 artifact bytes and returns 100 facts. Publication read 9,690,105,489 logical artifact bytes and wrote 9,854,044,129 bytes; local compare-and-swap added 19,385,058,113 disk-read bytes. Index replacement costs grow with that place's page inventory.

Completed national SQL lifecycle runs use native identity/location queries, partition verification and promotion, and per-place publication for joined facts.

| Source | Loaded / joined / unjoined | Seconds | Peak worker bytes | DB read bytes | DB written bytes | RAM copies alone / with parent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| USAspending | 112,034 / 112,034 / 0 | 594.065 | 704,724,992 | 1,060,703,449 | 573,092,804 | 11 / 6 |
| FAC 2015 | 112,613 / 0 / 112,613 | 880.358 | 638,926,848 | 2,929,524,937 | 790,787,913 | 12 / 7 |
| SAM | 112,034 / 112,034 / 0 | 759.420 | 582,135,808 | 1,649,144,981 | 553,546,861 | 13 / 8 |
| OpenFEMA | 71,170 / 71,170 / 0 | 655.211 | 541,077,504 | 631,092,937 | 383,828,956 | 14 / 8 |

USAspending and SAM each cover all 112,034 held governments across 56 jurisdictions. These benchmarks add synthetic UEIs to the government reference; they measure recipient matching, while real nationwide UEI crosswalk coverage remains unmeasured. The generated USAspending fixture assigns 19,835 otherwise missing performance counties within the same state; it uses each government's own UEI and NCES ID where present, and every recipient is checked against the expected government. OpenFEMA covers all 3,235 held counties with 71,170 generated declarations, exceeding the measured live catalog of 70,567. The real FAC 2015 rows have no supported recipient-native keys in this identity inventory, so all 112,613 remain retained and unjoined across 57 buckets, including ZZ. Modern FAC native-ID joins are covered by source fixtures.

Empty-delta days below execute the actual provider acquisition paths against empty native responses, using controlled worker/database clocks. These are measured zero-row source responses, not observed production traffic or estimates for changed records or inclusive-window overlap. Every run wrote zero fact partitions and zero place-fact artifacts. Source freshness metadata still updates; those artifact-status bytes are outside the database-byte measurement.

| Source | Checks/day | Provider requests | Seconds | Peak worker bytes | DB read bytes/day | DB written bytes/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| USAspending | 1 | 1,008 | 35.301 | 272,527,360 | 17,088,538 | 10,523,558 |
| FAC (2015 inventory) | 1 | 57 | 1.981 | 265,330,688 | 1,640,163 | 482,581 |
| SAM | 1 | 112 | 11.143 | 331,460,608 | 5,913,925 | 3,567,033 |
| OpenFEMA | 72 | 4,032 | 137.023 | 324,112,384 | 119,344,744 | 33,783,192 |

The stored leaf counts, distinct source IDs and checkpoint totals reconcile per state. Maximum leaves contain 457 USAspending rows, 500 SAM/FAC rows and 22 FEMA rows. Cold place reads remain below three seconds; the separate two-million-fact place benchmark measures the larger reader index. Total backfill time and bytes grow with the input; each worker operation holds bounded pages, partitions and native matches, and reader costs follow the selected place.

Maximum single SQL response/request bytes: USAspending 1,562,671/1,560,818; FAC 1,874,158/1,872,213; SAM 1,531,369/1,529,425; OpenFEMA 87,828/85,956.

The worker reservation is 768 MiB. On an 8 GiB runner, after the 0.75 GiB margin, nine reserved workers fit alone or five alongside the existing 2,928 MiB research-parent reservation. These are memory-only capacities; admission also accounts for observed process growth. The largest measured cold sort permits only one copy in this 32 GiB workspace because it uses 20.8 GiB of temporary disk. Concurrent giant sorts and production disk capacity were not measured.

Live USAspending, FAC and OpenFEMA probes succeeded. SAM's entity APIs returned HTTP 503 upstream connection timeouts from this workspace; its documented million-row extract limit was exercised with generated input. Full historical USAspending database ingestion, the full 1,434,543-row modern FAC inventory, and a million-entity SAM database load remain unmeasured. The post-release checks below own production traffic and live-site verification.

The live-site and production checks under DONE run after River releases, by Sean's oversight session.

DONE: report rows loaded per state, rows joined and unjoined, and three live examples on meanwhileusa.com in three different states.
