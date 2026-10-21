# BA-01 southern source comparisons

Captured October 20–21, 2026; updated October 21 at 00:27 UTC. Reproduce counts with `python scripts/ba01-south-compare.py`. The capture metadata and source documents in this directory support that replay. These are source comparisons, not live ZIP acceptance results.

| State | Official comparison scope | Official contests / candidate rows | Held matches | Remaining work |
| --- | --- | --- | --- | --- |
| AL | Federal, statewide, legislative, education certifications | 167 / 241 | 167 / 241 | Full county, municipal, district and measure coverage |
| TN | Five federal, gubernatorial and legislative certified lists | 126 / 266 | 126 / 266 | Locals; House 93 says no candidate qualified |
| KY | Active federal and legislative candidate list | 126 / 206 | 126 / 206 | Locals |
| OK | Printed federal, statewide and legislative races across 77 county sections | 84 / 182 | 84 / 182 | Locals; unopposed offices omitted by the election authority |
| KS | All offices in the official candidate table, compared race by race | 247 / 362 | 247 / 362 | Full local contests and measures |
| NE | Full statewide candidate table, including regional/local offices | 411 / 521 | 42 / 92 core | 174 NRD races / 199 names and 195 other regional/local races / 230 names; two additional workers compensation retention candidates separately held |
| MS | Statewide sample including regional judicial and DA races | 133 / 188 | 100 / 146 | 33 regional races / 42 names; remaining appellate county relations and locals |
| LA | Federal and legislative candidate inquiry | 8 / 44 | 8 / 44 | 317 other office selectors need ballot-by-ballot comparison; selectors alone do not establish printed offices |
| AR | Regular federal, statewide and legislative general-ballot roster, checked against official handbook | 129 / 186 | 129 / 186 | One regional DA race / two names need division mapping; full locals |

MS's seven federal/legislative races include special House districts 70 and 77. LA's regular legislature is not up in November 2026. Their small core counts do not establish missing regular legislative seats.

This lane has added 16 countywide AL contests / 23 candidates, five KS State Board of Education contests / 10 candidates, 98 KS judicial contests / 99 candidates, 92 MS judicial contests / 119 candidates, the Hinds County DA special election / five candidates, two countywide DeSoto local contests / two candidates, and 157 AR contests / 228 candidates / nine measures. AR now also has both November legislative special elections: Senate District 1 and House District 8. Its core total, including specials, is **131 contests / 190 candidates**. Three circuit-judge runoffs add six more names, with 13 verified whole-county memberships routing each contest to its electorate. JSON totals are AL 187 contests / 264 candidates / four measures; KS 248 / 362 / one; MS 102 / 148 / zero; AR **179 / 261 / 13**.

All original AL, AR and KS contest, candidacy, measure and field-absence objects still appear unchanged after parsing. All first READY (`7e54e6ac5`) AR rows also remain unchanged, including IDs. General-roster and circuit-source replays are idempotent, and all IDs are unique. The nine-state comparison and `git diff --check` pass. `judicial-batch-preservation.json` confirms every preexisting KS and MS object and ID against the first READY commit; both new source replays are idempotent. All three tests in `tests/ba01-south-ar-ballots.test.ts` pass: saved general-ballot statuses, routing every constituent county while excluding neighbors/statewide scope, and separate regular/special House District 8 races. Root owns publication, production-copy validation and live checks; this lane claims no deployment or full ZIP ballot.

## Arkansas general-ballot source

The public roster's 198 names represent 134 office labels. House District 8 uses one office label for a regular race and a separate special race. After splitting those races using the official Benton County composite, there are 135 contests: 131 core races / 190 candidates and four regional judicial/DA races / eight candidates.

All 100 House districts and all 17 regular Senate districts are held. No regular federal, statewide or legislative IDs remain missing. The Senate District 1 special election is also confirmed by the governor's [July 2 proclamation](https://governor.arkansas.gov/news_post/sanders-calls-for-special-election-to-fill-vacancy-in-office-for-state-senator-for-district-1/).

`scripts/ba01-south-ar-general.py` checks the entire roster and all 198 public candidate-detail records uniformly. Each detail explicitly says `ElecCyDesc: General and Nonpartisan Judicial Runoff`, `OnGeneralBallot: True`, `Withdrawn: False`. The old heading on the candidate-search landing page does not describe these current records. Saved raw responses and their hashes are in `ar-core/sos-general-roster.json` and `ar-core/sos-general-details.json`. Filed home addresses and contacts in the source are not imported into reader records.

The working acquisition route is the landing page's published DataTables GET `/wp-json/metl/v1/all`, with `postID=2941`, the ordinary DataTables columns, and the form's **blank `CanBallotName` and `Descript` fields**. Leaving those blank fields out produced an empty body. The `Select One` affiliation placeholder must be omitted, as the page's `getData()` does. The published modal route is `/wp-json/metl/v1/find?postID=2941&key=FilerID&value=<id>`. No login or private credential is involved.

Saved county ballots and the state roster have three name variants: Ryan Rose / Ryan A. Rose, Steven Bright / Stephen Bright, and Bart Shulz / Bart Schulz. The existing county-printed names and IDs are preserved; they are matched by office, party and the documented spelling variant. House District 27's wrapped printed name is retained in full as Steven Walker.

All three circuit-judge runoffs are held under canonical OCD IDs (`circuit_court:2`, `:4`, `:16`). The official Judiciary's county-captioned directory places each whole constituent county in its named circuit and lists the elected division. `scripts/ba01-south-ar-circuits.py` checks the saved directory and candidate records before creating 13 directional county-to-circuit memberships. The focused ballot test checks all 13 county routes and excludes Benton County, statewide-only scope and a different state's Washington County.

The remaining regional office is Prosecuting Attorney District 11-West: two candidates are captured with explicit general-ballot status, but the OCD master does not distinguish its electorate from District 11-East. That electorate stays open. Full local comparisons and live ZIP acceptance remain acquisition/display work.

County replays remain `scripts/ba01-south-benton.py`, `ba01-south-pulaski.py` and `ba01-south-ar-core.py`; run the general-roster and circuit replays afterward to refresh coverage notes. Crawford's county-clerk `.gov` page links its election-commission domain. Marion embeds its notice in a base64 widget configuration. White's current `.ar.gov` site publishes a DOCX notice. A public VoterView address search resolves courthouse addresses and ballot styles without voter identity, but its sample-ballot route returned an empty block for both Washington and Pulaski and has not supplied a ballot PDF.

## Kansas judicial electorates

All 247 candidate/retention office tuples and all 362 names in the official 2026 General table now match race by race. The latest import adds 72 district-judge contests and 26 magistrate contests (99 names, including both Trego County candidates). The current Judicial Branch's explicit merit-selection district list establishes 56 retention races and 42 ordinary candidacy races. Party blanks alone do not decide the race type. Source-zero position/division values are not invented as reader-facing seat numbers.

The [current Constitution, Article 3 section 6](https://kslegislature.gov/b2025_26/laws/093_000_0000_chapter/093_003_0000_article/093_003_0006_section/093_003_0006_k/) elects district judges by judicial-district voters. [K.S.A. 20-2908](https://www.kslegislature.gov/b2025_26/laws/020_000_0000_chapter/020_029_0000_article/020_029_0008_section/020_029_0008_k/) explicitly distinguishes district-judge retention electorates from county magistrate electorates. [K.S.A. 20-336](https://www.kslegislature.gov/b2025_26/laws/020_000_0000_chapter/020_003_0000_article/020_003_0036_section/020_003_0036_k/) also elects partisan magistrates by their position's county. The official statewide district map and current district directories establish 78 county-to-district memberships and every magistrate's individual county. The two candidates with the same District 23 Position 3 tuple both reach Trego voters; no candidate home address defines an electorate. Captures, exact canonical ID extract and the magistrate proof rows are in `ks-judicial/`.

Replay with `python scripts/ba01-south-ks-judicial.py`. Candidate fields are taken uniformly from all 99 source rows, including both filed websites. No residential contact fields are imported. County, municipal, school and special-district contests and local measures remain open.

## Mississippi adopted judicial electorates

The judicial imports add 92 contests / 119 names from the official dated statewide sample: 87 trial-court races and five Court of Appeals races. The Hinds County district-attorney special election adds a further race and five names. The source comparison now holds 100 of 133 races and 146 of 188 candidate rows. Two additional countywide DeSoto local contests bring package totals to 102 / 148. The remaining 33 statewide-sample races / 42 names require precise electorates; other appellate county relations and full local coverage also remain open.

The serving-judge directory predates the districts used for terms beginning January 2027. Its old county lists are not used for those election scopes. The state government's [MARIS agency page](https://www.ms.gov/agencies/automated-resource-information-system-maris) links the official GIS publisher. MARIS's [current judicial redistricting page](https://maris.mississippi.edu/HTML/Redistricting/MS_Judicial.html) publishes the adopted 2027-term chancery and circuit polygons, including the 2026 circuit update. Every imported trial-court district is exactly equal to its full-county union; the maximum symmetric-difference fraction is 1.68e-13 after coordinate conversion. The 1e-10 tolerance covers only numerical round trips. Precinct subdistricts are not expanded into counties. Circuit subdistrict 6-3 is exactly Pike County and uses that county's canonical ID.

MARIS separately identifies its [1990 congressional polygons as the current Court of Appeals districts](https://maris.mississippi.edu/html/data/data_Political/1990USCongressionalDistricts.html). Thirteen whole-county memberships for four appellate electorates are supported to the same numerical standard. Other counties are excluded because their polygons either split between appellate districts or differ from the historical geometry; no near-whole coverage threshold is accepted. This limits reach without misassigning a ballot.

Saved raw GIS archives, the government link, exact registry IDs and `verified-electorates.json` are in `ms-judicial/`. Reproduce with `python -m pip install -r scripts/ba01-south-gis-requirements.txt` in an isolated environment, then `python scripts/ba01-south-ms-courts.py`. GIS packages are source-replay tools, not application dependencies. Both candidates in every contested race receive identical fields and extraction effort.

All five tests in `tests/ba01-south-judicial-ballots.test.ts` pass. They exercise county routing through the reader selector, Kansas magistrate exclusions and the full Trego pair, Mississippi counts for eight example counties, Hinds/DeSoto exclusions for precinct-split judicial electorates and the county-scoped Hinds DA special election, state-only and foreign-state exclusions, raw source hashes, numerical proof limits and uniform candidate fields. No live ZIP acceptance result is claimed.


The Governor's [July 10, 2026 announcement](https://governorreeves.ms.gov/governor-tate-reeves-appoints-brad-mccullouch-to-serve-as-hinds-county-district-attorney/) expressly identifies District Attorney 7 as covering Hinds County and sets the special election for November 3. `scripts/ba01-south-ms-da.py` checks those exact statements and every one of the five independent candidates on the dated statewide sample. That contest uses Hinds County's canonical ID; the circuit judges' precinct subdistricts are left separate. The source capture is in `ms-judicial/hinds-da-special.html`.


## DeSoto four-style comparison

The county's current official candidate page links a complete four-page sample pack. All four styles contain Chancery 17 Places 1/2, Circuit 21 Places 1/2/3, both Court of Appeals 1 positions, County Court Place 1 and the County Attorney special. Style 3 includes the five ordinary court races alongside its two narrower subdistrict races, so the ordinary electorates cover the whole county. The narrower GIS rest-of-county polygons do not define those ordinary seats' electorates. Three DeSoto memberships now route the five ordinary and two appellate races correctly; all earlier candidate names and IDs remain unchanged.

The import adds five statewide-sample court races / seven candidates and two local races / two candidates. `scripts/ba01-south-ms-desoto.py` checks every style's date, office labels and OCR hashes; exact court names and parties come from the state sample and current county list, with the two local names/parties from the county sample. The replay is idempotent.

| Official DeSoto style | Official races / candidates | Held races / candidates | Remaining |
| --- | --- | --- | --- |
| 1 | 12 / 20 | 11 / 18 | Justice Court District 1 |
| 2 | 11 / 18 | 11 / 18 | None |
| 3 | 13 / 22 | 11 / 18 | Chancery 17-1 Place 3 and Circuit 21-1 Place 4 |
| 4 | 12 / 20 | 11 / 18 | School Board District 5 |

The reader selector matches Style 2 exactly with the verified state, congressional and county divisions. This is a source-and-selector result; live ZIP acceptance remains root's check. Raw county pages, the official PDF, all four style extractions and the race counts are in `ms-desoto/`.

The Mississippi October 20 sample capture is retained separately from the October 14 capture of identical bytes. Source receipt identity includes URL, hash and actual retrieval timestamp. All 360 new MS records, 290 KS records and 398 AR records were audited for exact source-URL/capture-time receipt matches; none were missing. The focused regression test covers every imported MS contest, candidate and district membership.

## Nebraska full table comparison

`scripts/ba01-south-ne-rows.py` replays all 24 pages of the saved official final candidate list from its exact PDF bytes. Every page reconciles: pages 1–23 each contain 22 candidate rows and page 24 contains 15, totaling **521**. There are **411 office/district/term/vote-limit tuples**: the 42 core races / 92 candidates already held, **174 natural-resources-district races / 199 candidates**, and **195 other regional/local races / 230 candidates**. Short terms and full terms for the same subdivision remain distinct. The prior “64 NRD rows” count counted wrapped continuation headings and is corrected.

`ne-source-inventory.json` preserves all candidate names, printed party cells, incumbency, vote limits, terms, exact source metadata and page counts, without filed addresses or private contacts. The other regional/local rows include community-college boards, public-power and utilities districts, educational-service and learning-community boards, and reclamation districts. The full OCD master contains no Nebraska natural-resource-district divisions; exact electoral divisions and routing remain acquisition work. No new NE reader records or completeness claims were created by this comparison correction.

## Territorial packages

`territories/README.md` and `import-comparison.json` describe the new AS, MP and VI packages: **49 contests / 186 choices plus 8 running mates (194 people)**. All 17 AS House districts and six delegate names are held. MP's certified list and every specimen front match all 77 people; 21 of 22 contests publish, with its Northern Islands mayor / two names retained as the sole unresolved electorate. VI's 10 unique contests include both district samples, all 70 choices and five explicit running mates. Five focused tests pass real selector counts for all 13 MP fronts and both VI samples, exact source receipt identity and AS district exclusions. Replays are idempotent. GU requires an official backlink to its actual captured government-account specimen; PR's next regular general date is expressly Nov 7, 2028 and its Cataño special was expressly Sep 27, 2026. No GU or PR package was invented. Root owns production-copy promotion and live verification.
