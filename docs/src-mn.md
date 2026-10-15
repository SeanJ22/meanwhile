# Federal money sources

Four national routine contracts run independently: daily USAspending, Federal Audit Clearinghouse and SAM.gov checks, and OpenFEMA every twenty minutes. Provider limits and Retry-After govern requests. Publication never needs a software release.

Bulk files stream into the evidence vault in content-addressed chunks. CSV and JSON rows are sorted on disk by native state, year, place and record hash before bounded ingestion. Interrupted downloads and extraction resume from temporary disk checkpoints. The vault holds completed chunk references, so losing scratch space does not strand a saved source cursor. Each historical FAC national year downloads once and splits into state files; records with no usable state remain in the reported ZZ inventory.

USAspending uses its custom bulk transaction endpoint, with annual initial extracts beginning October 2000 and subsequent checks filtered by last modification date. Each completed pass retains its start time so updates arriving during ingestion remain eligible for the next pass.

A stored fact partition contains at most 500 records and four MiB, except a single larger source fact. State/year/county or native division partitions split by record hash when full. SAM registrations group by their native address district, or an unlocated bucket, without asserting that the entity governs that place. Each page updates only affected partitions and verifies their incoming captures and exact predecessors. A source correction or split removes a record only after its destination has published. State checkpoints contain counts, continuation and pending-page references, never the state's facts. Pending-page baselines make replay safe after a crash between database and reader publication.

Candidates retain capture references, not source bodies. The existing evidence vault holds the bytes. An index over compact native lookup keys finds UEIs, audit report IDs and corrected record locations without scanning the national fact inventory. No new database columns are introduced; the index migration uses the existing classified civic-data payload column.

Identity lookup returns only the current page's native matches. Recipient identity remains separate from geographic reach. Unmatched rows stay held with their reasons. Source outages preserve accepted facts; an unchanged check succeeds.

Each place has its own reader index and immutable pages of at most 100 facts. Only changed place segments publish. Government and district cards collect attribution in one bottom Sources list, and Ask reads the same place pages and historical-year selection. Missing sources and partial coverage stay visible.

Fixture provenance is in `tests/fixtures/federal-money/provenance.json` and `source-probe-2026-10-15.json` in the same directory. Generated scale inputs are marked synthetic and never seed production. `scripts/federal-money-scale.mts` exercises streaming acquisition, partition publication and place reads, and reports measured resources separately from unmeasured production traffic.

Local scale measurements use a four-core host with concurrent work. Counts describe benchmark inputs; production inventory is checked under DONE. Database traffic means decoded SQL request and response JSON through the production PostgreSQL adapter. It does not measure heap, index, TOAST, WAL, compressed network traffic or production daily changes. Fixture preparation runs separately from the measured worker.

| Completed stage | Input | Elapsed | Peak worker memory | Database traffic |
| --- | --- | ---: | ---: | --- |
| FAC historical acquisition | All 18 official 1998–2015 archives; 950,035 selected rows across 57 state buckets | 813.47 s across measured cold phases | 501,121,024 bytes, observed process tree | Zero; acquisition and vault only |
| USAspending national acquisition | 8,038,344 generated transactions across 56 jurisdictions and all 112,034 held governments | 1,184.62 s | 373,796,864 bytes | Zero; acquisition and vault only |
| SAM extract acquisition | 1,000,000 generated entities; 1,353,888,929 expanded bytes | 513.22 s | 357,138,432 bytes | Zero; acquisition and vault only |
| Per-place artifact publication | 2,000,000 generated county facts; 4,000 partitions and 20,000 pages | 236.90 s | 558,215,168 bytes | Zero; artifact stage only |

The FAC archives contain 10,613,289 native CSV rows in 1,902,780,166 expanded bytes. A separate strict UTF-8 and ZIP checksum pass reconciled every selected row. Raw archives total 432,697,811 bytes. Acquisition wrote 922,185,471 vault bytes and read 490,054,536 bytes. The process-tree monitor started with year 2000; the process maximum covers all years. Unknown-state records remain in ZZ: 798 rows.

The generated national USAspending input matches the live 2025 transaction count. Its 64,115,267 ZIP bytes expand to 1,364,272,836 CSV bytes, delivered as 16,107 bounded pages; the largest capture is 96,531 bytes. A separate two-million-row input exercised 4,403,778,095 expanded bytes, beyond V8's single-string limit, in 308.98 seconds at a 581,750,784-byte worker peak. Both measurements cover streaming acquisition only.

At two million county facts, the place index is 4,847,006 bytes and retained artifacts total 163,938,640 bytes. Cold reader/API/Ask-evidence checks took 1.175/1.198/1.591 seconds. The first page reads 4,855,020 artifact bytes and returns 100 facts. Publication read 9,690,105,489 logical artifact bytes and wrote 9,854,044,129 bytes; local compare-and-swap added 19,385,058,113 disk-read bytes. Index replacement costs grow with that place's page inventory.

The worker reservation is 768 MiB. On an 8 GiB runner, after the 0.75 GiB margin, nine reserved workers fit alone or five alongside the existing 2,928 MiB research-parent reservation. Actual admission also accounts for observed process growth.

Live USAspending, FAC and OpenFEMA probes succeeded. SAM's entity APIs returned HTTP 503 upstream connection timeouts from this workspace; its documented million-row extract limit was exercised with generated input. Full historical USAspending database ingestion and a million-entity SAM database load remain unmeasured. The post-release checks below own production traffic and live-site verification.

The live-site and production checks under DONE run after River releases, by Sean's oversight session.

DONE: report rows loaded per state, rows joined and unjoined, and three live examples on meanwhileusa.com in three different states.
