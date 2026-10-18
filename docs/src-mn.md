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

Campaign source samples and their provenance are committed in `tests/fixtures/campaign-finance/`. The connected first piece covers AL, CA, CO, CT, DC, FL, HI, ID, KY, LA, MD, MA, MN, MS, MO, NE, NH, NY, PA, SC, TX, UT, VT, VA, WA, WI and PR. Remaining jurisdictions, partial-source expansion and further local-government bindings follow separately.

Campaign files stream to the evidence vault. Each verified batch of at most 500 source rows is recorded by the routine source flow and filed immediately in the shared `entity`, `entity_place`, `entity_external_id`, `source_copy` and `fact` tables RS-01 reads. Bound local records sit under their exact place inside the state; unmatched rows stay under their state with the source's identifiers and reason. Every amount keeps its source and publication date. Missing or unreadable updates retain previously verified amounts with their original evidence. Source checks use the existing `pass_cursor` table; no campaign artifact, pointer, page file or reader copy is published.

Readers query one committee's page of at most 100 live facts through the place index. Cursors carry that place, committee and last field, and another state's cursor is rejected. Ask calls the same reader. Original source bytes stay in the evidence vault. Anonymous rows use stable content identities and occurrence counters on temporary disk; the counter cache is bounded to one MiB and removed after the pass. Facts are never accumulated for all states or all pages.

The production database was inspected using its `readonly` role with read privileges and no write privileges. It holds 717 AZ, 28 NH and 5,145 NJ state records. Their exact candidacy bindings account for 46, 15 and 317 records respectively; 670 AZ and 4,802 NJ records have native filer identities. Other rows remain held. Pima's local source record is present. No curated national or per-state campaign-finance publication is currently held, so that split remains old 0, new 0, with no differing IDs. A nonempty test reconciles 112 filings, two per jurisdiction, exactly once each.

Production native campaign fact rows are currently zero; the first piece delivers the publisher and reader connection for River to release. All 27 connected jurisdictions have committed native samples and passing source tests. No national-volume campaign run is required for this first piece. No new database columns are introduced.

Read-only production verification ran the merged branch's funding handler from a cold process, then compared Ask's evidence with the returned filings. Arizona's Rodney Glassman took 1.191 seconds, New Hampshire's Cinde Warmington 1.122 seconds, New Jersey's Tayfun Selen 2.504 seconds and Arizona Governor Katie Hobbs 1.756 seconds. The governor check exposed a missing candidacy ID in the place selection; the resolved, verified candidacy now enters the same selection before money is read. Candidate and official identity checks are unchanged. Two earlier New Jersey reads returned an unavailable authority. The exact underlying errors were not captured; the checker now retains source failure details. The final complete run returned both held filings, but does not establish that the intermittent failure is resolved. Public-site API GETs against the already deployed code took 3.75–4.06 seconds through this workspace; those fail the three-second rule and are not claimed as a pass for this branch.

Before-and-after row hashes matched for all 5,890 state records and Pima's 1,484 transactions: AZ holds 717 records, 46 joined to exact candidacies and 671 without that binding; NH holds 28, with 15 joined and 13 without; NJ holds 5,145, with 317 joined and 4,828 without. Native filer identities remain on 670 AZ and 4,802 NJ records. Pima holds 900 contributions and 584 distributions under its county; no additional person binding is asserted. The test handle was production's `readonly` role, verified to have SELECT permission and no INSERT, UPDATE or DELETE permission. No production rows were written.

Actual official-source samples were acquired and published through the final shared-store path in isolated PostgreSQL databases. Each worker acquired one 500-row page, filed it, read its place page and read the same facts through Ask. WA loaded 500, joined 0 and retained 500 unjoined; PR loaded 500, joined 0 and retained 500 unjoined. These are source-native records with no independently held local-government binding, not invented joins. They are private test publications, not live production counts. Every other connected jurisdiction's additional native production count remains zero.

| Campaign unit | Runtime | Peak worker RSS | Logical database bytes read / written | Reader plus Ask |
| --- | ---: | ---: | ---: | ---: |
| WA official API, 500 rows | 1.658 s | 363,986,944 | 6,231,439 / 4,834,172 | 11.006 ms |
| PR official API, 500 anonymous rows | 6.721 s | 354,779,136 | 5,542,013 / 4,120,649 | 16.311 ms |

The acquisition/publication peak is set by one 500-row source batch; the reader peak is one committee page of at most 100 facts. The private database process was separate, as the production database is remote. Anonymous-row counters stay in a one-MiB SQLite cache on temporary disk. The largest measured money worker was 347.125 MiB; its routine admission reservation is 384 MiB. On an 8 GiB runner with the 768 MiB margin, 19 reserved workers fit alone or 11 alongside the existing 2,928 MiB parent reservation. The largest production reader check peaked at 411,598,848 bytes after both card and Ask reads. Daily database traffic, full-source production ingestion and national-volume campaign runs were not measured in this first piece. Acquisition runtime includes the official source request; it is separate from reader latency. Remaining sources, partial-state expansion and local bindings stay with SRC-MN for subsequent READYs. Preflight initially refused unconstrained campaign scratch destinations and the expanded registry command dependency graph. The source path now enforces the existing temporary-directory confinement; the campaign contract modules are consolidated and their replaced files deleted. The corrected preflight and all 65 focused regressions pass. A guarded, write-blocked browser inspection of the deployed Arizona ballot succeeded; its default view did not show a money section and is not proof of the unreleased branch. The first full-suite attempt also found a missing per-state campaign source in the warm-up exclusion assertion and a server reader reachable from browser/preflight imports. The assertion now checks the new state source, and the reader lives in the existing server module. Both browser and bare-import regressions pass. Geography and deliberately unreadable-ballot fixtures read the workspace database instead of their committed samples; their assertions pass in the CI environment without that database handle. Standing-source inventory assertions now include the new campaign record class and all state publisher tasks. The native HTTPS report-ID assertion parses the URL explicitly and passes the existing path guard. The full gates retain the separate production readonly schema-check handle.

| Place | Official campaign-finance source | Access identified | New native records published live |
| --- | --- | --- | ---: |
| AL | [Alabama Secretary of State](https://www.sos.alabama.gov/alabama-votes/media/campaign-finance-reports) | Bulk download | 0 |
| AK | [Alaska Public Offices Commission](https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDIncome.aspx) | Not yet confirmed | 0 |
| AZ | [Arizona Secretary of State](https://azsos.gov/elections/campaign-finance-reporting) | API | 0 |
| AR | [Arkansas Secretary of State](https://financial-disclosures.sos.arkansas.gov/) | Not yet confirmed | 0 |
| CA | [California Secretary of State](https://www.sos.ca.gov/campaign-lobbying/cal-access-resources/raw-data-campaign-finance-and-lobbying-activity) | Bulk download | 0 |
| CO | [Colorado Secretary of State](https://tracer.sos.colorado.gov/PublicSite/DataDownload.aspx) | Bulk download | 0 |
| CT | [Connecticut State Elections Enforcement Commission](https://seec.ct.gov/Portal/eCRIS/eCrisSearch) | Bulk download | 0 |
| DE | [Delaware Department of Elections](https://cfrs.elections.delaware.gov/) | Not yet confirmed | 0 |
| DC | [District of Columbia Office of Campaign Finance](https://efiling.ocf.dc.gov/DataDownload) | Bulk download and API | 0 |
| FL | [Florida Division of Elections](https://dos.elections.myflorida.com/campaign-finance/contributions/) | Bulk download | 0 |
| GA | [Georgia State Ethics Commission](https://ethics.ga.gov/) | Not yet confirmed | 0 |
| HI | [Hawaii Campaign Spending Commission](https://hicscdata.hawaii.gov/) | API | 0 |
| ID | [Idaho Secretary of State](https://sunshine.sos.idaho.gov/) | API | 0 |
| IL | [Illinois State Board of Elections](https://www.elections.il.gov/CampaignDisclosure/DownloadData.aspx) | Bulk download | 0 |
| IN | [Indiana Election Division](https://cfa.in.gov/) | Not yet confirmed | 0 |
| IA | [Iowa Ethics and Campaign Disclosure Board](https://data.iowa.gov/catalog/dataset/917) | API | 0 |
| KS | [Kansas Public Disclosure Commission](https://kpdc.kansas.gov/campaign-finance/campaign-contributor-data/) | Not yet confirmed | 0 |
| KY | [Kentucky Registry of Election Finance](https://secure.kentucky.gov/kref/publicsearch/CandidateSearch/) | Bulk download and API | 0 |
| LA | [Louisiana Board of Ethics](https://ethics.la.gov/CampaignFinanceSearch/) | Bulk download | 0 |
| ME | [Maine Commission on Governmental Ethics and Election Practices](https://www.mainecampaignfinance.com/) | Not yet confirmed | 0 |
| MD | [Maryland State Board of Elections](https://campaignfinance.maryland.gov/) | Bulk download | 0 |
| MA | [Massachusetts Office of Campaign and Political Finance](https://ocpf.us/Data/Downloads) | Bulk download and API | 0 |
| MI | [Michigan Department of State](https://www.michigan.gov/sos/elections/Disclosure/cfr/committee-search/intro/welcome-to-the-michigan-campaign-finance-searchable-database) | Bulk download | 0 |
| MN | [Minnesota Campaign Finance and Public Disclosure Board](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/) | Bulk download | 0 |
| MS | [Mississippi Secretary of State](https://cfportal.sos.ms.gov/) | API | 0 |
| MO | [Missouri Ethics Commission](https://www.mec.mo.gov/MEC/Campaign_Finance/CF_ContrCSV.aspx) | Bulk download | 0 |
| MT | [Montana Commissioner of Political Practices](https://cers-ext.mt.gov/CampaignTracker/dashboard) | Not yet confirmed | 0 |
| NE | [Nebraska Accountability and Disclosure Commission](https://nadc-e.nebraska.gov/) | Bulk download | 0 |
| NV | [Nevada Secretary of State](https://www.nvsos.gov/SOSCandidateServices/AnonymousAccess/CEFDSearchUU.aspx) | Not yet confirmed | 0 |
| NH | [New Hampshire Secretary of State](https://cfs.sos.nh.gov/) | API | 0 |
| NJ | [New Jersey Election Law Enforcement Commission](https://www.elec.nj.gov/) | API | 0 |
| NM | [New Mexico Secretary of State](https://cfis.sos.nm.gov/) | Bulk download and API | 0 |
| NY | [New York State Board of Elections](https://data.ny.gov/Government-Finance/Campaign-Finance-Disclosure-Reports-Data-Beginning/e9ss-239a) | Bulk download and API | 0 |
| NC | [North Carolina State Board of Elections](https://www.ncsbe.gov/campaign-finance/search-campaign-funding-and-spending-reports-and-penalties) | Not yet confirmed | 0 |
| ND | [North Dakota Secretary of State](https://www.sos.nd.gov/elections/campaign-finance-statement-interests/search-reports) | Not yet confirmed | 0 |
| OH | [Ohio Secretary of State](https://www.ohiosos.gov/elections/campaign-finance) | Bulk download | 0 |
| OK | [Oklahoma Ethics Commission](https://guardian.ok.gov/PublicSite/) | Bulk download | 0 |
| OR | [Oregon Secretary of State](https://sos.oregon.gov/elections/campaign-finance/pages/search-campaign-finance.aspx) | Not yet confirmed | 0 |
| PA | [Pennsylvania Department of State](https://www.campaignfinanceonline.pa.gov/Pages/CampaignFinanceHome.aspx) | Bulk download | 0 |
| RI | [Rhode Island Board of Elections](https://www.ricampaignfinance.com/) | Not yet confirmed | 0 |
| SC | [South Carolina State Ethics Commission](https://ethicsfiling.sc.gov/filing/home) | API | 0 |
| SD | [South Dakota Secretary of State](https://sdcfr.sdsos.gov/) | Not yet confirmed | 0 |
| TN | [Tennessee Registry of Election Finance](https://apps.tn.gov/tncamp/) | Not yet confirmed | 0 |
| TX | [Texas Ethics Commission](https://www.ethics.state.tx.us/search/cf/) | Bulk download | 0 |
| UT | [Utah Lieutenant Governor](https://disclosures.utah.gov/) | Bulk download | 0 |
| VT | [Vermont Secretary of State](https://campaignfinance.vermont.gov/) | Bulk download and API | 0 |
| VA | [Virginia Department of Elections](https://www.elections.virginia.gov/candidatepac-info/reporting/) | Bulk download | 0 |
| WA | [Washington Public Disclosure Commission](https://www.pdc.wa.gov/) | API | 0 |
| WV | [West Virginia Secretary of State](https://cfrs.wvsos.gov/) | Not yet confirmed | 0 |
| WI | [Wisconsin Ethics Commission](https://campaignfinance.wi.gov/browse-data) | API | 0 |
| WY | [Wyoming Secretary of State](https://www.wycampaignfinance.gov/) | Not yet confirmed | 0 |
| AS | [American Samoa Election Office](https://aselectionoffice.gov/) | Not yet confirmed | 0 |
| GU | [Guam Election Commission](https://gec.guam.gov/) | Not yet confirmed | 0 |
| MP | [Commonwealth Election Commission](https://www.votecnmi.gov.mp/) | Not yet confirmed | 0 |
| PR | [Puerto Rico Office of the Electoral Comptroller](https://oce.pr.gov/) | API | 0 |
| VI | [Elections System of the Virgin Islands](https://vivote.gov/) | Not yet confirmed | 0 |

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
