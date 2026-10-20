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

## Campaign money — removal of incorrect reader facts

River 011443fad and main f7db190d6 are included. Every source now declares 2020 as its first eligible year. A new transaction can publish only with a unique published person, exact office and seat, filed committee name and eligible date. Extracts missing a supported candidate or office stop before downloading financial rows; their committee discovery stays open. Invalid calendar dates and periods spanning multiple cycles are held. Committees without native IDs use the filed committee, candidate, office and year; null IDs never share one committee. Source bytes remain in the vault and unmatched rows are reported as open work. Existing unbound committee facts are excluded by the reader query through the normal code release; no production data edits or migrations are used. Legacy native-filer records also require their verified candidacy match before public display.

Government cards and Ask read the same cycle summaries, with filing links only in the bottom Sources list. Individual transactions are no longer a reader response. Rulings §9 keeps individual donors who gave $200 or less in the cycle anonymous; donors above $200 may appear as filed, and home addresses never appear. Organizations and committees keep their filed names. Person-driven hourly acquisition and cycle donor aggregates belong to the second READY.

All 56 states and territories were checked against the production database using its `readonly` role, verified to lack INSERT, UPDATE and DELETE permission. The inventory below lists published person IDs across the held official and November 3, 2026 ballot sources, not deduplicated natural people; complementary sources can use different IDs for one person. “Held rows” means existing native campaign transactions, not newly loaded production rows. Every one lacks a verified published-person/seat binding, so the first READY returns zero of these rows to readers. Zero-row states have no native source rows held. No database writes were performed. Louisiana's first connection returned an upstream HTTP 503; the resumed audit completed it and every remaining place. The completed states were retained, not rerun.

| Place | Official source / access | Published person IDs | People with bound native money | Held rows | Joined | Unmatched | Audit peak MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AL | [Alabama Secretary of State](https://www.sos.alabama.gov/alabama-votes/media/campaign-finance-reports) / BULK | 393 | 0 | 444,469 | 0 | 444,469 | 112.9 |
| AK | [Alaska Public Offices Commission](https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDIncome.aspx) / UNCONFIRMED | 195 | 0 | 0 | 0 | 0 | 113.9 |
| AZ | [Arizona Secretary of State](https://azsos.gov/elections/campaign-finance-reporting) / API | 469 | 0 | 0 | 0 | 0 | 113.8 |
| AR | [Arkansas Secretary of State](https://financial-disclosures.sos.arkansas.gov/) / UNCONFIRMED | 173 | 0 | 0 | 0 | 0 | 113.5 |
| CA | [California Secretary of State](https://www.sos.ca.gov/campaign-lobbying/cal-access-resources/raw-data-campaign-finance-and-lobbying-activity) / BULK | 547 | 0 | 3,000 | 0 | 3,000 | 112.7 |
| CO | [Colorado Secretary of State](https://tracer.sos.colorado.gov/PublicSite/DataDownload.aspx) / BULK | 383 | 0 | 351,781 | 0 | 351,781 | 113.5 |
| CT | [Connecticut State Elections Enforcement Commission](https://seec.ct.gov/Portal/eCRIS/eCrisSearch) / BULK | 737 | 0 | 182,214 | 0 | 182,214 | 113.1 |
| DE | [Delaware Department of Elections](https://cfrs.elections.delaware.gov/) / UNCONFIRMED | 226 | 0 | 0 | 0 | 0 | 113.6 |
| DC | [District of Columbia Office of Campaign Finance](https://efiling.ocf.dc.gov/DataDownload) / BULK_API | 65 | 0 | 154,500 | 0 | 154,500 | 113.9 |
| FL | [Florida Division of Elections](https://dos.elections.myflorida.com/campaign-finance/contributions/) / BULK | 680 | 0 | 127,348 | 0 | 127,348 | 113.7 |
| GA | [Georgia State Ethics Commission](https://ethics.ga.gov/) / UNCONFIRMED | 723 | 0 | 0 | 0 | 0 | 113.5 |
| HI | [Hawaii Campaign Spending Commission](https://hicscdata.hawaii.gov/) / API | 177 | 0 | 156,903 | 0 | 156,903 | 113.6 |
| ID | [Idaho Secretary of State](https://sunshine.sos.idaho.gov/) / API | 360 | 0 | 89,000 | 0 | 89,000 | 114.0 |
| IL | [Illinois State Board of Elections](https://www.elections.il.gov/CampaignDisclosure/DownloadData.aspx) / BULK | 460 | 0 | 0 | 0 | 0 | 113.2 |
| IN | [Indiana Election Division](https://cfa.in.gov/) / UNCONFIRMED | 441 | 0 | 0 | 0 | 0 | 114.5 |
| IA | [Iowa Ethics and Campaign Disclosure Board](https://data.iowa.gov/catalog/dataset/917) / API | 408 | 0 | 0 | 0 | 0 | 113.7 |
| KS | [Kansas Public Disclosure Commission](https://kpdc.kansas.gov/campaign-finance/campaign-contributor-data/) / UNCONFIRMED | 432 | 0 | 0 | 0 | 0 | 113.5 |
| KY | [Kentucky Registry of Election Finance](https://secure.kentucky.gov/kref/publicsearch/CandidateSearch/) / BULK_API | 357 | 0 | 92,399 | 0 | 92,399 | 113.3 |
| LA | [Louisiana Board of Ethics](https://ethics.la.gov/CampaignFinanceSearch/) / BULK | 195 | 0 | 49,000 | 0 | 49,000 | 114.3 |
| ME | [Maine Commission on Governmental Ethics and Election Practices](https://www.mainecampaignfinance.com/) / UNCONFIRMED | 556 | 0 | 0 | 0 | 0 | 113.9 |
| MD | [Maryland State Board of Elections](https://campaignfinance.maryland.gov/) / BULK | 523 | 0 | 20,000 | 0 | 20,000 | 113.4 |
| MA | [Massachusetts Office of Campaign and Political Finance](https://ocpf.us/Data/Downloads) / BULK_API | 513 | 0 | 14,188 | 0 | 14,188 | 113.6 |
| MI | [Michigan Department of State](https://www.michigan.gov/sos/elections/Disclosure/cfr/committee-search/intro/welcome-to-the-michigan-campaign-finance-searchable-database) / BULK | 631 | 0 | 0 | 0 | 0 | 114.0 |
| MN | [Minnesota Campaign Finance and Public Disclosure Board](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/) / BULK | 645 | 0 | 12,524 | 0 | 12,524 | 112.8 |
| MS | [Mississippi Secretary of State](https://cfportal.sos.ms.gov/) / API | 203 | 0 | 0 | 0 | 0 | 112.8 |
| MO | [Missouri Ethics Commission](https://www.mec.mo.gov/MEC/Campaign_Finance/CF_ContrCSV.aspx) / BULK | 573 | 0 | 0 | 0 | 0 | 113.8 |
| MT | [Montana Commissioner of Political Practices](https://cers-ext.mt.gov/CampaignTracker/dashboard) / UNCONFIRMED | 416 | 0 | 0 | 0 | 0 | 114.2 |
| NE | [Nebraska Accountability and Disclosure Commission](https://nadc-e.nebraska.gov/) / BULK | 154 | 0 | 0 | 0 | 0 | 114.7 |
| NV | [Nevada Secretary of State](https://www.nvsos.gov/SOSCandidateServices/AnonymousAccess/CEFDSearchUU.aspx) / UNCONFIRMED | 212 | 0 | 0 | 0 | 0 | 113.1 |
| NH | [New Hampshire Secretary of State](https://cfs.sos.nh.gov/) / API | 470 | 0 | 0 | 0 | 0 | 114.1 |
| NJ | [New Jersey Election Law Enforcement Commission](https://www.elec.nj.gov/) / API | 589 | 0 | 0 | 0 | 0 | 114.9 |
| NM | [New Mexico Secretary of State](https://cfis.sos.nm.gov/) / BULK_API | 254 | 0 | 0 | 0 | 0 | 114.2 |
| NY | [New York State Board of Elections](https://data.ny.gov/Government-Finance/Campaign-Finance-Disclosure-Reports-Data-Beginning/e9ss-239a) / BULK_API | 695 | 0 | 0 | 0 | 0 | 114.2 |
| NC | [North Carolina State Board of Elections](https://www.ncsbe.gov/campaign-finance/search-campaign-funding-and-spending-reports-and-penalties) / UNCONFIRMED | 561 | 0 | 0 | 0 | 0 | 113.2 |
| ND | [North Dakota Secretary of State](https://www.sos.nd.gov/elections/campaign-finance-statement-interests/search-reports) / UNCONFIRMED | 296 | 0 | 0 | 0 | 0 | 112.9 |
| OH | [Ohio Secretary of State](https://www.ohiosos.gov/elections/campaign-finance) / BULK | 188 | 0 | 0 | 0 | 0 | 113.7 |
| OK | [Oklahoma Ethics Commission](https://guardian.ok.gov/PublicSite/) / BULK | 350 | 0 | 0 | 0 | 0 | 115.0 |
| OR | [Oregon Secretary of State](https://sos.oregon.gov/elections/campaign-finance/pages/search-campaign-finance.aspx) / UNCONFIRMED | 282 | 0 | 0 | 0 | 0 | 113.4 |
| PA | [Pennsylvania Department of State](https://www.campaignfinanceonline.pa.gov/Pages/CampaignFinanceHome.aspx) / BULK | 400 | 0 | 0 | 0 | 0 | 114.3 |
| RI | [Rhode Island Board of Elections](https://www.ricampaignfinance.com/) / UNCONFIRMED | 282 | 0 | 0 | 0 | 0 | 114.7 |
| SC | [South Carolina State Ethics Commission](https://ethicsfiling.sc.gov/filing/home) / API | 473 | 0 | 0 | 0 | 0 | 113.9 |
| SD | [South Dakota Secretary of State](https://sdcfr.sdsos.gov/) / UNCONFIRMED | 290 | 0 | 0 | 0 | 0 | 114.8 |
| TN | [Tennessee Registry of Election Finance](https://apps.tn.gov/tncamp/) / UNCONFIRMED | 414 | 0 | 0 | 0 | 0 | 113.6 |
| TX | [Texas Ethics Commission](https://www.ethics.state.tx.us/search/cf/) / BULK | 722 | 0 | 0 | 0 | 0 | 114.3 |
| UT | [Utah Lieutenant Governor](https://disclosures.utah.gov/) / BULK | 352 | 0 | 0 | 0 | 0 | 113.7 |
| VT | [Vermont Secretary of State](https://campaignfinance.vermont.gov/) / BULK_API | 505 | 0 | 0 | 0 | 0 | 113.9 |
| VA | [Virginia Department of Elections](https://www.elections.virginia.gov/candidatepac-info/reporting/) / BULK | 203 | 0 | 0 | 0 | 0 | 114.1 |
| WA | [Washington Public Disclosure Commission](https://www.pdc.wa.gov/) / API | 440 | 0 | 0 | 0 | 0 | 112.2 |
| WV | [West Virginia Secretary of State](https://cfrs.wvsos.gov/) / UNCONFIRMED | 384 | 0 | 0 | 0 | 0 | 114.4 |
| WI | [Wisconsin Ethics Commission](https://campaignfinance.wi.gov/browse-data) / API | 157 | 0 | 0 | 0 | 0 | 114.1 |
| WY | [Wyoming Secretary of State](https://www.wycampaignfinance.gov/) / UNCONFIRMED | 230 | 0 | 0 | 0 | 0 | 114.0 |
| AS | [American Samoa Election Office](https://aselectionoffice.gov/) / UNCONFIRMED | 0 | 0 | 0 | 0 | 0 | 113.8 |
| GU | [Guam Election Commission](https://gec.guam.gov/) / UNCONFIRMED | 0 | 0 | 0 | 0 | 0 | 114.5 |
| MP | [Commonwealth Election Commission](https://www.votecnmi.gov.mp/) / UNCONFIRMED | 0 | 0 | 0 | 0 | 0 | 113.4 |
| PR | [Puerto Rico Office of the Electoral Comptroller](https://oce.pr.gov/) / API | 83 | 0 | 0 | 0 | 0 | 113.9 |
| VI | [Elections System of the Virgin Islands](https://vivote.gov/) / UNCONFIRMED | 0 | 0 | 0 | 0 | 0 | 113.4 |

All 1,697,326 unmatched native rows have the same publication blocker: no verified published-person and seat binding. The underlying reasons include missing office, missing candidate, missing native filer ID, unsupported person matches and historical dates. These are held evidence, not reader facts. No claim is made that every missing binding has already been investigated.

The existing state publications remain held: Arizona 717 records, New Hampshire 28, New Jersey 5,145; Pima retains its local publication. Their source payload hashes at this check are AZ `5f7a45347e88a9963164cb2fdd62689d`, NH `3358afe7d4705486ed1078adbc2c5b2f`, NJ `f37575a744720b6c2d504256ff9d0341`, Pima `8b73fab45eecff781d96607afbec3af8`. Reader restrictions do not remove evidence. No new database columns are introduced.

| Production-backed branch read | Campaign API | Government card money read | Reader sees |
| --- | ---: | ---: | --- |
| DC | 0.047 s | 0.058 s | Existing coverage gap; no unbound donation list |
| FL | 0.119 s | 0.126 s | Existing coverage gap; no unbound donation list |
| CO | 0.052 s | 0.072 s | Existing coverage gap; no unbound donation list |
| AZ | 0.177 s | 0.046 s | Existing coverage gap; no unbound donation list |

These timings use the branch's actual API handler and the money reader used by the card, against production data. They are not a claim that the unreleased code is already serving on meanwhileusa.com. All 56 place-money reads completed below 0.489 s. The guarded browser checked the actual cycle card and its single Sources footer. Focused real-source parser, committee identity, period, privacy, card, Ask and held legacy-money checks pass. The first full gates run found an incomplete typed meeting fixture and an obsolete unbound cache fixture; both are corrected and the focused regressions pass.

The measured read-only audit worker peak was 120,553,472 bytes (115.0 MiB). All campaign state contracts share one failure domain; the actual bounded-child executor regression runs all 56 with eight available slots and observes exactly one active money job. The code holds one state's compact people lookup and one source batch of at most 500 rows; no country-sized money collection is retained. The production acquisition worker's full-file peak is not established by this read-only audit. Its existing 384 MiB admission reservation is unchanged; RH-01 owns runner admission. On an 8 GiB runner after the 0.75 GiB margin the audit peak permits 63 memory-only copies; this lane deliberately runs one. Other work's reservations remain under RH-01. Daily acquisition traffic and full-file acquisition peaks remain for the people-driven replacement in the second READY.

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
