# CL-01 — One person, one card

Built on `stream/cl-01`, cut from `origin/river` at `21ae9bcfb663794953b07a9d7977b228cab67c2d`.

Residents get one choice per person and race, with separate person cards for running mates. Ballot-source duplicates share aliases and sources. Incumbents retain their held records, positions, official portraits and contacts. Verified official member links also carry a person’s record when they seek a different office; that does not make them the incumbent in the new office.

The separate nominee/current-candidate rendering paths and the name-concatenating ticket implementation were replaced. Reactions, saved picks, Ask context, questionnaire names and demand targets resolve historical aliases. No database migrations or production writes are part of this lane. Official field values take priority over reference values; newer official captures win ties. Joint cells split on published slashes, “and”, ampersands or line breaks; surname-only official cells retain the published surnames.

## Counts on production holdings

Each jurisdiction was read separately from Reader project `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, role `readonly`. The “after” columns apply this branch’s reader projection to those published records; they are not a claim that this code is deployed. Before counts use the replaced reader projection. Linked counts count distinct candidacies connected to a current held person, including independently verified official-profile links. Source rows remain evidence. Cross-endorsement parties remain on the merged choice.

| State | Duplicate entries before | After | Linked to held person | Tickets as one choice |
| --- | ---: | ---: | ---: | ---: |
| AK | 0 | 0 | 33 | 5 |
| AL | 0 | 0 | 128 | 0 |
| AR | 0 | 0 | 43 | 0 |
| AS | 0 | 0 | 0 | 0 |
| AZ | 4 | 0 | 78 | 4 |
| CA | 0 | 0 | 123 | 0 |
| CO | 0 | 0 | 67 | 7 |
| CT | 174 | 0 | 153 | 5 |
| DC | 0 | 0 | 0 | 0 |
| DE | 0 | 0 | 37 | 0 |
| FL | 0 | 0 | 114 | 10 |
| GA | 0 | 0 | 210 | 0 |
| GU | 0 | 0 | 0 | 0 |
| HI | 0 | 0 | 30 | 2 |
| IA | 0 | 0 | 95 | 2 |
| ID | 0 | 0 | 41 | 0 |
| IL | 0 | 0 | 124 | 3 |
| IN | 0 | 0 | 105 | 0 |
| KS | 0 | 0 | 76 | 2 |
| KY | 0 | 0 | 106 | 0 |
| LA | 0 | 0 | 3 | 0 |
| MA | 0 | 0 | 11 | 3 |
| MD | 0 | 0 | 145 | 4 |
| ME | 0 | 0 | 96 | 0 |
| MI | 0 | 0 | 100 | 5 |
| MN | 0 | 0 | 144 | 3 |
| MO | 0 | 0 | 117 | 0 |
| MP | 0 | 0 | 0 | 3 |
| MS | 0 | 0 | 5 | 0 |
| MT | 0 | 0 | 76 | 0 |
| NC | 0 | 0 | 157 | 0 |
| ND | 0 | 0 | 47 | 0 |
| NE | 0 | 0 | 17 | 4 |
| NH | 0 | 0 | 7 | 0 |
| NJ | 0 | 0 | 29 | 0 |
| NM | 0 | 0 | 43 | 2 |
| NV | 0 | 0 | 46 | 0 |
| NY | 0 | 0 | 169 | 2 |
| OH | 0 | 0 | 98 | 6 |
| OK | 0 | 0 | 57 | 0 |
| OR | 0 | 0 | 65 | 0 |
| PA | 0 | 0 | 168 | 3 |
| PR | 0 | 0 | 0 | 0 |
| RI | 0 | 0 | 79 | 0 |
| SC | 0 | 0 | 117 | 4 |
| SD | 0 | 0 | 66 | 2 |
| TN | 0 | 0 | 103 | 0 |
| TX | 0 | 0 | 147 | 0 |
| UT | 0 | 0 | 68 | 0 |
| VA | 0 | 0 | 13 | 0 |
| VI | 0 | 0 | 0 | 5 |
| VT | 0 | 0 | 5 | 0 |
| WA | 0 | 0 | 108 | 0 |
| WI | 0 | 0 | 87 | 2 |
| WV | 0 | 0 | 78 | 0 |
| WY | 0 | 0 | 40 | 0 |
| Total | 178 | 0 | 4074 | 88 |

These are [current reader counts](measurements/cl-01/current-reader-counts.json), including retention choices and the existing official withdrawal filter: 19,847 choices before and 19,669 after. The earlier total of 89 tickets included one withdrawn Ohio ticket. There are 88 current tickets; the 89th held ticket, Ron Ula / Michael C. Lehnerd, remains in filing history with both separate people and all their aliases. The official Cuyahoga candidate-list capture records their October 15 withdrawal. Every one of the 89 held ticket records has two distinct named members. No two separate current choices in one canonical contest resolve to the same verified held person.

40,030 person and source keys resolve; zero earlier raw/displayed keys are missing. The 18 candidate targets already used by 30 production reaction/demand records all resolve. Existing Speak posts retain their submitted subject IDs, and Ask resolves those aliases to the correct person.

## Two production connections

The Arizona ballot pointer is `cv-9015276228f16597cc83a46351ffa385` (published October 23). Candidate profiles are `cv-26e47527f29ab75335fac71d8ed864f0`. These are existing production facts, read without changing either database.

- **Alma Hernandez**: `ballot-az-pima:state-senate-20:hernandez-alma` and its prior card alias link to the held person through the [official candidate list](https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf) and [official member page](https://www.azleg.gov/House/House-member/?legislature=57&session=130&legislator=2312). The native legislature ID on that page also exists in the held person’s identity; their portrait, record and contacts stay attached across the office change.
- **Sally Ann Gonzales**: `ballot-az-pima:state-house-20:gonzales-sally-ann` and its prior card alias link to the held person through the [official candidate list](https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf) and [official member page](https://www.azleg.gov/Senate/Senate-member/?legislature=57&session=130&legislator=2381). The native legislature ID on that page also exists in the held person’s identity; their portrait, record and contacts stay attached across the office change.

Betty Villegas also retains the current official House profile with legislature ID `2346`. Hobbs’s USA.gov, official governor and OpenStates records identify the same single statewide seat; the rich governor portrait and contacts are retained rather than replaced by an empty source slot. Each ticket’s mate keeps a separate subject and card. John Giles has a sourced ticket candidacy; no separate held roster person was found.

## Scheduled refresh

`tests/assemble-ballot-package.test.ts` exercises the registered daily task with a controlled clock: it is not due immediately, becomes due at its cadence, sees changed input bytes, runs the real publication function against an in-memory store, replaces both lead and running-mate source IDs, and retains every earlier ID plus the held-person link. Running-mate aliases stay separate from the lead’s aliases. Existing unchanged publications are also normalized at read time. This covers the live runner’s existing “State file unchanged” decision without forcing database writes or changing its schedule.

The bridge tests also reverse the three Hobbs source records on the next reconciliation and retain `statewide:az/governor` as the person identity. The automatic task and source merge use the same alias contract; no manual backfill is required.

## Chrome and release state

Google Chrome for Testing 156.0.8078.47 inspected the actual meanwhileusa.com pages before the change. A local branch server then read the same production holdings through the specified read-only roles. That second check is branch verification, not a production deployment.

Chrome comparison covers AZ 85701 plus CO 80202, WI 53703, MI 48933, PA 19147, CA 95814, NY 10007, TX 78701, FL 32301, GA 30303 and NH 03301; Connecticut 06103 additionally exercises cross-endorsement tickets. Individual cards were opened and Sources checked, with settled vote and statement contents checked where held.

First visible contests on the original 11-state production sample were 1.5–2.9 seconds. The additional NH first read was 3.653 seconds; that is recorded as a failed speed check. Development/proxy timings are not production speed evidence.

Arizona’s final branch comparison has zero missing baseline biographies, links or aliases. All four named portraits decode; Hobbs retains receipts of $15,044,057.16 and expenditures of $17,793,857.40. Connecticut governor choices fall from seven to five, retaining both cross-endorsement parties. Betty’s own card uses the current official member page (legislature 57, session 130, legislator 2346).

[Arizona before](measurements/cl-01/az-before.png) · [Arizona branch](measurements/cl-01/az-branch.png) · [Connecticut branch](measurements/cl-01/ct-branch.png)

Pending: River must fold and deploy this READY, then the same Chrome journeys and the next automatic production pass must be checked on meanwhileusa.com. This lane remains open until board/river says CL-01 passed its live check. Only stream/cl-01 is pushed.

PT-01 can use `Candidacy.aliases`, its person-specific `ticket.runningMate`, and the verified person graph; a ticket-wide historical key resolves to the lead, while the mate’s historical keys resolve only to the mate.

The per-person audit found no lost current general-election candidate links. Horne and Myers remain retained primary filings with their old IDs; the complete sourced general lineup omits them.

## River return repair

The return exposed five regional school-board contests in New Jersey being collapsed into two. Their shared board division and office title did not identify the constituent township seat. Race matching now retains the published scope, number of seats and term; all five original contests and their candidates remain. Already joint office titles keep the authority's wording, and unchanged historical filings retain their exact source fields.

The raw ballot accessor again returns the exact published holding. Person and ticket consumers explicitly request the cached derived view. During publication, candidacy history remains available until alias enrichment and retirement finish; releasing it earlier caused otherwise valid updates to be held. The unchanged all-state Postgres publication test exercises the real migrations and retains every prior ballot ID.

Ticket assertions now check the displayed pair, two distinct person IDs and the exact official pairing source. Reader assertions resolve each historical nominee alias to exactly one visible choice and check its own card's filing source. Original contest and candidate count/hash assertions remain in place.

Verification after merging `origin/river` at `bd77dcb0f`: all seven returned suites pass, plus the ticket, alias and scheduled-refresh suites (83 distinct checks, zero skipped; the final changed Wisconsin and reader suites were rerun together, 32/32). TypeScript, changed-file lint, the existing dead-code check and diff whitespace checks pass. The unchanged worker/publication suites additionally pass 23/23. The production-snapshot recount remains 178 duplicates before, zero after, 4,074 linked candidacies and 88 current tickets, with no original key or existing activity target missing.

Google Chrome comparison of meanwhileusa.com and the repaired branch at Morristown `07960` retains all 22 contest IDs and 53 choices. None of the original candidate aliases, biographies, candidate links or source links are missing; no candidate changes race. All five allocated regional-board seats remain separate. The live page's first visible contests took 1.824 seconds; the cold development branch took 5.842 seconds, recorded above three seconds and not a production speed pass. No page errors occurred; four event writes were blocked. [Mendham live](measurements/cl-01/nj-mendham-live.png) · [Mendham repaired branch](measurements/cl-01/nj-mendham-branch.png).


## Complete office and seat matching

An audit of the zero-link states exposed source office wording that the shared parser did not recognize. The parser now uses the source division to interpret ambiguous chamber labels, known jurisdiction names/codes, and numeric, Roman or written district numbers. All 3,403 previously classified production titles retain their original classification. Person matching still requires the same conservative name, exact district, office, and unique held identity. An independently held official profile supports the person relationship when its roster omits a position label; known conflicting seat or district values still refuse the match. Incumbency retains the stricter exact-seat check.

Lettered seats, position abbreviations, court groups, and term commencement dates remain separate races. This preserves Ohio's distinct January 1 and January 2, 2027 Supreme Court terms. Across all 56 production snapshots, all 11,602 original separate contests remain separate, and all 19,847 old visible choice targets resolve in their correct races. Only the 178 source duplicates merge. No original choice, race, source key or ticket member alias is missing or reassigned. Explicit ticket-member identity checks pass 21/21.

The recount links 4,074 candidacies to held people (991 more than the first CL-01 projection), with zero lost current general-election person connections against the original reader's 2,734 valid links. The two source-backed retired Arizona primary filings remain accessible as described above. The comparison uses the exact pre-CL-01 office and seat matching code for its baseline.

Chrome additionally compares the live baseline with this branch at WA `98101` (26 contests, 33 choices), UT `84101` (13, 20), OH `43215` (28, 53) and VA `20175` (10, 9). All entries, names, aliases, biographies and candidate links remain. Ohio's two Supreme Court terms each retain their own candidates and pick control. Seattle's Jayapal card carries the held portrait, contact, voting record and sources; Utah's checked cards carry held terms and contacts, without claiming a portrait or voting-content proof for them. Live first-visible contests were 1.778 seconds in WA, 1.779 in UT and 1.295 in OH; the WA development read was 3.355 seconds and is recorded above the target.

Cold Chrome checks exposed two further connections that component checks had missed. Husted's publisher-specific ID sent his records to an invalid directory endpoint; the merged federal card now uses its unique native Congress key while retaining every publisher ID as an alias, and loads the native held record and its portrait provenance. His card now shows recent and selected votes, its original Congress image citation, and successful directory, vote and profile responses. [Held record](measurements/cl-01/oh-held-record.png).

His [Ohio candidate list](https://www.ohiosos.gov/assets/dir2026-45-form-of-the-official-ballot-for-the-november%203-general-election.pdf) and [official Congress member source](https://api.congress.gov/v3/member/H001104?format=json) identify the same senator. Subramanyam's [Virginia candidate list](https://www.elections.virginia.gov/media/castyourballot/candidatelist/2026/2026-November-Federal-Offices-Candidate-List-(rev-10-6-2026).xlsx) and [official Congress member source](https://api.congress.gov/v3/member/S001230?format=json) identify the same House member.

The FEC slice was being pinned before the concurrent official-directory read supplied native person keys. The funding preload now finishes that shared read and includes only the displayed divisions' exact native identities before selecting its slice. An actual read-only replay of production pointer `cv-5ebb867fb8b5281fa6b785a1276734a0` changed Suhas Subramanyam's empty first slice into the already-held `H4VA10279` registration. All amounts remain null and no committee or contribution rows are invented. Funding also resolves old candidate and mate aliases, and the card uses the returned alias-aware result. Cold Chrome shows the FEC registration, source and explicit campaign-totals gap on Suhas's own card. [FEC registration](measurements/cl-01/va-fec-registration.png).

Current focused checks: 71 returned-ballot/schedule checks and 38 office/seat/person checks pass; the final reader, holder, alias, contextual-money and first-read FEC checks pass 31/31. The existing numbered-seat refusal test remains unchanged. Full TypeScript, lint for all 23 changed TypeScript files, the existing dead-code check and whitespace checks pass. These are branch and read-only production-data proofs. River's deployed Chrome check and the next automatic production pass remain pending.

The subsequent River return (`fix:98f6f83c`) is repaired with its two original assertions intact. The page explicitly passes the source contest's seat count into the checked incumbency input. An unresolved card/filing relationship no longer joins their corpora: each ID retains its own sourced statements, and Ask can answer from the card itself. The prior CL-01 assertions that incorrectly combined a party-conflict card and filing were restored to upstream's expectations. Production Hourihan's current single-card, joint-card and filing aliases remain reconciled by the newer official list; the superseded disagreement does not affect her current biography or corpus.

The ID-only money-slice fixture again runs without adding names. Missing display-name fields yield no invented name alias, while existing IDs remain usable. Given-name initials remain as filed. The returned checks plus related identity, name and first-read money tests pass 47/47, with full TypeScript, changed-file lint and the existing dead-code check passing. `origin/river` was fetched and merged for this repair; at that check it still pointed to `bd77dcb0f`, so River's pending BL-01 integration and its carried name-casing fixes remain part of the combined release check.

## Raleigh and preservation of merged source records

River folded READY `16159c59d` into the release 97 candidate and cleared the return. Its combined ballot check passed 359 tests. River also found Deborah K. Ross twice in Raleigh's “Who governs here?” on release 96. Actual Chrome confirms two rows under NC-2: one rich card with her portrait, and one incomplete card incorrectly describing state-representative powers.

Both held records identify Bioguide `R000305`. The official Congress source supplies a current federal House membership for NC-2 but calls the office “Representative”; the directory calls it “U.S. Representative.” The shared holder merge now interprets a bare chamber title only from its unique selected current federal membership. Exact native-person and place checks still apply. Explicit state offices, an ended or wrong-chamber membership, a missing identity and a conflicting division remain separate.

The merge retains all original source records, memberships, social accounts and aliases. The existing ballot source-record helper moved to `lib/officials/held-sources.ts`; its old export and repeated ballot-only source collection were deleted. All person, district and body Sources can now retain the original records behind a merged person, including alternate portrait citations. Agreement on an ISO date's year or month preserves the already-held day and its actual source; conflicting dates keep the normal source precedence. The ballot projection uses the same date-refinement rule when it reads those original records again.

The [56-state production replay](measurements/cl-01/federal-source-preservation.json) removes 342 duplicate federal rows (881 rows to 539) with zero duplicates afterward and zero wrong native-person, office or division joins. All 8,669 original identity keys, 616 portrait records, 3,264 card source URLs, 1,715 social-account records, 2,818 memberships, 6,631 term values and 1,850 contact values remain accessible. This includes all 78 alternate portraits whose different source URLs must remain available. Reprojecting every newly merged holder onto the ballot yields zero office, native-ID, date, portrait or source regressions. The candidate recount remains 178 duplicate choices before, zero after, 4,074 held-person links and 88 current tickets in all 56 jurisdictions.

A read-only replay of NC package `11e4ac9153d5af0046a567de95722e072ba4ec935d590149d920eb5b7e59649f` returns one `congress:R000305`, retaining the full January 3, 2025 term start, four source memberships, three social accounts, phone and both API aliases. Chrome on the branch retains all nine distinct people while reducing ten rows to nine. Ross's rich card retains its contact, money, votes, statements and exact original image citation. [Live duplicate](measurements/cl-01/nc-ross-live-before.png) · [Branch single entry](measurements/cl-01/nc-ross-branch.png).

Chrome also reproduced an enabled, hydrated “Who governs here?” click being discarded while coverage was loading. The first resolved ZIP was resetting the reader's open intent. It now preserves that first click; changing to a different resolved ZIP still closes the old place's card. The same delayed-read reproduction now opens one Ross entry with one click, an untouched load stays closed, and an actual second-tab ZIP change from 27601 to 27701 closes the old card. The original failed reproduction is retained. [One-click result](measurements/cl-01/nc-one-click-branch.png).

At Tampa 33602, Chrome and the held current federal membership independently establish Kathy Castor's FL-14 card. She appears once, her selected portrait decodes, and her own Sources retains both `https://www.congress.gov/img/member/c001066_200.jpg` and `https://castor.house.gov/images/kathy_castor.jpg`. [Original portrait source](measurements/cl-01/fl-castor-original-portrait-source.png) · [Current portrait source](measurements/cl-01/fl-castor-current-portrait-source.png).

The connected identity, original return, card-source, ballot-money and representation checks pass 102/102; full TypeScript, changed-file lint, the existing Knip check and whitespace checks pass. These Chrome results use a branch development server and read-only production holdings, with production geographic and portrait assets passed through locally. They are not deployed-live or production-speed claims. River's deployed check of the full CL-01 branch, the next automatic production pass and its explicit CL-01 live-check pass remain pending.

River's subsequent full-check finding on held empty funding answers is also repaired on this branch: the ballot only inspects a settled answer's kind when the answer exists. The unchanged `pdc-reader-remaining-repairs` test reproduces the prior false campaign-money gap and now passes; partial holdings still contribute their existing gap, and positive alias-aware funding remains available.
