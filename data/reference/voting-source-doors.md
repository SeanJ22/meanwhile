# voting-source-doors.json — source note

The root universe comes from data/reference/fec_state_election_offices.csv, published by the Federal Election Commission at https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices/. Its exact links were reread with the browser on October 13, 2026. The original CSV contains 54 chief-office entries covering the 50 states, DC and PR, because Kentucky and Rhode Island each have two FEC offices. The fresh October 21, 2026 FEC directory also links AS, GU, MP and VI; those four captured official roots now complete the 56-jurisdiction universe. FEC authority excerpts are normalized anchors from observed visible URLs, explicitly marked as such rather than claimed as original HTML bytes.

Additional doors were found by following those official pages into state files, county directories, official county lists, address-only portals and linked vendor directories. The record preserves shape, publisher, scope, coverage, election page and access observations. A root has an empty covers array because an elections homepage is a discovery source, not a polling list. Official vendor-link excerpts are likewise explicitly normalized observed destinations. November 3 is the requested election scope; individual file applicability, older titles and unresolved vendor warnings remain acquisition work. Fixture counts and inaccessible samples are documented in tests/fixtures/voting-sources/manifest.json. No identity-locked lookup was submitted, and missing source bytes or geocodes were not manufactured.


Native capture update (October 13, 2026): execution with the configured network capability resolved the initial workspace proxy failure. The fixture manifest now records native Montana XLSX, North Carolina files, North Dakota and vendor HTML, county pages, official rule/calendar pages, Pima app JSON and Census responses with source URLs, response hashes and robots evidence. Historical browser observations remain identified as such. Native layer queries can still be closed by their own robots response, and an older-election file stays visible with its newer-election hunter blank.

Credential handling: the Pima election HTML and two El Paso location HTML captures pass through the repository writeCapturedFixture sanitizer. Only detected credential substrings are replaced. Their manifest entries record both the raw capture hash and sanitized saved hash, alongside data/fixtures/sanitization.json; they are not described as unchanged HTTP bytes. Election text and site records remain source evidence.


VS-04 final batch (October 21, 2026): 347 configured source mappings and all 56 official chief-office roots cover the 50 states, DC and five territories. Official state files lead county files. Where a lookup needs a personal name and birthday, acquisition follows public county files. No personal lookup was submitted. Verified official facts enter the existing native reader used before the Google fallback; publication to live production is not claimed here.

A document requiring restricted encrypted storage is held separately, with a safe access task in the existing queue, while other documents continue. Original restricted bodies cannot enter compressed unrestricted publication evidence. Public list pages with unrelated login or contact-form CAPTCHA footers remain readable; actual challenges remain closed. Binary spreadsheets are classified from extracted cells. Multiple sections of one document publish together, preserving their distinct services. Named PDF members inside official ZIPs and scanned PDFs use the normal archive and OCR readers while retaining the original document URL, bytes and hash. A newer election file retires an explicitly superseded file only after the newer sites have actually published. The archived North Carolina primary file remains a fallback until that condition is met.

Fresh source manifests are [west](../../tests/fixtures/voting-sources/vs-04-west/captures.json), [central](../../tests/fixtures/voting-sources/vs-04-central/captures.json), [northeast](../../tests/fixtures/voting-sources/vs-04-northeast/captures.json), [southeast](../../tests/fixtures/voting-sources/vs-04-southeast/manifest.json) and [territories](../../tests/fixtures/voting-sources/vs-04-territories/manifest.json). They record URLs, capture times and hashes. Sanitized text captures distinguish original-response and saved hashes; they are not unchanged HTTP bytes. Unchanged files retain exact publisher bytes. Regional results retain source-specific missing values, attempted alternatives and next acquisition work. Tests replay every configured acquired source and check extracted values against those saved documents.

The [site list by state](../../tests/fixtures/voting-sources/vs-04-sites-by-state.json) enumerates held site IDs, names, addresses, service kinds and source URLs. Of its 15,595 IDs, 15,271 match this batch's captured source hashes and 324 are explicitly marked retained prior records (168 AZ, 156 NJ). It is a review artifact, not a file loaded by workers. The table distinguishes newly acquired source records from held reader site IDs: service entries can merge at one facility, and prior verified reader facts can remain. These counts do not assert complete state coverage. Every nonzero row passed publication and typed readback on an actual production copy. AS and PR passed instruction-only publication; AK and GU have evidenced access gaps.

| State or territory | Acquired sites / service records | Held reader sites | Acquired scope and remaining work |
| --- | ---: | ---: | --- |
| Alaska (AK) | 0 | 0 | State routes returned 503. Borough alternatives checked; municipal-only lists do not establish the November state election. |
| Alabama (AL) | 78 | 78 | Mobile County polling centers; other counties, dated applicability and hours remain open. |
| Arkansas (AR) | 36 | 36 | Benton County GIS and 35 OCR-read vote centers; other counties and early-voting scan corrections remain open. |
| American Samoa (AS) | 0 | 0 | Verified walk-in absentee instructions; current district polling list and linked physical office address remain open. |
| Arizona (AZ) | 23 | 191 | Cochise County acquired; other counties and missing schedules/assignments remain open. Prior reader sites retained. |
| California (CA) | 100 | 100 | Alameda County; other counties and missing schedules/assignments remain open. |
| Colorado (CO) | 56 | 56 | Arapahoe County; other counties and missing schedules/assignments remain open. |
| Connecticut (CT) | 174 | 174 | Statewide early-voting PDF; election-day lists and complete schedules remain open. |
| District of Columbia (DC) | 129 | 129 | District-wide vote-center/drop-box lists; ward assignments, coordinates and full early schedules remain open. |
| Delaware (DE) | 297 | 297 | Official statewide GIS polling and early locations; county joins, schedules and precinct boundaries remain open. |
| Florida (FL) | 463 | 463 | Early-location PDFs for all 67 counties; election-day lists, separate intake sections and daily schedules remain open. |
| Georgia (GA) | 132 | 132 | Cobb County precinct facilities; other counties, early schedules and boundaries remain open. |
| Guam (GU) | 0 | 0 | Official general-election routes returned 503/TLS verification failure; primary-only mirror and actual login page cannot supply general sites. |
| Hawaii (HI) | 60 | 60 | State tables covering four county election offices; Kalawao administrative coverage and remaining assignments/points need verification. |
| Iowa (IA) | 64 | 64 | Scott County polling facilities and precincts; other counties remain open. |
| Idaho (ID) | 2 | 2 | Canyon County early sites; other counties and service kinds remain open. |
| Illinois (IL) | 24 | 24 | DuPage County early sites after state/Chicago/Cook access failures; other counties and election-day lists remain open. |
| Indiana (IN) | 182 | 182 | Marion County vote centers; other counties and schedules remain open. |
| Kansas (KS) | 23 | 23 | Johnson County early/drop services; other counties and dated schedules remain open. |
| Kentucky (KY) | 1,690 | 1,690 | State workbook has all 120 county labels; excused in-person sheet omits Larue. Full dated schedules and boundaries remain open. |
| Louisiana (LA) | 112 | 112 | Early sites across all 64 parishes; election-day lists and schedules remain open. |
| Massachusetts (MA) | 164 | 164 | Boston polling facilities with ward/precinct assignments; other towns/cities and early lists remain open. |
| Maryland (MD) | 102 | 102 | State early PDF matches all 24 printed county/Baltimore City counts; election-day lists and schedules remain open. |
| Maine (ME) | 1 | 1 | Bangor election notice after state/Portland access failures; other municipalities remain open. |
| Michigan (MI) | 4 | 4 | Grand Rapids early sites; other municipalities, election-day lists and Detroit scan extraction remain open. |
| Minnesota (MN) | 25 | 25 | Renville County current GIS; state TXT was a 2008 sample. Other counties and dated hours remain open. |
| Missouri (MO) | 57 | 57 | Active St. Louis city centers; inactive records excluded. Other counties remain open. |
| Northern Mariana Islands (MP) | 15 | 15 | 12 election-day entries and three early services across Saipan, Rota and Tinian; combined Northern Islands entry lacks individual facilities. |
| Mississippi (MS) | 46 | 46 | DeSoto County current linked map, revised March 2025; November 2026 applicability, other counties and hours remain open. |
| Montana (MT) | 335 | 335 | State polling/satellite workbook; remaining registered geography joins, precincts and schedules stay queued. |
| North Carolina (NC) | 2,806 | 2,806 | State November polling/early files across all 100 counties; boundaries and services absent from those files remain open. |
| North Dakota (ND) | 209 | 209 | Fully paginated state general-election directory; registered place/precinct joins, points and schedules remain open. |
| Nebraska (NE) | 13 | 13 | Douglas County drop boxes; statewide lookup is not a bulk file. Other counties and election-day lists remain open. |
| New Hampshire (NH) | 1 | 1 | New London town page; current hours retain existing site ID and map pin. Other towns remain open; CAPTCHA not submitted. |
| New Jersey (NJ) | 458 | 614 | State drop boxes across 21 explicit county sections; prior verified sites retained. Election-day/early lists and schedules remain open. |
| New Mexico (NM) | 37 | 37 | Santa Fe County; other counties and missing schedules/assignments remain open. |
| Nevada (NV) | 48 | 48 | Washoe County; other counties and remaining early/day schedule sections remain open. |
| New York (NY) | 25 | 25 | Westchester early sites; other counties and election-day lists remain open. |
| Ohio (OH) | 88 | 88 | State directory of county early locations; election-day facilities, precincts and local hours remain open. |
| Oklahoma (OK) | 93 | 93 | State early list across all 77 counties; election-day lists and precinct assignments remain open. |
| Oregon (OR) | 334 | 334 | State drop-site file across all 36 counties; county updates, remaining dates and boundaries remain open. |
| Pennsylvania (PA) | 683 | 683 | Philadelphia workbook deduplicated from 1,703 ward/division rows; other counties, early sites and schedules remain open. |
| Puerto Rico (PR) | 0 | 0 | Official four-year general-election cycle excludes November 2026; separately scheduled special elections remain acquisition work. |
| Rhode Island (RI) | 80 | 55 | State tables: 41 drop-box and 39 early-service entries merge at shared facilities; election-day lists and full hours remain open. |
| South Carolina (SC) | 1,956 | 1,956 | Permanent directory across all 46 counties excludes temporary changes; November assignments and early lists remain open. |
| South Dakota (SD) | 456 | 456 | State general-election PDF; boundaries and publisher-absent hours/points remain open. |
| Tennessee (TN) | 15 | 15 | Davidson County early sites; other counties, daily schedules and election-day lists remain open. |
| Texas (TX) | 129 | 129 | El Paso early/vote-center files; other counties follow the official directory instead of name/birthday lookup. |
| Utah (UT) | 38 | 38 | Utah County; other counties and missing schedules/assignments remain open. |
| Virginia (VA) | 2,651 | 2,651 | State list matched all 133 typed county/city equivalents; early sites, hours and boundaries remain open. |
| Virgin Islands (VI) | 14 | 14 | 11 general centers plus three early offices, with exact island scopes and latest September notice; full street addresses/points remain open. |
| Vermont (VT) | 8 | 8 | Burlington wards including changed Ward 4 location; other towns remain open. Prior unrelated authority gaps do not hold these sites. |
| Washington (WA) | 627 | 627 | State list across all 39 counties; updates, remaining dates/assignments and boundaries remain open. |
| Wisconsin (WI) | 11 | 11 | Milwaukee early sites; other municipalities and dated schedules remain open. |
| West Virginia (WV) | 99 | 99 | Early locations across all 55 counties with individual periods; election-day lists and boundaries remain open. |
| Wyoming (WY) | 23 | 23 | Natrona County; other counties and missing schedules/assignments remain open. |

The [final copy proof](../../tests/fixtures/voting-sources/vs-04-copy-proof.json) records 54 promoted jurisdictions, 52 with sites, and 15,595 held site IDs. It uses actual reader copies `br-purple-fire-axpd56ml` and `br-frosty-truth-axq7rdql`, actual control-plane copy `br-gentle-fog-aebfnn9f`, the registered `MANUAL_CONTRACT`, and typed reader readback. All 56 first submissions to the production-build API passed under three seconds (maximum 1,959 ms). Updated-source HTTP checks passed, including New Hampshire's preserved ID, map pin and current hours. The native Montana command separately completed PROMOTED/GOOD with 335 grouped sites and persisted remaining work in the existing queue. The isolated production build, 151 voting tests (zero failed/skipped), TypeScript, scoped lint and credential scan passed.

Earlier OR/MA/NJ/NM trial corrections encountered the generic `OPEN_FACT_SET` member-removal guard in the first test copy. Corrected acquisition passed on a fresh child of actual production, without weakening that guard or changing candidate pointers. New Hampshire's real same-facility refresh passes with its stable ID. Genuine moved/deleted-site retirement still needs the generic publication owner's removal contract outside this lane's allowed files.

At the read-only production heartbeat of October 21, 2026, 1:03 AM Eastern, existing growth reservations and the unchanged 0.75 GiB margin permit **zero additional voting jobs** at the largest measured replay peak of 1,012,461,568 bytes. The runner reported `lastCycleOk=false`; the existing RN-01 runtime work remains its owner. No production write, worker launch or capacity-setting change was performed. The runtime owner must resolve capacity before production acquisition can run. County coverage, precinct assignments, source hours and boundaries continue through existing acquisition work; a verified partial list does not wait for them.
