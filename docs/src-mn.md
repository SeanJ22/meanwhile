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

## Campaign money

The `campaign-money` coordinator checks each state's hourly clock on the standing five-minute routine pass and starts one state process at a time. Each process reads that state's published officeholders at every held level and the candidates on its November 3, 2026 ballot. The hourly clock starts when the state begins, so processing time does not postpone the next scan. New people and people with no usable money are checked on the next pass; existing money is checked daily. A saved completion flag does not hide a missing cycle fact. A failed daily source check stays due on the next hour while the last verified totals remain available. Current officeholders run first, and source publications run newest cycle first. Other years from 2020 follow. A source without a verified committee, candidate, office and cycle binding stays open work without loading unrelated money into the reader store.

Bulk files stream to the evidence vault by content hash. The state's cached file is shared by subsequent people; its directory uses the database identity so a software checkout change does not discard the cache. Provider release versions, ETags and Last-Modified checks detect updates. The parser filters against the run's people before filling one publication batch of at most 500 matched rows and two MiB. Native input counts remain separate from selected rows, so filtering cannot disguise truncated API responses. Source-native transaction IDs are retained. Where no filer ID is published, committee identity includes the filed committee name, candidate, office and election year. Kentucky's native Location column supplies ordinal districts; a broad government ID cannot override a different filed district. Unmatched source evidence stays vaulted and the person's blank remains open. A native filing correction rebuilds its former and current owners; a committee's filed name stays attached to its cycle. Missing amounts are retained only within the same committee identity.

Facts are filed in the shared state-then-place `entity`, `entity_place` and `fact` store. The campaign artifact and pointer path is gone. Database reads select the run's people, committees and record IDs; no query returns the state's complete money collection. Old amounts are fetched only for missing source amounts. Cycle rebuilding runs in the database for the touched people, and readers fetch one person's cycle totals with at most 100 named contributors per page. The hourly coordinator retains counts and reasons, not state financial rows. Source-door status uses the configured control-plane database; money facts use the reader database. No shared database client or runner-admission code is changed.

Government, official and candidate cards and Ask read those same person-bound cycle facts. Readers get totals by cycle, each filed committee and its office, named organizations, and individual donors whose filed cycle total exceeds $200. Individuals at $200 or less and home addresses never reach either reader response. The small-donor percentage is shown only when the source supplies its own small and large individual lines at the $200 threshold; otherwise that field remains open work. Sources link the financial capture and the filing at the bottom of the card, with publication and check dates. The obsolete Pima body-to-committee transaction reader is deleted; its held evidence remains available for a future verified person binding.

Production verification uses only the `readonly` role and rows or counts needed by the check. Publisher writes use full reader and control-plane production copies. The harness checks both declared Neon branch IDs before writes. No production facts are hand edited. Wire payload bytes, storage growth, worker peaks and reader timings are measured separately.

## Campaign publication checks

All 56 places ran serially against the verified read-only production people projection and separate reader/control-plane production copies built by the real migrations. The first pass read 18,221 published people, found money for 689, and processed 270,161 matched rows or held summaries. It left 1,406,876 observed unmatched rows in saved source evidence. The next-hour pass preserved the money and processed 83,106 matched confirmations, including retries after partial source failures. Processed rows include unchanged confirmations; they are not counts of new database inserts. These are copy checks; the person publisher is not yet deployed.

| State | Official source | Access | Published people | People with money | Matched rows | Unmatched rows observed | Peak MiB |
|---|---|---|---:|---:|---:|---|---:|
| AL | [Alabama Secretary of State](https://www.sos.alabama.gov/alabama-votes/media/campaign-finance-reports) | BULK | 295 | 0 | 0 | Not read | 138.1 |
| AK | [Alaska Public Offices Commission](https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDIncome.aspx) | UNCONFIRMED | 197 | 0 | 0 | Not read | 133.0 |
| AZ | [Arizona Secretary of State](https://azsos.gov/elections/campaign-finance-reporting) | API | 386 | 26 | 26 | 0 | 146.9 |
| AR | [Arkansas Secretary of State](https://financial-disclosures.sos.arkansas.gov/) | UNCONFIRMED | 173 | 0 | 0 | Not read | 137.9 |
| CA | [California Secretary of State](https://www.sos.ca.gov/campaign-lobbying/cal-access-resources/raw-data-campaign-finance-and-lobbying-activity) | BULK | 484 | 0 | 0 | Not read | 133.5 |
| CO | [Colorado Secretary of State](https://tracer.sos.colorado.gov/PublicSite/DataDownload.aspx) | BULK | 331 | 0 | 0 | Not read | 160.5 |
| CT | [Connecticut State Elections Enforcement Commission](https://seec.ct.gov/Portal/eCRIS/eCrisSearch) | BULK | 457 | 175 | 83,060 | 240,037 | 184.2 |
| DE | [Delaware Department of Elections](https://cfrs.elections.delaware.gov/) | UNCONFIRMED | 151 | 0 | 0 | Not read | 137.9 |
| DC | [District of Columbia Office of Campaign Finance](https://efiling.ocf.dc.gov/DataDownload) | BULK_API | 64 | 0 | 0 | Not read | 160.6 |
| FL | [Florida Division of Elections](https://dos.elections.myflorida.com/campaign-finance/contributions/) | BULK | 504 | 0 | 0 | Not read | 166.5 |
| GA | [Georgia State Ethics Commission](https://ethics.ga.gov/) | UNCONFIRMED | 567 | 0 | 0 | Not read | 140.5 |
| HI | [Hawaii Campaign Spending Commission](https://hicscdata.hawaii.gov/) | API | 179 | 24 | 27,813 | 143,916 | 182.4 |
| ID | [Idaho Secretary of State](https://sunshine.sos.idaho.gov/) | API | 324 | 0 | 0 | Unknown | 137.8 |
| IL | [Illinois State Board of Elections](https://www.elections.il.gov/CampaignDisclosure/DownloadData.aspx) | BULK | 436 | 0 | 0 | Not read | 138.9 |
| IN | [Indiana Election Division](https://cfa.in.gov/) | UNCONFIRMED | 369 | 0 | 0 | Not read | 137.9 |
| IA | [Iowa Ethics and Campaign Disclosure Board](https://data.iowa.gov/catalog/dataset/917) | API | 333 | 0 | 0 | Not read | 134.5 |
| KS | [Kansas Public Disclosure Commission](https://kpdc.kansas.gov/campaign-finance/campaign-contributor-data/) | UNCONFIRMED | 430 | 0 | 0 | Not read | 133.4 |
| KY | [Kentucky Registry of Election Finance](https://secure.kentucky.gov/kref/publicsearch/CandidateSearch/) | BULK_API | 296 | 117 | 74,771 | 343,500 | 206.8 |
| LA | [Louisiana Board of Ethics](https://ethics.la.gov/CampaignFinanceSearch/) | BULK | 198 | 0 | 0 | Not read | 136.5 |
| ME | [Maine Commission on Governmental Ethics and Election Practices](https://www.mainecampaignfinance.com/) | UNCONFIRMED | 541 | 0 | 0 | Not read | 138.2 |
| MD | [Maryland State Board of Elections](https://campaignfinance.maryland.gov/) | BULK | 440 | 0 | 0 | Not read | 135.5 |
| MA | [Massachusetts Office of Campaign and Political Finance](https://ocpf.us/Data/Downloads) | BULK_API | 509 | 0 | 0 | Not read | 140.0 |
| MI | [Michigan Department of State](https://www.michigan.gov/sos/elections/Disclosure/cfr/committee-search/intro/welcome-to-the-michigan-campaign-finance-searchable-database) | BULK | 619 | 0 | 0 | Not read | 138.3 |
| MN | [Minnesota Campaign Finance and Public Disclosure Board](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/) | BULK | 526 | 0 | 0 | Not read | 135.6 |
| MS | [Mississippi Secretary of State](https://cfportal.sos.ms.gov/) | API | 203 | 0 | 0 | Not read | 138.5 |
| MO | [Missouri Ethics Commission](https://www.mec.mo.gov/MEC/Campaign_Finance/CF_ContrCSV.aspx) | BULK | 480 | 0 | 0 | Not read | 136.2 |
| MT | [Montana Commissioner of Political Practices](https://cers-ext.mt.gov/CampaignTracker/dashboard) | UNCONFIRMED | 352 | 0 | 0 | Not read | 139.2 |
| NE | [Nebraska Accountability and Disclosure Commission](https://nadc-e.nebraska.gov/) | BULK | 152 | 0 | 0 | Not read | 135.5 |
| NV | [Nevada Secretary of State](https://www.nvsos.gov/SOSCandidateServices/AnonymousAccess/CEFDSearchUU.aspx) | UNCONFIRMED | 184 | 0 | 0 | Not read | 136.1 |
| NH | [New Hampshire Secretary of State](https://cfs.sos.nh.gov/) | API | 465 | 4 | 4 | Unknown | 139.8 |
| NJ | [New Jersey Election Law Enforcement Commission](https://www.elec.nj.gov/) | API | 561 | 14 | 16 | 0 | 141.7 |
| NM | [New Mexico Secretary of State](https://cfis.sos.nm.gov/) | BULK_API | 241 | 0 | 0 | Not read | 138.9 |
| NY | [New York State Board of Elections](https://data.ny.gov/Government-Finance/Campaign-Finance-Disclosure-Reports-Data-Beginning/e9ss-239a) | BULK_API | 638 | 0 | 0 | Not read | 139.0 |
| NC | [North Carolina State Board of Elections](https://www.ncsbe.gov/campaign-finance/search-campaign-funding-and-spending-reports-and-penalties) | UNCONFIRMED | 561 | 0 | 0 | Not read | 140.1 |
| ND | [North Dakota Secretary of State](https://www.sos.nd.gov/elections/campaign-finance-statement-interests/search-reports) | UNCONFIRMED | 255 | 0 | 0 | Not read | 137.8 |
| OH | [Ohio Secretary of State](https://www.ohiosos.gov/elections/campaign-finance) | BULK | 187 | 0 | 0 | Not read | 137.5 |
| OK | [Oklahoma Ethics Commission](https://guardian.ok.gov/PublicSite/) | BULK | 300 | 0 | 0 | Not read | 139.4 |
| OR | [Oregon Secretary of State](https://sos.oregon.gov/elections/campaign-finance/pages/search-campaign-finance.aspx) | UNCONFIRMED | 233 | 0 | 0 | Not read | 133.0 |
| PA | [Pennsylvania Department of State](https://www.campaignfinanceonline.pa.gov/Pages/CampaignFinanceHome.aspx) | BULK | 361 | 0 | 0 | Not read | 138.7 |
| RI | [Rhode Island Board of Elections](https://www.ricampaignfinance.com/) | UNCONFIRMED | 280 | 0 | 0 | Not read | 132.8 |
| SC | [South Carolina State Ethics Commission](https://ethicsfiling.sc.gov/filing/home) | API | 378 | 175 | 84,050 | 654,051 | 170.4 |
| SD | [South Dakota Secretary of State](https://sdcfr.sdsos.gov/) | UNCONFIRMED | 237 | 0 | 0 | Not read | 133.6 |
| TN | [Tennessee Registry of Election Finance](https://apps.tn.gov/tncamp/) | UNCONFIRMED | 413 | 0 | 0 | Not read | 137.3 |
| TX | [Texas Ethics Commission](https://www.ethics.state.tx.us/search/cf/) | BULK | 611 | 0 | 0 | Not read | 140.2 |
| UT | [Utah Lieutenant Governor](https://disclosures.utah.gov/) | BULK | 352 | 0 | 0 | Not read | 138.9 |
| VT | [Vermont Secretary of State](https://campaignfinance.vermont.gov/) | BULK_API | 504 | 0 | 0 | Unknown | 149.8 |
| VA | [Virginia Department of Elections](https://www.elections.virginia.gov/candidatepac-info/reporting/) | BULK | 203 | 0 | 0 | Not read | 139.0 |
| WA | [Washington Public Disclosure Commission](https://www.pdc.wa.gov/) | API | 441 | 154 | 421 | 25,372 | 151.4 |
| WV | [West Virginia Secretary of State](https://cfrs.wvsos.gov/) | UNCONFIRMED | 383 | 0 | 0 | Not read | 139.2 |
| WI | [Wisconsin Ethics Commission](https://campaignfinance.wi.gov/browse-data) | API | 155 | 0 | 0 | Not read | 132.8 |
| WY | [Wyoming Secretary of State](https://www.wycampaignfinance.gov/) | UNCONFIRMED | 199 | 0 | 0 | Not read | 137.1 |
| AS | [American Samoa Election Office](https://aselectionoffice.gov/) | UNCONFIRMED | 0 | 0 | 0 | Not read | 132.6 |
| GU | [Guam Election Commission](https://gec.guam.gov/) | UNCONFIRMED | 0 | 0 | 0 | Not read | 136.2 |
| MP | [Commonwealth Election Commission](https://www.votecnmi.gov.mp/) | UNCONFIRMED | 0 | 0 | 0 | Not read | 136.0 |
| PR | [Puerto Rico Office of the Electoral Comptroller](https://oce.pr.gov/) | API | 83 | 0 | 0 | Not read | 135.9 |
| VI | [Elections System of the Virgin Islands](https://vivote.gov/) | UNCONFIRMED | 0 | 0 | 0 | Not read | 134.2 |

Access describes the official source, not a completed binding. Live native person/committee/office/cycle publication is connected for CT, HI, KY, SC and WA; verified held AZ, NH and NJ summaries also publish. Remaining bindings and local coverage are later SRC-MN pieces. “Not read” and “Unknown” are not claims that a source has no unmatched rows. Places with no published people acquire no money. The held Pima source remains unchanged; a verified person binding is still open.

Observed unmatched rows and source failures:

- CT: 197,152 — The filed person, office or district does not uniquely match a person we publish; 39,980 — The source does not bind a filed committee, candidate and office; 4 — SourceAcquisitionFailure(PUBLISHER_DOCUMENT_INVALID): Campaign export columns are missing or repeated.; 2,905 — The filing predates January 1, 2020.
- HI: 143,916 — The filed person, office or district does not uniquely match a person we publish.
- ID: 4 — SourceAcquisitionFailure(PUBLISHER_UNAVAILABLE): The campaign-finance publisher returned HTTP 404..
- KY: 339,636 — The filed person, office or district does not uniquely match a person we publish; 3,864 — The filing predates January 1, 2020.
- NH: 2 — SourceAcquisitionFailure(PUBLISHER_UNAVAILABLE): The campaign-finance publisher returned HTTP 403..
- SC: 427,668 — The filed person, office or district does not uniquely match a person we publish; 25 — The source does not bind a filed committee, candidate and office; 226,358 — The source has no mapped election cycle.
- VT: 4 — SourceAcquisitionFailure(PUBLISHER_DOCUMENT_INVALID): The campaign API response is truncated or exceeds its denominator..
- WA: 4,917 — The source does not bind a filed committee, candidate and office; 5,343 — The filed person, office or district does not uniquely match a person we publish; 15,112 — The source has not established a filed financial report.

The largest real source response was South Carolina contributions, 197,906,018 bytes. All inputs stream, with one matched batch of at most 500 rows/two MiB, one metadata page, and SQLite identity indexes with a one MiB page cache. Each worker holds only its state's people and current batch. No disconnected source was tested at full volume and no generated campaign money was substituted.

The first pass took 1290.8 worker-seconds; the next-hour pass took 554.2. State children use 112 MiB old-generation and four MiB semi-spaces. Their observed peak was 216,842,240 bytes. The unchanged runtime coordinator's measured active footprint is 81,842,176 bytes, giving 298,684,416 bytes (284.8 MiB) combined. Its separate publication phase, after state workers exit, peaked at 264,347,648 bytes. After the runner's 0.75 GiB margin, 26 observed copies fit on eight GiB, or 15 alongside the 2,928 MiB research-parent reservation. The existing 384 MiB reservation permits 19 / 11 copies; actual money work runs one state at a time. Shared admission and database clients are unchanged.

Bytes are SQL response/request payloads, not physical page IO or WAL. Reader reads include the production people/source projection and copy publisher/reader responses. The first pass includes initial fact creation. The day model is one measured first pass plus 23 measured next-hour passes, with unchanged source data and no new people, plus 288 clock scans and coordinator reports. It is a modeled first-fill day, not an observed steady 24-hour run; a later full daily recheck can return more predecessor fingerprints than the initial empty store. Storage growth is reported separately.

| State | First reader read bytes | First reader sent bytes | Next-hour read bytes | Next-hour sent bytes | Modeled day read bytes | Modeled day sent bytes |
|---|---:|---:|---:|---:|---:|---:|
| AL | 378,214 | 360,089 | 424,817 | 360,089 | 10,149,005 | 8,642,136 |
| AK | 175,338 | 233,471 | 206,459 | 233,471 | 4,923,895 | 5,603,304 |
| AZ | 759,730 | 531,254 | 759,730 | 531,254 | 18,233,520 | 12,750,096 |
| AR | 220,189 | 240,497 | 247,517 | 240,497 | 5,913,080 | 5,771,928 |
| CA | 524,360 | 610,329 | 600,825 | 610,329 | 14,343,335 | 14,647,896 |
| CO | 345,613 | 414,417 | 397,905 | 414,417 | 9,497,428 | 9,946,008 |
| CT | 18,079,552 | 272,786,253 | 47,864,781 | 15,518,637 | 1,118,969,515 | 629,714,904 |
| DE | 425,692 | 232,069 | 449,545 | 232,069 | 10,765,227 | 5,569,656 |
| DC | 71,284 | 100,519 | 81,392 | 100,519 | 1,943,300 | 2,412,456 |
| FL | 949,069 | 575,597 | 1,029,798 | 575,597 | 24,634,423 | 13,814,328 |
| GA | 671,800 | 668,813 | 761,376 | 668,813 | 18,183,448 | 16,051,512 |
| HI | 5,241,896 | 88,692,132 | 591,410 | 232,863 | 18,844,326 | 94,047,981 |
| ID | 486,016 | 413,922 | 536,739 | 413,831 | 12,831,013 | 9,932,035 |
| IL | 449,278 | 481,512 | 518,159 | 481,512 | 12,366,935 | 11,556,288 |
| IN | 420,850 | 453,472 | 479,145 | 453,472 | 11,441,185 | 10,883,328 |
| IA | 429,781 | 441,221 | 482,389 | 441,221 | 11,524,728 | 10,589,304 |
| KS | 426,642 | 511,164 | 494,575 | 511,164 | 11,801,867 | 12,267,936 |
| KY | 19,048,524 | 242,996,104 | 380,311 | 417,794 | 27,795,677 | 252,605,366 |
| LA | 237,575 | 240,545 | 268,853 | 240,545 | 6,421,194 | 5,773,080 |
| ME | 470,373 | 482,108 | 555,842 | 482,108 | 13,254,739 | 11,570,592 |
| MD | 494,556 | 519,322 | 564,069 | 519,322 | 13,468,143 | 12,463,728 |
| MA | 527,367 | 590,280 | 607,781 | 590,280 | 14,506,330 | 14,166,720 |
| MI | 578,812 | 663,907 | 676,603 | 663,907 | 16,140,681 | 15,933,768 |
| MN | 515,437 | 497,427 | 598,536 | 497,427 | 14,281,765 | 11,938,248 |
| MS | 251,823 | 261,015 | 283,891 | 261,015 | 6,781,316 | 6,264,360 |
| MO | 466,272 | 454,796 | 542,105 | 454,796 | 12,934,687 | 10,915,104 |
| MT | 395,239 | 432,856 | 450,849 | 432,856 | 10,764,766 | 10,388,544 |
| NE | 164,294 | 204,116 | 188,305 | 204,116 | 4,495,309 | 4,898,784 |
| NV | 210,000 | 227,497 | 239,067 | 227,497 | 5,708,541 | 5,459,928 |
| NH | 592,170 | 587,367 | 666,050 | 587,367 | 15,911,320 | 14,096,808 |
| NJ | 1,255,616 | 858,165 | 1,346,706 | 858,165 | 32,229,854 | 20,595,960 |
| NM | 267,993 | 323,429 | 306,065 | 323,429 | 7,307,488 | 7,762,296 |
| NY | 620,648 | 684,989 | 721,441 | 684,989 | 17,213,791 | 16,439,736 |
| NC | 567,406 | 683,868 | 656,034 | 683,868 | 15,656,188 | 16,412,832 |
| ND | 300,612 | 332,209 | 340,897 | 332,209 | 8,141,243 | 7,973,016 |
| OH | 226,793 | 238,309 | 256,333 | 238,309 | 6,122,452 | 5,719,416 |
| OK | 336,157 | 372,776 | 383,551 | 372,776 | 9,157,830 | 8,946,624 |
| OR | 266,326 | 269,736 | 303,135 | 269,736 | 7,238,431 | 6,473,664 |
| PA | 458,800 | 452,134 | 515,831 | 452,134 | 12,322,913 | 10,851,216 |
| RI | 298,233 | 377,827 | 342,467 | 377,827 | 8,174,974 | 9,067,848 |
| SC | 14,464,234 | 231,143,491 | 667,442 | 288,708 | 29,815,400 | 237,783,775 |
| SD | 265,676 | 296,169 | 303,117 | 296,169 | 7,237,367 | 7,108,056 |
| TN | 415,447 | 543,984 | 480,695 | 543,984 | 11,471,432 | 13,055,616 |
| TX | 632,390 | 728,291 | 728,917 | 728,291 | 17,397,481 | 17,478,984 |
| UT | 309,255 | 359,215 | 364,865 | 359,215 | 8,701,150 | 8,621,160 |
| VT | 527,546 | 718,667 | 607,171 | 718,667 | 14,492,479 | 17,248,008 |
| VA | 239,667 | 254,423 | 271,735 | 254,423 | 6,489,572 | 6,106,152 |
| WA | 524,712 | 2,009,508 | 497,636 | 365,891 | 11,970,340 | 10,425,001 |
| WV | 367,705 | 425,243 | 428,213 | 425,243 | 10,216,604 | 10,205,832 |
| WI | 200,687 | 212,278 | 225,171 | 212,278 | 5,379,620 | 5,094,672 |
| WY | 229,730 | 256,448 | 261,167 | 256,448 | 6,236,571 | 6,154,752 |
| AS | 3,493 | 12,339 | 3,493 | 12,339 | 83,832 | 296,136 |
| GU | 3,493 | 12,339 | 3,493 | 12,339 | 83,832 | 296,136 |
| MP | 3,493 | 12,339 | 3,493 | 12,339 | 83,832 | 296,136 |
| PR | 114,323 | 118,848 | 127,432 | 118,848 | 3,045,259 | 2,852,352 |
| VI | 3,493 | 12,339 | 3,493 | 12,339 | 83,832 | 296,136 |

Complete first-pass reader response/request bytes: 76,986,692 / 857,648,745. Complete next-hour bytes: 72,185,198 / 36,845,898. Modeled day: 1,759,812,702 / 1,714,593,087. The 56 actual sequential clock reads use 31,156 / 6,231 bytes. Coordinator publication uses 42,797 / 28,915 for the first report, 54,160 / 29,754 for the hourly report and 54,323 / 29,711 for a clock-only report.

Control-plane response/request bytes are 322,097 / 267,535 for the first pass and 316,987 / 224,467 for the next hour; modeled day 7,612,798 / 5,430,276. Copy database growth was 1,015,554,048 bytes initially and 12,132,352 next hour. Production writes were zero.

| State | Campaign API ms | Government money reader ms | Person funding API ms | Reader sees |
|---|---:|---:|---:|---|
| DC | 106.4 | 120.0 | 102.4 | We're working on getting this info. |
| FL | 86.8 | 131.7 | 80.0 | We're working on getting this info. |
| CO | 62.7 | 77.0 | 56.9 | We're working on getting this info. |
| AZ | 130.6 | 140.2 | 134.3 | Clara Pratte's 2026 totals, filed committee and Sources; donor details remain open. |

These handler timings use actual production-copy facts and source people; they exclude the CDN and browser shell. The browser's real Clara Pratte Battlecard money section was usable in 1,046 ms, and Ask returned the same official filing in 513 ms.

A fresh database on the production-copy branch applied the complete real migration journal, then published one real Washington officeholder and a second on the next controlled hour. The second run worked exactly one person, increased people with money from one to two, loaded two source rows, and made zero bulk downloads. It used the saved official source body and its saved release metadata to hold the publisher version unchanged. An earlier live version of this test found the new person but its zero-request assertion failed while the publisher release version changed; that failure is preserved, not reported as a cache success.

Changed money reader tests use the full real migrations. Fixture checks cover a stale completion flag with missing money, committee renames, filing ownership corrections, undated held reports, refund threshold changes, partial updates retaining older filing citations, per-state clocks and failed daily source checks. Older failed measurements remain in local logs; the tables above replace the obsolete private-schema measurements.

## Replaced campaign load retirement

The committed contract migration `0045_src_mn_retire_campaign_load`, shipped through River's normal release, has now applied in production. The October 20 1:17 PM Eastern expanded count-only audit read 63,214 bytes and found zero old-load facts of any entity kind or status, zero old publications, zero candidate copies, zero associated events, zero flags and zero old checkpoints in every one of the 56 places. The initial post-apply audit read 39,078 bytes and the retained-source hash check read 909 bytes. AZ, NH, NJ and Pima held source payloads are byte-for-byte unchanged. Source files and source-copy evidence remain; the migration deletes neither.

| Store | Old-load rows remaining in production |
|---|---:|
| Facts, all versions and live | 0 |
| Published source records | 0 |
| Candidate copies | 0 |
| Candidate events | 0 |
| Owner flags attached to those facts | 0 |
| Old source checkpoints | 0 |

Before retirement, the scoped all-56 inventory held 1,707,787 old facts, 4,322 publications and 21,109 candidate copies. The corrected producer uses `campaign-person-money:<state>:<resource>` and the retired producer used `campaign-finance:<state>:<resource>`. No database columns are added. No production SQL was hand applied and no production write credential was used by this session. Production removal ran after deployment, as Sean approved.

Retained earlier checks metered 178,666,596 production response bytes through 11:37 AM Eastern. The current real-copy runs add 21,319,168 read-only production bytes each for first and next-hour passes, plus their 468-byte controller guards. Including subsequent count audits, retention hashes and marker checks, the known measured total before final gates is 221,413,217 bytes. Final gate bytes are added in the READY commit. Earlier interrupted probes did not all retain byte counters, so an exact entire-session total is unknown; this is reported as a known measured total, not an invented complete total.

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

## Production-copy preservation checks

The money reader and retirement tests apply every committed journal migration in order in a fresh PostgreSQL database. Fixtures publish candidates, validation receipts, events and source pointers under the real production constraints. The acceptance script uses separate full reader and control-plane production copies and checks their declared branch IDs before writes. It creates no authority tables, views or private-schema substitutes. The production handle remains read-only.

The preservation baseline is shipped main 65 (`55ec164bd`). Live `/api/build` then reported shipped main 66 (`ed0ac299c`); the only code change between those releases is in `scripts/freshness-shadow.mts`, so their reader and Admin implementations are identical. Main 66 is merged into SRC-MN. No unshipped lane commit was merged.

On the real copies, baseline and candidate return the same 236 meeting identities, titles, times and sources; all 14 statewide holder identities, names, offices and sources; all 22 ballot contests; every official polling-place link; and the same sourced Katie Hobbs governor answer, contacts and gaps. Admin's pulse keeps the same sections, actions, counts and unavailable readings. Its Now response keeps the same jobs, running counts, waiting work, next work and gaps. Candidate response times were 909 ms for meetings, 467 ms for officials, 512 ms for ballot scope, 464 ms for voting links, 146 ms for Ask and 785 ms for Now's workers response.

A browser opened Clara Pratte's actual ballot Battlecard against the copy. Her 2026 cycle shows receipts of $165,197.31 and expenditures of $164,805.83, with the filed committee name. Opening the usable money section took 1,046 ms. Ask returned the same official filing in 513 ms. The filing URL appears in the containing ballot card's single Sources footer.

Existing behavior outside SRC-MN was left unchanged: nested Battlecards inherit the containing card's Sources instead of displaying a footer inside the modal (`components/ui/card-source-context.tsx` and `components/ui/card.tsx`). Full Now-page browser checks took 9.23 seconds for the baseline and 8.82 seconds for the candidate, and each accumulated about 195 MB of control-plane responses. Both showed existing unavailable results and link-health reads. These are not claimed as passing a three-second page test. The shared `tests/helpers/fact-db.ts` also contains fabricated authority tables in its edge helper; SRC-MN's changed tests no longer use it.

The normal migration applier failed on the reader production copy with HTTP 503 connection termination and no committed receipt, first at a 0.25 CU cap and again with production's 0.25–8 CU range. Increasing capacity did not resolve the failure. Both failed measurements are preserved. The production runner subsequently applied the released migration through the normal path; the expanded audit above proves its zero result. The copy HTTP failures remain failed measurements, not deletion successes.
