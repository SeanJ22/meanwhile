# The deferred census — everything still open

**This is a GENERATED file.** `docs/tracker.csv` is the source of truth and nothing is edited here — an edit to this file changes nothing and will be overwritten. Every field below is reproduced from the tracker as written; nothing is composed, summarised or reworded.

Decisions go in `docs/deferred.csv`, which carries the same rows with full unclipped notes, a plain-English **What this is asking you** column, and an empty `Disposition` column to fill in. That explainer column is the ONE piece of composed writing in the census — it is written by hand in `docs/deferred-asks.json`, it carries no authority, and where it and the tracker row disagree the tracker row is right. It is deliberately absent from this file, so the paragraph above stays literally true.

Generated **2026-08-18** (`pnpm stamp`, America/Phoenix) by `pnpm deferred`.

- Rows in `docs/tracker.csv`: **366**
- Done or Absorbed: **280**
- **Still open: 86**

Notes are clipped to 200 characters; a clipped note ends in `…`.

## Every status value in the tracker

The full set, counted across all 366 rows. The author has not seen this enumerated in one place before.

| status | rows | known to this script | open or closed |
| --- | --- | --- | --- |
| `Done` | 278 | yes | closed |
| `Not started` | 58 | yes | open |
| `In progress` | 12 | yes | open |
| `Open` | 5 | **no** | open |
| `Tabled` | 4 | **no** | open |
| `Parked` | 2 | yes | open |
| `Absorbed` | 2 | yes | closed |
| `Undecided` | 1 | **no** | open |
| `Waiting on testing end` | 1 | **no** | open |
| `Standing` | 1 | **no** | open |
| `Blocked on the author` | 1 | **no** | open |
| `Blocked` | 1 | **no** | open |

## Statuses this script does not know

14 open row(s) carry a status outside the known set (`Done`, `Not started`, `In progress`, `Parked`, `Absorbed`). They are listed here with their literal status string, and they are ALSO counted in the totals above and listed in the census below — named, never bucketed, never dropped.

| ID | literal status | item |
| --- | --- | --- |
| `D67` | `Open` | clerksboards parser reads past published month restrictions and exceptions |
| `D68` | `Open` | A data-fetch script overwrote verified data with less of it, and reported success |
| `D69` | `Open` | Montana's district count does not reconcile between NCES and the Census of Governments |
| `D70` | `Blocked` | Agenda-platform tenant enumeration crawler (replaces the h2 enumeration approach) |
| `P06` | `Tabled` | Templated response to rep |
| `P07` | `Tabled` | Outcome notifications |
| `P08` | `Tabled` | Appeal window prompt |
| `P09` | `Undecided` | "Should I move here" |
| `P12` | `Tabled` | People's voice - aggregate reactions shown to readers (TABLED) |
| `R13` | `Standing` | The playbook clause - standing and permanent |
| `R33` | `Blocked on the author` | The author's session map is not in the repo and was not reachable |
| `R48` | `Open` | Two scheduled workflows push to main with no rebase, so a collision loses a run |
| `T05` | `Open` | Abuse policy live |
| `T10` | `Waiting on testing end` | The demo-deletion promise - kept mechanically |

## In progress, and stalled

A row that has been `In progress` for a long time reads as progress on a status line and functions as a deferral. These are the most misleading rows on the board for a decks-clearing pass, because they are the ones that look alive.

Derived from the git history of `docs/tracker.csv` (first-parent), 90 commit(s) walked across 7 distinct date(s), 2026-08-12 to 2026-08-18. A **session** here is a distinct calendar date on which the tracker was committed. That UNDERCOUNTS sessions — this repo often runs several in a day — so a row flagged as spanning more than two sessions has certainly spanned more than two.

**8 of 12** `In progress` row(s) qualify.

| ID | entered In progress | sessions held | item |
| --- | --- | --- | --- |
| `D03` | 2026-08-12 (`59fd858`) | 7 | Voting records - state |
| `D08` | 2026-08-13 (`7b9ccb0`) | 6 | Ballot data source |
| `D25` | 2026-08-13 (`7b9ccb0`) | 6 | How to actually be heard - per-body comment access |
| `D29` | 2026-08-13 (`0c866cf`) | 6 | Multiple bodies per division - Tucson boards and commissions |
| `D50` | 2026-08-14 (`67d46b5`) | 5 | Photos round 2 - door 2 opens and the chamber tier ships (item 6b) |
| `P03` | 2026-08-13 (`4945cbb`) | 6 | Reaction capture |
| `T03` | 2026-08-13 (`4945cbb`) | 6 | Security review |
| `X07` | 2026-08-15 (`800fecf`) | 4 | A campaign that lives on Facebook still has a campaign site (item 5) |

The other 4 `In progress` row(s) entered that status within the last two sessions and are not flagged: `A03` (2026-08-18), `A05` (2026-08-18), `B01` (2026-08-17), `D06` (2026-08-18).

## The census

All 86 open row(s), sorted by status and then by ID. Format: **ID** · item · status · priority · note.


### Blocked — 1 row(s)

- **D70** · Agenda-platform tenant enumeration crawler (replaces the h2 enumeration approach) · Blocked · P2 · Opened 2026-08-18 (g19 item 10, the author's order). NOTHING HAS BEEN RUN AND NOTHING MAY BE RUN. CLEARANCE REQUIRED FROM THE AUTHOR BEFORE ANY FETCH: this needs unrestricted outbound HTTP and roughly…

### Blocked on the author — 1 row(s)

- **R33** · The author's session map is not in the repo and was not reachable · Blocked on the author · P1 · 2026-08-17 (g7) FAILED RETRIEVAL, REPORTED AS ONE. The brief said the map's content is in the Drive folder alongside the census 'if not otherwise provided'. It was not otherwise provided and it is NOT…

### In progress — 12 row(s)

- **A03** · "Is there a data center coming?" · In progress · P1 · 2026-08-18 (g19 item 6). BUILT AS THE GENERAL SHAPE, not a data-center feature: lib/routing/agenda-search.ts carries EIGHT topics - data centers, warehouses and distribution centres, rezonings, road p…
- **A05** · "What's on the docket for this?" · In progress · P1 · 2026-08-18 (g19 item 6). DEPENDENCY CHECKED FIRST: M06 is Done, so this was not blocked. Built as EXTRACTION, never summary - agendaItems() returns the agenda's own numbered and lettered items, verbat…
- **B01** · Settle the name · In progress · P0 · 2026-08-17 (g8) THE INTERIM RENAME SHIPPED: the display name is MEANWHILE on every on-site surface, the author's interim ruling. THE COUNT, which is the finding as much as the rename is: 12 occurrence…
- **D03** · Voting records - state · In progress · P1 · AUTHOR CLEARANCE 2026-08-12: the author approved building against this source when asked, which is the CLAUDE.md ask-before-adding-an-external-source gate for it. Legistar, Diligent Community, Congres…
- **D06** · Funding tracker · In progress · P1 · FEC restricts commercial use of contributor info - check the line 2026-08-12: FEC_API_KEY is now present in .env.local but is DELIBERATELY UNWIRED. Holding a key is not clearance. D14 must first recor…
- **D08** · Ballot data source · In progress · P1 · 2026-08-13 INVESTIGATED — docs/ballot-research-2026.md is the full report. Democracy Works Elections API: JSON, reaches sub-municipal but only jurisdictions over 5,000 people (Newbury ~2,200 falls und…
- **D25** · How to actually be heard - per-body comment access · In progress · P1 · Opened and built 2026-08-13. lib/registry/comment-access.ts holds the curated rows (0a: curated into the shape agenda-text extraction fills at scale — another reason agenda documents shipped first); m…
- **D29** · Multiple bodies per division - Tucson boards and commissions · In progress · P2 · 2026-08-14 THE SHAPE LANDED, branch claude/restore-representation-session-0814: bodies are first-class, divisions are geography, nothing assumes one body per division. All 56 boards/committees/commiss…
- **D50** · Photos round 2 - door 2 opens and the chamber tier ships (item 6b) · In progress · P0 · 2026-08-15 (round 3). 535 of 750 -> 590 of 750; 69 portraits shipped under door 2 (24 NH senators, 25 NH representatives, 20 curated locals), every one eyeballed on a contact sheet before shipping. Th…
- **P03** · Reaction capture · In progress · P1 · 2026-08-15 THE SENSOR IS LIVE FOR FEDERAL VOTES (branch claude/reactions-and-plain-language-0815). Do you like this vote? Yes/No/Unsure on every roll-call row in the rep popup - one reusable control k…
- **T03** · Security review · In progress · P0 · 2026-08-15 DEMO-GRADE PASS SHIPPED with the reaction surface, right-sized for a password-walled test (the site is behind the platform password with a handful of testers): enum-closed validation, targe…
- **X07** · A campaign that lives on Facebook still has a campaign site (item 5) · In progress · P1 · Rule adopted into CLAUDE.md 2026-08-15. The SWEEP over the curated-local and ballot-candidate sets is the open half and was the brief's own first cut if the session ran short - it did. Next session: w…

### Not started — 58 row(s)

- **AUD05** · Index the meetings snapshot in memory · Not started · P2 · 2026-08-18 (g15). DISPOSITION PER THE AUTHOR: NOT BUILT NOW, per the audit's OWN TIMING. THE TRIGGER, STATED ON THE ROW so a later session does not have to infer it: build when the meeting corpus MATE…
- **AUD08** · A spatial access path for meetings serving · Not started · P2 · 2026-08-18 (g15). DISPOSITION PER THE AUTHOR: NOT BUILT NOW. THE TRIGGER, STATED ON THE ROW: at the POSTGRES CUTOVER for meetings serving, and NOT BEFORE. The audit's own words for building it earlier…
- **AUD09** · A perf budget for state focus · Not started · P2 · 2026-08-18 (g15). DISPOSITION PER THE AUTHOR: dispositioned to the AUTHOR'S WALKTHROUGH DAY, alongside corepack pnpm perf and AUD03. THE ROW'S OWN TERMS: MEASUREMENT-FIRST by the audit's framing — a m…
- **B02** · Trademark search · Not started · P0 · _no note_
- **B03** · Entity decision · Not started · P1 · _no note_
- **B04** · Data broker registration · Not started · P1 · _no note_
- **B05** · Find counsel · Not started · P1 · _no note_
- **B07** · Pricing methodology · Not started · P2 · _no note_
- **B08** · Read separation agreement before signing · Not started · P0 · Leverage available exactly once. Same counterparty is in an active commission dispute.
- **B09** · Counsel question: vendor terms vs. public records duty · Not started · P0 · For B05. Framing: agendas are made and used by a district in the course of official duty, and open meeting law obliges the district to post them in advance. A public record does not stop being a publi…
- **B14** · The blurb-equalization hunt - a sourced one-line description for every ballot candidate · Not started · P1 · Recorded 2026-08-14 (the tester's mobile pass) as a future session's item, not this one's. The equal-effort non-negotiable in CLAUDE.md is what makes this mandatory rather than nice-to-have.
- **B16** · Address-level polling place on our own surface · Not started · P3 · Recorded 2026-08-15 per the brief's own instruction (item 6). || 2026-08-18 (g19 item 9.3). CONFIRMED PRE-H, unchanged. Checked while tabling P06/P07/P08 and left exactly where it was: session-map Que…
- **B18** · Town halls: federal officials' own events — RECORDED, evaluated, not built · Not started · P2 · Recorded 2026-08-15 (the truth session). NOT BUILT, and nothing half-built. THE RUNGS, in order, for the session that graduates this: (1) each member's official .gov events/press page — survey the 5 f…
- **B19** · Polling place, in the app · Not started · P1 · 2026-08-16 (g4 item 16). DEFERRED WHOLE. THE SPEC: the reader enters an address IN THE APP; their polling place drops a distinctly coloured pin on the map, visually unmistakable against meeting pins,…
- **C01** · Mock export - one measure, synthetic data · Not started · P0 · The map proves you ship. This proves you understand what they buy. Doubles as the V05 answer - a tracking poll cannot produce these rows.
- **C02** · Buyer dashboard · Not started · P2 · Real product, later. C01 is the paper version that sells it now. Every view must carry the verification-tier mix and weighted-vs-raw - never a single blended number.
- **C03** · Export format and delivery · Not started · P2 · Snapshot ID is what makes calibration provable after the fact.
- **C04** · Calibration log · Not started · P2 · Kalshi credibility is a scoreboard. This needs one, and it only works if snapshots were immutable from day one.
- **D04** · Voting records - local · Not started · P2 · _no note_
- **D05** · Candidate info · Not started · P1 · 2026-08-13 RESEARCH RECORDED in docs/ballot-research-2026.md (candidate corpus section): two corpora never merged (statements vs votes), quote-and-link answer format with no synthesis sentence, the th…
- **D07** · OCD-ID resolution layer · Not started · P0 · 2026-08-11: the canonical OCD list (opencivicdata/ocd-division-ids, identifiers/country-us.csv) uses cd:at-large, not cd:1. Verify Google Civic Divisions returns the same before depending on it - if D…
- **D23** · FEC contributor information - commercial-use restriction · Not started · P1 · Opened 2026-08-13 per the reprioritization. D06 said the FEC commercial-use question must be recorded by D14 first; D14 is Done and vendor-review.md never covered the FEC, so the hold existed in nobod…
- **D36** · Finish the candidate-link hunts recorded NOT_ATTEMPTED · Not started · P2 · 2026-08-16: the hunts array distinguishes MISS (searched, nothing verifiable) from NOT_ATTEMPTED (queued, no claim of absence). Every shipped link was fetch-verified; the misses are recorded with what…
- **D47** · State-to-state comparison, full side-by-side (PARKED) · Not started · P3 · Recorded 2026-08-14 (third 08-14 session). 6d's link shipped on branch claude/tester-feedback-0814. || 2026-08-18 (g19 item 9.2). STATUS CORRECTED Parked -> Not started. The author's disposition reads…
- **D51** · Independent expenditures - money spent ABOUT a race · Not started · P2 · 2026-08-15. Recorded, not built - the author's item 7. The next funding-content item after the contribution surface. Inherits every rule the contribution surface already carries: organizations render…
- **D52** · The state money-translation program (umbrella) · Not started · P2 · 2026-08-15. Recorded, not built - the author's item 7, parked behind the state-layer sessions. Umbrella row: individual state adapters become their own rows as they are taken. The mapping tables are a…
- **D62** · The Polarization Research Lab — what members SAY, evaluated for the build brief · Not started · P1 · RECORDED 2026-08-15 (the truth session) from the author's own read of the data page and the mirror; the remainder of the evaluation was the brief's own first deferral and this row is what the build se…
- **F01** · The author's 2026-08-18 testing pass: 40-odd findings across cards, meetings order, votes, the ask box, the ballot page and the map · Not started · P1 · OPENED 2026-08-18 (g16, branch claude/g16-deploy-leaks-queue-0818). NOT BUILT THIS SESSION AND THAT IS THE DISPOSITION, not a shortfall: this arrived mid-session, is in no brief, and the g16 brief's o…
- **H01** · The 03255 depth sweep across the full body universe · Not started · P0 · 2026-08-16 (h item 2), branch claude/h-03255-depth-0816. DEFERRED WHOLE, NOTHING HALF-BUILT. 2 subjects were touched (Kearsarge member towns and its board roster, both HIT at rung 9) of roughly 60 bod…
- **H02** · Body enumeration per unit - the missing second layer of the who-governs denominator · Not started · P0 · 2026-08-16 (h item 1, found by building the denominator). THE FINDING, which is the reason this row exists: the 2022 Census of Governments has ONE row for the Town of Newbury. The product renders Newb…
- **H03** · The re-walk cohort - prior not-published and could-not-reach records against the full ladder · Not started · P1 · 2026-08-16 (h item 2 inherited debt). NOT WALKED - 0 of an unknown M, and the M is unknown because enumerating the prior failures is itself the first step. THE SPEC: re-walk every existing not publish…
- **H04** · The 03255 candidate sweep - 47 candidacies to the Kelly standard · Not started · P0 · 2026-08-16 (h item 3). DEFERRED WHOLE. THE DENOMINATOR IS ALREADY FROZEN and that is the half that exists: the 2026 New Hampshire General Election (election id nh-…
- **H05** · Special-district territory resolution - 40 units UNRESOLVED at 03255 · Not started · P1 · 2026-08-16 (h item 1, found by building the denominator). 40 of 03255 166 enumerated units carry governsZip UNRESOLVED. THE POINT OF THE STATE: UNRESOLVED is a work item and never a false. Recording a…
- **H06** · The C7 same-subject replays and the C2b backfill pass · Not started · P2 · 2026-08-16 (h, the measurement half). NOT RUN, and the reason is honest rather than principled - the session ran out of room. WHAT IS MISSING AND WHY IT MATTERS: (1) THE SAME-SUBJECT REPLAY. When a ca…
- **M13** · Radius control regression tests beyond the store · Not started · P2 · Found 2026-08-12 during Phase 4.5.1 and fixed there; this row is for the coverage gap, not the bug. Enabling 'Limit radius' dispatched radius/set with the untouched default of 25 km while 85641's resu…
- **M18** · Merge consolidated city-county governments (FUNCSTAT=C) into one body · Not started · P3 · Found 2026-08-12 while doing M17. Census FUNCSTAT=C means an active government consolidated with another under a SINGLE set of officials - Nashville-Davidson, Indianapolis-Marion, Philadelphia. derive…
- **M75** · Meeting panel's bottom edge sits under the map legend at phone width · Not started · P2 · 2026-08-15. Recorded, not fixed. The legend is z-1100 and the bottom sheet is z-1150, so the ordering alone does not explain it and this needs the same measure-first treatment M73 got rather than a gu…
- **M81** · The jurisdiction badge - Governs your area vs Nearby, different jurisdiction · Not started · P1 · Recorded 2026-08-15 (the NH/NJ depth session), DEFERRED WHOLE - the session brief's own cut order names this as the first thing to defer if the session runs short, and it did. Nothing was half-built:…
- **M92** · See information / Go to website on bodies and districts - NOT BUILT · Not started · P1 · RECORDED 2026-08-15, NOT BUILT (the brief's own cut order named 6e as the second deferral after item 3, and item 3 shipped). THE MODEL: clicking a body or district name offers TWO actions rather than…
- **M95** · A sourced term end and birth date for the statewide executives · Not started · P2 · 2026-08-16 (g3 item 8): DEFERRED, per the brief's own cut order — item 8 was named the first cut and nothing was half-built. The spec stands: sourced birthday (age) and sourced term end ("In seat unti…
- **M123** · The Kearsarge towns: rungs walked, nothing wired · Not started · P2 · 2026-08-16 (g3 item 3, second half): DEFERRED per the brief's own cut order, with every rung recorded so the next session starts where this one stopped. The table is in docs/zip-playbook.md. In short:…
- **P02** · Ballot mapping · Not started · P1 · _no note_
- **P04** · Signal aggregation · Not started · P1 · _no note_
- **P05** · Vote notifications · Not started · P2 · Most specific ask from the call 2026-08-13: the governing constraint is now written into CLAUDE.md (Two stores that never join) with tests/neutrality-guards.test.ts asserting the search log and subscr…
- **P10** · Second jurisdiction · Not started · P2 · _no note_
- **T01** · Transparency page · Not started · P1 · _no note_
- **T02** · Identity verification · Not started · P1 · 2026-08-15: verificationTier is on every reaction row from row one (ANONYMOUS today; LOCALITY_VERIFIED and VOTER_MATCHED enumerated as designed future tiers) so aggregates are tier-shaped before any v…
- **T04** · Exclusive-access position · Not started · P1 · 2026-08-17 AUTHOR'S RULING RECORDED, verbatim from his census disposition: "Never to solely one side, equal offers will always be made". Attributed to the author, stated 2026-08-17. STATUS DELIBERATEL…
- **T06** · Manual tier calibration · Not started · P1 · _no note_
- **T07** · Escalation contacts file · Not started · P1 · Verify quarterly. A stale number during an incident is a failure.
- **V01** · Five buyer calls · Not started · P0 · _no note_
- **V03** · Legistar prototype, 3-5 cities · Not started · P0 · _no note_
- **V04** · Alignment grid, one Pima County race · Not started · P1 · _no note_
- **V05** · Beat-a-tracking-poll answer · Not started · P0 · Write before dialing. The mock export (C01) is the concrete form of this answer.
- **V06** · Reading-level test · Not started · P2 · _no note_
- **V08** · The candidate coverage-gap report - a candidate-side product surface · Not started · P2 · Recorded 2026-08-14 (the tester's mobile pass), business item. Ask before building: it is a new surface with a new audience.
- **X02** · Instagram presence · Not started · P2 · _no note_
- **X03** · Podcast pitch · Not started · P2 · _no note_

### Open — 5 row(s)

- **D67** · clerksboards parser reads past published month restrictions and exceptions · Open · P2 · Opened 2026-08-18 (g19 item 1b). The fix has a shape already: monthsInParens() in lib/sources/clerksboards/index.ts reads a month set out of a parenthetical for grammar C, and the same helper is what…
- **D68** · A data-fetch script overwrote verified data with less of it, and reported success · Open · P2 · Opened 2026-08-18 (g19 item 4). MITIGATED, NOT CLOSED. Three things landed with it: the resolver's merge is now non-destructive by construction (a run may add refs and may never remove one, and a refu…
- **D69** · Montana's district count does not reconcile between NCES and the Census of Governments · Open · P3 · Opened 2026-08-18 (g19 item 10, the author's order). Nothing was run and nothing is claimed about Montana. The likely shapes to check, none of them assumed: NCES counts operating LEAs including ones t…
- **R48** · Two scheduled workflows push to main with no rebase, so a collision loses a run · Open · P2 · FOUND 2026-08-18 (g13) while verifying R43 and R44: both workflows were dispatched at once to prove the two fixes, the tripwire pushed its report first, and the meetings refresh - whose ingest, whose…
- **T05** · Abuse policy live · Open · P0 · 2026-08-15 MINIMAL WIRING with the reaction surface: the reaction endpoint respects the abuse policy rate intent (serialized limits, 429 with Retry-After, fail closed). There is deliberately no free-t…

### Parked — 2 row(s)

- **D46** · Prop sponsor attribution (PARKED - author undecided) · Parked · P3 · Recorded 2026-08-14 (third 08-14 session).
- **V07** · Ed-tech / schools version (PARKED - business item) · Parked · P3 · Recorded 2026-08-14 (third 08-14 session).

### Standing — 1 row(s)

- **R13** · The playbook clause - standing and permanent · Standing · P1 · Recorded 2026-08-14 (third 08-14 session), per the session brief item 8. The clause is permanent; this row is its anchor.

### Tabled — 4 row(s)

- **P06** · Templated response to rep · Tabled · P2 · 2026-08-18 (g19 item 9.3). TABLED by the author's ruling. Moved out of session-map Queue 3 and into Queue 6 (tabled / non-code / kept in tracker). The consolidation the disposition describes - all thr…
- **P07** · Outcome notifications · Tabled · P2 · 2026-08-18 (g19 item 9.3). TABLED by the author's ruling. Moved out of session-map Queue 3 and into Queue 6 (tabled / non-code / kept in tracker). The consolidation the disposition describes - all thr…
- **P08** · Appeal window prompt · Tabled · P2 · 2026-08-18 (g19 item 9.3). TABLED by the author's ruling. Moved out of session-map Queue 3 and into Queue 6 (tabled / non-code / kept in tracker). The consolidation the disposition describes - all thr…
- **P12** · People's voice - aggregate reactions shown to readers (TABLED) · Tabled · P2 · Recorded 2026-08-14 (third 08-14 session), branch claude/tester-feedback-0814. Build nothing until the author closes this row in person.

### Undecided — 1 row(s)

- **P09** · "Should I move here" · Undecided · P3 · Decide in or out - it pulls the build sideways

### Waiting on testing end — 1 row(s)

- **T10** · The demo-deletion promise - kept mechanically · Waiting on testing end · P0 · Recorded 2026-08-14 (third 08-14 session). The window starts 2026-08-13T19:56Z (earliest search-log row). The tester had tapped zero reactions as of 2026-08-14 20:25Z; the reactions store held 4 rows,…

