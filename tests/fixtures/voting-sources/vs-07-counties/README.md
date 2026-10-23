VS-07 county sources, captured October 23, 2026

`config-fragment.json` contains 92 data-only door mappings. The master catalog imports them by ID. `captures.json` records each exact request URL, final URL, capture time, HTTP status, content type, raw-byte SHA-256, saved-byte SHA-256, and storage class. `SANITIZED_DERIVED` means a known credential or public signed-URL signature was removed; the saved hash describes the bytes in this directory. PDFs and the Allegheny workbook retain their native bytes. NYC and Cuyahoga also use the existing `../vs-07/expand-east-{nyc,cuyahoga}-page.html` native captures and their `.capture.json` metadata.

Brave was checked first, then Exa: this environment supplies neither Brave key (`BRAVE_API_KEY` or `BRAVE_SEARCH_API_KEY`) nor `EXA_API_KEY`. No credentials or budget controls changed. Connected web search was used as an explicit fallback only to discover election-office pages. Lists were acquired from the officials' linked URLs with plain native fetch, rather than saving search excerpts as evidence. No Google voterinfo responses were queried or saved by this acquisition work.

Verified reader results from the native captures:

| County | Parsed current facilities / services | Scope and limits |
| --- | --- | --- |
| Harris TX | 617 confirmed Election Day vote centers | Countywide, 7 a.m.–7 p.m.; rows marked `**` unconfirmed in the official PDF are omitted. The county `.gov`→HarrisVotes→appfiles authority chain is preserved as native link excerpts. |
| Dallas TX | 70 early sites; 346 Election Day centers | Countywide; own PDF explicitly names November 3, 2026. Rowlett's official election page links the Dallas county host. Hours remain open. |
| Tarrant TX | 47 early sites; 223 Election Day centers | Countywide; the two early PDF page ranges read 39 plus 8 sites. Day hours are 7 a.m.–7 p.m. Early hours remain open because the multilingual calendar needs separate date mappings. |
| Miami-Dade FL | 28 early sites | Countywide, October 19–November 1, 7 a.m.–7 p.m. |
| Broward FL | 280 polling facilities | Assigned precincts. Current official home page links the November 3 file. The October 6 report date is not an older election. The scanned early-site PDF and separate drop schedule are retained as leads. |
| Palm Beach FL | 28 early sites plus the same 28 drop sites | Countywide, October 19–November 1, 7 a.m.–7 p.m. Three printed map columns read 11, 9, and 8 sites. Flow records preserve the wrapped Dr. André Fladell Civic Center address. Branch-office Election Day return deadlines are not applied to these early sites. |
| NYC NY, five counties | All 10 current borough early/day PDFs, through 70 geometric panels | Assigned election districts. Printed Assembly District boundaries are excluded from addresses. These data mappings do not assert a voter's assigned facility from a nearest-site calculation; exact assignment and hours remain open. |
| Cuyahoga OH | 268 polling facilities | Assigned precincts. Current election page links the list. The October 1 report date is not an older election. The printed report header becomes a missing-address blank, not a voting site. |
| Franklin OH | 1 early voting office | Countywide; the official page provides 1700 Morse Road and the current election. Varying day/hour schedule remains open. |
| Fulton GA | 33 early sites | Countywide; current location page's 33 facilities supersede the older announcement saying 32. Published weekday/weekend hours retained. |
| Gwinnett GA | 13 early sites; 7 drop sites | Countywide list read, but current election-date association remains open. Official host authority is established by Peachtree Corners' native `.gov` link. No source-derived current-election date is fabricated. |
| Wayne MI | 47 early sites | Community assignment and printed hours retained. Current election-date association remains open: the county page's linked filename explicitly says `nov-3_2026_general_election`, but its visible link label is generic and the PDF body lacks the election year/date. |
| Cook IL | 2 early sites | Wheeling and Barrington Hills only, restricted by town. No countywide eligibility is asserted for Chicago residents. Barrington Hills' current dates and weekday/weekend hours are retained. Cook's full county early-location route returned HTTP 403. |

Standing acquisition leads remain evidence, not a completeness claim:

- Harris early voting's current linked map is a scanned PDF. The public map wrapper currently initializes an empty iframe in native HTML; do not invent its dynamically configured URL as a native link.
- Broward's scanned early list and drop schedule, Palm Beach's four office intake schedules, and Fulton's separate drop page need their remaining date/location mappings.
- Oakland's current official voter page has regional and central early sites with multi-community eligibility. Preserve that eligibility before publishing them. The formerly guessed early-voting URL returned 404; this does not establish absence.
- Allegheny's official current polling-list route returns a native workbook with `Sheet1`, `Changes`, and `Suggested Changes`. Only the current `Sheet1` list is a potential site source; the other tabs are not current location authority. The candidate-resource linking page does not visibly name November 3, so no current-election door was fabricated. The current satellite/return page has date tables and Google Maps links; its location addresses still need native official evidence.
- Cook's native municipal clerk pages verify two sites. Its full county list remains an access lead after the HTTP 403, not an unpublished finding. Barrington Township also links a public Acrobat document that needs a native download route.

Focused verification: `node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/voting-source-counties.test.ts` passed both tests (all 92 doors; about 42 seconds). It checks hashes, native government link excerpts and authority chains, county scopes, exact source counts, no PDF heading/address bleed, conservative assigned-site eligibility, and preservation through the production publication merge. It asserts that Broward and Cuyahoga do not get false earlier-election blanks. After removing public signed-URL signatures from unused HTML, the evidence/hash test was rerun and passed.

This acquisition's input is the standing county coverage blank and official election-office pages. Its output feeds the shared door catalog, `readVotingSource`, and the existing publication merge. It does not itself prove production publication, reader display, address assignment, or tomorrow's scheduled job; the root VS-07 production replay owns those proofs.
