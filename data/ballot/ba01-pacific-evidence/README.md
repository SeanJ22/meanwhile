# BA-01 Pacific source replay

Official sources checked October 20, 2026. These captures support the additions
in `data/ballot/2026-general/{ak,hi,or,wa}.json`. `captures.json` records each
source URL, capture time, byte hash, and extraction method. Gzip captures preserve
the downloaded bytes. Alaska's capture preserves the web reader's source text;
its method explicitly distinguishes that transport text from origin HTML.

| State | Measured comparison | Added to the held ballot file |
| --- | --- | --- |
| HI | Full native export: 415 filing rows; 140 people marked In General, 61 source contests, 60 ballot contests after combining governor/LG. Every general candidate is represented. | 17 local candidate contests, 44 candidates, 30 local charter questions: Honolulu 20, Maui 8, Hawaii 1, Kauai 1. Final file: 92 contests, 138 candidacy choices representing 140 people, 32 measures. |
| OR | Official directive: all 83 federal/statewide/legislative contests and all 167 name/party rows match exactly. | All seven circuit-court contests and three county DA contests in that directive; 13 city contests and seven county/Portland ranked-choice contests from Multnomah's ballot content; three Portland/Troutdale measures. Total additions: 30 candidate contests, 95 candidates, three measures. Final file: 116 contests, 262 candidacies, three measures. |
| WA | Full native export: 887 candidate rows. All 137 congressional/legislative/Supreme Court contests and all 255 name/party rows match exactly. King County's separate official list contains 97 candidate contests/153 names. | 15 King County/Seattle candidate contests, 20 candidates and Seattle's transit proposition. Final file: 156 contests, 275 candidacies, four measures. |
| AK | Judicial Council's complete 2026 ballot list has 21 judges; the held Supreme Court contest already contains Jude Pate. Federal/statewide/legislative certified roster completeness remains unmeasured. | 20 district judge retention contests/candidates, each scoped to its stated judicial district. Final file: 76 contests, 153 candidacies, two measures. |

Reproduce the comparisons without changing files:

```sh
python scripts/ba01-pacific-ballots.py
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/ba01-pacific-ballots.test.ts
```

`--apply` merges the verified additions by stable IDs. Existing ballot records
are retained. Repeated application produces no additions. Tests also verify
source hashes, all Hawaii general candidates' source fields, all Honolulu
questions, source timestamps, and county/city scope isolation.

## Acquisition methods and remaining coverage

- Hawaii's public Telerik form exports all 415 records after posting its hidden
  form fields and `ctl00$cphFooter$rdgSearch$ctl00$ctl02$ctl00$ExportToCsvButton`.
  Filter the source status, rather than assuming every legislative seat remains
  on the general ballot: 29 legislative contests were decided at the primary.
  Joint governor/LG tickets preserve both names. Maui's nine council residency
  seats are voted countywide; Hawaii and Honolulu council seats use districts.
- Washington's default Python request receives Cloudflare error 1010. A normal
  modern browser User-Agent plus browser Accept headers succeeds. The public
  native export uses the page's hidden fields and
  `ctl00$ContentPlaceHolder1$grdCandidates$ctl00$ctl02$ctl00$ExportToCsvButton`.
  Do not treat generic local `District` labels in the statewide export as county
  identifiers: its 599 declared offices collapse to 384 distinct raw
  district-type/district/race tuples. Acquire each county's ballot and list for
  those identities. King County's all-contests sample ballot explicitly warns
  that a voter is not eligible for every race in that document.
- For scanned ballots, render each needed PDF page, then run Tesseract with
  `OMP_THREAD_LIMIT=1`. Three concurrent default OCR processes oversubscribed
  this environment; they were terminated and the same pages completed with one
  OpenMP thread per process. Crop individual columns for reliable measure text.
- Oregon's native directive is directly readable with `pdftotext -layout`.
  Judicial district/county mapping comes from the five saved official court
  pages. Multnomah publishes separate general and RCV ballot content. Remaining
  work includes soil/water and utility districts, school and water measures,
  local work outside these counties, and each ZIP's full official sample-ballot
  comparison. Do not describe the Multnomah-area additions as complete county
  coverage.
- Alaska's election-office hostname returned 503; its previously working public
  CloudFront target returned 502 for both candidate pages and a sample ballot.
  Browser request headers did not repair those failures. Public DNS still names
  the same target. The official Judicial Council page was readable through the
  web source reader at `https://ajc.alaska.gov/retention/current2026.html`.
  Retention recommendations are excluded from ballot records. Legislative and
  federal roster comparison remains open. District judge and council contest
  delivery still depends on the reader resolving the corresponding districts.

No ZIP is claimed complete by these source comparisons. Root owns validation
against the production copy, the READY commit, and River handoff. The production
runner owns data publication after River ships; oversight owns live ZIP checks.
