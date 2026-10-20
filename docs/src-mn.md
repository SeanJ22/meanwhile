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

The `campaign-money` coordinator checks each state's hourly clock on the standing five-minute routine pass and starts one state process at a time. Each process reads that state's published officeholders at every held level and the candidates on its November 3, 2026 ballot. The hourly clock starts when the state begins, so processing time does not postpone the next scan. New people and people with no usable money are checked on the next pass; existing money is checked daily. A saved completion flag does not hide a missing cycle fact. Current officeholders run first, and source publications run newest cycle first. Other years from 2020 follow. A source without a verified committee, candidate, office and cycle binding stays open work without loading unrelated money into the reader store.

Bulk files stream to the evidence vault by content hash. The state's cached file is shared by subsequent people; its directory uses the database identity so a software checkout change does not discard the cache. Provider release versions, ETags and Last-Modified checks detect updates. The parser filters against the run's people before filling one publication batch of at most 500 matched rows and two MiB. Native input counts remain separate from selected rows, so filtering cannot disguise truncated API responses. Source-native transaction IDs are retained. Where no filer ID is published, committee identity includes the filed committee name, candidate, office and election year. Kentucky's native Location column supplies ordinal districts; a broad government ID cannot override a different filed district. Unmatched source evidence stays vaulted and the person's blank remains open.

Facts are filed in the shared state-then-place `entity`, `entity_place` and `fact` store. The campaign artifact and pointer path is gone. Database reads select the run's people, committees and record IDs; no query returns the state's complete money collection. Old amounts are fetched only for missing source amounts. Cycle rebuilding runs in the database for the touched people, and readers fetch one person's cycle totals with at most 100 named contributors per page. The hourly coordinator retains counts and reasons, not state financial rows. No shared database client or runner-admission code is changed.

Government, official and candidate cards and Ask read those same person-bound cycle facts. Readers get totals by cycle, each filed committee and its office, named organizations, and individual donors whose filed cycle total exceeds $200. Individuals at $200 or less and home addresses never reach either reader response. The small-donor percentage is shown only when the source supplies its own small and large individual lines at the $200 threshold; otherwise that field remains open work. Sources link the financial capture and the filing at the bottom of the card, with publication and check dates. The obsolete Pima body-to-committee transaction reader is deleted; its held evidence remains available for a future verified person binding.

Production verification uses only the `readonly` role and rows or counts needed by the check. Publisher writes are exercised in an isolated schema on a different existing database branch. The harness checks both actual Neon branch IDs before creating anything. No production facts are hand edited. Wire payload bytes, storage growth, worker peaks and reader timings are measured separately.

## Campaign publication checks

The shipping configuration ran against the production people projection for all 56 places, with the verified readonly role. All financial and source-door writes went to a separate existing database branch in an isolated schema. The daily-due pass checked 18,221 published people, found money for 689, processed 270,161 matched filings or held summaries and retained 1,406,872 unmatched rows in saved source evidence. Matched daily rows include unchanged confirmations; they are not all newly inserted facts. The missing-money-only pass retained those people and added zero financial rows. These are branch checks using production data; they do not claim the branch is deployed.

| State | Official source | Access | Published people | People with money | Matched rows | Unmatched rows seen | Shipping peak MiB |
|---|---|---|---:|---:|---:|---:|---:|
| AL | [Alabama Secretary of State](https://www.sos.alabama.gov/alabama-votes/media/campaign-finance-reports) | BULK | 295 | 0 | 0 | 0 | 135.9 |
| AK | [Alaska Public Offices Commission](https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDIncome.aspx) | UNCONFIRMED | 197 | 0 | 0 | 0 | 137.4 |
| AZ | [Arizona Secretary of State](https://azsos.gov/elections/campaign-finance-reporting) | API | 386 | 26 | 26 | 0 | 156.9 |
| AR | [Arkansas Secretary of State](https://financial-disclosures.sos.arkansas.gov/) | UNCONFIRMED | 173 | 0 | 0 | 0 | 135.9 |
| CA | [California Secretary of State](https://www.sos.ca.gov/campaign-lobbying/cal-access-resources/raw-data-campaign-finance-and-lobbying-activity) | BULK | 484 | 0 | 0 | 0 | 139.1 |
| CO | [Colorado Secretary of State](https://tracer.sos.colorado.gov/PublicSite/DataDownload.aspx) | BULK | 331 | 0 | 0 | 0 | 164.2 |
| CT | [Connecticut State Elections Enforcement Commission](https://seec.ct.gov/Portal/eCRIS/eCrisSearch) | BULK | 457 | 175 | 83,060 | 240,037 | 171.8 |
| DE | [Delaware Department of Elections](https://cfrs.elections.delaware.gov/) | UNCONFIRMED | 151 | 0 | 0 | 0 | 138.2 |
| DC | [District of Columbia Office of Campaign Finance](https://efiling.ocf.dc.gov/DataDownload) | BULK_API | 64 | 0 | 0 | 0 | 163.1 |
| FL | [Florida Division of Elections](https://dos.elections.myflorida.com/campaign-finance/contributions/) | BULK | 504 | 0 | 0 | 0 | 167.4 |
| GA | [Georgia State Ethics Commission](https://ethics.ga.gov/) | UNCONFIRMED | 567 | 0 | 0 | 0 | 140.2 |
| HI | [Hawaii Campaign Spending Commission](https://hicscdata.hawaii.gov/) | API | 179 | 24 | 27,813 | 143,916 | 161.6 |
| ID | [Idaho Secretary of State](https://sunshine.sos.idaho.gov/) | API | 324 | 0 | 0 | 0 | 136.6 |
| IL | [Illinois State Board of Elections](https://www.elections.il.gov/CampaignDisclosure/DownloadData.aspx) | BULK | 436 | 0 | 0 | 0 | 137.8 |
| IN | [Indiana Election Division](https://cfa.in.gov/) | UNCONFIRMED | 369 | 0 | 0 | 0 | 137.7 |
| IA | [Iowa Ethics and Campaign Disclosure Board](https://data.iowa.gov/catalog/dataset/917) | API | 333 | 0 | 0 | 0 | 135.4 |
| KS | [Kansas Public Disclosure Commission](https://kpdc.kansas.gov/campaign-finance/campaign-contributor-data/) | UNCONFIRMED | 430 | 0 | 0 | 0 | 138.1 |
| KY | [Kentucky Registry of Election Finance](https://secure.kentucky.gov/kref/publicsearch/CandidateSearch/) | BULK_API | 296 | 117 | 74,771 | 343,500 | 210.3 |
| LA | [Louisiana Board of Ethics](https://ethics.la.gov/CampaignFinanceSearch/) | BULK | 198 | 0 | 0 | 0 | 137.0 |
| ME | [Maine Commission on Governmental Ethics and Election Practices](https://www.mainecampaignfinance.com/) | UNCONFIRMED | 541 | 0 | 0 | 0 | 138.9 |
| MD | [Maryland State Board of Elections](https://campaignfinance.maryland.gov/) | BULK | 440 | 0 | 0 | 0 | 140.5 |
| MA | [Massachusetts Office of Campaign and Political Finance](https://ocpf.us/Data/Downloads) | BULK_API | 509 | 0 | 0 | 0 | 139.7 |
| MI | [Michigan Department of State](https://www.michigan.gov/sos/elections/Disclosure/cfr/committee-search/intro/welcome-to-the-michigan-campaign-finance-searchable-database) | BULK | 619 | 0 | 0 | 0 | 141.1 |
| MN | [Minnesota Campaign Finance and Public Disclosure Board](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/) | BULK | 526 | 0 | 0 | 0 | 139.6 |
| MS | [Mississippi Secretary of State](https://cfportal.sos.ms.gov/) | API | 203 | 0 | 0 | 0 | 137.8 |
| MO | [Missouri Ethics Commission](https://www.mec.mo.gov/MEC/Campaign_Finance/CF_ContrCSV.aspx) | BULK | 480 | 0 | 0 | 0 | 139.5 |
| MT | [Montana Commissioner of Political Practices](https://cers-ext.mt.gov/CampaignTracker/dashboard) | UNCONFIRMED | 352 | 0 | 0 | 0 | 138.1 |
| NE | [Nebraska Accountability and Disclosure Commission](https://nadc-e.nebraska.gov/) | BULK | 152 | 0 | 0 | 0 | 137.7 |
| NV | [Nevada Secretary of State](https://www.nvsos.gov/SOSCandidateServices/AnonymousAccess/CEFDSearchUU.aspx) | UNCONFIRMED | 184 | 0 | 0 | 0 | 137.3 |
| NH | [New Hampshire Secretary of State](https://cfs.sos.nh.gov/) | API | 465 | 4 | 4 | 0 | 141.2 |
| NJ | [New Jersey Election Law Enforcement Commission](https://www.elec.nj.gov/) | API | 561 | 14 | 16 | 0 | 143.7 |
| NM | [New Mexico Secretary of State](https://cfis.sos.nm.gov/) | BULK_API | 241 | 0 | 0 | 0 | 137.8 |
| NY | [New York State Board of Elections](https://data.ny.gov/Government-Finance/Campaign-Finance-Disclosure-Reports-Data-Beginning/e9ss-239a) | BULK_API | 638 | 0 | 0 | 0 | 140.0 |
| NC | [North Carolina State Board of Elections](https://www.ncsbe.gov/campaign-finance/search-campaign-funding-and-spending-reports-and-penalties) | UNCONFIRMED | 561 | 0 | 0 | 0 | 139.1 |
| ND | [North Dakota Secretary of State](https://www.sos.nd.gov/elections/campaign-finance-statement-interests/search-reports) | UNCONFIRMED | 255 | 0 | 0 | 0 | 137.0 |
| OH | [Ohio Secretary of State](https://www.ohiosos.gov/elections/campaign-finance) | BULK | 187 | 0 | 0 | 0 | 137.7 |
| OK | [Oklahoma Ethics Commission](https://guardian.ok.gov/PublicSite/) | BULK | 300 | 0 | 0 | 0 | 138.7 |
| OR | [Oregon Secretary of State](https://sos.oregon.gov/elections/campaign-finance/pages/search-campaign-finance.aspx) | UNCONFIRMED | 233 | 0 | 0 | 0 | 134.0 |
| PA | [Pennsylvania Department of State](https://www.campaignfinanceonline.pa.gov/Pages/CampaignFinanceHome.aspx) | BULK | 361 | 0 | 0 | 0 | 140.8 |
| RI | [Rhode Island Board of Elections](https://www.ricampaignfinance.com/) | UNCONFIRMED | 280 | 0 | 0 | 0 | 137.4 |
| SC | [South Carolina State Ethics Commission](https://ethicsfiling.sc.gov/filing/home) | API | 378 | 175 | 84,050 | 654,051 | 167.4 |
| SD | [South Dakota Secretary of State](https://sdcfr.sdsos.gov/) | UNCONFIRMED | 237 | 0 | 0 | 0 | 133.5 |
| TN | [Tennessee Registry of Election Finance](https://apps.tn.gov/tncamp/) | UNCONFIRMED | 413 | 0 | 0 | 0 | 139.3 |
| TX | [Texas Ethics Commission](https://www.ethics.state.tx.us/search/cf/) | BULK | 611 | 0 | 0 | 0 | 142.5 |
| UT | [Utah Lieutenant Governor](https://disclosures.utah.gov/) | BULK | 352 | 0 | 0 | 0 | 139.2 |
| VT | [Vermont Secretary of State](https://campaignfinance.vermont.gov/) | BULK_API | 504 | 0 | 0 | 0 | 149.8 |
| VA | [Virginia Department of Elections](https://www.elections.virginia.gov/candidatepac-info/reporting/) | BULK | 203 | 0 | 0 | 0 | 138.5 |
| WA | [Washington Public Disclosure Commission](https://www.pdc.wa.gov/) | API | 441 | 154 | 421 | 25,368 | 150.9 |
| WV | [West Virginia Secretary of State](https://cfrs.wvsos.gov/) | UNCONFIRMED | 383 | 0 | 0 | 0 | 138.1 |
| WI | [Wisconsin Ethics Commission](https://campaignfinance.wi.gov/browse-data) | API | 155 | 0 | 0 | 0 | 135.0 |
| WY | [Wyoming Secretary of State](https://www.wycampaignfinance.gov/) | UNCONFIRMED | 199 | 0 | 0 | 0 | 138.1 |
| AS | [American Samoa Election Office](https://aselectionoffice.gov/) | UNCONFIRMED | 0 | 0 | 0 | 0 | 137.0 |
| GU | [Guam Election Commission](https://gec.guam.gov/) | UNCONFIRMED | 0 | 0 | 0 | 0 | 136.5 |
| MP | [Commonwealth Election Commission](https://www.votecnmi.gov.mp/) | UNCONFIRMED | 0 | 0 | 0 | 0 | 137.7 |
| PR | [Puerto Rico Office of the Electoral Comptroller](https://oce.pr.gov/) | API | 83 | 0 | 0 | 0 | 136.3 |
| VI | [Elections System of the Virgin Islands](https://vivote.gov/) | UNCONFIRMED | 0 | 0 | 0 | 0 | 135.2 |

Reasons are counts of observed unmatched rows or source failures; a source not parsed does not establish zero filings. Missing source bindings remain owned by SRC-MN for later connections and partial-state/local coverage.

- CT: 197,152: The filed person, office or district does not uniquely match a person we publish; 39,980: The source does not bind a filed committee, candidate and office; 4: SourceAcquisitionFailure(PUBLISHER_DOCUMENT_INVALID): Campaign export columns are missing or repeated.; 2,905: The filing predates January 1, 2020
- HI: 143,916: The filed person, office or district does not uniquely match a person we publish
- ID: 4: SourceAcquisitionFailure(PUBLISHER_UNAVAILABLE): The campaign-finance publisher returned HTTP 404.
- KY: 339,636: The filed person, office or district does not uniquely match a person we publish; 3,864: The filing predates January 1, 2020
- NH: 2: SourceAcquisitionFailure(PUBLISHER_UNAVAILABLE): The campaign-finance publisher returned HTTP 403.
- SC: 427,668: The filed person, office or district does not uniquely match a person we publish; 25: The source does not bind a filed committee, candidate and office; 226,358: The source has no mapped election cycle
- VT: 4: SourceAcquisitionFailure(PUBLISHER_DOCUMENT_INVALID): The campaign API response is truncated or exceeds its denominator.
- WA: 4,917: The source does not bind a filed committee, candidate and office; 5,343: The filed person, office or district does not uniquely match a person we publish; 15,108: The source has not established a filed financial report

No verified committee/person/office/cycle binding is configured yet for AL, AK, AZ, AR, CA, CO, DE, DC, FL, GA, IL, IN, IA, KS, LA, ME, MD, MA, MI, MN, MS, MO, MT, NE, NV, NJ, NM, NY, NC, ND, OH, OK, OR, PA, RI, SD, TN, TX, UT, VA, WV, WI, WY, PR. Places with no published people do no financial acquisition. Counts for malformed or refused source responses are unknown; their bytes remain saved and the door/work reason is recorded.

The largest real source response was South Carolina contributions, 197,906,018 bytes. Cold publication of Kentucky and South Carolina used fresh isolated stores and published 158,821 rows for 292 people. All source files stream; a matched batch contains at most 500 rows/two MiB. SQLite keeps record identities on disk with a one MiB page cache. The raw-file cache also contains files from earlier development attempts; its total is not claimed as this run's input. Cold publication of every disconnected source was not tested and no generated money was substituted.

Each state child runs with a 112 MiB old-generation limit and four MiB semi-spaces, producing a 124 MiB JavaScript heap limit on this host. Limiting only the old generation left a 192 MiB young generation on this host and failed cold publication at the existing reservation. Final worker peak was 220,467,200 bytes. The measured active coordinator adds 81,842,176 bytes, giving a conservative combined peak of 302,309,376 bytes (288.3 MiB); its separate late report phase previously peaked at 282,562,560 bytes after the state exited. The existing money reservation stays 384 MiB. On the documented eight GiB runner, 19 reservations fit after the 0.75 GiB margin, or 11 alongside the existing 2,928 MiB research-parent reservation. Actual campaign work runs one state at a time. Shared admission and database clients are unchanged.

The daily-due pass took 1107.0 seconds across its workers; the missing-money-only pass took 336.5 seconds. Each worker holds its current state's people, one input page and one matched batch. No worker holds the country's financial rows or earlier state workers.

Database bytes below are measured response and request payload bytes. Reads combine the production people/source projection with private publisher/reader responses. Sent bytes conservatively include SQL requests, private people-view setup and source-door recording; they are not WAL or physical page writes. Physical relation growth is measured separately. The compact coordinator publication is measured separately below and included in the run and day totals. Day figures are an estimate using one measured daily-due pass, 23 measured missing-only passes and at most 288 compact coordinator scans, with unchanged sources and no new people. They are not a claimed observed 24-hour run.

| State | Daily read bytes | Daily sent bytes | Missing-only read bytes | Missing-only sent bytes | Estimated day read bytes | Estimated day sent bytes |
|---|---:|---:|---:|---:|---:|---:|
| AL | 425,888 | 588,623 | 424,885 | 588,623 | 10,311,715 | 14,161,800 |
| AK | 207,236 | 363,206 | 206,645 | 363,206 | 5,073,543 | 8,751,792 |
| AZ | 759,851 | 784,894 | 700,000 | 682,967 | 16,973,611 | 16,527,983 |
| AR | 248,222 | 386,696 | 247,703 | 386,696 | 6,058,863 | 9,315,552 |
| CA | 602,463 | 962,233 | 601,011 | 962,233 | 14,539,188 | 23,128,440 |
| CO | 399,084 | 642,242 | 398,091 | 642,242 | 9,668,649 | 15,448,656 |
| CT | 47,577,986 | 15,734,475 | 958,429 | 1,032,986 | 69,803,293 | 39,528,001 |
| DE | 450,184 | 348,751 | 449,731 | 348,751 | 10,907,469 | 8,404,872 |
| DC | 81,770 | 152,663 | 81,578 | 152,663 | 2,070,960 | 3,698,760 |
| FL | 1,031,517 | 947,959 | 1,029,984 | 947,959 | 24,834,621 | 22,785,864 |
| GA | 763,263 | 1,089,062 | 761,562 | 1,089,062 | 18,392,661 | 26,172,336 |
| HI | 14,468,524 | 4,108,279 | 606,390 | 370,674 | 28,532,422 | 12,668,629 |
| ID | 553,638 | 669,597 | 551,430 | 671,326 | 13,355,472 | 16,144,943 |
| IL | 519,653 | 800,100 | 518,345 | 800,100 | 12,555,060 | 19,237,248 |
| IN | 480,438 | 722,902 | 479,331 | 722,902 | 11,618,523 | 17,384,496 |
| IA | 483,574 | 708,243 | 482,575 | 708,243 | 11,696,271 | 17,032,680 |
| KS | 496,051 | 820,014 | 494,761 | 820,014 | 11,989,026 | 19,715,184 |
| KY | 40,411,443 | 14,194,941 | 524,228 | 742,298 | 52,598,287 | 31,302,643 |
| LA | 269,633 | 404,457 | 269,039 | 404,457 | 6,571,002 | 9,741,816 |
| ME | 557,651 | 845,147 | 556,028 | 845,147 | 13,459,767 | 20,318,376 |
| MD | 565,575 | 842,257 | 564,255 | 842,257 | 13,656,912 | 20,249,016 |
| MA | 609,494 | 970,943 | 607,967 | 970,943 | 14,706,207 | 23,337,480 |
| MI | 678,646 | 1,106,647 | 676,789 | 1,106,647 | 16,358,265 | 26,594,376 |
| MN | 600,300 | 845,854 | 598,722 | 845,854 | 14,484,378 | 20,335,344 |
| MS | 284,686 | 428,052 | 284,077 | 428,052 | 6,931,929 | 10,308,096 |
| MO | 543,731 | 773,339 | 542,291 | 773,339 | 13,129,896 | 18,594,984 |
| MT | 452,091 | 687,226 | 451,035 | 687,226 | 10,939,368 | 16,528,272 |
| NE | 188,947 | 321,615 | 188,491 | 321,615 | 4,637,712 | 7,753,608 |
| NV | 239,805 | 367,940 | 239,253 | 367,940 | 5,856,096 | 8,865,408 |
| NH | 674,397 | 967,919 | 665,808 | 953,202 | 16,106,925 | 22,926,413 |
| NJ | 1,346,276 | 1,284,363 | 1,306,367 | 1,217,467 | 31,506,477 | 29,320,952 |
| NM | 306,974 | 504,972 | 306,251 | 504,972 | 7,464,219 | 12,154,176 |
| NY | 723,541 | 1,130,479 | 721,627 | 1,130,479 | 17,434,434 | 27,166,344 |
| NC | 657,903 | 1,109,755 | 656,220 | 1,109,755 | 15,864,435 | 26,668,968 |
| ND | 341,848 | 522,156 | 341,083 | 522,156 | 8,300,229 | 12,566,592 |
| OH | 257,080 | 389,285 | 256,519 | 389,285 | 6,270,489 | 9,377,688 |
| OK | 384,637 | 587,390 | 383,737 | 587,390 | 9,324,060 | 14,132,208 |
| OR | 304,020 | 441,403 | 303,321 | 441,403 | 7,393,875 | 10,628,520 |
| PA | 517,100 | 744,324 | 516,017 | 744,324 | 12,498,963 | 17,898,624 |
| RI | 343,493 | 588,349 | 342,653 | 588,349 | 8,337,984 | 14,155,224 |
| SC | 42,332,481 | 14,296,147 | 680,314 | 561,488 | 58,131,191 | 27,245,219 |
| SD | 304,014 | 462,291 | 303,303 | 462,291 | 7,393,455 | 11,129,832 |
| TN | 482,120 | 840,497 | 480,881 | 840,497 | 11,655,855 | 20,206,776 |
| TX | 730,936 | 1,138,994 | 729,103 | 1,138,994 | 17,613,777 | 27,370,704 |
| UT | 366,107 | 596,102 | 365,051 | 596,102 | 8,875,752 | 14,341,296 |
| VT | 624,689 | 1,120,374 | 622,239 | 1,122,252 | 15,061,466 | 26,967,018 |
| VA | 272,530 | 417,856 | 271,921 | 417,856 | 6,640,185 | 10,063,392 |
| WA | 705,076 | 1,004,474 | 500,898 | 662,018 | 12,381,250 | 16,265,736 |
| WV | 429,548 | 702,388 | 428,399 | 702,388 | 10,396,197 | 16,892,160 |
| WI | 225,822 | 343,065 | 225,357 | 343,065 | 5,522,505 | 8,268,408 |
| WY | 261,950 | 404,293 | 261,353 | 404,293 | 6,386,541 | 9,737,880 |
| AS | 3,679 | 13,044 | 3,679 | 13,044 | 176,712 | 347,904 |
| GU | 3,679 | 13,044 | 3,679 | 13,044 | 176,712 | 347,904 |
| MP | 3,679 | 13,044 | 3,679 | 13,044 | 176,712 | 347,904 |
| PR | 127,867 | 192,279 | 127,618 | 192,279 | 3,175,977 | 4,649,544 |
| VI | 3,679 | 13,044 | 3,679 | 13,044 | 176,712 | 347,904 |

Totals: daily production responses 21,316,021 bytes, private responses 146,371,549, private requests 81,459,947; missing-only production responses 21,228,298, private responses 4,078,185, private requests 35,311,162. One compact 56-state clock scan read 22,375 bytes and sent 6,776. The estimated day reads 773,042,036 bytes and sends 904,656,213 bytes, including the shared promotion receipt. Production writes were zero. Private daily relation growth was 12,476,416 bytes; missing-only growth was -49,152.

In a verified private schema, the actual PostgresRoutineDataStore coordinator publication read/sent 46,872/30,664 bytes for a cold daily report, 58,427/31,580 for the next hourly report and 58,601/31,557 for a clock-only pass. Including one clock scan, complete daily run read/sent bytes are 167,756,817/81,497,387; complete hourly run bytes are 25,387,285/35,349,518. The private schema adds an explicit transaction-local search-path query to each HTTP request, so that overhead is conservatively included. This report measures payload traffic; WAL and billing-side physical IO are not measured. The coordinator publication peaked at 153,276,416 bytes in a separate phase with no state child running.

| State | Campaign API ms | Government money reader ms | Person funding API ms | Reader result |
|---|---:|---:|---:|---|
| DC | 109.5 | 115.5 | 111.6 | We're working on getting this info. |
| FL | 50.6 | 54.5 | 52.4 | We're working on getting this info. |
| CO | 51.6 | 54.0 | 48.2 | We're working on getting this info. |
| AZ | 117.2 | 137.2 | 111.3 | Clara Pratte's 2026 cycle totals and Sources; donor details remain open. |

These timings invoke the actual branch API handlers and money reader with production-derived people and private published facts. They exclude the deployed CDN and browser shell. Component checks cover the single Sources list and donor privacy; merged Ask route checks use the same person-cycle facts. Individual donors at $200 or less and home addresses are excluded. A small-donor share is shown only from official small/large individual lines at the $200 threshold; otherwise it remains open work.

A production-source Washington check exposed one real published person, then a second on the next controlled hourly scan. The next scan worked exactly one person, increased people with money from one to two and made zero bulk-download requests. Its measured production reads were 3,742 and 5,226 bytes. The state-start clock, a stale completion flag with missing money, refund threshold changes and a partial update retaining the older filing citation are also covered by the fixture-backed workflow.

## Replaced campaign load retirement

The contract migration `SRC-MN_retire_campaign_load` removes every old-load fact version tagged `campaign-finance:<state>:<resource>`, its native campaign publication pointers, candidate copies and events, old checkpoints, and empty committee links/entities. Fact deletion works in 500-ID batches for one committee in one state. The corrected writer uses `campaign-person-money:<state>:<resource>` and remains separate from the retired producer. The saved source copies, raw evidence-vault files, unrelated federal money and pre-existing Arizona/New Hampshire/New Jersey/Pima source records are retained. No columns are added.

The cleanup was pushed as READY `ba5791c5d` after merging released main 62 and River. All eight full gates passed: 8,708 registered tests, 8,706 passing, zero failures and two skips. Sean approved releasing the cleanup first, then requiring production zeros before the Step 2 READY. The migration runs through the normal contract phase after deployment. A real PostgreSQL test verifies more than one deletion batch, both live and superseded versions, flags, candidate self/history references, preservation of other money/source evidence, and restoration of immutable-store triggers.

Production retirement verification has not passed. The read-only all-56 check found 1,707,787 facts, all live, 4,322 old publication pointers and 21,108 candidate copies. They remain in production until the contract migration runs; none is reported as removed. The latest all-56 count-only check read 39,257 bytes. The earlier targeted 13-state check read 10,944 bytes. No financial payload was fetched for either count check. A separate 583-byte hash check confirmed the pre-existing Arizona, New Hampshire, New Jersey and Pima source payloads remain byte-for-byte unchanged.

| State | Old facts still live |
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

Measured production responses across the retained completed and failed runs total 130,150,074 bytes so far, including the final 56-place daily and missing-money passes, the cold Kentucky/South Carolina publication, prior memory configurations, both cleanup gate runs and the latest count check. Production writes were zero. Earlier interrupted development attempts and a few metadata probes were not all metered, so this is not an exact total for the entire session. The final merged gates and post-release zero check will add their measured bytes. `scripts/src-money-check.mts --retirement` persists per-state counts and measured response bytes and fails unless every old fact, publication and candidate copy count is zero.

The available production database handle is read-only. Automatic approval review rejected reading Netlify’s production write credential because it could expose secrets and credential inspection was not authorized. No alternate credential or manual production SQL was used. The normal post-deploy migration remains prepared; the zero-production-count condition is open.

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
