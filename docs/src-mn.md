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

Production verification uses only the `readonly` role and rows or counts needed by the check. Publisher writes are exercised in an isolated schema on a different existing database branch. The harness checks both actual Neon branch IDs before creating anything. No production facts are hand edited. Wire payload bytes, storage growth, worker peaks and reader timings are measured separately.

## Campaign publication checks

The shipping configuration ran against the production people projection for all 56 places, with the verified readonly role. Financial and source-door writes used separate reader/control connections and isolated schemas on a different existing database branch. The daily-due pass checked 18,221 published people, found money for 689, processed 270,161 matched filings or held summaries and retained 1,406,873 unmatched rows in saved source evidence. Matched daily rows include unchanged confirmations; they are not all newly inserted facts. The controlled next-hour pass retained the money and retried missing people and failed daily checks; it processed 83,106 matched rows, including unchanged confirmations. These are branch checks using production data; they do not claim the branch is deployed.

| State | Official source | Access | Published people | People with money | Matched rows | Unmatched rows seen | Shipping peak MiB |
|---|---|---|---:|---:|---:|---:|---:|
| AL | [Alabama Secretary of State](https://www.sos.alabama.gov/alabama-votes/media/campaign-finance-reports) | BULK | 295 | 0 | 0 | 0 | 140.1 |
| AK | [Alaska Public Offices Commission](https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDIncome.aspx) | UNCONFIRMED | 197 | 0 | 0 | 0 | 138.5 |
| AZ | [Arizona Secretary of State](https://azsos.gov/elections/campaign-finance-reporting) | API | 386 | 26 | 26 | 0 | 163.3 |
| AR | [Arkansas Secretary of State](https://financial-disclosures.sos.arkansas.gov/) | UNCONFIRMED | 173 | 0 | 0 | 0 | 137.8 |
| CA | [California Secretary of State](https://www.sos.ca.gov/campaign-lobbying/cal-access-resources/raw-data-campaign-finance-and-lobbying-activity) | BULK | 484 | 0 | 0 | 0 | 142.5 |
| CO | [Colorado Secretary of State](https://tracer.sos.colorado.gov/PublicSite/DataDownload.aspx) | BULK | 331 | 0 | 0 | 0 | 165.1 |
| CT | [Connecticut State Elections Enforcement Commission](https://seec.ct.gov/Portal/eCRIS/eCrisSearch) | BULK | 457 | 175 | 83,060 | 240,037 | 178.7 |
| DE | [Delaware Department of Elections](https://cfrs.elections.delaware.gov/) | UNCONFIRMED | 151 | 0 | 0 | 0 | 138.6 |
| DC | [District of Columbia Office of Campaign Finance](https://efiling.ocf.dc.gov/DataDownload) | BULK_API | 64 | 0 | 0 | 0 | 165.3 |
| FL | [Florida Division of Elections](https://dos.elections.myflorida.com/campaign-finance/contributions/) | BULK | 504 | 0 | 0 | 0 | 165.2 |
| GA | [Georgia State Ethics Commission](https://ethics.ga.gov/) | UNCONFIRMED | 567 | 0 | 0 | 0 | 142.3 |
| HI | [Hawaii Campaign Spending Commission](https://hicscdata.hawaii.gov/) | API | 179 | 24 | 27,813 | 143,916 | 167.0 |
| ID | [Idaho Secretary of State](https://sunshine.sos.idaho.gov/) | API | 324 | 0 | 0 | 0 | 142.7 |
| IL | [Illinois State Board of Elections](https://www.elections.il.gov/CampaignDisclosure/DownloadData.aspx) | BULK | 436 | 0 | 0 | 0 | 141.2 |
| IN | [Indiana Election Division](https://cfa.in.gov/) | UNCONFIRMED | 369 | 0 | 0 | 0 | 140.3 |
| IA | [Iowa Ethics and Campaign Disclosure Board](https://data.iowa.gov/catalog/dataset/917) | API | 333 | 0 | 0 | 0 | 140.7 |
| KS | [Kansas Public Disclosure Commission](https://kpdc.kansas.gov/campaign-finance/campaign-contributor-data/) | UNCONFIRMED | 430 | 0 | 0 | 0 | 140.1 |
| KY | [Kentucky Registry of Election Finance](https://secure.kentucky.gov/kref/publicsearch/CandidateSearch/) | BULK_API | 296 | 117 | 74,771 | 343,500 | 209.7 |
| LA | [Louisiana Board of Ethics](https://ethics.la.gov/CampaignFinanceSearch/) | BULK | 198 | 0 | 0 | 0 | 139.2 |
| ME | [Maine Commission on Governmental Ethics and Election Practices](https://www.mainecampaignfinance.com/) | UNCONFIRMED | 541 | 0 | 0 | 0 | 140.3 |
| MD | [Maryland State Board of Elections](https://campaignfinance.maryland.gov/) | BULK | 440 | 0 | 0 | 0 | 140.3 |
| MA | [Massachusetts Office of Campaign and Political Finance](https://ocpf.us/Data/Downloads) | BULK_API | 509 | 0 | 0 | 0 | 141.6 |
| MI | [Michigan Department of State](https://www.michigan.gov/sos/elections/Disclosure/cfr/committee-search/intro/welcome-to-the-michigan-campaign-finance-searchable-database) | BULK | 619 | 0 | 0 | 0 | 141.9 |
| MN | [Minnesota Campaign Finance and Public Disclosure Board](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/) | BULK | 526 | 0 | 0 | 0 | 140.9 |
| MS | [Mississippi Secretary of State](https://cfportal.sos.ms.gov/) | API | 203 | 0 | 0 | 0 | 136.8 |
| MO | [Missouri Ethics Commission](https://www.mec.mo.gov/MEC/Campaign_Finance/CF_ContrCSV.aspx) | BULK | 480 | 0 | 0 | 0 | 140.7 |
| MT | [Montana Commissioner of Political Practices](https://cers-ext.mt.gov/CampaignTracker/dashboard) | UNCONFIRMED | 352 | 0 | 0 | 0 | 139.2 |
| NE | [Nebraska Accountability and Disclosure Commission](https://nadc-e.nebraska.gov/) | BULK | 152 | 0 | 0 | 0 | 138.3 |
| NV | [Nevada Secretary of State](https://www.nvsos.gov/SOSCandidateServices/AnonymousAccess/CEFDSearchUU.aspx) | UNCONFIRMED | 184 | 0 | 0 | 0 | 138.6 |
| NH | [New Hampshire Secretary of State](https://cfs.sos.nh.gov/) | API | 465 | 4 | 4 | 0 | 143.0 |
| NJ | [New Jersey Election Law Enforcement Commission](https://www.elec.nj.gov/) | API | 561 | 14 | 16 | 0 | 143.6 |
| NM | [New Mexico Secretary of State](https://cfis.sos.nm.gov/) | BULK_API | 241 | 0 | 0 | 0 | 139.4 |
| NY | [New York State Board of Elections](https://data.ny.gov/Government-Finance/Campaign-Finance-Disclosure-Reports-Data-Beginning/e9ss-239a) | BULK_API | 638 | 0 | 0 | 0 | 142.8 |
| NC | [North Carolina State Board of Elections](https://www.ncsbe.gov/campaign-finance/search-campaign-funding-and-spending-reports-and-penalties) | UNCONFIRMED | 561 | 0 | 0 | 0 | 137.7 |
| ND | [North Dakota Secretary of State](https://www.sos.nd.gov/elections/campaign-finance-statement-interests/search-reports) | UNCONFIRMED | 255 | 0 | 0 | 0 | 138.0 |
| OH | [Ohio Secretary of State](https://www.ohiosos.gov/elections/campaign-finance) | BULK | 187 | 0 | 0 | 0 | 136.6 |
| OK | [Oklahoma Ethics Commission](https://guardian.ok.gov/PublicSite/) | BULK | 300 | 0 | 0 | 0 | 138.8 |
| OR | [Oregon Secretary of State](https://sos.oregon.gov/elections/campaign-finance/pages/search-campaign-finance.aspx) | UNCONFIRMED | 233 | 0 | 0 | 0 | 139.0 |
| PA | [Pennsylvania Department of State](https://www.campaignfinanceonline.pa.gov/Pages/CampaignFinanceHome.aspx) | BULK | 361 | 0 | 0 | 0 | 136.9 |
| RI | [Rhode Island Board of Elections](https://www.ricampaignfinance.com/) | UNCONFIRMED | 280 | 0 | 0 | 0 | 138.1 |
| SC | [South Carolina State Ethics Commission](https://ethicsfiling.sc.gov/filing/home) | API | 378 | 175 | 84,050 | 654,051 | 168.2 |
| SD | [South Dakota Secretary of State](https://sdcfr.sdsos.gov/) | UNCONFIRMED | 237 | 0 | 0 | 0 | 134.5 |
| TN | [Tennessee Registry of Election Finance](https://apps.tn.gov/tncamp/) | UNCONFIRMED | 413 | 0 | 0 | 0 | 139.2 |
| TX | [Texas Ethics Commission](https://www.ethics.state.tx.us/search/cf/) | BULK | 611 | 0 | 0 | 0 | 137.3 |
| UT | [Utah Lieutenant Governor](https://disclosures.utah.gov/) | BULK | 352 | 0 | 0 | 0 | 139.2 |
| VT | [Vermont Secretary of State](https://campaignfinance.vermont.gov/) | BULK_API | 504 | 0 | 0 | 0 | 151.9 |
| VA | [Virginia Department of Elections](https://www.elections.virginia.gov/candidatepac-info/reporting/) | BULK | 203 | 0 | 0 | 0 | 137.2 |
| WA | [Washington Public Disclosure Commission](https://www.pdc.wa.gov/) | API | 441 | 154 | 421 | 25,369 | 160.5 |
| WV | [West Virginia Secretary of State](https://cfrs.wvsos.gov/) | UNCONFIRMED | 383 | 0 | 0 | 0 | 140.8 |
| WI | [Wisconsin Ethics Commission](https://campaignfinance.wi.gov/browse-data) | API | 155 | 0 | 0 | 0 | 138.1 |
| WY | [Wyoming Secretary of State](https://www.wycampaignfinance.gov/) | UNCONFIRMED | 199 | 0 | 0 | 0 | 137.9 |
| AS | [American Samoa Election Office](https://aselectionoffice.gov/) | UNCONFIRMED | 0 | 0 | 0 | 0 | 137.6 |
| GU | [Guam Election Commission](https://gec.guam.gov/) | UNCONFIRMED | 0 | 0 | 0 | 0 | 138.2 |
| MP | [Commonwealth Election Commission](https://www.votecnmi.gov.mp/) | UNCONFIRMED | 0 | 0 | 0 | 0 | 137.3 |
| PR | [Puerto Rico Office of the Electoral Comptroller](https://oce.pr.gov/) | API | 83 | 0 | 0 | 0 | 137.5 |
| VI | [Elections System of the Virgin Islands](https://vivote.gov/) | UNCONFIRMED | 0 | 0 | 0 | 0 | 137.8 |

Reasons are counts of observed unmatched rows or source failures; a source not parsed does not establish zero filings. Missing source bindings remain owned by SRC-MN for later connections and partial-state/local coverage.

- CT: 197,152: The filed person, office or district does not uniquely match a person we publish; 39,980: The source does not bind a filed committee, candidate and office; 4: SourceAcquisitionFailure(PUBLISHER_DOCUMENT_INVALID): Campaign export columns are missing or repeated.; 2,905: The filing predates January 1, 2020
- HI: 143,916: The filed person, office or district does not uniquely match a person we publish
- ID: 4: SourceAcquisitionFailure(PUBLISHER_UNAVAILABLE): The campaign-finance publisher returned HTTP 404.
- KY: 339,636: The filed person, office or district does not uniquely match a person we publish; 3,864: The filing predates January 1, 2020
- NH: 2: SourceAcquisitionFailure(PUBLISHER_UNAVAILABLE): The campaign-finance publisher returned HTTP 403.
- SC: 427,668: The filed person, office or district does not uniquely match a person we publish; 25: The source does not bind a filed committee, candidate and office; 226,358: The source has no mapped election cycle
- VT: 4: SourceAcquisitionFailure(PUBLISHER_DOCUMENT_INVALID): The campaign API response is truncated or exceeds its denominator.
- WA: 4,917: The source does not bind a filed committee, candidate and office; 5,343: The filed person, office or district does not uniquely match a person we publish; 15,109: The source has not established a filed financial report

Live bulk/API committee/person/office/cycle binding is not configured yet for AL, AK, AZ, AR, CA, CO, DE, DC, FL, GA, IL, IN, IA, KS, LA, ME, MD, MA, MI, MN, MS, MO, MT, NE, NV, NJ, NM, NY, NC, ND, OH, OK, OR, PA, RI, SD, TN, TX, UT, VA, WV, WI, WY, PR. Verified held sources remain usable. Places with no published people do no financial acquisition. Counts for malformed or refused source responses are unknown; their bytes remain saved and the door/work reason is recorded.

The largest real source response was South Carolina contributions, 197,906,018 bytes. Cold publication of Kentucky and South Carolina used fresh isolated stores and published 158,821 rows for 292 people. All source files stream; a matched batch contains at most 500 rows/two MiB. SQLite keeps record identities on disk with a one MiB page cache. The raw-file cache also contains files from earlier development attempts; its total is not claimed as this run's input. Cold publication of every disconnected source was not tested and no generated money was substituted.

Fresh-store publication on the final code used two separate private reader/control connections. It took 551.3 worker-seconds. Source files were reused from the evidence cache.

| Cold state | Matched rows | Reader response bytes | Reader request bytes | Control response bytes | Control request bytes | Private relation growth bytes |
|---|---:|---:|---:|---:|---:|---:|
| KY | 74,771 | 13,998,067 | 242,786,512 | 147,129 | 133,303 | 362,414,080 |
| SC | 84,050 | 14,379,970 | 231,236,225 | 14,690 | 12,615 | 407,420,928 |


Each state child runs with a 112 MiB old-generation limit and four MiB semi-spaces, producing a 124 MiB JavaScript heap limit on this host. Limiting only the old generation left a 192 MiB young generation on this host and failed cold publication at the existing reservation. Final worker peak was 219,865,088 bytes. The measured active coordinator adds 81,842,176 bytes, giving a conservative combined peak of 301,707,264 bytes (287.7 MiB); its separate late report phase previously peaked at 282,562,560 bytes after the state exited. The existing money reservation stays 384 MiB. On the documented eight GiB runner, 19 reservations fit after the 0.75 GiB margin, or 11 alongside the existing 2,928 MiB research-parent reservation. The observed combined peak fits 25 copies after that margin, or 15 alongside the research parent. Actual campaign work runs one state at a time. Shared admission and database clients are unchanged.

The daily-due pass took 1122.5 seconds across its workers; the next-hour pass, including failed daily retries, took 615.1 seconds. Source doors use the configured control-plane connection; facts use the reader connection. Each worker holds its current state's people, one input page and one matched batch. No worker holds the country's financial rows or earlier state workers.

Database bytes below are measured response and request payload bytes. Reads combine the production people/source projection with private publisher/reader responses. Sent bytes conservatively include SQL requests, private people-view setup and source-door recording; they are not WAL or physical page writes. Physical relation growth is measured separately. The compact coordinator publication is measured separately below and included in the run and day totals. Day figures are an estimate using one measured daily-due pass, 23 measured next-hour passes (including retried source failures) and at most 288 compact coordinator scans, with unchanged sources and no new people. They are not a claimed observed 24-hour run.

| State | Daily reader read bytes | Daily reader sent bytes | Next-hour reader read bytes | Next-hour reader sent bytes | Estimated day read bytes | Estimated day sent bytes |
|---|---:|---:|---:|---:|---:|---:|
| AL | 425,828 | 588,624 | 424,943 | 588,624 | 10,312,989 | 14,161,824 |
| AK | 207,176 | 363,207 | 206,585 | 363,207 | 5,072,103 | 8,751,816 |
| AZ | 758,414 | 784,921 | 759,769 | 784,921 | 18,346,861 | 18,872,952 |
| AR | 248,162 | 386,697 | 247,643 | 386,697 | 6,057,423 | 9,315,576 |
| CA | 602,403 | 962,234 | 600,951 | 962,234 | 14,537,748 | 23,128,464 |
| CO | 399,024 | 642,243 | 398,031 | 642,243 | 9,667,209 | 15,448,680 |
| CT | 47,512,009 | 15,684,967 | 47,510,640 | 15,684,631 | 1,140,438,169 | 376,466,328 |
| DE | 450,124 | 348,752 | 449,671 | 348,752 | 10,906,029 | 8,404,896 |
| DC | 81,710 | 152,664 | 81,518 | 152,664 | 2,069,520 | 3,698,784 |
| FL | 1,031,457 | 947,960 | 1,029,924 | 947,960 | 24,833,181 | 22,785,888 |
| GA | 763,203 | 1,089,063 | 761,502 | 1,089,063 | 18,391,221 | 26,172,360 |
| HI | 14,453,817 | 4,097,366 | 591,534 | 357,261 | 28,176,027 | 12,349,217 |
| ID | 537,837 | 657,961 | 537,366 | 658,146 | 13,016,199 | 15,830,167 |
| IL | 519,593 | 800,101 | 518,285 | 800,101 | 12,553,620 | 19,237,272 |
| IN | 480,378 | 722,903 | 479,271 | 722,903 | 11,617,083 | 17,384,520 |
| IA | 483,514 | 708,244 | 482,515 | 708,244 | 11,694,831 | 17,032,704 |
| KS | 495,991 | 820,015 | 494,701 | 820,015 | 11,987,586 | 19,715,208 |
| KY | 40,269,321 | 14,087,515 | 380,437 | 610,624 | 49,148,972 | 28,166,715 |
| LA | 269,573 | 404,458 | 268,979 | 404,458 | 6,569,562 | 9,741,840 |
| ME | 557,591 | 845,148 | 555,968 | 845,148 | 13,458,327 | 20,318,400 |
| MD | 565,515 | 842,258 | 564,195 | 842,258 | 13,655,472 | 20,249,040 |
| MA | 609,434 | 970,944 | 607,907 | 970,944 | 14,704,767 | 23,337,504 |
| MI | 678,586 | 1,106,648 | 676,729 | 1,106,648 | 16,356,825 | 26,594,400 |
| MN | 600,240 | 845,855 | 598,662 | 845,855 | 14,482,938 | 20,335,368 |
| MS | 284,626 | 428,053 | 284,017 | 428,053 | 6,930,489 | 10,308,120 |
| MO | 543,671 | 773,340 | 542,231 | 773,340 | 13,128,456 | 18,595,008 |
| MT | 452,031 | 687,227 | 450,975 | 687,227 | 10,937,928 | 16,528,296 |
| NE | 188,887 | 321,616 | 188,431 | 321,616 | 4,636,272 | 7,753,632 |
| NV | 239,745 | 367,941 | 239,193 | 367,941 | 5,854,656 | 8,865,432 |
| NH | 667,146 | 962,527 | 666,168 | 962,527 | 16,107,954 | 23,135,496 |
| NJ | 1,346,059 | 1,284,378 | 1,346,837 | 1,284,378 | 32,437,070 | 30,859,920 |
| NM | 306,914 | 504,973 | 306,191 | 504,973 | 7,462,779 | 12,154,200 |
| NY | 723,481 | 1,130,480 | 721,567 | 1,130,480 | 17,432,994 | 27,166,368 |
| NC | 657,843 | 1,109,756 | 656,160 | 1,109,756 | 15,862,995 | 26,668,992 |
| ND | 341,788 | 522,157 | 341,023 | 522,157 | 8,298,789 | 12,566,616 |
| OH | 257,020 | 389,286 | 256,459 | 389,286 | 6,269,049 | 9,377,712 |
| OK | 384,577 | 587,391 | 383,677 | 587,391 | 9,322,620 | 14,132,232 |
| OR | 303,960 | 441,404 | 303,261 | 441,404 | 7,392,435 | 10,628,544 |
| PA | 517,040 | 744,325 | 515,957 | 744,325 | 12,497,523 | 17,898,648 |
| RI | 343,433 | 588,350 | 342,593 | 588,350 | 8,336,544 | 14,155,248 |
| SC | 42,319,966 | 14,286,694 | 667,636 | 549,899 | 57,827,082 | 26,969,219 |
| SD | 303,954 | 462,292 | 303,243 | 462,292 | 7,392,015 | 11,129,856 |
| TN | 482,060 | 840,498 | 480,821 | 840,498 | 11,654,415 | 20,206,800 |
| TX | 730,876 | 1,138,995 | 729,043 | 1,138,995 | 17,612,337 | 27,370,728 |
| UT | 366,047 | 596,103 | 364,991 | 596,103 | 8,874,312 | 14,341,320 |
| VT | 608,809 | 1,108,463 | 607,297 | 1,108,463 | 14,701,920 | 26,637,960 |
| VA | 272,470 | 417,857 | 271,861 | 417,857 | 6,638,745 | 10,063,416 |
| WA | 701,545 | 998,932 | 493,276 | 655,200 | 12,202,413 | 16,103,380 |
| WV | 429,488 | 702,389 | 428,339 | 702,389 | 10,394,757 | 16,892,184 |
| WI | 225,762 | 343,066 | 225,297 | 343,066 | 5,521,065 | 8,268,432 |
| WY | 261,890 | 404,294 | 261,293 | 404,294 | 6,385,101 | 9,737,904 |
| AS | 3,619 | 13,045 | 3,619 | 13,045 | 175,272 | 347,928 |
| GU | 3,619 | 13,045 | 3,619 | 13,045 | 175,272 | 347,928 |
| MP | 3,619 | 13,045 | 3,619 | 13,045 | 175,272 | 347,928 |
| PR | 127,807 | 192,280 | 127,558 | 192,280 | 3,174,537 | 4,649,568 |
| VI | 3,619 | 13,045 | 3,619 | 13,045 | 175,272 | 347,928 |

Totals: daily production responses 21,319,636 bytes, private responses 146,085,736, private requests 81,248,254; next-hour production responses 21,319,636, private responses 50,429,062, private requests 49,950,580. One compact 56-state clock scan read 22,375 bytes and sent 6,776. The estimated day reads 1,840,930,783 bytes and sends 1,241,151,134 bytes, including the shared promotion receipt. Production writes were zero. Private daily relation growth was 13,901,824 bytes; next-hour growth was 2,048,000.

In a verified private schema, the actual PostgresRoutineDataStore coordinator publication read/sent 46,872/30,664 bytes for a cold daily report, 58,427/31,580 for the next hourly report and 58,601/31,557 for a clock-only pass. Including one clock scan, complete daily run read/sent bytes are 167,474,619/81,285,694; complete hourly run bytes are 71,829,500/49,988,936. The private schema adds an explicit transaction-local search-path query to each HTTP request, so that overhead is conservatively included. This report measures payload traffic; WAL and billing-side physical IO are not measured. The coordinator publication peaked at 153,276,416 bytes in a separate phase with no state child running.

Control-plane responses/requests were 348,879/257,705 bytes for the daily pass and 345,182/251,705 for the next-hour pass, or an estimated 8,288,065/6,046,920 per unchanged-source day. These bytes use a second private connection and are excluded from the reader totals above.

| State | Campaign API ms | Government money reader ms | Person funding API ms | Reader result |
|---|---:|---:|---:|---|
| DC | 86.2 | 88.4 | 83.4 | We're working on getting this info. |
| FL | 59.4 | 61.8 | 60.4 | We're working on getting this info. |
| CO | 80.8 | 59.3 | 55.4 | We're working on getting this info. |
| AZ | 140.4 | 140.0 | 137.0 | Clara Pratte's 2026 cycle totals and Sources; donor details remain open. |

These timings invoke the actual branch API handlers and money reader with production-derived people and private published facts. They exclude the deployed CDN and browser shell. Component checks cover the single Sources list and donor privacy; merged Ask route checks use the same person-cycle facts. Individual donors at $200 or less and home addresses are excluded. A small-donor share is shown only from official small/large individual lines at the $200 threshold; otherwise it remains open work.

A production-source Washington check exposed one real published person, then a second on the next controlled hourly scan. The next scan worked exactly one person, increased people with money from one to two and made zero bulk-download requests. Its measured production reads were 3,742 and 5,226 bytes. The state-start clock, failed daily checks staying due, held documents without periods, committee renames, native filing ownership corrections, a stale completion flag with missing money, refund threshold changes and a partial update retaining the older filing citation are also covered by the fixture-backed workflow.

## Replaced campaign load retirement

The contract migration `0045_src_mn_retire_campaign_load` removes every old-load fact version tagged `campaign-finance:<state>:<resource>`, its native campaign publication pointers, candidate copies and events, old checkpoints, and empty committee links/entities. Fact deletion works in 500-ID batches for one committee in one state. The corrected writer uses `campaign-person-money:<state>:<resource>` and remains separate from the retired producer. The saved source copies, raw evidence-vault files, unrelated federal money and pre-existing Arizona/New Hampshire/New Jersey/Pima source records are retained. No columns are added.

River folded cleanup READY `ba5791c5d`, numbered its migration `0045`, and released it in main 64 (`61271401d9`). The replacement cleanup READY `768c31db9` had merged River and released main 63. All eight full gates passed: 8,761 registered tests, 8,759 passing, zero failures and two skips. Sean approved releasing the cleanup first, then requiring production zeros before the Step 2 READY. The migration runs through the normal contract phase after deployment. A real PostgreSQL test verifies more than one deletion batch, both live and superseded versions, flags, candidate self/history references, preservation of other money/source evidence, and restoration of immutable-store triggers.

Before deployment, the October 20 9:46 AM Eastern read-only all-56 check found 1,707,787 facts, all live, 4,322 old publication pointers and 21,109 candidate copies. These are pre-cleanup counts. The retirement audit must return zero for every store before the people-refresh READY. The latest all-56 count-only check read 39,257 bytes. The earlier targeted 13-state check read 10,944 bytes. No financial payload was fetched for either count check. A separate 583-byte hash check confirmed the pre-existing Arizona, New Hampshire, New Jersey and Pima source payloads remain byte-for-byte unchanged.

| State | Old facts live before cleanup |
|---|---:|
| AL | 444,469 |
| CA | 3,000 |
| CO | 351,781 |
| CT | 182,214 |
| DC | 154,500 |
| FL | 127,348 |
| HI | 156,903 |
| ID | 89,000 |
| KY | 92,399 |
| LA | 49,000 |
| MD | 28,740 |
| MA | 14,188 |
| MN | 14,081 |
| WA | 164 |

Retained metered production checks read 178,666,596 response bytes through the final split-reader/control per-state checks, fresh-store KY/SC publication, retained-source hashes, marker reads and exact migration-receipt check. Production writes were zero. This includes unsuccessful measured configurations. Earlier interrupted probes and the failed private Connecticut measurement did not all retain byte counters, so the exact entire-session total is unknown. Final gates and post-release audits add their measured bytes in the READY commit. `scripts/src-money-check.mts --retirement` persists all 56 states' counts and measured response bytes and refuses any remaining old fact version, publication or candidate copy.

The full merged gate run at `533247cd0` failed only the shared-origin and URL-path guards (8,739 registered tests, 8,735 pass, two fail, two skip). The money check and its regression now use the shared origin constant; source version parsing names its network URL before inspecting the path. No guard exception was added. All 52 focused origin, path and money/source checks then passed. River HF-01 is merged for the final full run.

The first next-hour private Connecticut measurement failed with a WebSocket error. It did not complete or retain a full byte count; its failure log is preserved. A fresh private-connection probe and the same controlled-hour state retry succeeded. The specific connection-close cause remains unknown. This is reported as a failed measurement, not a successful first attempt. The verified last totals survive source failures and the failing daily source checks remain due.

The production handle is read-only. No production SQL was hand applied and no production write credential was used. Normal post-deploy contract application owns the cleanup. At 10:59 AM Eastern its exact journal receipt and retirement marker were absent, although Netlify reported main 64 serving since 10:20 AM. SRC-MN's second READY requires the subsequent zero audit; deployment alone is not deletion proof.

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
