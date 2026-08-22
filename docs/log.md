# The log — what each session was for, and what came out of it

**GENERATED FILE — do not hand-edit.** Written by `corepack pnpm tracker:views`
(`scripts/tracker.mjs`) from the tracker's own attribution and description fields,
plus one authored sentence per session in `docs/log-purposes.json`.

Generated 2026-08-22 (America/Phoenix, from `pnpm stamp`).

Newest first. **118 sessions.**

Runs before 2026-08-17 predate the session-naming convention, so they are named by
their date and their own commit subject. That is a lookup rather than a guess, and
`git log --grep` finds any of them.

---

## Deleted rows — RULING 46

Rows Sean removed outright, because they are not project work and do not
belong in the tracker at all. **Only he may delete a row**; a session never
may, and `tests/tracker-stores.test.ts` fails the build if one tries. These
are hard-removed from both stores — this list is the whole surviving record.

- **B08** — Read separation agreement before signing · deleted 2026-08-20 by Sean · authority: his note: "This has absolutely nothing to do with this project at all.  Delete this entirely"

---

## NJHUNT2 · 2026-08-22

**What it finished.** 1 row(s).

- **NJ01** — Zip 07866 covers TWO municipalities, not one. The twig pair run on 2026-08-22 places BOROUGH OF ROCKAWAY and ROCKAWAY BORO SCH DIST at 0 km from the zip centroid, and this registry holds no body for either. The Borough is also holding a live election that this product does not render: the Morris County Clerk's 2026 filing carries four Borough Council candidates (Melissa Burnside and Patrick McDonald, Republican; Clifford D. Dawkins Jr. and Angelo Natale, Democratic), each with a filed street address and email, plus two Borough school board candidates (Edward Graf, Jaclyn D. Long). A reader in the Borough typing 07866 today gets the Township's ballot and nothing of their own. The contacts are already parsed and sitting in pnpm nj:filing output; what is missing is the division wiring, the bodies, and the ballot rows. Note the trap this sits on: the Census name normaliser collapsed Borough and Township onto one OCD id during this session and had to be corrected, so any fix here must keep the two distinct and be checked against that.

**What it started.** 9 row(s) opened, 9 still open.

- **NH56** — The ballot page now shows Rockaway Borough's council and school board to a 07866 reader, because it resolves the zip's AREA. The map's who-governs card still resolves a single ZCTA centroid, so it reads '4 bodies govern the area around 07866' and names Morris County, Morris Hills Regional, Rockaway township and Rockaway Township School District — no Borough. Same defect as NJ01, one surface over. *(open)*
- **NH57** — The welcome overlay offers four starting zips and labels 07866 'Rockaway Twp., NJ'. Two municipalities sit in that zip and the product now renders both, so the label names one of them and silently drops the other — for a Borough resident it is the wrong town. *(open)*
- **NH58** — When map tiles do not load, the reader-facing panel reads: 'BASEMAP UNAVAILABLE — Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use'. An environment-variable name and a source file path are internal identifiers and may not render outside a technical-details disclosure. *(open)*
- **NH59** — Sutton's calendar titles the committee's sittings 'WRLAC Mtg @ Pillsbury Library'. Its own page on suttonnh.gov carries only the site footer, so the body names a venue the page does not. Two sittings are held out of the product because of it. *(open)*
- **NH60** — pnpm venue:hunt --town sutton_town reads 18 of Sutton's board pages and cannot reach seven: Municipal Budget Committee, Supervisors of the Checklist, Trustees of the Trust Funds, Website Committee, Ad Hoc Waste Reduction Advisory Committee, Ad Hoc Grist Mill Bridge Committee, and the 26 Grist Mill Street Committee. suttonnh.gov/boards-committees itself answers 404. *(open)*
- **NH61** — RULING 70. Ballotpedia's Candidate Connection works because candidates volunteer answers and identity is verified before publication. The mechanism is not licensed and is worth more than the content: a questionnaire on this product's own site is original data with no licence, no copyleft and no dependency, and it is symmetric by construction because every candidate in a contest gets the same invitation and the same questions. *(open)*
- **NH62** — Recorded so no future session re-derives Ballotpedia as an available branch and starts building one. *(open)*
- **NH63** — RULING 69 says the session fetches the FEC's Combined Federal/State Disclosure and Election Directory into data/reference/, 'including its PDF (~2.2 MB)'. RULING 20 says portraits and PDF corpora do not go in git — they are content-addressed outside the repo with their hashes committed, while reference data and provenance stay in git. Both are yours and they point different ways for this file. *(open)*
- **NH64** — RULING 37 says a session marks its own completed work Resolved and moves it, in every section except Needs Sean. scripts/tracker.mjs has no mode or flag that does it. Resolution, Condition and Notes are read ONLY out of docs/tracker.xlsx, and anything found there is attributed to Sean. *(open)*

**Needs Sean.** NH63

## Sean · 2026-08-21

**What it finished.** 3 row(s).

- **PE01** — A candidate we hold no published words for still gets a sentence on their card saying so. It is honest and it names the gap as ours, and it also appears only on the shortest cards — which is the same shape as the line RULING 42 just deleted. Whether it goes too is a call about a reader surface, so it is yours. Seen on the live ballot at every pilot zip.
- **PE04** — Every candidate card carries a line saying how many of the twelve issues we search for turned up in their own pages — and, when none did, a sentence saying so. You asked for the page disclosure to be one sentence and no more. Whether that reaches this line too is the part your note does not settle, and it is worth asking because you ruled the opposite way on it once already.
- **NH09** — On 2026-08-16 you ruled that candidates we have a photo of should be listed first within a contest, and the cost was written down at the time: layout position stacks on top of the information advantage. RULING 42, four days later, says no ordering may indicate how complete one candidate's record is relative to another's. Both are yours and they point opposite ways. Nothing has been changed.

**Needs Sean.** Nothing.

## NHHUNT4 · 2026-08-21

**What it finished.** 2 row(s).

- **NH14** — Lake Todd Village District and the Merrimack County Conservation District both have territory over 03255, both are real governments with meetings and budgets, and the product has never named either. A reader in Newbury can be governed by them and hear nothing.
- **NH15** — Six of the seven towns that send members to the Kearsarge Regional School Board had no bodies in this registry at all. They now have a list - 90 boards, committees and commissions, read from each town's own website with the rung recorded - and nothing is wired to any of them. A reader in one of those towns still sees nothing.

**Needs Sean.** Nothing.

## NHHUNT2 · 2026-08-21

**What it finished.** 1 row(s).

- **NH01** — The Kearsarge Regional School District publishes who sits on its school board, and its own page for that list refuses every way we have of reading it. The nine names we show came from an earlier read and the district may have changed them since. Getting a current list needs a route we have not walked yet.

**What it started.** 8 row(s) opened, 6 still open.

- **NH10** — Tobin Menard is running for Executive Council in District 2, which covers Newbury. His campaign site publishes exactly one picture of him: a clean studio portrait with the words 'Accountability Responsibility' printed across it in red. The photo rule says a portrait, never a wordmark, and this is a portrait carrying one. I refused it, which means he shows initials on the ballot page while the sitting councillor beside him shows her face - and that is the visual asymmetry the equal-effort rule exists to stop. It is a call about how a real person looks on a reader's screen, so it is yours. *(open)*
- **NH11** — Shaun Fife is running for Governor. He has no campaign website and no campaign Facebook page. What he has is a candidate page on a political party's own site, carrying his name, the office, his own words and a contact address. Two of our rules point in opposite directions about it and the third makes it worse, so it is yours to settle. *(open)*
- **NH12** — The New Hampshire Secretary of State publishes a mailing address for every candidate on the ballot, and for most of them it is where they live. It is a public record, the state prints it, and it is the only working contact we hold for about half of the forty-seven people on Newbury's ballot. I have recorded all forty-seven in the hunt notes and rendered none of them, because putting a named person's home street address on a consumer app is a different act from a state PDF and I did not want to make that call on my own. *(open)*
- **NH13** — The constitution records a wall that is not there. Two paragraphs - the source register in CLAUDE.md and the curator note in the New Hampshire ballot data - say gc.nh.gov 'refuses every client this project has, browsers included'. It answers a plain fetch at HTTP 200. Only you change CLAUDE.md, so this is a correction routed to you rather than made. *(open)*
- **NH16** — Bradford, New Hampshire publishes every agenda and minute set on a vendor platform this product has never seen. Its own town website carries no boards index and no calendar, so the vendor is the only route to the town's meetings. *(open)*
- **NH17** — The consolidated miss list says newbury.nh.gov/sitemap.xml is a 403 and that robots declares none. It answers HTTP 200 at 43,484 bytes. A sitemap is the discovery rung for every page on a site, and this one has been closed to us on a stale reading. *(open)*

**Needs Sean.** NH10, NH11, NH12, NH13

## Prompt E · 2026-08-20

**What it finished.** 2 row(s).

- **PD04** — About one search in ninety was never recorded in the store this business sells, and nothing could see it happening. Diagnosed and fixed this session.
- **PE03** — A meetings source fetched three of a town's calendars, produced no meetings from them, and reported that it had succeeded — so the safety net that preserves a town's meetings during an outage never ran, and Wilmot, New Hampshire went from 23 meetings to none on a reader's page. Fixed at the one line all eleven sources pass through.

**What it started.** 4 row(s) opened, 1 still open.

- **PE02** — The short summary file generated at the end of every session still reads the frozen pre-rebuild tracker, so it reports a priority count on a scale that no longer exists. Nothing a reader sees is affected; the next session opens on a number that means nothing. *(open)*

**Needs Sean.** Nothing.

## Prompt D · 2026-08-20

Prompt C had added a rule that hid every candidate unless everybody in the race had the same information. That hid everyone. This session removed the rule, put 107 candidates back on the ballot across all 36 contests in the four test zips, and made the rule illegal so it cannot come back. It also gave a silently failing write a bell that somebody can hear.

**What it finished.** 1 row(s).

- **R58** — Seventeen production checks stopped running and said nothing at all. Only two of nineteen reported that they could not run, so a suite that had lost most of a section still passed.

**What it started.** 5 row(s) opened, 4 still open.

- **PD01** — Roughly four million people in Washington DC and the five territories are shown no federal representative at all, because their at-large district is missing from the registry. The six people are real, non-voting members of Congress, and their constituents currently see nothing. *(open)*
- **PD02** — The local development database is eight migrations behind production, so nothing can be tried locally against the real schema. *(open)*
- **PD03** — When a reaction's location lookup fails, the row is written with an empty list of districts rather than a recorded failure — so a lookup that broke is indistinguishable from a place with no districts. *(open)*
- **PD05** — The production walk creates rows under two different run labels and then counts only one of them, so it under-reports how many rows it wrote. *(open)*

**Needs Sean.** Nothing.

## Prompt C · 2026-08-20

Rewrote the constitution's shelf-life sections so they point at the files that are authoritative instead of copying them, gave rulings a permanent home, restarted the two stores that had gone dark, and tightened the gate that measures whether a hunt is finished.

**What it finished.** 2 row(s).

- **PB14** — A rule shipped in an earlier session withheld every contest whose candidates were not all fully researched, which on the four test zips meant almost all of them. It also broke two production checks.
- **D73** — Both stores this business sells stopped recording for four hours and eighteen minutes, and every instrument stayed green. A database change had shipped in code and had never been applied.

**What it started.** 39 row(s) opened, 37 still open.

- **HD01** — Eleven people are running for United States Senator in New Hampshire and forty-one things about them have never been looked for — faces, their own words, a way to reach them, a website. *(open)*
- **HD02** — Six people are running for Congress in New Hampshire's second district and eighteen things about them have never been looked for. *(open)*
- **HD03** — Four people are running for Merrimack County Attorney and sixteen things about them have never been looked for. *(open)*
- **HD04** — Four people are running for Merrimack County Sheriff and sixteen things about them have never been looked for. *(open)*
- **HD05** — Three people are running for Merrimack County Commissioner in the second district and twelve things about them have never been looked for. *(open)*
- **HD06** — Three people are running for the Rockaway Township Board of Education and twelve things about them have never been looked for. *(open)*
- **HD07** — Four people are running for Arizona's 19th state house district and ten things about them have never been looked for. *(open)*
- **HD08** — Four people are running for Congress in Arizona's sixth district and ten things about them have never been looked for. *(open)*
- **HD09** — Three people are running for Governor of New Hampshire and nine things about them have never been looked for. *(open)*
- **HD10** — Two people are running for Merrimack County Treasurer and eight things about them have never been looked for. *(open)*
- **HD11** — Two people are running for New Hampshire Executive Councillor in the second district and eight things about them have never been looked for. *(open)*
- **HD12** — Two people are running for Merrimack County Register of Deeds and eight things about them have never been looked for. *(open)*
- …and 25 more still open.

**Needs Sean.** R55, R56, R57

## Prompt B · 2026-08-20

Built the national picture: how many governments exist, how many of them the product can locate, and how deep the coverage goes in any given place. Restructured the tracker, specced the API clients, and built the gap ledger that later sessions work from.

**What it finished.** 3 row(s).

- **F25** — Two scheduled refresh runs hung and were killed at the six-hour limit, so the meetings on the site stopped moving without anything reporting a failure.
- **R48** — Two scheduled jobs both pushed to the main branch with no retry, so when they ran close together one run's work was silently lost.
- **PB13** — A previous session reported that a data.gov key did not exist. It does. The row exists to correct the record rather than let a wrong finding stand.

**What it started.** 20 row(s) opened, 18 still open.

- **PB02** — Nobody publishes boundaries for special districts — fire, water, irrigation, library — so the product cannot tell a reader whether they live in one. They are 43.55% of every government in the country, and this is the largest single hole in the coverage promise. *(open)*
- **PB01** — Two federal sources disagree about how many school districts Montana has — 387 against 311, with nothing to account for the gap. Until it reconciles, the product cannot state a district count for Montana or any national figure that includes it. *(open)*
- **PB08** — LegiScan already supplies bill text and votes. What is unread is the rest of a state legislator's record — who sponsored what, which committees they sit on, how long they have served — which is most of what a state card should say. *(open)*
- **PB09** — Congress.gov's own API, unread. The product already reads roll calls straight from the House and Senate clerks; this adds cosponsorships and committee membership, which is how a reader sees what a member works on rather than only how they voted. *(open)*
- **PB05** — School districts are matched between two federal files by name, because neither file carries a shared identifier. Roughly 4,000 do not match. The proper crosswalk exists and has to be acquired. *(open)*
- **PB06** — Two small, named holes in the national map: 35 government boundaries that landed in no zip at all, and 1,599 real postal zips that have no mapped area, so no place can be resolved for them. *(open)*
- **PB07** — Four of the five scheduled jobs run the full test suite before they push. The fifth does not, so a broken document can reach the repository unchallenged. *(open)*
- **PB11** — The Census Bureau's own data service is unused. The product reads Census boundary files offline, which give shape but no people — no population, no income, nothing about who lives in a place. *(open)*
- **PB12** — Lobbying disclosure data. The repo fetches none of it — not partially, not at all — and this row says so plainly rather than leaving a half-built impression. *(open)*
- **HUNT01** — Walk every single governing body around Newbury, New Hampshire to full depth — who sits on it, when it meets, where its records are. The first place the product tries to answer completely. *(open)*
- **HUNT02** — Nobody publishes a list of the boards and commissions inside a government. The Census counts governments; readers need bodies. Until a government's boards are enumerated, there is no honest denominator for how much of it the product covers. *(open)*
- **HUNT04** — The 47 people who filed to run around Newbury, New Hampshire. None has been researched. Every one of them is a card a reader will meet. *(open)*
- …and 6 more still open.

**Needs Sean.** PB10

## F22 · 2026-08-20

The scheduled job that keeps the meetings on the site current had been failing for a day and nobody had noticed. Fixed it, and fixed a vendor timeout that had quietly emptied a whole New Jersey township.

**What it finished.** 4 row(s).

- **F22** — The scheduled job that refreshes meetings had been failing for a day and the meetings on the site had quietly stopped moving. Fixed, and one vendor timeout that had emptied a whole township was fixed with it.
- **F23** — A meetings vendor publishes an archive stretching further back than the product serves and never says so, so the safety net that preserves rows during an outage was throwing most of them away.
- **F24** — A website refusing us and our own code failing both reported the same thing, so nobody could tell a wall from a bug.
- **F21** — The ballot page offered the polling-place control twice, identically, on the same screen.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## g20 · 2026-08-19

The research corpus of what members of Congress say arrived, and four numbers the project had been reporting turned out to describe nothing at all.

**What it finished.** 5 row(s).

- **D29** — A city has many boards, not one. The registry was deriving a single body per district, so Tucson's housing authority and its commissions were invisible.
- **D67** — Three Tucson boards publish schedules with exceptions the parser ignored, so the product showed meetings those boards had not scheduled.
- **D71** — Two reader-facing paths shipped with no production check at all, in a suite whose rule is that it only grows.
- **D72** — Two date guards asserted that the problem still existed, so they failed on the day it was fixed. A test that encodes the broken state passes only while it is broken.
- **A05** — Ask about a specific upcoming meeting and get its agenda summarized, alongside the raw agenda rather than instead of it.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## F01C2 · 2026-08-19

The second continuation of Sean's testing pass, worked on a phone. The ballot stopped being an endless scroll, and four instruments that were reporting the wrong thing were corrected.

**What it finished.** 9 row(s).

- **F12** — The reactions store could not say whether a row came from a reader or from one of the product's own automated runs. The search log already could.
- **F14** — The ballot page had become an endless scroll. Every long section moved into a card a reader opens when they want it.
- **F15** — Searching a candidate's positions returned nothing even when their own words were right there on the card — the search was reading the wrong file.
- **F16** — Every candidate's card ended with a full list of every issue the product searches for, repeated under every person. The count now sits on one row and the list is one tap away.
- **F17** — "Find your polling place" sent the reader out to the state's website while the product already held the answer.
- **F18** — New Jersey's in-person early voting runs across nine days, and it was the one voting event on the page a reader could not save to a calendar.
- **F20** — A bot-detection page served with a success code was recorded as a successful read of a school district's site. A challenge page counted as data.
- **F13** — A tracker row was missing its line break, so two rows fused into one and hid a duplicate id from the guard built to catch duplicate ids.
- **F19** — The "where can I vote" box suggested a Tucson address as its placeholder — to a reader in New Hampshire.

**What it started.** 11 row(s) opened, 1 still open.

- **F11** — One family of school-district websites ships its page content as data hidden inside the HTML, and the product's reader comes back empty without saying so. Sized, deliberately not built yet, and named so the silence is not mistaken for an empty page. *(open)*

**Needs Sean.** Nothing.

## F01C · 2026-08-19

The first continuation of Sean's testing pass. The numbers on the ballot page reconciled, and four things a reader actually hits were fixed.

**What it finished.** 7 row(s).

- **F04** — The "my ballot" tally counted ballot measures and skipped candidates, so a reader who had picked candidates was told they had picked nothing.
- **F05** — "Clear my picks" removed the card from the screen and left every pick in place, so the reader believed they had cleared something they had not.
- **F06** — A superintendent was carried as a bare surname with no first name. A surname alone is not a partial answer; it is a wrong one, and nothing detected it.
- **F10** — The candidate-issues extractor was reading website boilerplate as the candidate's own speech, so template chrome rendered as a person's stated position. A correctness and neutrality defect, not a formatting one.
- **F07** — A school superintendent was carried as a surname with no first name. The author supplied the full name and the source; the row records why the hunt returned half an answer.
- **F08** — A source file contained two invisible null bytes, which made every search tool skip it silently. A sweep that cannot see a file reports the same thing as a sweep that found nothing.
- **F09** — A script dated its own document in UTC, so after 5pm local time it wrote tomorrow's date.

**What it started.** 7 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## F01 · 2026-08-19

Sean walked the whole product on 2026-08-18 and left forty-odd findings. This session opened the row that keeps them together and started working them.

**What it finished.** 4 row(s).

- **B19** — "Find your polling place" used to send the reader out of the app. It now answers in the app where the answer is held.
- **M81** — A meeting forty miles away at the county seat governs the reader; the one next door may not. Every meeting now says which it is.
- **D47** — A full side-by-side comparison of two states' basics. Deliberately not built with the moving-here page; recorded as its own thing.
- **B16** — Name the reader's actual polling place on the product's own surface, rather than pointing them at the state's tool.

**What it started.** 8 row(s) opened, 8 still open.

- **F02** — The product renders 186 congressional committee rows with no description of what any of them does. The text does not exist in the upstream file, so it has to come from somewhere else. *(open)*
- **F03** — Ten of the twelve bodies the product covers show an elected leader and no appointed one — no superintendent, no town manager, no county administrator. The person who actually runs the place is missing from the card. *(open)*
- **V13** — A municipal agenda vendor nobody here had met, found while walking Bradford, New Hampshire. Wiring it reaches meetings that are currently invisible in several New Hampshire towns. *(open)*
- **R54** — A standing mechanism rather than a job: every portrait Sean needs to eyeball collects into one list he can work through, regenerated rather than hand-kept. *(open)*
- **V09** — Accela, one of four permit and zoning platforms Sean approved in principle. These are the records that answer "is there a data center coming?" before it is built. *(open)*
- **V10** — Tyler EnerGov, the second of the four permit and zoning platforms. Approved in principle; needs its own clearance. *(open)*
- **V11** — OpenGov Permitting & Licensing, the third of the four permit and zoning platforms. Approved in principle; needs its own clearance. *(open)*
- **V12** — CityView, the fourth of the four permit and zoning platforms. Approved in principle; needs its own clearance. *(open)*

**Needs Sean.** Nothing.

## g19 · 2026-08-18

Worked the deferred queue, and found four times that the brief's premise had already been built.

**What it finished.** 2 row(s).

- **G10** — Three deliverables an earlier session reported without measuring, measured properly, plus a performance command and a size cap on the session-context document.
- **A04** — Answering "who can I contact about X?" — the topic to the body with jurisdiction, then to the specific people and their public contact details.

**What it started.** 5 row(s) opened, 3 still open.

- **D68** — A script rewrote a verified data file with less data than it found and exited cleanly. Caught and reverted the same day. The row exists because the shape recurs, and a script that can lose data must be asked what it wrote. *(open)*
- **D69** — The Montana school-district disagreement, recorded as its own investigation. Named separately from the row above so the discrepancy has somewhere to be resolved rather than being carried as a caveat forever. *(open)*
- **D70** — Work out which public bodies sit on which agenda platform, so the meetings layer can reach past the four pilot zips. Three platforms, three different methods, and it needs Sean's ruling on the approach first. *(open)*

**Needs Sean.** D70

## g18 · 2026-08-18

Asked four instruments what they actually returned rather than trusting them, and four of them were wrong.

**What it finished.** 6 row(s).

- **R51** — The deploy host silently stopped building on push, so the live site served a stale version while the repository sat thirteen commits ahead.
- **AUD06** — Coverage was described in more than one place, so what the product claims to watch could drift between them.
- **M135** — Selecting a body anywhere in the product opens that body's full card. The goal is keeping the reader in the product rather than throwing them at a website.
- **R52** — A production check failed on one run in three, and the row records that it is intermittent rather than pretending it is reliable.
- **AUD03** — Surfaces whose payload can wait until the reader asks for them, identified by the outside audit.
- **R53** — The map-versus-application split in the size budget was decorative: it attributed a whole file to the map library if the file's bytes contained the word anywhere.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## g16 · 2026-08-18

Shipped the deploy, closed a class of leak where the product's own robots were counting as readers, and broke ballot measures into their parts.

**What it finished.** 3 row(s).

- **P01** — Ballot measures broken into the parts people actually disagree about — how it is paid for, what it funds, who oversees it, when it ends — in plain language.
- **R49** — The production walk checked a rendered result once after a fixed wait, so a slow but working page reported as a regression. Fixed in 33 more places.
- **R50** — The browser's fire-and-forget send bypasses the header that declares an automated run, so the product's own robots were landing in the sold store labelled as readers.

**What it started.** 2 row(s) opened, 1 still open.

- **F01** — Sean's full walk of the product on 2026-08-18, forty-odd findings across cards, meeting order, votes, the ask box, the ballot and the map. The parent row that keeps the whole batch together; the individual findings became their own rows. *(open)*

**Needs Sean.** Nothing.

## g15 · 2026-08-18

An external audit's findings entered the tracker, and three of the project's own numbers stopped describing the code.

**What it finished.** 1 row(s).

- **AUD07** — The scheduled refresh jobs ran the entire test suite even on runs where nothing changed — proving nothing, slowly.

**Needs Sean.** Nothing.

## AUD-04 · 2026-08-18

One audit finding, worked on its own: every meetings request was resolving the reader's location twice.

**What it finished.** 11 row(s).

- **R47** — Zooming out at Tucson wiped every pin off the map. Zooming out is a request to see more, and a map answering it with less is indistinguishable from a map losing data.
- **AUD01** — An outside audit asked whether the product should move to a different language or framework. The answer was no, and the reasoning is recorded so it is not re-litigated.
- **AUD04** — Every meetings request was resolving the reader's location against the same map twice. Now once.
- **B15** — A curated list of notable votes on each member's card, so a reader sees the votes that mattered rather than all of them.
- **M136** — Body cards brought up to the depth a person card already had — the author wanted opening one to feel like finding a great deal of information at once.
- **M139** — Arriving from another zip, or coming back from the ballot, the sidebar sometimes rendered blank and the who-governs card half-drawn.
- **R45** — Every workflow run printed a deprecation warning because the actions were pinned to a Node version the platform no longer supports.
- **R46** — Node printed a warning on every single test file, so real warnings were buried in noise.
- **R44** — The safety net that preserves a failed source's meetings was clipping them to a window that source never used, so an outage still lost rows.
- **M07** — A returning reader gets their zip and chosen district back, with a visible control to change either.
- **R43** — The scheduled cleanup of rate-limit state had failed on every run since it shipped, because the write guard refused it in the environment it runs in.

**What it started.** 17 row(s) opened, 3 still open.

- **AUD05** — Meetings are found by scanning the whole snapshot rather than looking them up. It works at today's size and gets slower with every place added. *(open)*
- **AUD08** — Meetings are matched to a location without a spatial index. Same shape as the row above: correct now, and the wrong shape at scale. *(open)*
- **AUD09** — The animation that flies the map to a state has no agreed speed budget, so nothing can tell whether a change made it slower. *(open)*

**Needs Sean.** Nothing.

## AUD-02 · 2026-08-18

One audit finding, worked on its own: the build check was reporting a file count as though it were the bytes a reader downloads.

**What it finished.** 1 row(s).

- **AUD02** — The build check's "largest bundle" figure was counting files in a server manifest, not bytes a reader downloads. Two different things reported as one number.

**Needs Sean.** Nothing.

## g8 · 2026-08-17

The deploy landed, and two instruments that could not actually measure the thing they claimed to measure started measuring it.

**What it finished.** 34 row(s).

- **B06** — The date the idea started, written down. Ten minutes of work that matters only if ownership is ever questioned.
- **D66** — The meetings file counted two different things and reported one number, so a healthy-looking total hid a real discrepancy. Both numbers are now stated and have to reconcile.
- **G01** — The who-governs card said four bodies govern this area directly above a list of five. Two definitions of the same thing on one surface; now one.
- **G02** — Every route now refuses a nonsense parameter instead of answering it. A malformed request used to produce a confident, plausible answer for a point in the Gulf of Guinea.
- **G03** — The production walk prints its own count of the checks it ran, so no session has to transcribe a number by hand. One mis-copied total had propagated through two sessions.
- **G11** — The number of meetings a reader is shown now agrees with itself in all four places it appears.
- **R01** — Framework scaffolding had once overwritten the project's own rules file with a twelve-byte stub. This makes that impossible to do silently.
- **R34** — Local development used to write into the production database. It now has its own, and the production write path refuses anything that is not production.
- **V02** — Spend a week using an existing local-meetings alert product in Tucson and find out what it has already solved.
- **G06** — A line on incumbents' cards ended with a defence of itself. The author cut the defence; the fact stayed.
- **G08** — The mayor was removed from the who-governs card, where the placement was awkward and the office already appeared elsewhere.
- **G09** — Measure the map's ramp-up animation and capture the frames before changing anything. The author ruled: measure first, decide after.
- …and 22 more, on the Resolved tab.

**What it started.** 24 row(s) opened, 1 still open.

- **R33** — Sean's map of the project's sessions lived outside the repo, so nothing could read it. It is now committed, and the row stays open until he confirms the copy in the repo is the one he wants used. *(open)*

**Needs Sean.** R33

## g12 · 2026-08-17

The question matcher stopped answering questions nobody asked, and the interface stopped repeating itself.

**What it finished.** 22 row(s).

- **A07** — When the ask box has no sourced answer, it says so instead of writing one. Nothing a reader is told is ever generated to fill a gap.
- **D31** — A naming convention for the thousands of governments no national standard enumerates — community college districts, special districts, authorities, joint boards — minted in the product's own namespace rather than faked in somebody else's.
- **G05** — The interface consolidated: the ask box stopped being tangled up with the who-governs card and became its own thing that expands where it sits.
- **G07** — Hiding the ask box behind a pill was cleaner and got used less. Typed questions are the highest-intent signal the product collects, so discoverability won.
- **M134** — Answering "would you vote for them?" with Yes now sets the pick for that race, instead of the race asking a question the reader has already answered.
- **R39** — An official with seven phone numbers rendered seven rows. One pill now, everywhere a contact appears.
- **A06** — Collect the questions people actually ask. Every one that cannot be answered is either a data gap or a feature nobody has built.
- **D24** — 348 of 940 districts did not match the public standard's list. Reconciled by joining on the Census's own identifier instead of by name similarity.
- **D35** — The machinery that tells a reader whether a candidate has said something about an issue, has said nothing, or was never searched — three different answers that must never be collapsed into one.
- **R36** — The connection string named READONLY connects with full permission to write, drop and truncate. The name promised a protection that did not exist.
- **D22** — The second school-board agenda platform. Vail's district runs a different one from Newbury's, so reaching both target districts needed both.
- **A01** — One input that answers a question instead of making the reader navigate to it. This is the interface, not a feature on it.
- …and 10 more, on the Resolved tab.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · Verified live, and the documents

Verified the previous session's work against the live site rather than against its own report, and wrote the record.

**What it finished.** 3 row(s).

- **R22** — The ship command now runs the exact build the deploy host runs and refuses to ship on failure. A green merge had once served the previous build for an hour.
- **R25** — Production screenshots file beside their local counterparts instead of overwriting the very shots they are being compared against.
- **R24** — Checking a deploy by looking at the front page's HTML returns nothing even when the deploy is correct, because the reader's location is session-scoped. The check has to look at something else.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The sensor was counting; the screen was not saying so

Tapping a reaction blanked the button, so a reader could not tell whether their answer had counted. It had.

**What it finished.** 1 row(s).

- **M113** — Tapping Yes blanked the button and tapping Love it made it vanish, so the reader could not tell whether their answer had counted. It had.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The pane that looked empty, and the sub-groups that did n…

A pane on the voting-record card looked empty when a view was selected, and its sub-groups did not read as sub-groups.

**What it finished.** 1 row(s).

- **M117** — The voting-record pane looked empty when a view was selected, and its sub-groups did not read as sub-groups.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The map answers to the reader: the mask follows, the rise…

The map's dimming followed the reader instead of staying where they had been, and the raised-state effect stopped looking like a hard grey outline.

**What it finished.** 5 row(s).

- **M128** — Changing from a New Hampshire zip to an Arizona one flew the map to Arizona and left Arizona blurred, because the mask was bound to the last activation instead of to where the reader was.
- **M129** — The raised edge on a focused state rendered as a hard grey band tracing every coastal vertex. Two soft silhouettes replaced it.
- **M130** — District lines from states the reader is not in were drawing over the state they are in. At fifty states that is unreadable, and it split a 1.6 MB file into pieces.
- **M132** — The reader can now see which zip they are looking at, shaded on the map.
- **M133** — Panning the map glided the reader back to where they started, so free exploration was impossible.

**What it started.** 6 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The mandate becomes law before the hunting starts, and th…

Wrote the transparency mandate and the fourteen-rung retrieval ladder into the constitution before any deep hunting began, and stopped the tracker carrying two rows for one item.

**What it finished.** 4 row(s).

- **X08** — The transparency mandate and the fourteen-rung retrieval ladder became law, placed above every operational rule so they all inherit from them.
- **R29** — Two tracker rows shared an id with two completely different items, which silently breaks every lookup. Nothing had caught it.
- **M141** — The meetings panel rendered blank until the mouse moved. The header said 86 meetings and the list underneath was empty — a paint failure, not a data one.
- **M140** — One state active at a time, the whole of it crisp at every zoom, every other state muted and lowered — and the mask stops dimming the state the reader is standing in.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The list goes back to clean, and the popup to three things

The who-governs list went back to clean and the small map popup slimmed to a name, a party and a way to make contact.

**What it finished.** 2 row(s).

- **M114** — The who-governs card went back to clean: no pills, no site links, one way to click. The author called the previous version a forever scroll.
- **M115** — The small popup slimmed to a name, a party and a way to make contact. The author called it ugly and scattered.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The documents: what shipped, what did not, and why the me…

Wrote up what shipped, what did not, and why measuring the work cost half the session.

**What it finished.** 1 row(s).

- **R28** — Twelve checks added to that suite and three of its own claims corrected. The suite only ever grows.

**What it started.** 9 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The documents: four standing rules, the cuts, and the con…

Recorded four new standing rules, what was deliberately cut, and one conflict left for Sean to settle.

**What it finished.** 10 row(s).

- **M121** — The "about this area" page, linked from every who-governs panel, was returning a server error at every single zip. The door was down.
- **M122** — The zip around Newbury dropped from 26 meetings to 7 because one website refused one request and the refresh wrote that refusal into the data as an absence.
- **M124** — Zooming out removed pins because the re-query ignored the zoom entirely and kept asking about a small circle around a moving point.
- **M125** — A fact read from the Governor of Arizona's own website rendered under the words "Verified: not yet". The product was slandering its own best evidence.
- **M126** — The contest pick read as a duplicate of the per-candidate question. It now names what it does, names the cards it opens, and reads as one group.
- **R27** — Every past session's production checks collected into one suite that runs against the live site, each check tagged with the session whose work it protects.
- **M127** — The large card showed the same contact details twice — once as a row of pills and once as an accordion beneath.
- **M94** — Two more kinds of repeated notice that should collapse to a footnote. The other three fixes in that batch shipped; this half did not.
- **M91** — One state vivid and its neighbours dimmed, with a real dialog when the reader crosses a state line. Recorded whole; not built at the time.
- **D65** — The contributions question got its own version, so answers to it never pool with answers given to the older wording.

**What it started.** 9 row(s) opened, 1 still open.

- **M123** — Six towns around Newbury hold meetings inside the radius a reader at 03255 sees. The routes to their calendars have been walked and written down; none of them is wired, so those meetings do not appear. *(open)*

**Needs Sean.** Nothing.

## 2026-08-16 · The documents, the cuts, and what was ruled out

Wrote the record of what shipped, what was cut, and what was ruled out — including things that turned out not to reproduce.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The district card stops denying people we hold

A district card said it had no officeholder while the product held that person all along.

**What it finished.** 1 row(s).

- **M112** — A district card denied having any officeholder whenever the reader was not standing in that district, while the product held those people all along.

**Needs Sean.** Nothing.

## 2026-08-16 · The cards take their final face, and the brown dies

The cards took their final visual form and the last of an old colour scheme was removed.

**What it finished.** 7 row(s).

- **D63** — One weekly fetch of a pinned public dataset solved the entire federal directory — roster, social accounts, district offices, committees and membership.
- **M101** — Pima County's supervisors rendered one character per line in the small popup. A layout breakage, seen live, not a style preference.
- **M102** — The identity header matched to the author's ruling: circular portrait with a neutral ring, the name as the dominant type, one row of chips with party filled and the rest outlined.
- **M106** — Every way to reach a person, in one row on the large card — social accounts where held, plus phone, contact form, official page and campaign site.
- **M103** — The voting record became one full-width section with two views, and the expand arrows stopped pointing the wrong way.
- **M104** — Yes and no became filled pills everywhere a position or a reaction renders, so a settled answer looks settled.
- **M105** — The measure question was asked in a smaller, quieter box than the candidate question, so it read as less important than it is.

**What it started.** 7 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The amber remnant dies in both themes

One control had survived the colour pass in the light theme. Sean's ruling was system-wide, so it went too.

**What it finished.** 1 row(s).

- **M118** — One amber control survived the colour pass in the light theme. The author's ruling was system-wide, so it went too.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The .gov registry lands, with its boundary stated three t…

The federal registry of government domains landed as a reliable way to find where a government actually publishes, with the limits of that method stated plainly.

**What it finished.** 1 row(s).

- **D64** — A pinned snapshot of the federal registry of .gov domains, which is a reliable rung for finding where a government actually publishes.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · Pictures first, the counters breathe, and the documents

Candidates with a photograph list first within a contest, the sidebar counters stopped overflowing their tiles, and the record was written.

**What it finished.** 6 row(s).

- **M107** — Within a contest, candidates with a photograph list first. The author's recorded decision, after looking at the alternative.
- **R26** — Four entries added to the source ladder, including the federal legislator directory as a source of record and a fifty-state portal table.
- **M111** — The rule that came out of the closest call in the product's history: a component's default may never turn an absence into a statement. A null renders as its named gap, on every surface, always.
- **M108** — The four sidebar counters had labels wider than the tiles holding them, so they overflowed and read as clutter.
- **M109** — The who-governs card rebuilt to the same element grammar as the other cards. The author's bar was the reference screenshots' cleanliness.
- **M110** — A four-step route through three unsourced bodies said "we haven't sourced who sits on this body yet" three times, one line apart. Now once.

**What it started.** 6 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · Found by verifying the fix: a district card denies office…

Verifying one fix uncovered another: a district card denied having officeholders whenever the reader was standing somewhere else.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · Campaign money asks once per object

Two funding controls asked the reader the identical question on the same card, so the two answers could never be told apart.

**What it finished.** 1 row(s).

- **M116** — Two different funding controls asked the reader the identical question, word for word, on the same card — so the two answers could never be told apart.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · A tab that reports absence has to have looked

A card's Sources tab said it had no sources, on a card built entirely from sources.

**What it finished.** 1 row(s).

- **M100** — A district card's Sources tab said it had no sources, on a card built entirely from sources. It was reporting absence without having looked.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## truth-session-0815 · 2026-08-15

Two blocked websites opened, every district card started confessing where its facts came from, and the laws got their votes attached.

**What it finished.** 52 row(s).

- **M57** — The sidebar counters disagreed with the lists behind them: 6 officials beside a list of 24, 13 bodies beside a list of 60.
- **M58** — The "concluded" filter was dead at every zip, so meetings that had already happened rendered nowhere — even though the server had been sending them all along.
- **M60** — Every candidate blurb's attribution rendered its dash as three garbage characters, on every card. One bad file round-trip in an earlier session did it.
- **M61** — A candidate's party appeared on the ballot and vanished on the who-governs card — the same person, two surfaces, one of them silent.
- **M86** — A district card said it had no officeholder while showing that officeholder's name three rows further down. Fixed at the shared source rather than on the one card where it was spotted.
- **D49** — The source for state legislators' voting records, found by the author: bulk roll-call data for all fifty states.
- **M63** — In a race with one name on the ballot, the existing three answers collect almost nothing. "Someone else" is the answer that carries the signal.
- **M64** — The committed design foundation — the type scale, the three voices the product speaks in, and the tokens everything else draws from.
- **M65** — The ask box redesigned as the flagship it is: a raised block with a real heading, an inviting input and a filled button.
- **M66** — The ballot and the funding surface given flagship treatment — a header with presence, contests as designed cards rather than a list.
- **M67** — Three voices applied across the whole product: explainer, tappable link, and sourced data, each visually distinct so a reader can tell a fact from a link from an explanation.
- **M68** — When the same source line repeats under every contest, it renders once at the foot with a marker at each contest instead of a wall of identical citations.
- …and 40 more, on the Resolved tab.

**What it started.** 65 row(s) opened, 8 still open.

- **D62** — A research corpus of everything all 535 members of Congress have said publicly since 2022. It would give a member's card its third leg — votes show what they do, money shows who funds them, this shows what they say. *(open)*
- **B18** — Sean asked for federal officials' town halls. There is no authoritative feed for them anywhere, so this row records what was checked and what it found rather than pretending a build is waiting. *(open)*
- **D52** — Turning each state's campaign-finance filing vocabulary into words a fifteen-year-old reads. Every state files differently, so this is a programme with one adapter per state rather than a single job. *(open)*
- **X07** — In small races a campaign's entire public presence is a Facebook page. Recording that as no site found hides something real and penalizes exactly the candidates who could not afford a domain. *(open)*
- **D51** — Money spent about a race by groups that gave the campaign nothing. It reads completely differently from a contribution and has to render differently, or a reader will read it as the candidate's own money. *(open)*
- **M75** — On a phone, the map's legend crosses the bottom of an open meeting panel and covers the text underneath it. *(open)*
- **M92** — Bodies and districts on the map still click straight out to a website. Sean and the tester both wanted a card that tells you about the thing first, with the website as one of the things on it. *(open)*
- **M95** — The three state governors' cards carry no term end and no date of birth, so those lines correctly say nothing. Federal members already have them. *(open)*

**Needs Sean.** Nothing.

## 2026-08-14 · The tester's mobile pass: the bleed fenced, the ballot fo…

The tester walked the product on her own phone. Arizona's facts were bleeding into New Hampshire's answers, and she could not find the ballot at all.

**What it finished.** 6 row(s).

- **B13** — The tester's finding that a candidate with nothing on their card gets skipped, so the app tilts races without saying a word. It shipped a line naming the gap as ours; that line has since been replaced by a page-level disclosure.
- **M53** — The tester typed "library" in New Hampshire and got an explanation about Pima County, Arizona. One state's facts answering another state's question.
- **M54** — The tester could not find the ballot on her phone at all — the floating entry point never appeared and the only other way in sat below the browser chrome.
- **M55** — At phone width, fixed controls sat on top of the text a reader was trying to read.
- **D48** — The funding section now says what kind of money each donation is. Every committee in the tester's screenshot read "a political action committee" — true, and useless.
- **M56** — The tester found four of six district types switched on and turned the rest on by hand. Diagnosed rather than guessed at.

**What it started.** 10 row(s) opened, 3 still open.

- **D50** — The second pass at candidate and official photographs, now that the author has opened the door for portraits a government body publishes about its own members. More faces on cards, each one carrying the door it came through. *(open)*
- **B14** — Every candidate on every ballot gets a one-line description of themselves, taken from their own words and cited. The hunt is run just as hard for everybody in a race, which is what stops the cards tracking who could afford a website. *(open)*
- **V08** — A page for candidates rather than readers, showing what the product holds on them next to what it holds on their opponents. Sean's idea: the fastest way to fill a thin card is to let the person fill it. *(open)*

**Needs Sean.** V08

## 2026-08-14 · The photo session documents: 476/750, the findings for co…

Wrote up the photo hunt — 476 of 750 people covered — and the findings it produced.

**What it finished.** 1 row(s).

- **D20** — Portraits of officeholders downloaded once and served from the product's own servers, each one carrying a licence. No hotlinking and no unlicensed image.

**Needs Sean.** Nothing.

## 2026-08-14 · The documents stop making up dates, and the mirror gets a…

Documents had been carrying dates nobody read off a clock. Every date now comes from one command, and the shared drive got a short summary file.

**What it finished.** 2 row(s).

- **R14** — Three rules in the constitution carried dates later than the file's own last modification — dates nobody had read off a clock. Every date now comes from one command.
- **R15** — A short generated file so a conversation outside the repository can get current without reading a 249 KB state document.

**What it started.** 6 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · T08 session documents: state.md section 20, tracker Done …

Wrote the record of the hardening session — the rate limits, the abuse detection, and what they cost.

**What it finished.** 1 row(s).

- **T08** — The hardening pass before the password comes off the demo — adversarial load, abuse-pattern detection, and shared rate-limit state that does not violate the store-separation rule to enforce itself.

**Needs Sean.** Nothing.

## 2026-08-14 · 9c: the session documents - section 19, the executed brie…

Wrote the record of the tester-feedback session, including the walk that found a defect making the large card impossible to open on a phone.

**What it finished.** 11 row(s).

- **B11** — Governors were invisible on the who-governs card because they are elected by no district on the map. They now appear, so a reader sees the person running their state.
- **M46** — Rockaway Township's mayor card carried Tucson's charter text and a Tucson link. One jurisdiction's facts rendered on another's official.
- **M47** — The tester asked for her regional school district by name and the map never showed it, even though the product was counting it. Every district layer now starts switched on.
- **M48** — Officials group as Local, State and Federal everywhere they appear, from one shared derivation, so a growing list stays readable.
- **M49** — The top of the ballot now tells a reader what to actually do: the next election date they can add to a calendar, the registration deadline with the state's own link, and early voting.
- **M52** — The large official card could not open at all on a phone, on either the map or the ballot. Overlays had been pushing browser history and the router was tearing them down as they opened.
- **X04** — Two standing rules written into the constitution: organizations render exactly as they are registered and are never characterized, and every description of a person or organization names where it came from.
- **B12** — Every roll call shows how each party voted. Pure arithmetic over data already held, and the tester's cheapest good idea.
- **M50** — A reader can draw their own picks onto a single phone-width image and screenshot or download it. Entirely on their device; nothing is transmitted.
- **M51** — A batch of copy and truth corrections, including making every reader-facing date a real wall-clock date instead of a session label.
- **A11** — The ask box answered "pothole in front of my house" by naming the public housing authority board. A tie or a zero now refuses instead of answering.

**What it started.** 11 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 8a: the sidebar numbers become doors

The four numbers in the sidebar became doors that open the lists they count.

**What it finished.** 1 row(s).

- **M37** — The four numbers in the sidebar became doors. Each one opens the list it counts.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 8: recorded, not built - the tracker rows

Recorded several things as rows rather than building them, including two Sean deliberately parked.

**What it started.** 6 row(s) opened, 5 still open.

- **T10** — Sean told the tester that everything collected during the demo gets deleted when testing ends. This builds the deletion so it happens whether or not anybody remembers to do it. *(open)*
- **R13** — A standing rule rather than a task: the zip playbook only ever gains entries, never loses them, and every depth run ends by stating what it added or that it added nothing. It rides every future session. *(open)*
- **P12** — Showing readers what other readers answered. Sean tabled this: it anchors the next respondent and corrupts the very data being sold. Recorded so nobody builds it by accident. *(open)*
- **D46** — Showing who sponsored and funded each ballot measure. The tester argued both sides and Sean has not decided, so it is parked rather than half-built. *(open)*
- **V07** — A schools and civics-education version of the product, suggested by the tester. A business question rather than product work, parked for Sean. *(open)*

**Needs Sean.** T10, V07

## 2026-08-14 · 7: the mover's page — the questions asked before moving, …

Built the page for people thinking of moving somewhere — taxes, schools, registering, and the rest — answered per state and cited.

**What it finished.** 1 row(s).

- **M36** — The page for people thinking of moving somewhere: curated, cited answers per state to the questions that actually get asked — marijuana, firearms, income tax, vehicle registration, voter registration.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 6: the walk, the verified contact map, and the session do…

Walked the live product, verified every contact route, and wrote the record.

**What it finished.** 4 row(s).

- **D44** — The weekly campaign-finance refresh now refuses to publish a file with substantially less in it than the one before. A shrinking book never ships unnoticed.
- **P11** — A reaction only renders as counted once the server has actually stored it. Before, the button said "counted" whether or not anything landed.
- **A10** — Real phone numbers with cited sources for the everyday things — a pothole, a streetlight, a barking dog — riding the ask box's answers.
- **T09** — The refusal log stores raw typed text and the store is described publicly as identifier-free. Phone numbers, emails and street addresses are stripped before storage, not after.

**Needs Sean.** Nothing.

## 2026-08-14 · 6: meetings — the past has a card, the future goes on you…

Meetings that already happened got their own kind of card, and every upcoming one can be added to a calendar.

**What it finished.** 1 row(s).

- **M35** — Meetings that already happened get their own kind of card — what happened and who to call — and every upcoming meeting can be added to a calendar.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 5: the votes surface — summary open, the No-vote line, at…

The votes surface got its plain-language summary open by default and a line saying what a No vote actually means on that bill.

**What it finished.** 1 row(s).

- **M34** — The votes surface: the plain-language summary open by default, a line saying what a No vote actually means on that bill, and the attribution stated once instead of on every row.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 5: the photo census — 16 of 747, counted by script (D45)

Counted, by script rather than by eye, how many of the people the product renders actually have a photograph. Sixteen of 747.

**What it finished.** 1 row(s).

- **D45** — A script rather than an eyeball counted how many of the people the product renders actually have a photograph. The answer was 16 of 747, and that number is what justified the photo hunts.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 5: the ask box, v1 — routing without generation (A09)

The first ask box: type a question and get routed to the body that can act on it. It generates nothing.

**What it finished.** 1 row(s).

- **A09** — The first ask box: type a question, get routed to the body that can actually act on it. Curated matching, and it generates nothing.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 4: the refusal log scrubs before it stores (T09)

The log of unanswered questions captures raw typed text, so phone numbers, emails and addresses are stripped before storage rather than after.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 4: save my picks — device-local only, said everywhere, en…

Readers can mark how they would vote. It saves on their own device, is never transmitted, and the database is prevented from ever having a column for it.

**What it finished.** 1 row(s).

- **M33** — A reader can mark how they would vote on each contest. It is saved on their own device, never transmitted, and the database is prevented from ever having a column to put it in.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 4: incumbents' ballot cards link their voting record (B10)

Every incumbent's ballot card links straight to their voting record, opening the same full card the map uses.

**What it finished.** 1 row(s).

- **B10** — Every incumbent's ballot card links straight to their voting record, opening the same full card the map uses rather than sending the reader somewhere else.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 3: the everyday-topics map — the pothole standard (A10)

Real phone numbers with cited sources for the everyday things — a pothole, a streetlight, a barking dog.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 3: the copy and UI batch, the author's words verbatim (M3…

A batch of wording and interface changes in Sean's own words, shipped together.

**What it finished.** 8 row(s).

- **M38** — Party shows in its own colour everywhere it renders. The colour states the label and never implies anything else.
- **M41** — "Mark how you'd vote" became "What do you think?", and the disclosure about picks stopped repeating under every contest.
- **M43** — The districts card said 3 and listed 2, because the card counted what was drawn on screen and the list counted what actually governs the reader.
- **M44** — The who-governs card stopped popping open every time the reader panned across an invisible boundary. It opens for a typed zip, which is a request.
- **M45** — Add-to-calendar had shipped on one meeting card only. It now appears on every upcoming meeting anywhere in the product.
- **M39** — The product's own plain-language summaries render in a heavier weight, so the reader can see which words are ours and which are the government's.
- **M40** — The moving-here teaser in the author's exact words, so the invitation reads like a person wrote it.
- **M42** — The government's own official analysis collapses by default, with the plain-language summary open above it. The reader gets the plain version first and the official one on request.

**What it started.** 8 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 3: the audit against the official universe — 211 governme…

Counted what the product covers against the federal Census of Governments rather than against its own list, because a list that defines its own denominator can never be caught missing anything.

**What it finished.** 1 row(s).

- **D38** — Counted what the product covers against the federal Census of Governments rather than against its own list. A list that defines its own denominator can never be caught missing anything.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 2: the FEC snapshot refuses to ship thin (D44)

The weekly campaign-finance refresh now refuses to publish a file with substantially less in it than the one before.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 2: self-funding labeled from the FEC's own typing; the ph…

A candidate lending money to his own campaign stopped rendering as an anonymous organization, and the photo rule tightened to ban logos and banners.

**What it finished.** 3 row(s).

- **D41** — A candidate who lends money to his own campaign was rendering as an anonymous organization donating to him. The federal filing says plainly it is him, and the card now says so too.
- **D42** — A governor's card was serving a campaign wordmark instead of her face. The photo rule now bans logos, banners, screengrabs and any picture where the person is not unmistakably the subject.
- **D43** — Donor names render exactly as filed, in shouting capitals, because that is what the public record says. Deliberate, and recorded so nobody tidies it.

**What it started.** 3 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 2: Sunnyside and Amphitheater wired live — the author's c…

Two Tucson-area school districts serving four zips had nothing at all. Sean spotted it; this session wired them.

**What it finished.** 1 row(s).

- **D39** — Two Tucson-area school districts serving four zips had no bodies, no members and no meetings. They now render fully — the author spotted they were missing.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 2: NH/NJ depth — Kelly cards, the name-case pass, Newbury…

New Hampshire and New Jersey got depth: proper candidate cards, names that stopped shouting, and Newbury's select board explained for somebody who has never been there.

**What it finished.** 3 row(s).

- **M30** — Candidates became cards rather than links: photograph with its source named, their own site's words for the description, published contact details and their official and campaign sites.
- **M32** — Newbury has no mayor — a select board runs the town. The card now says so, with the board's members, instead of leaving a stranger to wonder who is in charge.
- **M31** — A New Jersey clerk files names in capitals, so "Brian ROACH" rendered as shouting. Display-only correction; the filing is untouched.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 1: the author's words — the mission text verbatim, and "s…

The welcome screen took Sean's mission statement in his own words, and the word "sell" was replaced with an accurate description of what happens to the data.

**What it finished.** 1 row(s).

- **M29** — The welcome screen carries the author's mission statement in his own words, and the word "sell" was replaced with an accurate description of what happens to the data.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 1: the FEC replication bug (D40) — the cache key, not the…

Production was showing one senator's campaign finance figures on two other politicians' cards. The cause was a cache keyed on the wrong thing.

**What it finished.** 1 row(s).

- **D40** — Production showed one senator's campaign finance figures on two other politicians' cards. The cause was a cache keyed on the wrong thing, not a bad join.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 1: FEC funding surfaces, first and whole — D34 built, bot…

Built the campaign-finance surfaces whole, behind named kill switches, so an open legal question can be pulled without a migration.

**What it finished.** 1 row(s).

- **D34** — The campaign-finance surfaces ship behind named kill switches, with every record tagged, so pulling one is a filter rather than a migration.

**Needs Sean.** Nothing.

## 2026-08-14 · 10: the tester pass — four zips, phone width, 74 checks g…

A full pass across the four test zips at phone width, with 74 checks recorded.

**What it finished.** 1 row(s).

- **D37** — Checked every New Hampshire constitutional amendment proposed in 2025 and 2026 against the official record and confirmed none reached the November 2026 ballot. An absence the product earned the right to state.

**Needs Sean.** Nothing.

## 2026-08-13 · Tucson depth: the hunts, their records, and what blocks t…

Went deep on Tucson: which meeting sources exist, which were found, and what stands in the way of the rest.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · The session's documents: state.md §10, tracker closes, CL…

Wrote the record of the deploy-and-demo session.

**What it finished.** 1 row(s).

- **R12** — The deploy now runs the exact command the repository specifies rather than whatever the host guessed, so what builds locally is what builds in production.

**Needs Sean.** Nothing.

## 2026-08-13 · The session's documents: correct-first in CLAUDE.md, the …

Wrote correct-first-fast-second into the constitution as the order of every trade, and recorded the retry rule.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · The live fan-out cannot ship: production reads a committe…

Fetching five vendors live for every visitor would time out and would hammer public bodies' websites. Meetings now come from a committed file.

**What it finished.** 1 row(s).

- **D26** — Meetings are read from a committed file rather than fetched live for each visitor. Live fetching would time out and would hammer public bodies' websites with a request per reader.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · The friction batch: ten production defects under the new …

Ten small defects Sean found in one pass, shipped together under the new rule that reader friction is a defect.

**What it finished.** 1 row(s).

- **M28** — Ten small production defects the author found in one pass, shipped together: directions that opened the wrong app, links that stole the tab, and eight more.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · The cheap corrections: D15 marked, M14 built, GEOID retai…

A batch of cheap corrections, plus three new rows for the things that turned out not to be cheap.

**What it finished.** 2 row(s).

- **D15** — The identifiers the product mints for districts had drifted from the public standard. Since every join runs on those identifiers, nothing could be reliably connected until they matched.
- **M14** — County subdivisions were built and committed but never drawn, because drawing them would have shown some governments twice.

**What it started.** 3 row(s) opened, 1 still open.

- **D23** — Federal law restricts commercial use of individual donor names and addresses. This row records exactly what the restriction covers before any code ships that touches it, so the line is drawn on paper first. *(open)*

**Needs Sean.** D23

## 2026-08-13 · Search logging and the transparency page, together

Search logging and the page describing it shipped in the same commit, so the description could never lag behind what is collected.

**What it finished.** 1 row(s).

- **D30** — Search logging and the transparency page shipped in the same commit, so the page describing what is collected could never be behind what is collected.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · Retire the mock: the composite source serves real meeting…

Mock meetings retired. The product started serving real agendas from real public bodies.

**What it finished.** 5 row(s).

- **D11** — A live spike wiring the agenda source against a handful of real cities, so real agendas appeared on the map before the database existed.
- **D12** — The read API for the first real meetings vendor, replacing the assumption that the site would have to be scraped.
- **D13** — The school-board tier: a single agenda platform used by several thousand boards across the country.
- **D16** — Tucson's meetings run on a different platform from the county's, and the vendor's own portal is off-limits. The records are reached through the City instead.
- **D21** — A municipal platform that publishes real feeds anybody can read. One adapter, thousands of municipalities, and no vendor question at all.

**Needs Sean.** Nothing.

## 2026-08-13 · Restore the officials surface: the exact tier was deletin…

All 537 federal officials and every state legislator vanished at one specific zoom level. Restored and guarded.

**What it finished.** 1 row(s).

- **M23** — All 537 federal officials, the state legislators and the list of governing bodies stopped appearing at one specific zoom level. Found by the author in production, restored and guarded.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · Realign the documents to the reprioritization they record

Brought the documents into line with the decision that four zips are the product.

**What it finished.** 1 row(s).

- **D01** — The first real municipal agenda source, replacing mock meetings. One integration per vendor reaches many cities at once.

**Needs Sean.** Nothing.

## 2026-08-13 · Phone width and the landing state: the demo becomes a demo

The product became usable on a phone and the landing state became something worth showing somebody.

**What it finished.** 2 row(s).

- **X01** — Define the demo. Nobody funds or covers an idea.
- **M22** — The whole product on a phone: the sidebar becomes a slide-over drawer behind a proper touch target. The demo gets opened on a phone.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · P03: reaction capture goes live — the sensor, its stores,…

Reaction capture went live: the one-tap answer, the stores behind it, and the disclosure the reader passes through exactly once.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · Morris and Merrimack wired: the two found sources become …

Two county meeting sources found by hand became working adapters.

**What it finished.** 1 row(s).

- **D27** — Two county meeting sources found by hand and built into adapters — Morris County, New Jersey and Merrimack County, New Hampshire.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · M27: the dead district checkboxes — intent turns the over…

The district-type checkboxes did nothing while the overlay was off, so a reader ticking boxes saw no response.

**What it finished.** 1 row(s).

- **M27** — The district-type checkboxes did nothing when the overlay was switched off, so a reader ticking boxes saw no response at all.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · M26: the narrowing prompt, in the author's words and on t…

When a zip crosses several towns, the reader is asked which one is theirs — a prompt they can decline, in Sean's own wording.

**What it finished.** 1 row(s).

- **M26** — When a zip crosses several towns or districts, the reader is asked which one is theirs — a prompt they can decline, stored on their own device and never sent anywhere.

**Needs Sean.** Nothing.

## 2026-08-13 · M24/M25: Reset all resets everything, and it shows

"Reset all" left filters behind and the count of what was active was wrong. Two faults compounding into one confusing control.

**What it finished.** 2 row(s).

- **M24** — "Reset all" left filters behind, and the count of what was active was wrong. Two separate faults compounding into one confusing control.
- **M25** — There was no way to switch every district type on at once.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · Deploy pipeline pinned; session-start now repairs a stale…

The deploy now runs the exact command the repository specifies, and the start-of-session check repairs a stale development server instead of leaving it running.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · D33: the Arizona and New Hampshire ballots, as filed and …

The first two real ballots landed — Arizona and New Hampshire — rendered exactly as filed and never as advice.

**What it finished.** 1 row(s).

- **D33** — The first two real ballots — Pima County, Arizona and Merrimack County, New Hampshire — behind one contract, so adding a state does not mean rewriting the ballot.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · D32: officials become people you can actually reach

Officials stopped being names and became people with a phone number, a face, and a plain description of what their office does.

**What it finished.** 1 row(s).

- **D32** — Officials became people you can reach: contact details on the card, photographs, plain-language descriptions of what each office does, and a verified campaign link.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · D28/D29: the curated overlay — division-less bodies and o…

A city has many boards rather than one, and some governments have no mapped district at all. Both got a way to be represented.

**What it finished.** 1 row(s).

- **D28** — Special districts and community college boards that the Census does not enumerate needed identifiers before they could be wired. Pima Community College's board was one wiring row from live.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · D25: how to actually be heard, curated per body and rende…

For each body: whether there is a public comment period, when it falls, and how to be heard at it.

**What it started.** 1 row(s) opened, 1 still open.

- **D25** — For every body the product watches: whether there is a public comment period, when it falls, how to sign up, where to send something in writing, and how long anybody gets to speak. The difference between knowing a meeting exists and being able to be heard at it. *(open)*

**Needs Sean.** Nothing.

## 2026-08-13 · D17: split the gating — the statute renders now, diligenc…

New Hampshire does not require an agenda at all, so a missing one there is lawful rather than a hole in the product's coverage.

**What it finished.** 1 row(s).

- **D17** — New Hampshire does not require an agenda at all, so a missing agenda there is lawful rather than a hole in the product's coverage. The wording has to say which.

**Needs Sean.** Nothing.

## 2026-08-13 · D10: the persistence schema lands, with the vintage column

The database design for meetings landed, including the column recording which boundary vintage a record was resolved against.

**What it finished.** 1 row(s).

- **D10** — The database design for meetings — tables, a migration, and a rule for what happens when the same meeting arrives twice.

**Needs Sean.** Nothing.

## 2026-08-13 · D02: how my rep actually voted — the roll calls land as a…

Federal roll-call votes landed, read from the House and Senate clerks' own published records.

**What it finished.** 1 row(s).

- **D02** — Federal roll-call votes, read from the House and Senate clerks' own published records rather than scraped from a website.

**Needs Sean.** Nothing.

## 2026-08-13 · A08: the routing knowledge base — who can act, cited, par…

A curated, cited map of which kind of official can actually act on which kind of problem — built before any chat interface, so the routing is knowledge rather than guesswork.

**What it finished.** 1 row(s).

- **A08** — A curated, cited map of which kind of official can actually act on which kind of problem, built before any chat interface so the routing is knowledge rather than guesswork.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · 7: the session's documents — §14, the ripcord doctrine, t…

Wrote the record, including the doctrine that a feature with an open legal question ships behind a named kill switch or not at all.

**What it started.** 3 row(s) opened, 1 still open.

- **D36** — Twenty-seven candidates whose website and contact hunts were written down as never attempted. Each one finished is a candidate who stops being a name with nothing beside it. *(open)*

**Needs Sean.** Nothing.

## 2026-08-13 · 7: the session's documents — §13, the rung set, the rows,…

Wrote the record, including the retrieval rungs discovered that day.

**What it finished.** 1 row(s).

- **M05** — Click a district or a pin and get a consistent card: who represents you there, what was recently decided, and what is coming up.

**Needs Sean.** Nothing.

## 2026-08-12 · Write git-state.txt into the mirror

A generated file in the shared drive recording where the repository stood at handoff, so a conversation with no checkout can still see it.

**What it finished.** 1 row(s).

- **R09** — A generated file in the shared drive recording where the repository stood at handoff, so a conversation with no checkout can still see it.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Tell every reader in the country who represents them in C…

Every reader in the country can see who represents them in Congress, not only readers in the four test zips.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Say what coverage means on screen, and stop counting 32 g…

The screen started saying what coverage actually means, and 32 governments stopped being counted twice.

**What it finished.** 1 row(s).

- **M16** — An empty map becomes an honest statement: this area has a governing board and the product does not have its calendar yet.

**What it started.** 3 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Replace the entry notice with the welcome overlay

The entry screen became a welcome card over a dimmed map, with quick-jump zips and a use-my-location option.

**What it finished.** 1 row(s).

- **M11** — The entry screen became a welcome card over a dimmed map, with quick-jump zips and a use-my-location option.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Read Pima County's meetings from the Legistar API, and wr…

The first real municipal agenda source, plus a written record of what each vendor's terms actually say.

**What it finished.** 1 row(s).

- **D14** — One written paragraph per vendor recording what its terms actually say. A record for choosing routes, deliberately not a gate that blocks retrieval.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Port the popup card and the full-screen modal, and pool t…

The popup card and the full-screen card landed, and map markers started being reused instead of rebuilt on every change.

**What it finished.** 1 row(s).

- **M20** — Map markers are created once and reused as filters change, rather than the whole set being torn down and rebuilt.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Let Census resolve the duplicate: FUNCSTAT, joined from T…

Let the Census's own data decide which of two overlapping map layers describes a real government, rather than guessing by name.

**What it finished.** 1 row(s).

- **M17** — 32 of 153 municipal bodies were the same government counted twice, because two federal map layers both describe it.

**What it started.** 1 row(s) opened, 1 still open.

- **M18** — A city and county that merged into one government still render as two bodies with two councils. A reader sees their single local government twice. *(open)*

**Needs Sean.** Nothing.

## 2026-08-12 · Give every meeting somewhere to click, and record who act…

Every meeting got somewhere to click through to, and the product started recording what was searched.

**What it finished.** 1 row(s).

- **M21** — Every meeting gets somewhere to click, and a body nobody has looked at stops being indistinguishable from one that was searched and found empty.

**What it started.** 3 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Fix the four defects found testing the Phase 4 build

Four defects found by actually testing the build rather than reading it.

**What it started.** 6 row(s) opened, 2 still open.

- **M13** — The radius control broke twice — once blanking results, once refusing to switch off — and both times the tests only covered the logic underneath, not the control a reader touches. *(open)*
- **B09** — The question to put to counsel: can a software vendor's terms of use narrow the public's statutory right to records a government body is required to publish? The product's whole retrieval posture rests on the answer being no. *(open)*

**Needs Sean.** B09

## 2026-08-12 · Fast-forward local main after shipping, and push -u when …

The ship command stopped leaving the local repository a whole session behind, which had made the project look empty on the next checkout.

**What it finished.** 1 row(s).

- **R07** — The ship command merged the pull request and left the local repository a whole session behind, which made the project look empty on the next checkout.

**Needs Sean.** Nothing.

## 2026-08-12 · Check the three things that lie quietly, and stop the dev…

Three start-of-session checks for the things that fail silently, and a development server that can actually be stopped.

**What it finished.** 1 row(s).

- **R10** — Three checks at the start of every session and a development server that can actually be stopped, so a stale checkout cannot pass for a working one.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Build the boundary data Phase 4.6's derivation rule needs

Built the boundary data needed to work out which governing bodies sit inside which district.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Bring state.md and the tracker current through Phase 4.6

Brought the state document and the tracker current with what had actually shipped.

**What it finished.** 1 row(s).

- **M15** — The join that did not exist: which governing bodies sit inside which district. Generated from the boundary files rather than hand-written.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Add seven district overlays and click-to-select

Seven kinds of district boundary became layers on the map, each one clickable.

**What it finished.** 2 row(s).

- **M02** — A zip crosses district lines, so after a zip is typed the reader is shown the districts that overlap it and picks the one they actually live in.
- **M04** — The same boundary treatment for state house and senate districts, council wards and school board zones, each a layer the reader can toggle.

**Needs Sean.** Nothing.

## 2026-08-11 · Port the EdiaStratMap application shell

The application shell — sidebar, scope selectors, stats, search, filters and legend.

**What it finished.** 1 row(s).

- **M10** — The application shell — sidebar, scope selectors, stats, search with autocomplete, radius and near-me controls, filters and legend.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-11 · Fix the MapLibre worker and port the EdiaStratMap design …

The map's rendering worker failed to load, so no map tiles were ever fetched. Fixed, and the whole visual system landed with it.

**What it finished.** 4 row(s).

- **M08** — The map's rendering worker failed to load, so no map tiles were ever fetched. Without this fix there is no map.
- **M09** — The whole visual system — colours, typefaces, and a light/dark theme that remembers what the reader chose.
- **R06** — Headless screenshot capture of the running app, so visual checks do not depend on somebody having a browser window open.
- **R04** — The README described a map setup that was not what actually ran.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-11 · Add national congressional district overlay

The first session. The map, the tracker, and congressional district boundaries over the whole country.

**What it finished.** 5 row(s).

- **D09** — The full table of zip centre points. Before it, most real zips reported as not covered; after it, the map can zoom to any zip in the country.
- **M01** — The first build of the map: type a zip, the map flies there, and upcoming public meetings appear as pins.
- **M06** — Every upcoming meeting links out to its own agenda where one exists. Never a dead end.
- **M03** — Congressional district boundaries as a layer the reader can switch on over the map.
- **R03** — Nothing is marked done without the branch and which checks passed. An agent grading its own homework drifts optimistic.

**What it started.** 68 row(s) opened, 40 still open.

- **B01** — The product is called Meanwhile on screen while the real name is decided. Nothing a reader sees changes until Sean settles it; when he does, one file changes and the whole site follows. *(open)*
- **C01** — A sample of what a buyer actually receives: one Pima County measure broken into its provisions, with support per provision and counts by how well each answer was verified. Synthetic numbers, clearly labelled, built to show rather than to sell. *(open)*
- **D07** — Turning a street address into the exact set of districts a person votes in. Without it the product can orient a reader by zip but cannot promise them their own ballot. *(open)*
- **V01** — Five conversations with the people who would buy the data — campaign consultants, party data staff, PAC data directors, at least one on each side. The question to put to them is exclusivity. *(open)*
- **V03** — Build a throwaway prototype against three to five cities' agenda systems and find out whether the local-meetings thesis holds. If those systems are locked down or wildly inconsistent, the product changes shape. *(open)*
- **V05** — A short, sharp answer to the buyer who asks why this beats a thirty-thousand-dollar tracking poll. Needed before the first meeting, not after it. *(open)*
- **B05** — Two lawyers, probably: one on privacy and one on election law. Both have long lead times and several other rows are waiting on them. *(open)*
- **D05** — Everything the product can say about a candidate from their own site, their own filings and their own voting record. Never an endorsement list — that is somebody else's judgement about them. *(open)*
- **D08** — Pick the source that says which contests are on which ballot. The commercial-use terms are the first question to ask, because they decide whether the answer can ship. *(open)*
- **T01** — The page that says, in plain words, what the product collects, how it is used, and that anonymous totals may be sold. Written before any marketing page, because the marketing has to be true. *(open)*
- **V04** — Take one real Pima County down-ballot race and build the full side-by-side of sourced positions and the reader's own priorities. The test of whether the sourcing actually holds up end to end. *(open)*
- **V06** — Read the plain-language output back to real people with real questions and find out whether it is actually plain. Synthetic test questions cannot tell you that. *(open)*
- …and 28 more still open.

**Needs Sean.** B01, C01, V01, V03, V05, B05, T01, V04, V06, B02, B03, T04, B07, T03, T05, B04, T02, X02, X03, T06, T07, C02, C03, C04

## nj-hunt3

**What it started.** 12 row(s) opened, 12 still open.

- **NJ06** — data/ballot/nh-merrimack-2026.json gives the contest "Executive Councilor, District 2" the ocdId ocd-division/country:us/state:nh/county:merrimack/place:newbury_town. New Hampshire's Executive Council District 2 covers 81 cities and towns; Newbury is one of them. Two consequences: the contest renders only for readers whose divisions include Newbury, so the other 80 towns in the district never see their own Executive Council race; and the id is a wrong join key, which CLAUDE.md makes the universal key for districts, offices and elections. Found while verifying RULING 71's certainty classification -- the contest read as CERTAIN at 03255, which is accidentally the right answer for the wrong reason (Newbury covers the whole zip, and District 2 does cover Newbury). The right division is an Executive Council district, which this repo has no committed geometry for. Fixing it means either committing that layer or recording the contest against the state with a scope note. *(open)*
- **NJ07** — pnpm twig:pair --zip 07866 gives 90 of 142 units held, and 52 of 52 unheld rows read "no division of its own". 34 of those are GENERAL_PURPOSE and SCHOOL_DISTRICT units in Sussex, Passaic, Essex, Bergen and Warren counties, 16-25 km out. Real TIGER polygons exist for all of them. The gap is that CLIP_COUNTIES is one county per covered state (lib/coverage/artifacts.ts, derived from the coverage manifest): place-34.geojson holds 67 features and cousub-34.geojson 66, all Morris. scripts/fetch-districts.ts states the tradeoff explicitly -- national coverage across these types is 13,000+ features, which ends the committed-GeoJSON approach and forces vector tiling. Extending to five adjacent counties is roughly 1,000 more features. That is a real step toward the stated ceiling and it is an architecture decision rather than a hunt, which is why this is a row and not a fix. Note the denominator: 142 is the first-rung 25 km circle, and every government whose territory reaches inside 07866 IS held. *(open)*
- **NJ08** — The other half of the 52. Fire districts, sewerage authorities and a power authority -- ROCKAWAY VALLEY REGIONAL SEWAGE AUTHORITY, five PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICTs, three MONTVILLE TOWNSHIP FIRE DISTRICTs, HANOVER TOWNSHIP FIRE DISTRICTs 2 and 3, PEQUANNOCK RIVER BASIN REGIONAL SEWERAGE AUTHORITY, NEW JERSEY PUBLIC POWER AUTHORITY, SOUTHEAST MORRIS COUNTY MUNICIPAL UTILITIES AUTHORITY, PEQUANNOCK-LINCOLN PARK-FAIRFIELD SEWERAGE AUTH, WANAQUE VALLEY REGIONAL SEWERAGE AUTHORITY, MUSCONETCONG SEWERAGE AUTHORITY. No TIGER polygon exists for any of them at any vintage, so no geometry pipeline will ever reach them. RULING 57 says a body is NAMED FIRST and hunted second, and that a body with no source and no site is still entered and still rendered. scripts/twig-pair.mts already has divisionlessBodyFor(), so the mechanism exists in one place and has not been generalised. Eleven of the eighteen publish a website, listed in the twig:pair output. *(open)*
- **NJ09** — Measured 2026-08-22, not assumed. Across all 272 Morris candidacies: contact 272 of 272, ballot slogan 70 of 272, campaign site 0 of 272, photo 0 of 272. Both of the fields that are held come from ONE route -- filing-county, one county-clerk PDF -- and that document carries no portrait, no prose about a candidate and no URL. So New Jersey's mechanical contact windfall is a property of that DOCUMENT and does not generalise to the other three fields. pnpm nj:fields walks a contest and reports per route; the Rockaway Borough Council four were walked (Burnside, McDonald, Dawkins Jr., Natale) and returned filing-county empty, campaign-site not walkable, domain-search one lead (patrickmcdonald.com, capped at a lead under RULING 68 because the identifier was guessed) and three empty. 86 of the 90 contests are unwalked, and no candidate anywhere has had the full named route list walked, so no absence has been earned for anybody in either zip. *(open)*
- **NJ10** — Read as an image on production 2026-08-22. With the zip-area widening in place the card at 07866 lists both municipalities, and the Borough's row reads "Rockaway  MUNICIPAL" while the Township's reads "Rockaway township  MUNICIPAL". A reader cannot tell which is which, which is the exact confusion RULING 71 exists to remove -- borough and township are coequal forms and these are two separate governments sharing a name. The label comes from the division's own name in the registry, which for the place layer is the Census's "Rockaway" for the CDP-style entry. The fix is a labelling decision about which of the two committed names a row shows, and it wants a look at the other states before it is made. *(open)*
- **PU01** — Read as an image on production 2026-08-22 at 430x932. The map at 07866 shows a panel reading "BASEMAP UNAVAILABLE -- Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use". That is an environment variable name and a dotfile path rendered to a reader, which the plain-language rule forbids outside a technical-details disclosure: identifiers, enum values and internal keys never render to a reader. The honest half of the message -- that tiles did not load and pins still work -- is right and should stay. Two questions for whoever takes it: whether the key is simply unset on the production deploy (in which case the message is doing its job for the wrong audience), and what a reader should see instead. *(open)*
- **DI01** — pnpm nj:filing reports 42 seats a party filed nobody for, and entry 28 is "Morristown Town -- NO LOCAL ELECTION (Democratic)". NO LOCAL ELECTION is a jurisdiction-level statement in the clerk's document, not an office, so a row carrying it as an office is a bleed between two record types the parser already separates elsewhere -- the same class NJ2 playbook entry 7 describes. It does not reach a reader (the 42 are a finding stated in the report, not a rendered surface) and the total still reconciles, which is why this is P3. The count of 42 should be read as 41 unfilled seats plus one parser artifact until it is fixed. *(open)*
- **NS02** — The Stack section states "Five workflows push main -- the four governed-artifact refreshes plus the intake tripwire". Since then job-watch.yml was added (NH Hunt 3, RULING 56) and refresh-nj-filing.yml was added today (NJ Hunt 3 item 2.3, the county filing on a one-day RULING 53 clock). tests/push-main.test.ts now asserts seven. CLAUDE.md is law and is changed only by the author, so this is routed rather than edited. The sentence is a factual count rather than a rule, and the rule it sits inside -- that every main-pushing workflow rebases and retries through scripts/push-main.mjs -- is unchanged and still true of all seven. *(open)*
- **NS03** — RULING 75 -- a close-out commit is gated like any other commit to main. Close-out records were pushed straight to main through no gate at all, by every session in this repo's history, and that put a red suite on main twice. pnpm closeout is the gated door, pnpm main:green asks GitHub what happened to the tip rather than asking the working tree, and pnpm handoff now fails on a RED main. RULING 76 -- session-dated capture scripts stay committed and stay held to every standard; there are 34 of them and all 34 are committed. Both are written into docs/rulings.md with their reasoning. Neither is in CLAUDE.md, because that file is law and only the author changes it. If either should be law, it wants his hand on it. *(open)*
- **PU02** — Measured on production f20e1e9, 2026-08-22, at 430x932 with the walk's own page shape. Typing "a" into the ask box and clicking the FIRST row of type Body opens no card at either zip: 85701 offers "Amphitheater Unified School District Governing Board" and 85641 offers "Armory Park Historic Zone Advisory Board", and neither produces a .account-modal within 5 seconds. No page error is thrown. This is M135's rule (g15) -- a row opens a card -- broken for at least some rows.

It is PRE-EXISTING and is not caused by this session's coverage widening. The proof is 85701, which this session did not change in that direction and which fails on its first Body row exactly the same way. walk:all passes at 85701 only because its loop retries up to three times and a LATER row happens to open ("AGENDA FOR AUDIT COMMITTEE MEETING"); at 85641 only one Body row is offered, so `attempt >= offered` breaks the loop after one attempt and a single non-opening row fails the check.

Why it surfaced as a regression today: the meetings snapshot refreshed at 20:04 (455 rows, 381 fresh + 74 carried), which changed which rows the autocomplete offers first at 85641. The check's verdict is therefore sensitive to snapshot content, which is worth knowing about the check as well as about the defect.

Two things for whoever takes it: why that class of row resolves to no card, and whether M135's retry loop should keep trying rather than breaking when a zip offers exactly one Body row -- a check that passes because the second row worked is not asserting what it reads as asserting. *(open)*
- **VF01** — Read as an image on production f20e1e9 at 430x932. On the map's who-governs card the pill sits inline in each body row, between the body name and the type label. At phone width that squeezes the name into two and three lines - Rockaway Township School District wraps to three, Denville Township School District to three - and the pill itself wraps to two or three lines beside them. Every word is legible and the classification is correct; the row is simply cramped, and six of eight rows carry it at this zip. The pill reads well on the ballot page, where it wraps under a wide heading rather than competing with a narrow column. Worth a look at whether it belongs under the row rather than inside it on narrow viewports, or whether the type label should move. *(open)*
- **NS04** — Every job on d0e0e34 completed in three to four seconds with ZERO steps recorded, twice, including an explicit `gh run rerun`. Runs 32600684167 and its re-run both died before any step reported and the logs were not retrievable. It was not the tree: f20e1e9, twenty minutes earlier, passed all three checks, d0e0e34 differed from it only by documents and one capture script, and locally the suite was 1704/1704 with lint clean, tsc clean and both build modes green. RESOLVED ITSELF WITHIN THE HOUR, and that is recorded rather than the row being dropped. The next commit, 3186eb2, went GREEN on all three checks at the first attempt. So the condition was TRANSIENT -- a runner allocation failure rather than a standing minutes or spending cap. This is left open at a lower priority because a transient failure that nobody looked at is how the meetings refresh degraded for eight days, and because the account settings that would confirm or rule out a cap are ones a session cannot see: `gh api /settings/billing/actions` returns 404 for me. What is worth Sean's minute: whether the Actions minutes balance or spending limit is anywhere near its ceiling, because if it is, this will recur and the next occurrence will look identical. Nothing needs fixing in the repo. scripts/main-green.mjs was corrected in the same session to tell this apart from a genuinely red main -- before that fix it reported "main is broken and production will not deploy", which would have sent a session hunting a defect that did not exist. *(open)*

**Needs Sean.** NS02, NS03, NS04

## nj-hunt-0822

**What it started.** 6 row(s) opened, 5 still open.

- **NS01** — The Meta Ad Library is the single best compliant route to a campaign that lives on Facebook, and it is the one route in the manifest that this project cannot walk at all. Political-ad disclosure is mandatory by law, so any candidate who buys a single ad appears there with the campaign's website, its paid-for-by disclaimer and often a contact. The API refuses every unauthenticated request (graph.facebook.com/ads_archive answers HTTP 500 OAuthException), and the public Ad Library web pages answer HTTP 403 with an anti-automation challenge. Measured 2026-08-22 for all sixteen Merrimack County candidates: ad-library REFUSED 16 of 16, and that refusal is recorded as a refusal rather than an absence, so no candidate field moved toward exhaustion on it. A token is issued against an identity-verified Meta developer account, which means it is tied to a real person and to that person's acceptance of Meta's platform terms. That is a standing commitment to a third party and a legal question wearing an API key, which CLAUDE.md lists as an ask-before. It is also the reason no session may make it: RULING 12 says a wall like Facebook's is named and not defeated, and authenticated access risks the account it runs under. This row exists so the decision is documented and yours, with counsel's read, rather than made quietly inside a session. NOTHING is blocked on it — the other three RULING 66 routes are built and walked, and the answer may simply be no. *(open)*
- **NJ02** — The official-universe pair at 07866, measured 2026-08-22 against the 2022 Census of Governments: 178 units within the first radius rung, 5 held, 173 with no body, 13 bodies held across those five. Compare 03255, which is 48 of 48. The five held are Township of Rockaway (9 bodies), County of Morris, Morris County Soil Conservation District, Morris Hills Regional District and Rockaway Township School District. Every un-held unit is named in the twig:pair output rather than counted, per RULING 57. This is the enumeration finding, not a defect: the New Jersey universe is simply much larger inside 25 km than Newbury's, because northern New Jersey is dense with boroughs, townships, fire districts and regional authorities. The work is to name and reach them, one shape at a time, and the fire districts and municipal utilities authorities are the biggest single class. *(open)*
- **NJ03** — lib/sources/http.ts gives the Cloudflare interstitial signature a 20 KB maxBytes floor, with a comment explaining exactly why: Cloudflare injects its challenge-platform script into ORDINARY pages, so reading the marker at any size would mark a working source refused. The Imperva/Incapsula signature has no such floor, and Imperva injects _Incapsula_Resource script tags into ordinary served pages in the same way. Swept on 2026-08-22 with git grep -a --untracked: no committed fixture currently carries the marker in a real page, so this is a LATENT risk and not a live defect, which is why it is a row rather than an edit. Diagnose before fixing applies with force here — changing a challenge detector without evidence would risk the opposite failure, a real wall read as a page. What would settle it is a recorded fixture of a large Imperva-fronted page that is genuinely served, which www.nj.gov can supply. *(open)*
- **NJ04** — RULING 65's footer-address branch wired seven Sutton bodies on 2026-08-22, and three were deliberately left out because each has better evidence about itself than the town's footer has about it. Ad Hoc Speed Sign Committee: its own feed titles read 'Ad Hoc Speed Sign Committee - Zoom Mtg', so it meets on Zoom and pinning it at 93 Main Street would send a reader to an empty building; the playbook already records that a Zoom URL in LOCATION is a fact and not a building, and this is the same rule read from a title. Warner River Local Advisory Committee: its titles read 'WRLAC Mtg @ Pillsbury Library', a venue this session could not resolve to a coordinate, and it is a multi-town river committee so Sutton's town hall is a poor guess; the work is to resolve Pillsbury Library. Sutton Free Library Board of Trustees: its page states its own meeting arrangement, so it is a STATES A VENUE case. Each has four future sittings, two, and an unknown respectively. *(open)*
- **NJ05** — suttonnh.gov/sitemap.xml answers HTTP 200 with a valid sitemap containing exactly one URL: https://d9template1.civiccms.acsitefactory.com/ — the vendor's Drupal 9 template host, not the town. Rung 10 of the retrieval ladder is sitemaps and search-index caches, and on this CMS family that rung returns the vendor and none of the body's own pages. A session walking rung 10 here would read a well-formed sitemap, find no board pages in it, and have no signal that anything was wrong. Recorded 2026-08-22. Worth checking across the CivicPlus D9 tenants this project already knows before it is treated as one town's misconfiguration; data/reference/civicplus_tenants.csv is the list. *(open)*

**Needs Sean.** NS01

## nh-hunt5

**What it started.** 7 row(s) opened, 7 still open.

- **NH43** — RULING 60's residual. NH Hunt 5 hand-worked every un-held unit at 03255 and holds 48 of 48. Three bodies inside those units were reached by nothing, and each is listed below with every branch already walked and what each returned. The ruling asks you to hunt one or two yourself and return the process, which then gets built as a branch the same way the six in zip-playbook.md section 8 were. *(open)*
- **NH44** — A structural decision that belongs to you rather than to a hunt. The committed TIGER geometry is clipped to one county per state - public/geo/*.geojson says clippedTo 04019/34027/33013 on its own face - and 03255's first-rung circle crosses three counties. Six New Hampshire towns inside that circle are now in the registry with their boards and have NO POLYGON, so the map cannot draw them. *(open)*
- **NH45** — data/ballot/candidate-hunt-state.json holds 136 candidate keys in TWO formats for the same people: a slug form, ballot-az-pima:governor:hobbs-katie, and a pipe-and-display-name form, ballot-az-pima:governor|Katie Hobbs. Thirty of the 136 are the pipe form and every one names somebody the slug form already names. candidate-cards-2026.json carries 20 of the same duplicates. *(open)*
- **NH46** — One of the three coverageNotes in data/ballot/nh-merrimack-2026.json ends with a paragraph of internal record-keeping that reaches a reader on the ballot page: 'CORRECTED 2026-08-21 under RULING 52: this note used to end ... That was true when it was written on 2026-08-14 and is FALSE now - re-walked 2026-08-21, gc.nh.gov answers a plain rung-2 fetch at HTTP 200. A wall is recorded with the date it was last tested...' *(open)*
- **NH47** — pnpm test reported 1561 passing, 0 failing, while EIGHT guard tests had stopped running entirely. A deleted test and a passing test are indistinguishable in that output; the only instrument that can see the difference is the COUNT, and nothing checks it. *(open)*
- **NH48** — pnpm venue:hunt read 157 body pages on 2026-08-21. Three state where the body meets; 137 were read and state nothing; 17 could not be read. That 137 is a dated measurement about 137 specific pages and it is the next hunt's starting point. *(open)*
- **NH49** — pnpm hunt:gaps reports 182 owed of 368 possible across 30 contests and 92 candidates, down from 184 at NH Hunt 4's close. Per class: Photo 45, In their own words 41, Contact 60, Campaign site 36. *(open)*

**Needs Sean.** NH43, NH44

## job-watch

**What it started.** 1 row(s) opened, 1 still open.

- **JOB01** — The scheduled job refresh-meetings-snapshot.yml failed on two CONSECUTIVE runs (32543652154 and 32543393133), both at: A source failed for a JOB reason — this run is red, and has since gone green on its own. It is not broken right now. Nobody found out why it broke, so the next occurrence starts from the same nothing — which is why this is a row rather than a shrug. This watcher runs once a day and used to read only the two most recent runs, so a double failure that healed in between was invisible to it (NJ Hunt 3 item 1c). Over its last 40 completed runs it has failed 17 time(s). Two consecutive failures is evidence the cause is ours rather than a host refusing on a schedule — a wall would not usually repeat exactly. RULING 56 opens this automatically so a degrading data path is not a page nobody watches. [job-watch:refresh-meetings-snapshot.yml] *(open)*

**Needs Sean.** JOB01

## NHHUNT3

**What it started.** 4 row(s) opened, 4 still open.

- **NH26** — RULING 55 says every photo is reviewed by you and only an approved photo renders. Gating on an empty store would have blanked every portrait in the product the moment the rule shipped, so the 48 photos already shipping were recorded APPROVED with decidedBy grandfathered - which means SHIPPING BEFORE THE RULE EXISTED, NOT APPROVED BY YOU. They are labelled that way in data/photos/review.json and carry a decision date, so pnpm stale surfaces them on RULING 53 clock. What is owed is your eye on them. The 5 refusals are already recorded REJECTED with their reasons - the flag stock photo alt-texted Victor Orlando, the scanned 1978 Grand Jury manual served as a campaign og:image, the Karishma Manzur banner-with-wordmark, the photographer-credited Monkman file, and the Ayotte WinRed graphic from 2026-08-14. One row per session listing N photos, never one row per photo: 47 candidates plus 90 officials would otherwise flood this queue. *(open)*
- **NH27** — Springfield is one of Kearsarge seven member towns and had no bodies in this registry at all. Eight are now enumerated and recorded KNOWN_UNCOVERED. They are not wired because the town iCal export is capped at the OLDEST 50 events and stops at 2024-11-07 - six different views all return the identical stale document and the plugin REST API answers 404. The town has NOT stopped meeting: its own front page links events/cemetery-trustees-meeting-2026-08-11 and events/conservation-commission-meeting-2026-09-03 [expected-future: the town's own published meeting date, read 2026-08-21]. The live meetings are in the HTML, and no adapter here reads that shape for this town yet. Wiring to the stale feed would have shipped eight bodies rendering as having no meetings while the town publishes them. *(open)*
- **NH28** — Springfield was found by probing six conventional iCal paths against the town host - one request, and a town that had been dark since the registry was built produced eight named governing bodies. The same probe was run against Bradford, New London, Warner and Newbury; only Springfield and Newbury answered. Sutton at www.sutton-nh.gov does not resolve at all and needs its real host found. The remaining towns need the OTHER branches walked - vendor portals, board pages, minutes archives - rather than the conclusion that they publish nothing. Six of seven member towns were dark and this session moved one of them. *(open)*
- **NH29** — Springfield NH went from zero bodies in the registry to eight enumerated and the gap ledger is byte-identical at 22383 bytes before and after. The ledger measures special-district coverage against the Census of Governments, which is right and is not the whole of coverage: RULING 9 says the Census counts GOVERNMENTS and the product renders BODIES, and a New Hampshire town is one government and a dozen or more bodies. So the instrument that is supposed to say how covered a place is cannot see the unit the product actually renders. Six of Kearsarge seven member towns are dark at the body level and nothing measures that. This is a defect in the instrument rather than a gap in coverage, which is why it is a row and not a ledger entry. *(open)*

**Needs Sean.** NH26

## NHHUNT

**What it started.** 9 row(s) opened, 7 still open.

- **NH02** — Newbury's own site lists a Parks and Recreation Committee and a Housing Committee in its sitemap, and both pages ask for a password. They are real committees the town has not published. We never sign in to anything, so their membership and meetings have to come from somewhere else. *(open)*
- **NH03** — The town's own pages state terms ending 2021, 2022 and 2023 for its Cemetery Trustees, and March 2021 for one Planning Board alternate. Those are the town's current published words and they are up to five years out of date. We render them as published, which is honest, and a reader may still be looking at people who left. *(open)*
- **NH04** — We now hold all three county commissioners, the delegation's officers and every department head by name. What the county publishes for reaching any of them is one main number. The Kelly standard asks for a working contact per person and the county does not print one. *(open)*
- **NH05** — Ten Newbury boards now read their meetings off the town's own calendar, and the town has not posted a single upcoming date for any of them. Seventy-eight of their past sittings are on that calendar, so they do meet. A reader who wants to attend one cannot find out when from anything the town publishes. *(open)*
- **NH06** — Newbury's Selectboard and its three land-use boards are now read from two places at once: the vendor portals that carry agendas, and the town calendar that carries more dates. A merge decides which row a reader sees. That works, and nobody has measured whether it is the right arrangement over a few refreshes. *(open)*
- **NH07** — Merrimack County's department pages all load cleanly and all of them list their staff in a table our reader cannot understand. It is a different table shape from the one we built for. Nobody has looked at how many other counties use it. *(open)*
- **NH08** — The Town of Newbury publishes its whole calendar as a feed nobody had wired, and it has more meeting dates on it than the portals we were using. Both now ship, and when they both carry the same meeting the site shows the one with the agenda attached. That is a change to what you see at 03255 and it is worth a look. *(open)*

**Needs Sean.** NH08

## NH-Hunt-6

**What it started.** 6 row(s) opened, 6 still open.

- **NH50** — Sutton's own boards-and-committees index lists sixteen governing bodies and the registry holds two of them. RULING 57 names a body first and hunts it second, so the fifteen missing ones are entered with what is known — the name, the host municipality, and the page that named them — whether or not a meeting source exists. The index is at suttonnh.gov/boards-committees and is reachable at rung 5 (rungs 2, 3 and 4 hit a Cloudflare managed challenge). NH Hunt 6 wired the Planning Board only, because its page is the only one that states a venue. *(open)*
- **NH51** — Fifteen of Sutton's sixteen bodies have no published venue this session could find. Their pages carry '93 Main Street | Sutton Mills' in the SITE FOOTER only — the town's postal address on a template, not a statement about where that board sits — and reading a footer as a venue would pin fifteen bodies on the strength of a page layout. What is owed is the posted NOTICE per body, which carries the room by construction, or a minutes header that states it. *(open)*
- **NH52** — facebook.com renders 977,803 and 928,697 bytes and ZERO characters of readable text to our headless browser, on two campaign and committee pages read 2026-08-21. campaign-social is the highest-yield branch-manifest route for the smallest races — the rule that a campaign living on Facebook still has a campaign site exists to protect exactly the candidates least able to buy a domain. The route is WALLED today, with its date, and RULING 53 puts it back on the queue in fourteen days. *(open)*
- **NH53** — The walker covers 7 of the 36 manifest routes mechanically. Per field that leaves 4 of 7 photo routes, 8 of 10 blurb, 29 of 35 contact, 10 of 14 campaign site and 6 of 8 verified page needing a person — reported by name on every run, never counted as walked. Each route automated is a whole class of candidate the manifest can be exhausted against without a session reading pages one at a time. *(open)*
- **NH54** — A statewide New Hampshire candidate-and-results database exists at electiondatabase.nhpr.org and nh.electionstats.com. Every /candidates/view/<Name> URL from the search index returns the SPA's 404 shell — 41,148 bytes, identical for a known-good name — and rung 6 confirms a genuine 'Page Not Found'. The path has moved. It would serve many candidates at once if found: prior candidacies, districts, and results. *(open)*
- **NH55** — Steven Endres is an Assistant Merrimack County Attorney and a candidate for County Attorney. The only working contact any manifest route reached for him is his office of record — Four Court Street, Concord, (603) 228-0529 — published on courts.nh.gov in his own filed comment and on the county's own department page. Meg Hagaman's card already carries the same number, because she is an attorney in the same office. Two candidates in one race now show one phone. That is a true fact about the office rather than a join collapsing, and it is shipped; but whether a reader is well served by a switchboard that reaches a candidate's EMPLOYER is a judgement about the product, not about the data. *(open)*

**Needs Sean.** NH55

## NH Hunt 4

**What it started.** 13 row(s) opened, 13 still open.

- **NH30** — RULING 55 says only a photo you have approved renders. Three were hunted on 2026-08-21 and are PENDING: Meg Hagaman (Merrimack County Attorney, door 3), Jon Raiche (Merrimack County Attorney, door 3) and Vincent S. Ribas (Merrimack County Commissioner D2, door 2). Each one was read as an image before it shipped and each is a clean solo portrait; the cards render initials until you say yes. Nothing else about any of the three is affected. *(open)*
- **NH31** — The refresh commits only if every source succeeded. One source producing zero rows from a non-zero fetch fails the run, so the snapshot does not move - even when carry-forward already saved that source's rows and every other source was fine. Today that is 14 failures of 37 runs. At national volume it means the snapshot never commits again, and the decision to make the gate per-source rather than per-run is yours. *(open)*
- **NH32** — The intake tripwire raised an alarm on 2026-08-21 at 00:28 UTC: a search_log insert was refused in production. The alarm is doing exactly what it was built for. The problem is that its output prints five dashes where the database's reason should be, so the one thing needed to diagnose it is the one thing not recorded. Production schema is in sync at 0015, so a missing column is ruled out. *(open)*
- **NH33** — Lake Todd Village District governs territory in Bradford AND Newbury. The New London-Springfield Water System Precinct serves New London AND Springfield. A body id here is <division>#<slot>, so each of them ships as two rows carrying the same name. They are one body wearing two ids, not two districts, and every count that walks the registry counts them twice. *(open)*
- **NH34** — Sutton has 18 governing bodies, all named in the registry and all shipping KNOWN_UNCOVERED. Its CivicPlus calendar exports 1,312 events - 47 of them upcoming - and every single one has an empty LOCATION field. Nothing this session reached states a meeting venue for any Sutton body, so wiring them would have produced 18 bodies whose every sitting drops. *(open)*
- **NH35** — Warner's own boards index names 26 governing bodies. Its calendar files sittings for 16 of them. The other ten are named in the registry and ship KNOWN_UNCOVERED: the Cemetery Trustees, the Community Power Committee, the Corridor Committee, the Economic Development Advisory Committee, the Groundwater Protection Committee, the Highway Safety Committee, the Housing Advisory Committee, the Joint Loss Management Committee, the Mink Hills Recreation Committee and the Record Preservation Committee. *(open)*
- **NH36** — Wilmot's Master Plan Committee, its Safety Services Facility Committee and its Transfer Station Advisory Group all meet, and the town files their meetings under CATEGORIES:Planning Board and CATEGORIES:Select Board. A category-driven read cannot separate them and a title-driven row over the same feed would claim events that already belong to another body. All three are named and KNOWN_UNCOVERED. *(open)*
- **NH37** — Every Arizona officeholder's stored page URL carries a legislature number, and 67 of the 90 carry one that is not the current session: 5 at legislature 54, 23 at 55 and 39 at 56. Two of them surfaced as MISS-GENERIC in the officials audit - Rachel Keshel and Rosanna Gabaldon - and the rest are latent, waiting for their seat to be wired to a district. *(open)*
- **NH38** — Six of the 40 New Jersey senators carry a websiteUrl on assemblydems.com or njassemblygop.com - a party caucus page for the Assembly, for people who now sit in the Senate. Two of them, John McKeon and Parker Space, answer HTTP 404 and surfaced in the officials audit as MISS-404. *(open)*
- **NH39** — James Gallagher, a U.S. Representative sworn in on 2026-06-10, has no websiteUrl at all - the congress-legislators dataset this registry reads has not yet published his House page. Kate Murray is the one New Hampshire officeholder pnpm nh:fix-pages could not repair, because she is not on the General Court's current roster; a former member's page is the archive's hunt. *(open)*
- **NH40** — cfs.sos.nh.gov holds first-party contact details for every New Hampshire candidate who registered a committee, and it refuses rungs 2, 3, 4 and 6 with an Akamai 403 - headless Chromium, a real Chrome channel and a masked user agent alike. A visible browser on the same machine and the same IP gets HTTP 200. It was harvested by hand this session through the app's own XHR at rung 7, which is a procedure and not a script, so nothing in CI can repeat it. *(open)*
- **NH41** — The Lake Todd Village District's own site, which the Census of Governments records as laketoddvillagedistrict.us, answers HTTP 404 at rungs 2, 3, 4, 5 and 6, and so does the Town of Bradford's news item for its meeting. The Internet Archive - rung 11, and the rung that produced this district's own words for an earlier session - answered 'Temporarily Offline' on 2026-08-21. *(open)*
- …and 1 more still open.

**Needs Sean.** NH30, NH31, NH32, NH33
