# voting-source-doors.json — source note

The root universe comes from data/reference/fec_state_election_offices.csv, published by the Federal Election Commission at https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices/. Its exact links were reread with the browser on October 13, 2026. The original CSV contains 54 chief-office entries covering the 50 states, DC and PR, because Kentucky and Rhode Island each have two FEC offices. The fresh October 21, 2026 FEC directory also links AS, GU, MP and VI; those four captured official roots now complete the 56-jurisdiction universe. FEC authority excerpts are normalized anchors from observed visible URLs, explicitly marked as such rather than claimed as original HTML bytes.

Additional doors were found by following those official pages into state files, county directories, official county lists, address-only portals and linked vendor directories. The record preserves shape, publisher, scope, coverage, election page and access observations. A root has an empty covers array because an elections homepage is a discovery source, not a polling list. Official vendor-link excerpts are likewise explicitly normalized observed destinations. November 3 is the requested election scope; individual file applicability, older titles and unresolved vendor warnings remain acquisition work. Fixture counts and inaccessible samples are documented in tests/fixtures/voting-sources/manifest.json. No identity-locked lookup was submitted, and missing source bytes or geocodes were not manufactured.


Native capture update (October 13, 2026): execution with the configured network capability resolved the initial workspace proxy failure. The fixture manifest now records native Montana XLSX, North Carolina files, North Dakota and vendor HTML, county pages, official rule/calendar pages, Pima app JSON and Census responses with source URLs, response hashes and robots evidence. Historical browser observations remain identified as such. Native layer queries can still be closed by their own robots response, and an older-election file stays visible with its newer-election hunter blank.

Credential handling: the Pima election HTML and two El Paso location HTML captures pass through the repository writeCapturedFixture sanitizer. Only detected credential substrings are replaced. Their manifest entries record both the raw capture hash and sanitized saved hash, alongside data/fixtures/sanitization.json; they are not described as unchanged HTTP bytes. Election text and site records remain source evidence.


VS-04 first batch (October 21, 2026): official state files lead county files; a personal-name/birth-date lookup is recorded and public county lists supply the locations instead. A document requiring restricted encrypted storage is held separately, with an open access task, while the other sources continue. Public list pages can contain unrelated login or contact-form CAPTCHA footers. Binary spreadsheets are classified from extracted cells. Multiple configured sections of one document replace its prior publication together, preserving all independently verified services.

Fresh saved sources are under tests/fixtures/voting-sources/vs-04-*/captures.json (territories use manifest.json). Each capture names its source, capture time and hash. Where the existing sanitizer changed credential substrings, the manifest distinguishes publisher and saved hashes; these files are sanitized evidence rather than exact original responses. Unchanged binary files retain their exact publisher bytes. Original restricted bodies are not put into compressed unrestricted publication evidence.

The first copy result is in tests/fixtures/voting-sources/vs-04-copy-proof.json. It uses the actual production reader and control-plane copies, the registered MANUAL_CONTRACT, and typed reader readback. These are copy results; live production publication and River integration remain separate. Site counts below are held reader rows, including prior verified facts; they describe loaded locations, not complete state coverage. County, precinct, service and schedule blanks remain acquisition work.

| State or territory | Sites in production copy | Readback |
| --- | ---: | --- |
| AL | 78 | PASS |
| AR | 3 | PASS |
| AS | 0 | PASS (absentee instructions; polling list still open) |
| AZ | 191 | PASS |
| CA | 100 | PASS |
| CO | 56 | PASS |
| CT | 174 | PASS |
| DC | 129 | PASS |
| DE | 297 | PASS |
| FL | 463 | PASS |
| GA | 121 | PASS |
| HI | 60 | PASS |
| IA | 64 | PASS |
| ID | 2 | PASS |
| IL | 24 | PASS |
| IN | 182 | PASS |
| KS | 23 | PASS |
| KY | 1690 | PASS |
| LA | 112 | PASS |
| MA | 164 | PASS |
| MD | 102 | PASS |
| ME | 1 | PASS |
| MI | 4 | PASS |
| MN | 25 | PASS |
| MO | 57 | PASS |
| MP | 15 | PASS |
| MS | 46 | PASS |
| MT | 335 | PASS |
| NC | 2806 | PASS |
| ND | 209 | PASS |
| NE | 13 | PASS |
| NJ | 614 | PASS |
| NV | 48 | PASS |
| NY | 25 | PASS |
| OH | 88 | PASS |
| OK | 93 | PASS |
| OR | 334 | PASS |
| PA | 683 | PASS |
| PR | 0 | PASS |
| RI | 55 | PASS |
| SC | 1956 | PASS |
| SD | 456 | PASS |
| TN | 15 | PASS |
| TX | 129 | PASS |
| UT | 38 | PASS |
| VA | 2651 | PASS |
| VI | 14 | PASS |
| VT | 8 | PASS |
| WA | 627 | PASS |
| WI | 11 | PASS |
| WV | 99 | PASS |
| WY | 23 | PASS |

All 56 first HTTP submissions to the actual production-build API passed in under three seconds (maximum 1,959 ms), using real copy projections. The isolated native Montana source command completed with 335 grouped locations, PROMOTED/GOOD, and remaining source/place work in the existing queue. New Hampshire and New Mexico refresh corrections remain in progress for the final batch; prior verified reader facts are retained. Alaska and Guam have documented access failures; American Samoa has instructions but no complete polling list; Puerto Rico’s official election cycle has no 2026 general election. These acquisition reasons and checked alternatives remain in the regional results files.
