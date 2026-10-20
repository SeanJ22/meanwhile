# Federal money sources

Four national routine contracts run independently: daily USAspending, Federal Audit Clearinghouse and SAM.gov checks, and OpenFEMA every twenty minutes. Provider limits and Retry-After govern requests. Publication never needs a software release.

Bulk files stream into the evidence vault in content-addressed chunks. CSV and JSON rows are sorted on disk by native state, year, place and record hash before bounded ingestion. Interrupted downloads and extraction resume from temporary disk checkpoints. The vault holds completed chunk references, so losing scratch space does not strand a saved source cursor. Each historical FAC national year downloads once and splits into state files; records with no usable state remain in the reported ZZ inventory. The 57 state buckets stay on disk, with at most 16 file handles open. CSV fields use slices, and raw rows are released as facts are parsed.

USAspending uses its custom bulk transaction endpoint, with annual initial extracts beginning October 2000 and subsequent checks filtered by last modification date. Each completed pass retains its start time so updates arriving during ingestion remain eligible for the next pass.

A stored fact partition contains at most 500 records and four MiB, except a single larger source fact. State/year/county or native division partitions split by record hash when full. SAM registrations group by their native address district, or an unlocated bucket, without asserting that the entity governs that place. Each page updates only affected partitions and verifies their incoming captures and exact predecessors. A source correction or split removes a record only after its destination has published. State checkpoints contain counts, continuation and pending-page references, never the state's facts. Pending-page baselines make replay safe after a crash between database and reader publication.

Candidates retain capture references, not source bodies. The existing evidence vault holds the bytes. Acquisition initializes the vault, and verification uses that worker's supplied context, keeping local evidence storage out of reader bundles. An index over compact native lookup keys finds UEIs, audit report IDs and corrected record locations without scanning the national fact inventory. No new database columns are introduced; the index migration uses the existing classified civic-data payload column.

Identity lookup returns only the current page's native matches. Recipient identity remains separate from geographic reach. Unmatched rows stay held with their reasons. Source outages preserve accepted facts; an unchanged check succeeds.

Cold-statistics lookup checks used 102,263 stored facts without analyzing the table or changing planner settings. A 500-ID lookup took 93.56 ms for matches and 5.98 ms for misses; the UEI crosswalk took 69.07 ms. The key index selects matching partitions first, and each matching leaf expands once. Partition change detection includes child and subtree counters so updates inside an existing split cannot retain stale totals; the regression covers several pages and interrupted child publication.

Each place has a constant-size pointer to immutable index pages of at most 64 entries. Separate indexes locate a changed partition and seek records by source, year and publication date. A publication writes only the affected paths, one segment of at most five page references, and immutable pages of at most 100 facts. Readers seek the next page directly; cursors retain the immutable snapshot through later corrections and removals. Worker partition verification lives separately from the public artifact reader, which has no database read-model import. Government and district cards collect attribution in one bottom Sources list, and Ask reads the same place pages and historical-year selection. Missing sources and partial coverage stay visible.

Fixture provenance is in `tests/fixtures/federal-money/provenance.json`. Generated scale inputs never seed production.

## Campaign load retirement

The native state campaign load is retired. Its 56 scheduled contracts and its acquisition/publishing entry point are deleted. No job from this load can repopulate the reader stores after the cleanup. Source acquisition/parsing fixtures and the existing Arizona, New Hampshire, New Jersey and Pima publications remain held. The people-driven replacement is the next SRC-MN READY.

Release 60 already excludes unbound, misfiled and pre-2020 native campaign facts from cards and Ask. Individual donation lists are excluded. Rulings §9 permits individual names only above $200 in a cycle; small donors and home addresses remain private. The forthcoming person-cycle publisher implements that rule.

The journaled contract migration `SRC-MN_retire_campaign_load` deletes every fact version from the retired producer, its native publication pointers, candidate copies/events, old checkpoints and now-empty committee identities and links. Source copies and raw evidence-vault files are preserved. Other funding producers, valid legacy source publications and corrected future money are untouched. No database column is added.

The migration processes one committee in one state at a time, deleting at most 500 fact IDs per statement. It never fetches financial payloads into the runner. PostgreSQL applies the deletion server-side; the runner holds the fixed migration text. Fact watermarks change for each affected state. Trigger permissions are restored in the same transaction. A real PostgreSQL regression checks 1,001 facts across multiple batches, live and superseded facts, flags, candidate self/history foreign keys, preserved money/source evidence and restoration of immutable-store protection. No full production-sized deletion was performed in the workspace.

The release runner quiesces its source lanes before following the deployed commit, applies contract migrations for that exact serving commit, and only then admits source work. Rulings §5 therefore puts this cleanup after deployment. Sean approved releasing the cleanup first and requiring production zeros before the people-refresh READY. The pre-release counts below are reported as still present, not as already removed.

| Place | Old facts live | Old publication pointers | Old candidate copies |
|---|---:|---:|---:|
| AL | 444,469 | 894 | 5,352 |
| AK | 0 | 0 | 23 |
| AZ | 0 | 0 | 23 |
| AR | 0 | 0 | 23 |
| CA | 3,000 | 6 | 8 |
| CO | 351,781 | 705 | 3,434 |
| CT | 182,214 | 371 | 2,038 |
| DE | 0 | 0 | 21 |
| DC | 154,500 | 310 | 2,082 |
| FL | 127,348 | 343 | 2,599 |
| GA | 0 | 0 | 16 |
| HI | 156,903 | 315 | 1,953 |
| ID | 89,000 | 179 | 857 |
| IL | 0 | 0 | 11 |
| IN | 0 | 0 | 10 |
| IA | 0 | 0 | 10 |
| KS | 0 | 0 | 9 |
| KY | 92,399 | 662 | 1,056 |
| LA | 49,000 | 99 | 553 |
| ME | 0 | 0 | 4 |
| MD | 28,740 | 72 | 145 |
| MA | 14,188 | 192 | 678 |
| MI | 0 | 0 | 3 |
| MN | 14,081 | 74 | 77 |
| MS | 0 | 0 | 2 |
| MO | 0 | 0 | 1 |
| MT | 0 | 0 | 1 |
| NE | 0 | 0 | 0 |
| NV | 0 | 0 | 0 |
| NH | 0 | 0 | 1 |
| NJ | 0 | 0 | 0 |
| NM | 0 | 0 | 0 |
| NY | 0 | 0 | 0 |
| NC | 0 | 0 | 0 |
| ND | 0 | 0 | 0 |
| OH | 0 | 0 | 0 |
| OK | 0 | 0 | 0 |
| OR | 0 | 0 | 0 |
| PA | 0 | 0 | 0 |
| RI | 0 | 0 | 0 |
| SC | 0 | 0 | 0 |
| SD | 0 | 0 | 0 |
| TN | 0 | 0 | 0 |
| TX | 0 | 0 | 0 |
| UT | 0 | 0 | 0 |
| VT | 0 | 0 | 0 |
| VA | 0 | 0 | 0 |
| WA | 0 | 0 | 0 |
| WV | 0 | 0 | 1 |
| WI | 0 | 0 | 0 |
| WY | 0 | 0 | 0 |
| AS | 0 | 0 | 0 |
| GU | 0 | 0 | 0 |
| MP | 0 | 0 | 1 |
| PR | 0 | 0 | 1 |
| VI | 0 | 0 | 0 |

Across all 56 places: 1,707,623 facts, all live; 4,222 publication pointers; 20,993 candidate copies. After River releases, `scripts/src-money-check.mts` repeats the same state-scoped, count-only read-only queries, persists measured response bytes and refuses success unless every fact, publication and candidate-copy count is zero. Immutable payload fragments have no independent live status: publication and candidate roots are removed; raw source evidence remains saved.

The pre-release all-place count check read 39,251 bytes. The earlier targeted 13-state check read 10,944 bytes; a retained-source hash check read 583 bytes. These cleanup checks total 50,778 production response bytes and zero production bytes written. Completed production-backed checks, including preparation for the people-based publisher and the first gate invocation, read 42,697,118 measured response bytes; the final gate traffic is added in READY. Production counts return no financial payload. The isolated migration test is a correctness test, not a production WAL or storage measurement. Actual migration write traffic and run time will be recorded after release; no daily cleanup replay is scheduled. Retired source workers run zero copies and consume no acquisition reservation. The fixed migration’s production runner peak has not been measured; RH-01’s existing admission and 0.75 GiB margin are unchanged.

The retained payload hashes are AZ `5f7a45347e88a9963164cb2fdd62689d`, NH `3358afe7d4705486ed1078adbc2c5b2f`, NJ `f37575a744720b6c2d504256ff9d0341` and Pima `8b73fab45eecff781d96607afbec3af8`, identical to the prior held values. Earlier interrupted development probes were not all metered; 50,778 bytes is the exact measured cleanup-check total, not a claimed total for every historical probe.

## Federal source scale measurements

Local scale measurements use a four-core host with concurrent work. Counts describe benchmark inputs; production inventory is checked under DONE. Database traffic means decoded SQL request and response JSON through the production PostgreSQL adapter. It does not measure heap, index, TOAST, WAL, compressed network traffic or production daily changes. Fixture preparation runs separately from the measured worker.

| Completed stage | Input | Elapsed | Peak worker memory | Database traffic | RAM copies alone / with parent |
| --- | --- | ---: | ---: | --- | ---: |
| FAC historical acquisition | All 18 official 1998–2015 archives; 950,035 selected rows across 57 state buckets | 345.46 s | 378,646,528 bytes, observed process tree | Zero; acquisition and vault only | 20 / 12 |
| USAspending national acquisition | 8,038,344 generated transactions across 56 jurisdictions and all 112,034 held governments | 1,120.33 s | 373,768,192 bytes | Zero; acquisition and vault only | 20 / 12 |
| USAspending single-county acquisition | 2,000,000 generated transactions; 4,403,778,095 expanded bytes | 498.43 s | 407,928,832 bytes | Zero; acquisition and vault only | 19 / 11 |
| SAM extract acquisition | 1,000,000 generated entities; 1,353,888,929 expanded bytes | 567.56 s | 369,995,776 bytes | Zero; acquisition and vault only | 21 / 12 |
| Per-place artifact publication | 2,000,000 generated county facts; 4,000 partitions and 20,000 pages | 118.93 s publication; 123.96 s including cold checks | 328,200,192 bytes | Zero; artifact stage only | 23 / 14 |

The FAC archives contain 10,613,289 native CSV rows in 1,902,780,166 expanded bytes. Raw archives total 432,697,811 bytes. The cold rerun replayed real archived evidence through byte-bounded response streams and reproduced all 2,551 capture hashes, lengths and formats and all 57 state counts from the earlier strict UTF-8/ZIP-checksum verification. Acquisition wrote 922,185,471 vault bytes and read 490,054,536 bytes. Unknown-state records remain in ZZ: 798 rows. The largest annual archive expands to 139,040,569 bytes; its largest individual CSV entry is 106,249,472 bytes. The largest selected state/table bucket is California's 2011 audit header, 2,719,993 bytes on disk.

| FAC stage | One active payload unit | Largest unit bytes | Peak process-tree RSS bytes |
| --- | --- | ---: | ---: |
| Download | Response chunk | 65,536 | 371,171,328 |
| Raw archive vault | Reused content-hash chunk | 4,194,304 | 378,646,528 |
| ZIP expansion | Expanded stream chunk | 65,536 | 374,321,152 |
| State split | One CSV row; bucket payloads stay on disk | 1,552 | 374,321,152 |
| Sort key | One native row | 1,552 | 369,643,520 |
| External sort | One state/table spool; 16 MiB sort buffer | 3,951,092 | 369,643,520 |
| Sort output | One decoded row | 1,552 | 369,643,520 |
| Capture vault | One capture in a reused 2 MiB buffer | 362,103 | 369,905,664 |
| Capture parse | One capture of at most 500 rows | 362,103 | 376,143,872 |

RSS includes the runtime, V8 heap capacity and allocator residency. The FAC baseline was 67,284,992 bytes; the peak occurred during one 4 MiB chunk of the 2011 archive, with 13,326,880 used heap bytes, 149,942,272 heap-capacity bytes and 31,846,464 external bytes. The remaining four archives did not raise that peak. Active-unit diagnostics describe the operation, not a census of heap retainers. No forced collection or heap-size flags were used.

A separate single-record test isolates the removed CSV allocation amplification: the same 4,194,317-byte CSV record, containing a 4 MiB field, took 300.4 ms and 271,396,864 peak RSS bytes with the prior parser, and 16.9 ms and 49,184,768 bytes with the replacement. Both returned the same field. The parser slices fields, releases raw rows as it creates facts, and reuses a file's header while sorting. Capture writing no longer keeps row strings, a joined string and an encoded buffer together. Partition byte checks serialize one fact at a time, and refresh no longer retains the preceding acquisition page.

The generated national USAspending input matches the live 2025 transaction count. Its 64,115,267 ZIP bytes expand to 1,364,272,836 CSV bytes, delivered as 16,107 bounded pages; the largest capture is 96,531 bytes. Illinois is the largest state extract: 573,408 rows and 98,109,106 expanded bytes. Its 180,033,328-byte keyed sort spool stays on disk, with a 16 MiB sort buffer. A separate two-million-row input exercised 4,403,778,095 expanded bytes, beyond V8's single-string limit, in 498.43 seconds at a 407,928,832-byte worker peak. Its sampled scratch-space peak was 21,755,274,593 bytes. The largest keyed sort spool was 6,043,595,600 bytes on disk; sort used a 16 MiB buffer. The largest capture was 1,101,355 bytes for 500 rows. The worker began at 233,050,112 RSS bytes; its sampled peak occurred while keying one 2,201-byte row, with 19,892,616 used heap bytes and 13,265,244 external bytes. The largest native row was 2,203 bytes. These measurements cover streaming acquisition only.

At two million county facts, the root is 203 bytes and the largest index node is 11,684 bytes. The accepted 500-fact partition is at most 1,035,698 bytes; publication serializes one 100-fact page at a time, at most 202,876 expanded bytes or 7,989 compressed bytes. A segment holds at most five references in 1,325 bytes, and its immutable snapshot is 300 bytes. Tree traversal verified all 4,000 segments, 20,000 pages and two million facts without collecting the full index.

Publication read 244,998,690 logical artifact bytes and wrote 358,552,240 bytes; local compare-and-swap added 1,623,926 disk-read bytes. Retained artifacts occupy 355,651,309 bytes, including immutable index versions needed by existing cursors. Cold latest-page, historical-year, API and Ask evidence checks took 0.290/0.305/0.331/0.368 seconds. A latest page reads 62,815 artifact bytes and returns 100 facts; the historical-year page reads 80,155 bytes.

Publisher RSS began at 82,964,480 bytes. Its sampled peak during one compressed fact-page write was 328,069,120 bytes, with 175,616,000 heap-capacity bytes, 105,773,208 used heap bytes and 21,827,836 external bytes; the kernel high-water was 328,200,192 bytes. Sampled heap use was 17.8 MB at 100,000 facts, 7.7 MB at one million and 6.7 MB at two million. The reader uses the federal hash function directly, avoiding a meeting-runtime import for hashing small values. The code retains the accepted partition, one output page and bounded index paths; it has no collection of all county pages or previous full indexes. Benchmark byte counters measure artifact sizes directly rather than reserializing indexes.

| County publication stage | One active item | Largest item bytes | Peak RSS bytes |
| --- | --- | ---: | ---: |
| publish-partition | Accepted partition, at most 500 facts | 1,035,698 | 327,970,816 |
| write-fact-page | One compressed 100-fact page | 7,989 | 328,069,120 |
| write-segment | One segment, at most five page references | 1,325 | 328,069,120 |
| write-indexNode | One index node, at most 64 entries | 11,684 | 328,069,120 |
| read-artifact | One index artifact | 11,684 | 328,069,120 |
| write-snapshot | One immutable snapshot | 300 | 328,069,120 |
| read-pointer | One place pointer | 203 | 327,020,544 |
| write-pointer | One place pointer | 203 | 328,069,120 |

The million-row SAM input streamed from 13,876,922 gzip bytes into 2,000 captures, at most 676,971 bytes each. Its largest native JSON row was 1,353 bytes; external sort uses a 16 MiB buffer. Peak scratch storage was 6,912,761,084 bytes. The worker began at 233,680,896 RSS bytes and peaked at 369,995,776; the initial download/JSON-scan phase shared one diagnostic label, so that peak cannot be assigned solely to a network chunk. At the sampled peak, heap use was 71.9 MB and external memory 13.6 MB.

Completed national SQL lifecycle runs use native identity/location queries, partition verification and promotion, and per-place publication for joined facts. These runs precede the final consolidation of checkpoint readers into the existing verification module; function bodies, queries and page bounds are unchanged. Final gates check the consolidated module and its consumer identifiers. SAM and FEMA peaks include up to 500 fixture seed descriptors that were unused and subsequently removed; generated source rows are unchanged.

| Source | Loaded / joined / unjoined | Seconds | Peak worker bytes | DB read bytes | DB written bytes | RAM copies alone / with parent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| USAspending | 112,034 / 112,034 / 0 | 962.555 | 605,052,928 | 1,062,456,389 | 573,139,696 | 12 / 7 |
| FAC 2015 | 112,613 / 0 / 112,613 | 869.154 | 619,302,912 | 2,929,585,733 | 790,822,593 | 12 / 7 |
| SAM | 112,034 / 112,034 / 0 | 853.701 | 524,558,336 | 1,650,860,616 | 553,564,332 | 14 / 8 |
| OpenFEMA | 71,170 / 71,170 / 0 | 504.511 | 575,922,176 | 631,148,813 | 383,873,296 | 13 / 8 |

USAspending and SAM each cover all 112,034 held governments across 56 jurisdictions. These benchmarks add synthetic UEIs to the government reference; they measure recipient matching, while real nationwide UEI crosswalk coverage remains unmeasured. The generated USAspending fixture assigns 19,835 otherwise missing performance counties within the same state; it uses each government's own UEI and NCES ID where present, and every recipient is checked against the expected government. OpenFEMA covers all 3,235 held counties with 71,170 generated declarations, exceeding the measured live catalog of 70,567. The real FAC 2015 rows have no supported recipient-native keys in this identity inventory, so all 112,613 remain retained and unjoined across 57 buckets, including ZZ. Modern FAC native-ID joins are covered by source fixtures.

Empty-delta days below execute the actual provider acquisition paths against empty native responses, using controlled worker/database clocks. These are measured zero-row source responses, not observed production traffic or estimates for changed records or inclusive-window overlap. Every run wrote zero fact partitions and zero place-fact artifacts. Source freshness metadata still updates; those artifact-status bytes are outside the database-byte measurement.

| Source | Checks/day | Provider requests | Seconds | Peak worker bytes | DB read bytes/day | DB written bytes/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| USAspending | 1 | 1,008 | 37.820 | 270,663,680 | 17,096,620 | 10,527,602 |
| FAC (2015 inventory) | 1 | 57 | 3.077 | 270,131,200 | 1,499,504 | 482,593 |
| SAM | 1 | 112 | 12.822 | 258,613,248 | 5,774,889 | 3,567,033 |
| OpenFEMA | 72 | 4,032 | 241.100 | 315,813,888 | 119,240,034 | 33,784,056 |

The stored leaf counts, distinct source IDs and checkpoint totals reconcile per state. Maximum leaves contain 457 USAspending rows, 500 SAM/FAC rows and 22 FEMA rows. Cold place reads remain below three seconds; the separate two-million-fact place benchmark measures the larger reader index. Total backfill time and bytes grow with the input; each worker operation holds bounded pages, partitions and native matches, and reader costs follow the selected place.

Maximum single SQL response/request bytes: USAspending 1,562,673/1,560,818; FAC 1,874,160/1,872,213; SAM 1,531,371/1,529,425; OpenFEMA 87,830/85,956.

The worker reservation is 768 MiB. On an 8 GiB runner, after the 0.75 GiB margin, nine reserved workers fit alone or five alongside the existing 2,928 MiB research-parent reservation. These are memory-only capacities; admission also accounts for observed process growth. The largest measured cold sort permits only one copy in this 32 GiB workspace because it uses 20.3 GiB of temporary disk. Concurrent giant sorts and production disk capacity were not measured.

The 2026-10-15 live USAspending, FAC and OpenFEMA probes succeeded. SAM's entity APIs returned HTTP 503 upstream connection timeouts from this workspace on that probe; its documented million-row extract limit was exercised with generated input. Full historical USAspending database ingestion, the full 1,434,543-row modern FAC inventory, and a million-entity SAM database load remain unmeasured. The post-release checks below own production traffic and live-site verification.

The live-site and production checks under DONE run after River releases, by Sean's oversight session.

DONE: report rows loaded per state, rows joined and unjoined, and three live examples on meanwhileusa.com in three different states.
