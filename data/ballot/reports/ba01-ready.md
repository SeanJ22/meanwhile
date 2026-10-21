# BA-01 return repair

The five River return defects are repaired. This is the replacement READY; River acceptance is the finish line. Remaining acquisition and live coverage work belong to a new step.

The daily `ballot-contests:<ST>` runner remains the production publication path. This lane uses an isolated production database copy for validation. No production write credential is requested or used.

## Return repairs

- Tucson preserves all 22 original reader contest IDs, all 91 prior Arizona contest objects, and every prior candidacy identity. Both newly verified races remain available. Explicit governor ticket aliases restore the original candidate targets and keep the older party disagreement as sourced history.
- All three capture scripts use `launchGuarded`.
- 61 credential substrings in 44 saved artifacts are redacted, including 17 gzip files. Original page/container fingerprints and exact sanitized hashes are retained in `../ba01-source-redactions.json`. Unsanitized copies stay outside Git. The unused third-party NYC JavaScript capture is omitted, with its original fingerprint retained.
- The extra reviewed Arizona entries were Maricopa Proposition 413, Peoria Proposition 417 and Tempe Proposition 424. Their official questions and full YES/NO statements stay in raw measure records. They no longer masquerade as reviewed plain-English summaries. All 15 original reviewed summaries and 52 reaction targets remain unchanged. Arizona has 18 measure contests and seven raw question records; these are different counts.
- River's four requested files pass all 40 tests.

## Counts by state

Counts below are the actual promoted production-copy readback. Candidates are raw candidacy records, not distinct people. Measure contests are already included in contests; question records count separately stored official wording. Input files contain 11,608 contests and 19,860 candidacies; the copy publishes 11,604 and 19,853. Four Illinois races and seven associated filings remain held, with reasons in `ba01-production-copy.json`. No prior production ID was lost.

| State | Contests | Candidacies | Measure contests | Question records |
| --- | ---: | ---: | ---: | ---: |
| AK | 76 | 153 | 2 | 2 |
| AL | 187 | 264 | 4 | 4 |
| AR | 179 | 261 | 13 | 13 |
| AS | 18 | 44 | 0 | 0 |
| AZ | 169 | 297 | 18 | 7 |
| CA | 346 | 461 | 79 | 79 |
| CO | 165 | 321 | 20 | 20 |
| CT | 197 | 544 | 0 | 0 |
| DC | 16 | 51 | 1 | 1 |
| DE | 77 | 130 | 0 | 0 |
| FL | 307 | 514 | 62 | 62 |
| GA | 279 | 479 | 6 | 6 |
| HI | 92 | 138 | 32 | 32 |
| IA | 140 | 246 | 1 | 1 |
| ID | 423 | 574 | 4 | 4 |
| IL | 166 | 256 | 0 | 0 |
| IN | 142 | 274 | 2 | 2 |
| KS | 248 | 362 | 1 | 1 |
| KY | 127 | 206 | 1 | 1 |
| LA | 18 | 44 | 10 | 10 |
| MA | 232 | 304 | 9 | 9 |
| MD | 336 | 671 | 51 | 51 |
| ME | 278 | 470 | 0 | 0 |
| MI | 340 | 707 | 2 | 2 |
| MN | 392 | 683 | 1 | 1 |
| MO | 195 | 367 | 5 | 5 |
| MP | 21 | 72 | 0 | 0 |
| MS | 102 | 148 | 0 | 0 |
| MT | 146 | 269 | 3 | 3 |
| NC | 561 | 999 | 6 | 6 |
| ND | 409 | 612 | 3 | 3 |
| NE | 48 | 94 | 4 | 4 |
| NH | 98 | 165 | 28 | 28 |
| NJ | 109 | 304 | 0 | 0 |
| NM | 255 | 333 | 7 | 7 |
| NV | 78 | 152 | 2 | 2 |
| NY | 268 | 523 | 5 | 5 |
| OH | 223 | 433 | 8 | 8 |
| OK | 95 | 191 | 2 | 2 |
| OR | 116 | 262 | 3 | 3 |
| PA | 188 | 317 | 4 | 4 |
| RI | 126 | 161 | 5 | 5 |
| SC | 298 | 501 | 0 | 0 |
| SD | 89 | 187 | 4 | 4 |
| TN | 129 | 266 | 3 | 3 |
| TX | 1,736 | 2,166 | 8 | 8 |
| UT | 142 | 267 | 3 | 3 |
| VA | 427 | 1,068 | 64 | 64 |
| VI | 10 | 70 | 0 | 0 |
| VT | 140 | 369 | 2 | 2 |
| WA | 156 | 275 | 4 | 4 |
| WI | 195 | 322 | 3 | 3 |
| WV | 196 | 360 | 3 | 3 |
| WY | 98 | 146 | 1 | 1 |

## Production-copy ZIP checks

All 15 normal reader selectors return promoted ballots. Each full race list, candidate identity and official source URL is in `ba01-production-copy.json`. All 15 actual local browser pages returned HTTP 200; `ba01-production-copy-pages.json` records their visible race IDs and candidate cards. Tucson 85701 separately shows 24 contests, including every original 22 contest ID. Browser screenshots were inspected. These local development timings do not establish production performance. A ZIP can span multiple ballot styles; the following counts do not certify every address or an official sample match.

| ZIP | Selector contests | Visible page contests | Candidate cards | Held races omitted by page | Unresolved district family |
| --- | ---: | ---: | ---: | ---: | --- |
| 78701 | 53 | 53 | 87 | 0 | U.S. House |
| 94110 | 52 | 39 | 37 | 13 | U.S. House |
| 43215 | 28 | 28 | 53 | 0 | U.S. House |
| 53703 | 12 | 12 | 16 | 0 | None reported |
| 19103 | 8 | 8 | 9 | 0 | None reported |
| 85003 | 83 | 83 | 99 | 0 | None reported |
| 80202 | 55 | 48 | 75 | 7 | None reported |
| 98101 | 26 | 26 | 33 | 0 | None reported |
| 10001 | 15 | 15 | 31 | 0 | None reported |
| 30303 | 22 | 22 | 46 | 0 | None reported |
| 33130 | 29 | 23 | 30 | 6 | U.S. House |
| 07102 | 3 | 3 | 10 | 0 | None reported |
| 48226 | 23 | 23 | 113 | 0 | State Senate |
| 46204 | 14 | 11 | 19 | 3 | None reported |
| 96813 | 29 | 29 | 20 | 0 | None reported |

NYC 10001: the verified 315 W 29th Street paper style has 16 races. The normal ZIP selector returns 15: City Council District 3 and Municipal Court District 3 are missing, while the split ZIP adds State Senate District 28. Madison 53703: the ZIP union returns 12 races; the Central Library Ward 52 printed style has 11, with all 11 held and independently compared. Exact address narrowing remains open.

The existing page filters out the `RETENTION` type: San Francisco omits 13 held judicial races, Denver seven, Miami six and Indianapolis three. All are present in the promoted data and normal selector. This requires a display repair in a new step; `app/ballot/page.tsx` is outside this lane. No contest was deleted to make the checks pass.

## Verified source expansion

Ohio's 139 core contests and 310 active choices match acquired official lists and
samples, including all 15 congressional, 17 Senate and 99 House races. Its 311th
raw core record remains as a sourced withdrawn filing. Michigan now matches all
338 candidate-bearing contests and 707 eligible names in the acquired final SOS
list, including 168 judicial races. Minnesota's 221 core contests / 427 choices
and 114 district-judge races / 117 names are checked separately. Kansas accounts
for every one of 247 races / 362 names in its official statewide table. Arkansas
accounts for all 129 regular core races plus both legislative specials.

Texas adds all 269 certified district-judge contests / 328 names, including the
sole declared write-in in District 276, plus the declared-write-in-only District
Attorney 31 special. Exact current court jurisdictions and enacted HB16 resolve
the obsolete Guadalupe entry for District 274: that court now serves Comal and
Hays. All 17 names in the statewide declared write-in certificate are accounted
for. The earlier county import holds all 1,222 countywide offices / 1,346 names
printed for all 254 counties in the final certification. Regional appeals,
prosecutor, precinct, municipal and special-district scope work remains open.

California's 58 official county-to-appellate-district memberships let San
Francisco county readers reach all eleven held First District retention races.
Los Angeles adds 34 certified county/city races / 54 candidates and 54 complete
county/city questions. Its other district races and 14 school/college measure
electorates remain open. Earlier San Francisco additions include all five
countywide candidate offices and eleven local/regional questions.

Further verified county batches include statewide county/judicial lists in
Idaho, North Dakota and New Mexico; selected Montana and Utah judicial races;
Maine's 88 local races / 108 names; New York Supreme Court and selected NYC local
races; Maryland's circuit candidates and all 48 county/city questions; selected
Ohio and Minnesota municipal/school offices; and Florida, Georgia, Mississippi
and other regional additions. Miami-Dade's 55 local questions are held; its
candidate and special-district coverage remains partial. Florida's 31 certified
unopposed core contests are legally omitted from printed ballots; the report
keeps certified-roster counts separate from actual sample counts.

American Samoa has its first verified input, 18 contests / 44 choices. The
Northern Mariana Islands hold 21 of 22 certified/sample races, 72 choices and
three explicit governor mates; Northern Islands mayor's exact electorate remains
open. The U.S. Virgin Islands hold all ten source contests / 70 choices and five
explicit mates. Guam's sample is acquired but the government publisher backlink
is not established. Puerto Rico's next regular general election is 2028; no
November3 contest is invented.

Every new candidate receives the same extraction effort and fields within its
contest, including literal independent/minor-party labels and filed websites
where supplied. No candidate is supplied for a blank write-in line. Six empty
North Dakota offices and Richland County's coroner remain explicit held gaps.

## Verification

The isolated Neon branch `br-wandering-shape-ax3ranho` copies production branch `br-delicate-lab-ax02xuo5`. All 46 copied migration hashes match the committed journal. All 54 jurisdiction inputs publish through the ordinary assembler and Postgres store; every copied prior contest, candidacy and measure ID remains. Actual final Arizona vote wording and joint tickets were also checked on the copy. Reports retain the branch, migration hashes, prior versions and input fingerprints. The test branch expires automatically.

The full suite exercised all 1,211 files / 8,898 tests: its initial result was 8,888 passed, five failed and five skipped. All five failures were corrected. Three affected files needed the repository's existing postinstall projector to replace stale October 4 generated references; no tracked source change was needed. The copy helper's duplicate migration-journal query was replaced with the shared receipt reader. The four files then passed the canonical `pnpm test` selection: 54/54 tests. The original full-run totals remain in `ba01-validation.json`; a second full run is not claimed.

Full-project TypeScript passes after correcting two test annotations found by the gate run. Lint, pinned Chromium, database gate, default build, bundle tests (16/16), and standalone build pass. The completed standalone traces also pass all 12 deploy-path checks. River's requested files pass 40/40, Python source replays 54/54, and the Ask route plus new budget regression pass 33/33. Final preflight is recorded in `ba01-validation.json`.

Sean approved these named ownership exceptions: the one-line fix in `lib/civic-data/source-authority.ts`, and the bounded summary fix in `lib/ask/ballot-summary.ts` ("Allow this Ask summary fix"). Expanded ballots now retain every sourced contest record while a summary exceeding the existing prose budget uses the correct counts. Small ballots keep their full named summary. The existing validator remains unchanged.

BL-30 retains its exact original 22-contest ID hash and every prior candidate assertion; it separately requires both additional source-verified races. All 91 prior Arizona contest objects, every prior candidacy ID, all reviewed summaries and all 52 provision IDs remain checked.

## Remaining work for a new step

River owns integration/release. The existing daily runner owns production publication; its live refresh and current runner health remain unverified here (River lists RN-01 as pending). Oversight owns post-publication live race-by-race acceptance for all 15 ZIPs. No post-publication live acceptance is claimed here.

`ba01-national-comparison.md` and regional comparison reports retain every state/DC denominator and gap. Major regular core gaps remain in Pennsylvania, New Hampshire, Wisconsin and Illinois. Alaska's full core denominator is unmeasured. Arizona CD3/4/8 certification limitations remain explicit. Nebraska's saved source has 411 contest tuples / 521 choices, including 174 NRD races / 199 choices and 195 other regional/local races / 230 choices still requiring exact electorate mapping.

County, city, judicial, school, special-district and local-measure acquisition remains incomplete beyond the individually verified source sections. Exact address/style matching remains open except for the particular examples recorded in `ba01-zip-acceptance.json`. The unresolved geography families in the ZIP table require work outside this lane's original ownership. The current step stops when River accepts this READY; none of this remaining work is started here.
