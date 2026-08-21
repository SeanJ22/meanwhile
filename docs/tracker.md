# The tracker — what is left

**GENERATED FILE — do not hand-edit.** Written by `corepack pnpm tracker:views`
(`scripts/tracker.mjs`) from `docs/tracker-working.csv`. It cannot disagree with the
store, because it is derived from it.

Generated 2026-08-21 (America/Phoenix, from `pnpm stamp`).

Open rows only. Finished work is in `docs/tracker-resolved.csv` and on the
**Resolved** tab of `docs/tracker.xlsx`, which is the record of what was decided
and when. Nothing is ever deleted.

---

## Where the project stands

- **170 open**, 323 resolved.
- **45 waiting on Sean** — the first section below.
- P1 by section:
  - Needs Sean — **3**
  - New Hampshire hunt — **2**
  - New Jersey hunt — **0**
  - Arizona hunt — **0**
  - Visual feedback — **1**
  - Data infrastructure — **0**
  - Product / UI — **1**
  - Constitution & rules — **1**
  - Repo & ops — **0**

No section is over the five-P1 cap.

---

## Needs Sean

Anything only Sean can unblock: an API key, a legal review, a business decision, a visual judgment, and specifically go look at the site and confirm this is right.

**45 open · 11 resolved.**

Only Sean closes a row here. A session may open one and may work it.

### P1

**B05** — Two lawyers, probably: one on privacy and one on election law. Both have long lead times and several other rows are waiting on them.

  Pending review.

**NH31** — The refresh commits only if every source succeeded. One source producing zero rows from a non-zero fetch fails the run, so the snapshot does not move - even when carry-forward already saved that source's rows and every other source was fine. Today that is 14 failures of 37 runs. At national volume it means the snapshot never commits again, and the decision to make the gate per-source rather than per-run is yours.

**T05** — The abuse policy is written but the review path behind it does not exist. No free-text answer can be accepted until somebody can actually act on a threat.

  Waiting on reaction capture (P03).

  Pending review.

### P2

**B01** — The product is called Meanwhile on screen while the real name is decided. Nothing a reader sees changes until Sean settles it; when he does, one file changes and the whole site follows.

**NH12** — The New Hampshire Secretary of State publishes a mailing address for every candidate on the ballot, and for most of them it is where they live. It is a public record, the state prints it, and it is the only working contact we hold for about half of the forty-seven people on Newbury's ballot. I have recorded all forty-seven in the hunt notes and rendered none of them, because putting a named person's home street address on a consumer app is a different act from a state PDF and I did not want to make that call on my own.

**NH13** — The constitution records a wall that is not there. Two paragraphs - the source register in CLAUDE.md and the curator note in the New Hampshire ballot data - say gc.nh.gov 'refuses every client this project has, browsers included'. It answers a plain fetch at HTTP 200. Only you change CLAUDE.md, so this is a correction routed to you rather than made.

**NH26** — RULING 55 says every photo is reviewed by you and only an approved photo renders. Gating on an empty store would have blanked every portrait in the product the moment the rule shipped, so the 48 photos already shipping were recorded APPROVED with decidedBy grandfathered - which means SHIPPING BEFORE THE RULE EXISTED, NOT APPROVED BY YOU. They are labelled that way in data/photos/review.json and carry a decision date, so pnpm stale surfaces them on RULING 53 clock. What is owed is your eye on them. The 5 refusals are already recorded REJECTED with their reasons - the flag stock photo alt-texted Victor Orlando, the scanned 1978 Grand Jury manual served as a campaign og:image, the Karishma Manzur banner-with-wordmark, the photographer-credited Monkman file, and the Ayotte WinRed graphic from 2026-08-14. One row per session listing N photos, never one row per photo: 47 candidates plus 90 officials would otherwise flood this queue.

**NH30** — RULING 55 says only a photo you have approved renders. Three were hunted on 2026-08-21 and are PENDING: Meg Hagaman (Merrimack County Attorney, door 3), Jon Raiche (Merrimack County Attorney, door 3) and Vincent S. Ribas (Merrimack County Commissioner D2, door 2). Each one was read as an image before it shipped and each is a clean solo portrait; the cards render initials until you say yes. Nothing else about any of the three is affected.

**NH32** — The intake tripwire raised an alarm on 2026-08-21 at 00:28 UTC: a search_log insert was refused in production. The alarm is doing exactly what it was built for. The problem is that its output prints five dashes where the database's reason should be, so the one thing needed to diagnose it is the one thing not recorded. Production schema is in sync at 0015, so a missing column is ruled out.

**R33** — Sean's map of the project's sessions lived outside the repo, so nothing could read it. It is now committed, and the row stays open until he confirms the copy in the repo is the one he wants used.

**R55** — The document Sean's session prompts are generated from lived outside the repo. It is now committed, and this stays open until he confirms the committed copy is the one to use.

**R57** — Portraits and PDF archives are too big for git, so they live in a content-addressed store. Where that store actually lives — so a deploy can restore from it — is Sean's call.

**T01** — The page that says, in plain words, what the product collects, how it is used, and that anonymous totals may be sold. Written before any marketing page, because the marketing has to be true.

**T10** — Sean told the tester that everything collected during the demo gets deleted when testing ends. This builds the deletion so it happens whether or not anybody remembers to do it.

**B03** — What legal entity this becomes. An LLC now and a public benefit corporation after the buyer calls, rather than a plain C-corp.

  Waiting on five buyer calls (V01).

**B04** — Registering as a data broker in California, Vermont, Texas and Oregon. Annual deadlines with per-day penalties for missing them.

  Waiting on entity decision (B03).

**B09** — The question to put to counsel: can a software vendor's terms of use narrow the public's statutory right to records a government body is required to publish? The product's whole retrieval posture rests on the answer being no.

  Waiting on find counsel (B05).

**D23** — Federal law restricts commercial use of individual donor names and addresses. This row records exactly what the restriction covers before any code ships that touches it, so the line is drawn on paper first.

  Waiting on find counsel (B05).

**T03** — A security review before a single real person's political opinions are stored. A breach ends the product.

  Waiting on reaction capture (P03).

**T04** — Decide, and publish, whether this data is ever sold exclusively to one buyer. The neutrality claim does not survive a yes, so the answer shapes the business.

  Waiting on five buyer calls (V01).

### P3

**C01** — A sample of what a buyer actually receives: one Pima County measure broken into its provisions, with support per provision and counts by how well each answer was verified. Synthetic numbers, clearly labelled, built to show rather than to sell.

**NH08** — The Town of Newbury publishes its whole calendar as a feed nobody had wired, and it has more meeting dates on it than the portals we were using. Both now ship, and when they both carry the same meeting the site shows the one with the agenda attached. That is a change to what you see at 03255 and it is worth a look.

**NH10** — Tobin Menard is running for Executive Council in District 2, which covers Newbury. His campaign site publishes exactly one picture of him: a clean studio portrait with the words 'Accountability Responsibility' printed across it in red. The photo rule says a portrait, never a wordmark, and this is a portrait carrying one. I refused it, which means he shows initials on the ballot page while the sitting councillor beside him shows her face - and that is the visual asymmetry the equal-effort rule exists to stop. It is a call about how a real person looks on a reader's screen, so it is yours.

**NH11** — Shaun Fife is running for Governor. He has no campaign website and no campaign Facebook page. What he has is a candidate page on a political party's own site, carrying his name, the office, his own words and a contact address. Two of our rules point in opposite directions about it and the third makes it worse, so it is yours to settle.

**NH33** — Lake Todd Village District governs territory in Bradford AND Newbury. The New London-Springfield Water System Precinct serves New London AND Springfield. A body id here is <division>#<slot>, so each of them ships as two rows carrying the same name. They are one body wearing two ids, not two districts, and every count that walks the registry counts them twice.

**R56** — The old status page put 54% of the tracker in a section called "everything with no recorded prerequisite", which is not a place. Superseded by the rebuild this session, and it stays open until Sean says the new sections are right.

**V01** — Five conversations with the people who would buy the data — campaign consultants, party data staff, PAC data directors, at least one on each side. The question to put to them is exclusivity.

**V03** — Build a throwaway prototype against three to five cities' agenda systems and find out whether the local-meetings thesis holds. If those systems are locked down or wildly inconsistent, the product changes shape.

**V04** — Take one real Pima County down-ballot race and build the full side-by-side of sourced positions and the reader's own priorities. The test of whether the sourcing actually holds up end to end.

**V05** — A short, sharp answer to the buyer who asks why this beats a thirty-thousand-dollar tracking poll. Needed before the first meeting, not after it.

**V06** — Read the plain-language output back to real people with real questions and find out whether it is actually plain. Synthetic test questions cannot tell you that.

**V07** — A schools and civics-education version of the product, suggested by the tester. A business question rather than product work, parked for Sean.

**B02** — A trademark search in the three classes this product would file under. Cannot usefully happen until the name is settled.

  Waiting on settle the name (B01).

**B07** — How to price this. Selling to a campaign below fair market value can count as an in-kind political contribution, so the prices have to be real and documented, pilots included.

  Waiting on five buyer calls (V01).

**C02** — The commercial front end: buyers log in and see signal by district, race, measure and provision, over time, with the ability to filter, drill down and export.

  Waiting on signal aggregation (P04).

**C03** — The actual file or API a buyer receives — its schema, the confidence-mix figures on every row, how much was excluded by moderation, and the snapshot id that makes it citable.

  Waiting on signal aggregation (P04).

**C04** — Publish what the signal predicted before each election and how it actually turned out. A public scoreboard, including the misses.

  Waiting on signal aggregation (P04).

**D70** — Work out which public bodies sit on which agenda platform, so the meetings layer can reach past the four pilot zips. Three platforms, three different methods, and it needs Sean's ruling on the approach first.

  Waiting on body enumeration per unit - the missing second layer of the who-governs denominator (HUNT02).

**PB10** — Reading individual donors out of the federal campaign-finance data, rather than only committee totals. Held until an election lawyer rules on the commercial-use restriction that attaches to donor names and addresses.

  Waiting on fec contributor information - commercial-use restriction (D23).

**T02** — Proving a real person is answering without learning who they are — device attestation, a phone check that rejects burner numbers, an address that exists. Weighted rather than gated, so nobody is turned away.

  Waiting on reaction capture (P03).

**T06** — Grade a hundred real answers by hand against the verification tiers before any automatic classifier touches them. The hand pass is what tells you whether the tiers mean anything.

  Waiting on abuse policy live (T05).

**T07** — The abuse policy points at a file of escalation contacts that does not exist — local police, the state agency per state, the Capitol Police threat unit. A policy pointing at nothing cannot be followed.

  Waiting on abuse policy live (T05).

**V08** — A page for candidates rather than readers, showing what the product holds on them next to what it holds on their opponents. Sean's idea: the fastest way to fill a thin card is to let the person fill it.

  Waiting on the blurb-equalization hunt - a sourced one-line description for every ballot candidate (B14).

**X02** — Five content creators on Instagram. The cheapest distribution channel available to a product nobody has heard of.

**X03** — A podcast pitch, shorter and more specific than feels comfortable.

## New Hampshire hunt

Everything owed to a reader in New Hampshire — Newbury and 03255 first. Bodies, officeholders, candidates, meetings, the ballot.

**23 open · 3 resolved.**

### P1

**HUNT01** — Walk every single governing body around Newbury, New Hampshire to full depth — who sits on it, when it meets, where its records are. The first place the product tries to answer completely.

**HUNT04** — The 47 people who filed to run around Newbury, New Hampshire. None has been researched. Every one of them is a card a reader will meet.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

### P2

**NH02** — Newbury's own site lists a Parks and Recreation Committee and a Housing Committee in its sitemap, and both pages ask for a password. They are real committees the town has not published. We never sign in to anything, so their membership and meetings have to come from somewhere else.

**NH04** — We now hold all three county commissioners, the delegation's officers and every department head by name. What the county publishes for reaching any of them is one main number. The Kelly standard asks for a working contact per person and the county does not print one.

**NH05** — Ten Newbury boards now read their meetings off the town's own calendar, and the town has not posted a single upcoming date for any of them. Seventy-eight of their past sittings are on that calendar, so they do meet. A reader who wants to attend one cannot find out when from anything the town publishes.

**NH34** — Sutton has 18 governing bodies, all named in the registry and all shipping KNOWN_UNCOVERED. Its CivicPlus calendar exports 1,312 events - 47 of them upcoming - and every single one has an empty LOCATION field. Nothing this session reached states a meeting venue for any Sutton body, so wiring them would have produced 18 bodies whose every sitting drops.

**HD01** — Eleven people are running for United States Senator in New Hampshire and forty-one things about them have never been looked for — faces, their own words, a way to reach them, a website.

**HD02** — Six people are running for Congress in New Hampshire's second district and eighteen things about them have never been looked for.

**HD03** — Four people are running for Merrimack County Attorney and sixteen things about them have never been looked for.

**HD04** — Four people are running for Merrimack County Sheriff and sixteen things about them have never been looked for.

**HD05** — Three people are running for Merrimack County Commissioner in the second district and twelve things about them have never been looked for.

**HD09** — Three people are running for Governor of New Hampshire and nine things about them have never been looked for.

**HD10** — Two people are running for Merrimack County Treasurer and eight things about them have never been looked for.

**HD11** — Two people are running for New Hampshire Executive Councillor in the second district and eight things about them have never been looked for.

**HD12** — Two people are running for Merrimack County Register of Deeds and eight things about them have never been looked for.

**HD13** — Two people are running for state representative in Merrimack County's seventh district and eight things about them have never been looked for.

**HD19** — Two people are running for New Hampshire's seventh state senate district and five things about them have never been looked for.

**HD24** — One person is running for Merrimack County Register of Probate and four things about them have never been looked for.

**HUNT05** — Forty special districts that might or might not reach Newbury, New Hampshire. Nobody publishes their boundaries, so the answer has to come from somewhere other than a map.

  Waiting on body enumeration per unit - the missing second layer of the who-governs denominator (HUNT02).

### P3

**NH03** — The town's own pages state terms ending 2021, 2022 and 2023 for its Cemetery Trustees, and March 2021 for one Planning Board alternate. Those are the town's current published words and they are up to five years out of date. We render them as published, which is honest, and a reader may still be looking at people who left.

**NH35** — Warner's own boards index names 26 governing bodies. Its calendar files sittings for 16 of them. The other ten are named in the registry and ship KNOWN_UNCOVERED: the Cemetery Trustees, the Community Power Committee, the Corridor Committee, the Economic Development Advisory Committee, the Groundwater Protection Committee, the Highway Safety Committee, the Housing Advisory Committee, the Joint Loss Management Committee, the Mink Hills Recreation Committee and the Record Preservation Committee.

**NH36** — Wilmot's Master Plan Committee, its Safety Services Facility Committee and its Transfer Station Advisory Group all meet, and the town files their meetings under CATEGORIES:Planning Board and CATEGORIES:Select Board. A category-driven read cannot separate them and a title-driven row over the same feed would claim events that already belong to another body. All three are named and KNOWN_UNCOVERED.

**NH41** — The Lake Todd Village District's own site, which the Census of Governments records as laketoddvillagedistrict.us, answers HTTP 404 at rungs 2, 3, 4, 5 and 6, and so does the Town of Bradford's news item for its meeting. The Internet Archive - rung 11, and the rung that produced this district's own words for an earlier session - answered 'Temporarily Offline' on 2026-08-21.

## New Jersey hunt

Everything owed to a reader in New Jersey — Rockaway Township and 07866 first.

**7 open · 0 resolved.**

### P2

**NH38** — Six of the 40 New Jersey senators carry a websiteUrl on assemblydems.com or njassemblygop.com - a party caucus page for the Assembly, for people who now sit in the Senate. Two of them, John McKeon and Parker Space, answer HTTP 404 and surfaced in the officials audit as MISS-404.

**HD06** — Three people are running for the Rockaway Township Board of Education and twelve things about them have never been looked for.

**HD14** — Two people are running for the Morris Hills regional school board's Rockaway Township seats and eight things about them have never been looked for.

**HD17** — Three people are running for United States Senator in New Jersey and six things about them have never been looked for.

**HD20** — Two people are running for the Morris County Board of Commissioners and five things about them have never been looked for.

**HD21** — Two people are running for Congress in New Jersey's 11th district and five things about them have never been looked for.

**HD25** — One person is running for the Rockaway Township school board's unexpired term and four things about them have never been looked for.

## Arizona hunt

Everything owed to a reader in Arizona — Vail (85641) and downtown Tucson (85701) first.

**13 open · 0 resolved.**

### P2

**NH37** — Every Arizona officeholder's stored page URL carries a legislature number, and 67 of the 90 carry one that is not the current session: 5 at legislature 54, 23 at 55 and 39 at 56. Two of them surfaced as MISS-GENERIC in the officials audit - Rachel Keshel and Rosanna Gabaldon - and the rest are latent, waiting for their seat to be wired to a district.

**HD07** — Four people are running for Arizona's 19th state house district and ten things about them have never been looked for.

**HD08** — Four people are running for Congress in Arizona's sixth district and ten things about them have never been looked for.

**HD15** — Two people are running for Arizona State Mine Inspector and six things about them have never been looked for.

**HD16** — Three people are running for Arizona Secretary of State and six things about them have never been looked for.

**HD18** — Two people are running for Arizona's 19th state senate district and five things about them have never been looked for.

**HD22** — Three people are running for Governor of Arizona and four things about them have never been looked for.

**HD23** — Two people are running for Arizona's 20th state house district and four things about them have never been looked for.

**HD26** — Two people are running for Arizona State Treasurer and three things about them have never been looked for.

**HD27** — Two people are running for Congress in Arizona's seventh district and three things about them have never been looked for.

**HD28** — Two people are running for Arizona Attorney General and two things about them have never been looked for.

**HD29** — Two people are running for Arizona Superintendent of Public Instruction and two things about them have never been looked for.

**HD30** — One person is running for Arizona's 20th state senate district and one thing about them has never been looked for.

## Visual feedback

Everything arriving in Sean's twice-weekly batches — what the product looks like and reads like when he walks it.

**2 open · 34 resolved.**

### P1

**F01** — Sean's full walk of the product on 2026-08-18, forty-odd findings across cards, meeting order, votes, the ask box, the ballot and the map. The parent row that keeps the whole batch together; the individual findings became their own rows.

### P2

**M92** — Bodies and districts on the map still click straight out to a website. Sean and the tester both wanted a card that tells you about the thing first, with the website as one of the things on it.

## Data infrastructure

Sources, ingest, denominators, extraction, crawlers. The machinery that turns a public record into a row.

**57 open · 81 resolved.**

### P2

**D05** — Everything the product can say about a candidate from their own site, their own filings and their own voting record. Never an endorsement list — that is somebody else's judgement about them.

**D07** — Turning a street address into the exact set of districts a person votes in. Without it the product can orient a reader by zip but cannot promise them their own ballot.

**D08** — Pick the source that says which contests are on which ballot. The commercial-use terms are the first question to ask, because they decide whether the answer can ship.

**D36** — Twenty-seven candidates whose website and contact hunts were written down as never attempted. Each one finished is a candidate who stops being a name with nothing beside it.

**D50** — The second pass at candidate and official photographs, now that the author has opened the door for portraits a government body publishes about its own members. More faces on cards, each one carrying the door it came through.

**D52** — Turning each state's campaign-finance filing vocabulary into words a fifteen-year-old reads. Every state files differently, so this is a programme with one adapter per state rather than a single job.

**F02** — The product renders 186 congressional committee rows with no description of what any of them does. The text does not exist in the upstream file, so it has to come from somewhere else.

**F03** — Ten of the twelve bodies the product covers show an elected leader and no appointed one — no superintendent, no town manager, no county administrator. The person who actually runs the place is missing from the card.

**F11** — One family of school-district websites ships its page content as data hidden inside the HTML, and the product's reader comes back empty without saying so. Sized, deliberately not built yet, and named so the silence is not mistaken for an empty page.

**NH06** — Newbury's Selectboard and its three land-use boards are now read from two places at once: the vendor portals that carry agendas, and the town calendar that carries more dates. A merge decides which row a reader sees. That works, and nobody has measured whether it is the right arrangement over a few refreshes.

**NH27** — Springfield is one of Kearsarge seven member towns and had no bodies in this registry at all. Eight are now enumerated and recorded KNOWN_UNCOVERED. They are not wired because the town iCal export is capped at the OLDEST 50 events and stops at 2024-11-07 - six different views all return the identical stale document and the plugin REST API answers 404. The town has NOT stopped meeting: its own front page links events/cemetery-trustees-meeting-2026-08-11 and events/conservation-commission-meeting-2026-09-03 [expected-future: the town's own published meeting date, read 2026-08-21]. The live meetings are in the HTML, and no adapter here reads that shape for this town yet. Wiring to the stale feed would have shipped eight bodies rendering as having no meetings while the town publishes them.

**NH28** — Springfield was found by probing six conventional iCal paths against the town host - one request, and a town that had been dark since the registry was built produced eight named governing bodies. The same probe was run against Bradford, New London, Warner and Newbury; only Springfield and Newbury answered. Sutton at www.sutton-nh.gov does not resolve at all and needs its real host found. The remaining towns need the OTHER branches walked - vendor portals, board pages, minutes archives - rather than the conclusion that they publish nothing. Six of seven member towns were dark and this session moved one of them.

**NH29** — Springfield NH went from zero bodies in the registry to eight enumerated and the gap ledger is byte-identical at 22383 bytes before and after. The ledger measures special-district coverage against the Census of Governments, which is right and is not the whole of coverage: RULING 9 says the Census counts GOVERNMENTS and the product renders BODIES, and a New Hampshire town is one government and a dozen or more bodies. So the instrument that is supposed to say how covered a place is cannot see the unit the product actually renders. Six of Kearsarge seven member towns are dark at the body level and nothing measures that. This is a defect in the instrument rather than a gap in coverage, which is why it is a row and not a ledger entry.

**PB02** — Nobody publishes boundaries for special districts — fire, water, irrigation, library — so the product cannot tell a reader whether they live in one. They are 43.55% of every government in the country, and this is the largest single hole in the coverage promise.

**PB05** — School districts are matched between two federal files by name, because neither file carries a shared identifier. Roughly 4,000 do not match. The proper crosswalk exists and has to be acquired.

**PB08** — LegiScan already supplies bill text and votes. What is unread is the rest of a state legislator's record — who sponsored what, which committees they sit on, how long they have served — which is most of what a state card should say.

**PB09** — Congress.gov's own API, unread. The product already reads roll calls straight from the House and Senate clerks; this adds cosponsorships and committee membership, which is how a reader sees what a member works on rather than only how they voted.

**PD01** — Roughly four million people in Washington DC and the five territories are shown no federal representative at all, because their at-large district is missing from the registry. The six people are real, non-voting members of Congress, and their constituents currently see nothing.

**PD03** — When a reaction's location lookup fails, the row is written with an empty list of districts rather than a recorded failure — so a lookup that broke is indistinguishable from a place with no districts.

**B14** — Every candidate on every ballot gets a one-line description of themselves, taken from their own words and cited. The hunt is run just as hard for everybody in a race, which is what stops the cards tracking who could afford a website.

**D03** — State legislators' voting records, all fifty states, from Plural Open. Today a state legislator's card can say who they are but not how they voted.

**D06** — Where a candidate's money comes from — top sources, how concentrated it is, and how much came from inside the district they want to represent.

  Waiting on candidate info (D05).

**HUNT02** — Nobody publishes a list of the boards and commissions inside a government. The Census counts governments; readers need bodies. Until a government's boards are enumerated, there is no honest denominator for how much of it the product covers.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

**HUNT03** — Coverage records written before the product knew how to get past several kinds of wall. Each one re-walked is a public body that becomes visible after having been written off.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

**M123** — Six towns around Newbury hold meetings inside the radius a reader at 03255 sees. The routes to their calendars have been walked and written down; none of them is wired, so those meetings do not appear.

**PB03** — A reader for agenda data hidden inside a page's HTML rather than published at an address. Without it, whole families of school and municipal sites come back empty and look like places with no meetings.

  Waiting on body enumeration per unit - the missing second layer of the who-governs denominator (HUNT02).

**PB04** — The list of towns on the CivicPlus platform covers about 12% of its customers and most of it went stale in 2020. Every town missing from that list is a town whose meetings the product cannot find.

  Waiting on embedded-json extractor, sized against f01c2's blind spot (PB03).

### P3

**AUD05** — Meetings are found by scanning the whole snapshot rather than looking them up. It works at today's size and gets slower with every place added.

**AUD08** — Meetings are matched to a location without a spatial index. Same shape as the row above: correct now, and the wrong shape at scale.

**D25** — For every body the product watches: whether there is a public comment period, when it falls, how to sign up, where to send something in writing, and how long anybody gets to speak. The difference between knowing a meeting exists and being able to be heard at it.

**D46** — Showing who sponsored and funded each ballot measure. The tester argued both sides and Sean has not decided, so it is parked rather than half-built.

**D62** — A research corpus of everything all 535 members of Congress have said publicly since 2022. It would give a member's card its third leg — votes show what they do, money shows who funds them, this shows what they say.

**D69** — The Montana school-district disagreement, recorded as its own investigation. Named separately from the row above so the discrepancy has somewhere to be resolved rather than being carried as a caveat forever.

**NH07** — Merrimack County's department pages all load cleanly and all of them list their staff in a table our reader cannot understand. It is a different table shape from the one we built for. Nobody has looked at how many other counties use it.

**NH16** — Bradford, New Hampshire publishes every agenda and minute set on a vendor platform this product has never seen. Its own town website carries no boards index and no calendar, so the vendor is the only route to the town's meetings.

**NH17** — The consolidated miss list says newbury.nh.gov/sitemap.xml is a 403 and that robots declares none. It answers HTTP 200 at 43,484 bytes. A sitemap is the discovery rung for every page on a site, and this one has been closed to us on a stale reading.

**NH39** — James Gallagher, a U.S. Representative sworn in on 2026-06-10, has no websiteUrl at all - the congress-legislators dataset this registry reads has not yet published his House page. Kate Murray is the one New Hampshire officeholder pnpm nh:fix-pages could not repair, because she is not on the General Court's current roster; a former member's page is the archive's hunt.

**NH40** — cfs.sos.nh.gov holds first-party contact details for every New Hampshire candidate who registered a committee, and it refuses rungs 2, 3, 4 and 6 with an Akamai 403 - headless Chromium, a real Chrome channel and a masked user agent alike. A visible browser on the same machine and the same IP gets HTTP 200. It was harvested by hand this session through the app's own XHR at rung 7, which is a procedure and not a script, so nothing in CI can repeat it.

**NH42** — pnpm twig:pair reports 48 government units inside 03255's first-rung circle, 28 with a body in this registry and 20 without. Seven of the twenty are not missing a body so much as missing a DIVISION: Sullivan County itself, and the towns of Lempster, Croydon, Newport, Windsor, Acworth and Grantham are not in the shipped division list at all, so no body could be attached to them.

**P12** — Showing readers what other readers answered. Sean tabled this: it anchors the next respondent and corrupts the very data being sold. Recorded so nobody builds it by accident.

**PB01** — Two federal sources disagree about how many school districts Montana has — 387 against 311, with nothing to account for the gap. Until it reconciles, the product cannot state a district count for Montana or any national figure that includes it.

**PB06** — Two small, named holes in the national map: 35 government boundaries that landed in no zip at all, and 1,599 real postal zips that have no mapped area, so no place can be resolved for them.

**PB11** — The Census Bureau's own data service is unused. The product reads Census boundary files offline, which give shape but no people — no population, no income, nothing about who lives in a place.

**PB12** — Lobbying disclosure data. The repo fetches none of it — not partially, not at all — and this row says so plainly rather than leaving a half-built impression.

**SRC01** — A Census Bureau API key sits unused. The product reads Census bulk files instead, so the key buys nothing until something wants live population or income figures.

**SRC03** — A data.gov umbrella key sits unused, and an earlier session reported it did not exist. It does — it is in the environment file — and this row corrects the record.

**SRC04** — The government publishing office's API, sized and deliberately not built. The row records the decision so a later session does not re-open the question from scratch.

**V13** — A municipal agenda vendor nobody here had met, found while walking Bradford, New Hampshire. Wiring it reaches meetings that are currently invisible in several New Hampshire towns.

**D04** — How your own city council voted. It sits in unstructured minutes nobody has parsed, which is exactly why it is worth doing and why nobody else has.

**D51** — Money spent about a race by groups that gave the campaign nothing. It reads completely differently from a contribution and has to render differently, or a reader will read it as the candidate's own money.

**HUNT06** — Re-running each new capability against the place it was built for, so its cost is measured in steady state rather than mixed in with the cost of inventing it.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

**M95** — The three state governors' cards carry no term end and no date of birth, so those lines correctly say nothing. Federal members already have them.

**SRC02** — A lobbying-disclosure API key sits unused. The credential half of the row that says the product fetches no lobbying data at all.

  Waiting on lda lobbying disclosure - currently fetching nothing (PB12).

**V09** — Accela, one of four permit and zoning platforms Sean approved in principle. These are the records that answer "is there a data center coming?" before it is built.

  Waiting on "is there a data center coming?" (A03).

**V10** — Tyler EnerGov, the second of the four permit and zoning platforms. Approved in principle; needs its own clearance.

  Waiting on "is there a data center coming?" (A03).

**V11** — OpenGov Permitting & Licensing, the third of the four permit and zoning platforms. Approved in principle; needs its own clearance.

  Waiting on "is there a data center coming?" (A03).

**V12** — CityView, the fourth of the four permit and zoning platforms. Approved in principle; needs its own clearance.

  Waiting on "is there a data center coming?" (A03).

## Product / UI

How the app behaves and reads — surfaces, flows, wording, features. Distinct from how it looks in a feedback batch.

**15 open · 131 resolved.**

### P1

**P02** — Mapping candidates' stated positions onto the issues on a reader's ballot, every one carrying its source. Never a score, never a ranking — the positions side by side and the reader deciding.

  Waiting on candidate info (D05).

### P2

**M75** — On a phone, the map's legend crosses the bottom of an open meeting panel and covers the text underneath it.

**P03** — The one-tap yes or no, with an optional free-text answer, asked after the explanation and attached to a specific provision or a specific sourced position. This is the revenue path.

### P3

**AUD09** — The animation that flies the map to a state has no agreed speed budget, so nothing can tell whether a change made it slower.

**B18** — Sean asked for federal officials' town halls. There is no authoritative feed for them anywhere, so this row records what was checked and what it found rather than pretending a build is waiting.

**M13** — The radius control broke twice — once blanking results, once refusing to switch off — and both times the tests only covered the logic underneath, not the control a reader touches.

**A03** — Answering "is there a data center coming?" by searching pending zoning, permits and agenda items near an address. The same machinery answers warehouses, rezonings and road projects.

**M18** — A city and county that merged into one government still render as two bodies with two councils. A reader sees their single local government twice.

**P04** — Turning individual answers into a number a buyer can trust: weighting by how much the person actually read, freezing each snapshot so it can never be quietly amended, and reporting on every export how well each answer was verified.

  Waiting on reaction capture (P03).

**P05** — Tell a reader when an official they follow votes on something.

**P06** — One tap to send a letter when a representative votes against a position the reader cared about. Public contact details only — delivery, not lobbying.

  Waiting on vote notifications (P05).

**P07** — Tell a reader what happened at the hearing they could not attend: passed, failed, or held over.

**P08** — After a decision, tell the reader how long they have to appeal it and how.

  Waiting on outcome notifications (P07).

**P09** — A different product for people deciding where to live: pending development, zoning and state-by-state requirements near an address they are considering. A real market, and not this one.

  Waiting on "is there a data center coming?" (A03).

**P10** — Build the product for a second metro so the demo is not only Tucson.

## Constitution & rules

CLAUDE.md, docs/rulings.md, and the guard tests that enforce them. The amendment history — every rule added or changed, when, and which session changed it — is generated into docs/amendment-history.md by corepack pnpm rules:history, because it is derived from the commits rather than composed from memory.

**3 open · 7 resolved.**

### P1

**D68** — A script rewrote a verified data file with less data than it found and exited cleanly. Caught and reverted the same day. The row exists because the shape recurs, and a script that can lose data must be asked what it wrote.

### P2

**R13** — A standing rule rather than a task: the zip playbook only ever gains entries, never loses them, and every depth run ends by stating what it added or that it added nothing. It rides every future session.

**X07** — In small races a campaign's entire public presence is a Facebook page. Recording that as no site found hides something real and penalizes exactly the candidates who could not afford a domain.

## Repo & ops

CI, tests, workflows, storage, the machinery the project runs on.

**5 open · 56 resolved.**

### P2

**PB07** — Four of the five scheduled jobs run the full test suite before they push. The fifth does not, so a broken document can reach the repository unchallenged.

### P3

**PD02** — The local development database is eight migrations behind production, so nothing can be tried locally against the real schema.

**PD05** — The production walk creates rows under two different run labels and then counts only one of them, so it under-reports how many rows it wrote.

**PE02** — The short summary file generated at the end of every session still reads the frozen pre-rebuild tracker, so it reports a priority count on a scale that no longer exists. Nothing a reader sees is affected; the next session opens on a number that means nothing.

**R54** — A standing mechanism rather than a job: every portrait Sean needs to eyeball collects into one list he can work through, regenerated rather than hand-kept.

  Waiting on photos round 2 - door 2 opens and the chamber tier ships (item 6b) (D50).

---

Every row also carries who opened it, the technical detail, and the full session
record. Those are in the spreadsheet and are left out here on purpose: this file
answers what is left, and the spreadsheet answers everything else.
