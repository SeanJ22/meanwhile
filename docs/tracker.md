# The tracker — what is left

**GENERATED FILE — do not hand-edit.** Written by `corepack pnpm tracker:views`
(`scripts/tracker.mjs`) from `docs/tracker-working.csv`. It cannot disagree with the
store, because it is derived from it.

Generated 2026-08-22 (America/Phoenix, from `pnpm stamp`).

Open rows only. Finished work is in `docs/tracker-resolved.csv` and on the
**Resolved** tab of `docs/tracker.xlsx`, which is the record of what was decided
and when. Nothing is ever deleted.

---

## Where the project stands

- **216 open**, 339 resolved.
- **50 waiting on Sean** — the first section below.
- P1 by section:
  - Needs Sean — **3**
  - New Hampshire hunt — **2**
  - New Jersey hunt — **0**
  - Arizona hunt — **0**
  - Visual feedback — **1**
  - Data infrastructure — **1**
  - Product / UI — **1**
  - Constitution & rules — **1**
  - Repo & ops — **0**

No section is over the five-P1 cap.

---

## Needs Sean

Anything only Sean can unblock: an API key, a legal review, a business decision, a visual judgment, and specifically go look at the site and confirm this is right.

**50 open · 20 resolved.**

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

**NH26** — RULING 55 says every photo is reviewed by you and only an approved photo renders. Gating on an empty store would have blanked every portrait in the product the moment the rule shipped, so the 48 photos already shipping were recorded APPROVED with decidedBy grandfathered - which means SHIPPING BEFORE THE RULE EXISTED, NOT APPROVED BY YOU. They are labelled that way in data/photos/review.json and carry a decision date, so pnpm stale surfaces them on RULING 53 clock. What is owed is your eye on them. The 5 refusals are already recorded REJECTED with their reasons - the flag stock photo alt-texted Victor Orlando, the scanned 1978 Grand Jury manual served as a campaign og:image, the Karishma Manzur banner-with-wordmark, the photographer-credited Monkman file, and the Ayotte WinRed graphic from 2026-08-14. One row per session listing N photos, never one row per photo: 47 candidates plus 90 officials would otherwise flood this queue.

**NH30** — RULING 55 says only a photo you have approved renders. Three were hunted on 2026-08-21 and are PENDING: Meg Hagaman (Merrimack County Attorney, door 3), Jon Raiche (Merrimack County Attorney, door 3) and Vincent S. Ribas (Merrimack County Commissioner D2, door 2). Each one was read as an image before it shipped and each is a clean solo portrait; the cards render initials until you say yes. Nothing else about any of the three is affected.

**NH32** — The intake tripwire raised an alarm on 2026-08-21 at 00:28 UTC: a search_log insert was refused in production. The alarm is doing exactly what it was built for. The problem is that its output prints five dashes where the database's reason should be, so the one thing needed to diagnose it is the one thing not recorded. Production schema is in sync at 0015, so a missing column is ruled out.

**NH43** — RULING 60's residual. NH Hunt 5 hand-worked every un-held unit at 03255 and holds 48 of 48. Three bodies inside those units were reached by nothing, and each is listed below with every branch already walked and what each returned. The ruling asks you to hunt one or two yourself and return the process, which then gets built as a branch the same way the six in zip-playbook.md section 8 were.

**NH65** — RULING 55 says only a photo you have approved renders. Five were hunted on 2026-08-22 from Morris County municipalities' own websites and are PENDING, so those five cards show initials until you say yes. Every one is door 2 - the picture the government publishes to identify its own member - and every one was read as an image before it shipped, in one contact sheet at screenshots/nj-hunt4-portraits.png. Jennifer Rowland (Chatham Township Committee, chathamtownship.org, file named jen_rowland.jpg). Melissa Senatore (Jefferson Township Council, jeffersontownship.net). Sean Mabey (Kinnelon Borough Council, kinnelonboro.org, file named thumb.Mabey 400.jpg). Marilyn Althoff (Mendham Borough Council, mendhamnj.org, file named thumb.Althoff1.png). Melissa Muilenburg (Mountain Lakes Borough Council, mountainlakes.gov, file named Muilenburg-Photo-scaled.jpg).

**NS01** — The Meta Ad Library is the single best compliant route to a campaign that lives on Facebook, and it is the one route in the manifest that this project cannot walk at all. Political-ad disclosure is mandatory by law, so any candidate who buys a single ad appears there with the campaign's website, its paid-for-by disclaimer and often a contact. The API refuses every unauthenticated request (graph.facebook.com/ads_archive answers HTTP 500 OAuthException), and the public Ad Library web pages answer HTTP 403 with an anti-automation challenge. Measured 2026-08-22 for all sixteen Merrimack County candidates: ad-library REFUSED 16 of 16, and that refusal is recorded as a refusal rather than an absence, so no candidate field moved toward exhaustion on it. A token is issued against an identity-verified Meta developer account, which means it is tied to a real person and to that person's acceptance of Meta's platform terms. That is a standing commitment to a third party and a legal question wearing an API key, which CLAUDE.md lists as an ask-before. It is also the reason no session may make it: RULING 12 says a wall like Facebook's is named and not defeated, and authenticated access risks the account it runs under. This row exists so the decision is documented and yours, with counsel's read, rather than made quietly inside a session. NOTHING is blocked on it — the other three RULING 66 routes are built and walked, and the answer may simply be no.

**NS05** — Your NJ Hunt 5 brief adopted the free-source floor, the tiered manifest, the two-click test, per-state source enumeration and the Wikipedia route as RULINGS 81 through 85. Both of those numbers were already taken by NJ Hunt 4 earlier the same day, from your previous brief: RULING 81 is the exhausted Actions balance (it closed NS04) and RULING 82 is the job watcher's sampling (it closed JOB01), and both are cited by id in the resolved tracker store and inside docs/rulings.md itself. docs/rulings.md is append-only, so renumbering what already shipped would leave dangling references in the one record whose whole value is that it does not move. THE SESSION'S CALL: the five took 83 through 87 in your order, each carrying your number beside it, with a mapping table at the head of the block in both CLAUDE.md and docs/rulings.md. Nothing about the content changed. REVERSE IT IF YOU WANT YOUR NUMBERING TO WIN - the alternative is renumbering the two that shipped and accepting the dangling references, and that is your call rather than a session's. Separately: your RULING 90 was used exactly as you gave it, and 88 and 89 are recorded as deliberately unassigned rather than closed by renumbering you down.

**NS06** — The Census key has sat in .env.local since before this session and had never been called by anything in the repo - confirmed by sweeping the tree with git grep -a --untracked rather than by trusting docs/sources.md. Called for the first time on 2026-08-22 it returns HTTP 302 with X-DataWebAPI-KeyError: 1 and Location: api.census.gov/data/invalid_key.html. A call with no key at all returns the same 302 pointing at missing_key.html, so the API cannot be reached without a working credential. WHAT IT COSTS: the demographic layer behind a zip - population, median household income, median home value. It closes no Kelly field about a person, so nothing in the hunt is blocked; what is blocked is any zip surface that wants context about a place. WHAT IS NEEDED FROM YOU: request a replacement key at api.census.gov/data/key_signup.html and put it in .env.local. The route is in the manifest as census-acs-api with the wall recorded as a dated measurement on the CREDENTIAL, never as a property of the source.

**NS07** — The government graph crawl enumerates New Jersey's executive departments as governing bodies under RULING 57 - each with its own official site, and each holding public meetings and rulemaking hearings. The Department of Banking and Insurance sets rules on mortgages, insurance premiums and pawnbrokers, and those hearings are exactly the there-is-a-hearing-Tuesday surface this product exists for. THE QUESTION IS NARROW AND IT IS YOURS: their MEETINGS are plainly in scope and the session is wiring them. What is not settled is whether an APPOINTED cabinet secretary or department head renders to a reader as someone who governs them, the way an elected mayor or council member does. The who-governs card's verb is GOVERN, which is a stronger claim than is-responsible-for-this-area, and a session widening it would be making a product decision about what that word means. Nothing is blocked either way - the departments are enumerated and their meetings are hunted regardless of how you rule.

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

**NS08** — Arizona's entry in the FEC Combined Federal/State Directory names SIX offices, and one of them is the Navajo Nation Ethics and Rules Office - listed alongside the states as a jurisdiction that holds administrative hearings, ethics clearances, standards of conduct and investigations under the Navajo Ethics in Government Law. No municipality list, no county roster and no state register would have produced it. The Navajo Nation, the Tohono O'odham Nation and the Pascua Yaqui Tribe all hold territory in or adjacent to Pima County, which is where 85641 and 85701 are. RULING 57 says the twig is as relevant as the trunk, and a sovereign nation is not a twig - it is a trunk this product has never touched. This product has no vocabulary for a sovereign government that is neither federal nor state nor local, and a session inventing one would be making a decision about how this product describes a nation. Raised now, before the Arizona hunt, because the enumeration step under RULING 86 surfaced it and the hunt should not start without your answer. Recorded in docs/arizona-source-enumeration.md.

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

**30 open · 3 resolved.**

### P1

**HUNT01** — Walk every single governing body around Newbury, New Hampshire to full depth — who sits on it, when it meets, where its records are. The first place the product tries to answer completely.

**HUNT04** — The 47 people who filed to run around Newbury, New Hampshire. None has been researched. Every one of them is a card a reader will meet.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

### P2

**NH02** — Newbury's own site lists a Parks and Recreation Committee and a Housing Committee in its sitemap, and both pages ask for a password. They are real committees the town has not published. We never sign in to anything, so their membership and meetings have to come from somewhere else.

**NH04** — We now hold all three county commissioners, the delegation's officers and every department head by name. What the county publishes for reaching any of them is one main number. The Kelly standard asks for a working contact per person and the county does not print one.

**NH05** — Ten Newbury boards now read their meetings off the town's own calendar, and the town has not posted a single upcoming date for any of them. Seventy-eight of their past sittings are on that calendar, so they do meet. A reader who wants to attend one cannot find out when from anything the town publishes.

**NH34** — Sutton has 18 governing bodies, all named in the registry and all shipping KNOWN_UNCOVERED. Its CivicPlus calendar exports 1,312 events - 47 of them upcoming - and every single one has an empty LOCATION field. Nothing this session reached states a meeting venue for any Sutton body, so wiring them would have produced 18 bodies whose every sitting drops.

**NH48** — pnpm venue:hunt read 157 body pages on 2026-08-21. Three state where the body meets; 137 were read and state nothing; 17 could not be read. That 137 is a dated measurement about 137 specific pages and it is the next hunt's starting point.

**NH49** — pnpm hunt:gaps reports 182 owed of 368 possible across 30 contests and 92 candidates, down from 184 at NH Hunt 4's close. Per class: Photo 45, In their own words 41, Contact 60, Campaign site 36.

**NH50** — Sutton's own boards-and-committees index lists sixteen governing bodies and the registry holds two of them. RULING 57 names a body first and hunts it second, so the fifteen missing ones are entered with what is known — the name, the host municipality, and the page that named them — whether or not a meeting source exists. The index is at suttonnh.gov/boards-committees and is reachable at rung 5 (rungs 2, 3 and 4 hit a Cloudflare managed challenge). NH Hunt 6 wired the Planning Board only, because its page is the only one that states a venue.

**NH51** — Fifteen of Sutton's sixteen bodies have no published venue this session could find. Their pages carry '93 Main Street | Sutton Mills' in the SITE FOOTER only — the town's postal address on a template, not a statement about where that board sits — and reading a footer as a venue would pin fifteen bodies on the strength of a page layout. What is owed is the posted NOTICE per body, which carries the room by construction, or a minutes header that states it.

**NH52** — facebook.com renders 977,803 and 928,697 bytes and ZERO characters of readable text to our headless browser, on two campaign and committee pages read 2026-08-21. campaign-social is the highest-yield branch-manifest route for the smallest races — the rule that a campaign living on Facebook still has a campaign site exists to protect exactly the candidates least able to buy a domain. The route is WALLED today, with its date, and RULING 53 puts it back on the queue in fourteen days.

**NH59** — Sutton's calendar titles the committee's sittings 'WRLAC Mtg @ Pillsbury Library'. Its own page on suttonnh.gov carries only the site footer, so the body names a venue the page does not. Two sittings are held out of the product because of it.

**NH60** — pnpm venue:hunt --town sutton_town reads 18 of Sutton's board pages and cannot reach seven: Municipal Budget Committee, Supervisors of the Checklist, Trustees of the Trust Funds, Website Committee, Ad Hoc Waste Reduction Advisory Committee, Ad Hoc Grist Mill Bridge Committee, and the 26 Grist Mill Street Committee. suttonnh.gov/boards-committees itself answers 404.

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

**24 open · 3 resolved.**

### P2

**NH38** — Six of the 40 New Jersey senators carry a websiteUrl on assemblydems.com or njassemblygop.com - a party caucus page for the Assembly, for people who now sit in the Senate. Two of them, John McKeon and Parker Space, answer HTTP 404 and surfaced in the officials audit as MISS-404.

**NH66** — 44 of the 90 Morris County contests are Boards of Education, and the municipal-roster branch built this session reaches municipalities only. A school district publishes its board members on its own site exactly as a borough publishes its council, so the same branch should reach them - what is missing is the INDEX step: there is no equivalent of the county's Cities-and-Towns page listing every district's website.

**NH67** — search-index was made mechanically walkable this session and walked all 272 candidates: 148 came back with at least one classified URL and 124 came back with none, because Bing and Yahoo both began refusing after roughly 170 queries. That 124 is a fact about one IP's rate ledger on one afternoon, not about those 124 people, and it may never be read as an absence.

**NH72** — NJ Hunt 6 wired 19 of 39 Morris municipalities' governing bodies. The other 20 are OWED, not absent, and `corepack pnpm nj:wire --dry` names every one with its reason. Three reasons, in order of frequency: (1) the confirmed member count does not reach the seat count the municipality's own form of government declares, so a partial list would state a false composition; (2) the form-of-government line states no seat count at all, so completeness cannot be checked; (3) the county clerk's certified winners do not reach the municipality, so the SEATS' partisanship is unsettled under M62. Every one of these is closed by more hunting, not by loosening the gate. The nearest wins: Boonton (7 of 8 confirmed), Dover (5 of 8), Netcong (4 of 6), Long Hill (4 of 5).

**NH73** — Denville Township's article listed Angela Cote and Christopher Golinski on the council. The Morris County Clerk's certified 2025 winners name Adrienne Zimmermann and Mark Venis in those seats, and the township's own council page confirms Zimmermann and Venis and does not name Cote or Golinski. This is RULING 87 working exactly as written - the encyclopedia named, the primary source proved, and the primary source disagreed. What is OWED is the sweep: how many of the other 38 Morris municipalities carry a stale encyclopedia roster that the certified winners contradict? `data/hunt/nj-morris-certified-winners.json` holds 263 certified winners and the comparison is a script, not a hunt.

**NJ02** — The official-universe pair at 07866, measured 2026-08-22 against the 2022 Census of Governments: 178 units within the first radius rung, 5 held, 173 with no body, 13 bodies held across those five. Compare 03255, which is 48 of 48. The five held are Township of Rockaway (9 bodies), County of Morris, Morris County Soil Conservation District, Morris Hills Regional District and Rockaway Township School District. Every un-held unit is named in the twig:pair output rather than counted, per RULING 57. This is the enumeration finding, not a defect: the New Jersey universe is simply much larger inside 25 km than Newbury's, because northern New Jersey is dense with boroughs, townships, fire districts and regional authorities. The work is to name and reach them, one shape at a time, and the fire districts and municipal utilities authorities are the biggest single class.

**NJ06** — data/ballot/nh-merrimack-2026.json gives the contest "Executive Councilor, District 2" the ocdId ocd-division/country:us/state:nh/county:merrimack/place:newbury_town. New Hampshire's Executive Council District 2 covers 81 cities and towns; Newbury is one of them. Two consequences: the contest renders only for readers whose divisions include Newbury, so the other 80 towns in the district never see their own Executive Council race; and the id is a wrong join key, which CLAUDE.md makes the universal key for districts, offices and elections. Found while verifying RULING 71's certainty classification -- the contest read as CERTAIN at 03255, which is accidentally the right answer for the wrong reason (Newbury covers the whole zip, and District 2 does cover Newbury). The right division is an Executive Council district, which this repo has no committed geometry for. Fixing it means either committing that layer or recording the contest against the state with a scope note.

**NJ08** — The other half of the 52. Fire districts, sewerage authorities and a power authority -- ROCKAWAY VALLEY REGIONAL SEWAGE AUTHORITY, five PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICTs, three MONTVILLE TOWNSHIP FIRE DISTRICTs, HANOVER TOWNSHIP FIRE DISTRICTs 2 and 3, PEQUANNOCK RIVER BASIN REGIONAL SEWERAGE AUTHORITY, NEW JERSEY PUBLIC POWER AUTHORITY, SOUTHEAST MORRIS COUNTY MUNICIPAL UTILITIES AUTHORITY, PEQUANNOCK-LINCOLN PARK-FAIRFIELD SEWERAGE AUTH, WANAQUE VALLEY REGIONAL SEWERAGE AUTHORITY, MUSCONETCONG SEWERAGE AUTHORITY. No TIGER polygon exists for any of them at any vintage, so no geometry pipeline will ever reach them. RULING 57 says a body is NAMED FIRST and hunted second, and that a body with no source and no site is still entered and still rendered. scripts/twig-pair.mts already has divisionlessBodyFor(), so the mechanism exists in one place and has not been generalised. Eleven of the eighteen publish a website, listed in the twig:pair output.

**NJ09** — Measured 2026-08-22, not assumed. Across all 272 Morris candidacies: contact 272 of 272, ballot slogan 70 of 272, campaign site 0 of 272, photo 0 of 272. Both of the fields that are held come from ONE route -- filing-county, one county-clerk PDF -- and that document carries no portrait, no prose about a candidate and no URL. So New Jersey's mechanical contact windfall is a property of that DOCUMENT and does not generalise to the other three fields. pnpm nj:fields walks a contest and reports per route; the Rockaway Borough Council four were walked (Burnside, McDonald, Dawkins Jr., Natale) and returned filing-county empty, campaign-site not walkable, domain-search one lead (patrickmcdonald.com, capped at a lead under RULING 68 because the identifier was guessed) and three empty. 86 of the 90 contests are unwalked, and no candidate anywhere has had the full named route list walked, so no absence has been earned for anybody in either zip.

**NJ11** — The wikipedia-municipality parser reads 39 of 39 Morris County municipalities and parses a roster for most of them. Jefferson Township and Pequannock Township return zero council members while their Local government sections plainly carry one, and both are Faulkner Act municipalities. Chatham Borough and Montville parse a roster but return no form-of-government string. These are parser seams rather than absences and must never be reported as absences about those bodies. The seams already found and fixed are written up in docs/zip-playbook.md section 8 - the roster sentence has no reliable lead-in so every sentence is scored, ref bodies must be masked before sentence splitting or every citation detaches, generational suffixes are not separators, and office titles are glued to names longest-first. These two are the next ones. The diagnostic is the headings array the parser returns on every record.

**NJ12** — Carries forward what NH71 recorded, minus what this session closed and plus what tiering revealed. CLOSED THIS SESSION: filing-campaign-finance-local (NJ ELEC) - the wall was on elec.nj.gov and the records are on njelecefilesearch.com at rung 2; 19 filed entities across the two 07866 municipalities with both controls clean. STILL OWED, with tier: lwv-questionnaire (Tier A) - onyourballot.vote411.org returned candidate-detail pages in search results last session and none has been opened, and it is the highest-value unwalked Tier A route left because one ballot page answers a whole contest. party-committee-roster (Tier A) - the Morris County Republican and Democratic committees publish slates and neither has been walked. filing-prior-candidacy (Tier A) - the manifest calls it the most under-used route in the list and it is under-used again. bar-directory and licensing-board (Tier C) - two candidates surfaced as attorneys through their firms' own sites and njcourts.gov has never been asked. records-request (Tier B) - rung 13, not reached. announcement-archive (Tier C). ad-library (Tier A) - NS01 is tabled by Sean and was not touched. press-outlet-map (Tier A) - the route was BUILT this session and its host list DERIVED from 726 distinct citation hosts, but the outlets' own site searches have not yet been queried.

**HD06** — Three people are running for the Rockaway Township Board of Education and twelve things about them have never been looked for.

**HD14** — Two people are running for the Morris Hills regional school board's Rockaway Township seats and eight things about them have never been looked for.

**HD17** — Three people are running for United States Senator in New Jersey and six things about them have never been looked for.

**HD20** — Two people are running for the Morris County Board of Commissioners and five things about them have never been looked for.

**HD21** — Two people are running for Congress in New Jersey's 11th district and five things about them have never been looked for.

**HD25** — One person is running for the Rockaway Township school board's unexpired term and four things about them have never been looked for.

### P3

**NH57** — The welcome overlay offers four starting zips and labels 07866 'Rockaway Twp., NJ'. Two municipalities sit in that zip and the product now renders both, so the label names one of them and silently drops the other — for a Borough resident it is the wrong town.

**NH68** — Robert Strobel is a Board of Education candidate and strobelforschoolboard.com answered HTTP 200 to a plain fetch with no mention of his name anywhere in the HTML. That is the classic JavaScript-rendered page: a false miss at rung 2, not a wall and not an absence. The extractor recorded it EMPTY, which is honest about the fetch and wrong about the candidate.

**NH71** — The branch manifest names 41 routes. This session walked search-index, filing-county, body-roster-page, gov-staff-directory, campaign-site, campaign-social, candidate-platform, local-newspaper, web-archive and domain-search. The rest were not walked and each one's reason is recorded here rather than left as a silence, because a route nobody names is a route the next session rediscovers as new.

**NH74** — The township's own Township Council page shows `hmorrison@rockawaytownship.org` as Howard Morrison's address, and the link behind it targets `hkritz@rockawaytownship.org`. Howard Kritz held the seat before Morrison and appears in the Clerk's certified 2023 winners, so the mailto is a predecessor's mailbox the page never updated. We ship the DISPLAYED address, which is what the body publishes as his, and record the mismatch rather than silently preferring either. Worth telling the township: the link on their own page reaches the wrong person.

**NH76** — `corepack pnpm nj:winners` reads the Morris County Clerk's certified general-election winners: 263 people across three cycles, each with a party, a filed street address and usually an email, certified by the election authority. NJ Hunt 6 wired the PARTY from it for 98 sitting officials and used the email only as a fallback where the body's own page publishes none. What is owed is the rest: the filed addresses are unused, and the same document class exists for every New Jersey county and for the school-board and fire-district races the municipal walk does not reach.

**NJ04** — RULING 65's footer-address branch wired seven Sutton bodies on 2026-08-22, and three were deliberately left out because each has better evidence about itself than the town's footer has about it. Ad Hoc Speed Sign Committee: its own feed titles read 'Ad Hoc Speed Sign Committee - Zoom Mtg', so it meets on Zoom and pinning it at 93 Main Street would send a reader to an empty building; the playbook already records that a Zoom URL in LOCATION is a fact and not a building, and this is the same rule read from a title. Warner River Local Advisory Committee: its titles read 'WRLAC Mtg @ Pillsbury Library', a venue this session could not resolve to a coordinate, and it is a multi-town river committee so Sutton's town hall is a poor guess; the work is to resolve Pillsbury Library. Sutton Free Library Board of Trustees: its page states its own meeting arrangement, so it is a STATES A VENUE case. Each has four future sittings, two, and an unknown respectively.

**NJ10** — Read as an image on production 2026-08-22. With the zip-area widening in place the card at 07866 lists both municipalities, and the Borough's row reads "Rockaway  MUNICIPAL" while the Township's reads "Rockaway township  MUNICIPAL". A reader cannot tell which is which, which is the exact confusion RULING 71 exists to remove -- borough and township are coequal forms and these are two separate governments sharing a name. The label comes from the division's own name in the registry, which for the place layer is the Census's "Rockaway" for the CDP-style entry. The fix is a labelling decision about which of the two committed names a row shows, and it wants a look at the other states before it is made.

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

**3 open · 35 resolved.**

### P1

**F01** — Sean's full walk of the product on 2026-08-18, forty-odd findings across cards, meeting order, votes, the ask box, the ballot and the map. The parent row that keeps the whole batch together; the individual findings became their own rows.

### P2

**M92** — Bodies and districts on the map still click straight out to a website. Sean and the tester both wanted a card that tells you about the thing first, with the website as one of the things on it.

### P3

**VF01** — Read as an image on production f20e1e9 at 430x932. On the map's who-governs card the pill sits inline in each body row, between the body name and the type label. At phone width that squeezes the name into two and three lines - Rockaway Township School District wraps to three, Denville Township School District to three - and the pill itself wraps to two or three lines beside them. Every word is legible and the classification is correct; the row is simply cramped, and six of eight rows carry it at this zip. The pill reads well on the ballot page, where it wraps under a wide heading rather than competing with a narrow column. Worth a look at whether it belongs under the row rather than inside it on narrow viewports, or whether the type label should move.

## Data infrastructure

Sources, ingest, denominators, extraction, crawlers. The machinery that turns a public record into a row.

**67 open · 81 resolved.**

### P1

**NH45** — data/ballot/candidate-hunt-state.json holds 136 candidate keys in TWO formats for the same people: a slug form, ballot-az-pima:governor:hobbs-katie, and a pipe-and-display-name form, ballot-az-pima:governor|Katie Hobbs. Thirty of the 136 are the pipe form and every one names somebody the slug form already names. candidate-cards-2026.json carries 20 of the same duplicates.

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

**NH46** — One of the three coverageNotes in data/ballot/nh-merrimack-2026.json ends with a paragraph of internal record-keeping that reaches a reader on the ballot page: 'CORRECTED 2026-08-21 under RULING 52: this note used to end ... That was true when it was written on 2026-08-14 and is FALSE now - re-walked 2026-08-21, gc.nh.gov answers a plain rung-2 fetch at HTTP 200. A wall is recorded with the date it was last tested...'

**NH75** — Playwright's extraHTTPHeaders applies to EVERY request a context makes, third parties included. MapTiler's CORS preflight does not allow x-wtp-synthetic-run, so the basemap style request was refused in every capture and every walk. That is why NJ Hunt 5's captures showed BASEMAP UNAVAILABLE against a production site serving readers a working map. Fixed at the shared path in scripts/browser.mts. This row is open for the QUESTION IT RAISES rather than the fix: what else has an instrument of ours been breaking while measuring it? The shape - a synthetic marker leaking into a third-party request - is worth sweeping for beyond the browser.

**NJ03** — lib/sources/http.ts gives the Cloudflare interstitial signature a 20 KB maxBytes floor, with a comment explaining exactly why: Cloudflare injects its challenge-platform script into ORDINARY pages, so reading the marker at any size would mark a working source refused. The Imperva/Incapsula signature has no such floor, and Imperva injects _Incapsula_Resource script tags into ordinary served pages in the same way. Swept on 2026-08-22 with git grep -a --untracked: no committed fixture currently carries the marker in a real page, so this is a LATENT risk and not a live defect, which is why it is a row rather than an edit. Diagnose before fixing applies with force here — changing a challenge detector without evidence would risk the opposite failure, a real wall read as a page. What would settle it is a recorded fixture of a large Imperva-fronted page that is genuinely served, which www.nj.gov can supply.

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

**DI01** — pnpm nj:filing reports 42 seats a party filed nobody for, and entry 28 is "Morristown Town -- NO LOCAL ELECTION (Democratic)". NO LOCAL ELECTION is a jurisdiction-level statement in the clerk's document, not an office, so a row carrying it as an office is a bleed between two record types the parser already separates elsewhere -- the same class NJ2 playbook entry 7 describes. It does not reach a reader (the 42 are a finding stated in the report, not a rendered surface) and the total still reconciles, which is why this is P3. The count of 42 should be read as 41 unfilled seats plus one parser artifact until it is fixed.

**DI02** — The wikipedia-government-graph crawl enumerates governing bodies the registry has never held, most of them state executive departments, agencies, boards and commissions. Each carries its own official site harvested from the article's infobox and External links block. What is NOT yet done is the second hop: fetching each of those official sites and finding the meeting, agenda, hearing or calendar page on it, so the body becomes a reader surface rather than a name in a file. The crawl records meetingLinks where Wikipedia itself linked one, which is rare - an encyclopedia links a department's home page, not its hearing calendar. The work is a pass over data/hunt/wiki-graph-07866.json that walks each harvested official site for the schedule, and then wiring what it finds into the meetings composite the same way every other source is wired. Whether appointed officials RENDER is a separate question and is on a Needs Sean row; their meetings are not in question.

**NH07** — Merrimack County's department pages all load cleanly and all of them list their staff in a table our reader cannot understand. It is a different table shape from the one we built for. Nobody has looked at how many other counties use it.

**NH16** — Bradford, New Hampshire publishes every agenda and minute set on a vendor platform this product has never seen. Its own town website carries no boards index and no calendar, so the vendor is the only route to the town's meetings.

**NH17** — The consolidated miss list says newbury.nh.gov/sitemap.xml is a 403 and that robots declares none. It answers HTTP 200 at 43,484 bytes. A sitemap is the discovery rung for every page on a site, and this one has been closed to us on a stale reading.

**NH39** — James Gallagher, a U.S. Representative sworn in on 2026-06-10, has no websiteUrl at all - the congress-legislators dataset this registry reads has not yet published his House page. Kate Murray is the one New Hampshire officeholder pnpm nh:fix-pages could not repair, because she is not on the General Court's current roster; a former member's page is the archive's hunt.

**NH40** — cfs.sos.nh.gov holds first-party contact details for every New Hampshire candidate who registered a committee, and it refuses rungs 2, 3, 4 and 6 with an Akamai 403 - headless Chromium, a real Chrome channel and a masked user agent alike. A visible browser on the same machine and the same IP gets HTTP 200. It was harvested by hand this session through the app's own XHR at rung 7, which is a procedure and not a script, so nothing in CI can repeat it.

**NH42** — pnpm twig:pair reports 48 government units inside 03255's first-rung circle, 28 with a body in this registry and 20 without. Seven of the twenty are not missing a body so much as missing a DIVISION: Sullivan County itself, and the towns of Lempster, Croydon, Newport, Windsor, Acworth and Grantham are not in the shipped division list at all, so no body could be attached to them.

**NH53** — The walker covers 7 of the 36 manifest routes mechanically. Per field that leaves 4 of 7 photo routes, 8 of 10 blurb, 29 of 35 contact, 10 of 14 campaign site and 6 of 8 verified page needing a person — reported by name on every run, never counted as walked. Each route automated is a whole class of candidate the manifest can be exhausted against without a session reading pages one at a time.

**NH54** — A statewide New Hampshire candidate-and-results database exists at electiondatabase.nhpr.org and nh.electionstats.com. Every /candidates/view/<Name> URL from the search index returns the SPA's 404 shell — 41,148 bytes, identical for a known-good name — and rung 6 confirms a genuine 'Page Not Found'. The path has moved. It would serve many candidates at once if found: prior candidacies, districts, and results.

**NH70** — New Jersey has two places named Silver Lake, Census GEOIDs 3467590 and 3467650, and placeIdentity keys on state plus name, so both slug to state:nj/place:silver_lake. The widened geometry clip surfaced it and the build refused to write, correctly - a duplicate join key is a join that collapses. It is fixed for the build by suffixing EVERY side of a collision with its Census GEOID, and the underlying identifier convention is still not unique.

**NJ05** — suttonnh.gov/sitemap.xml answers HTTP 200 with a valid sitemap containing exactly one URL: https://d9template1.civiccms.acsitefactory.com/ — the vendor's Drupal 9 template host, not the town. Rung 10 of the retrieval ladder is sitemaps and search-index caches, and on this CMS family that rung returns the vendor and none of the body's own pages. A session walking rung 10 here would read a well-formed sitemap, find no board pages in it, and have no signal that anything was wrong. Recorded 2026-08-22. Worth checking across the CivicPlus D9 tenants this project already knows before it is treated as one town's misconfiguration; data/reference/civicplus_tenants.csv is the list.

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

**19 open · 132 resolved.**

### P1

**P02** — Mapping candidates' stated positions onto the issues on a reader's ballot, every one carrying its source. Never a score, never a ranking — the positions side by side and the reader deciding.

  Waiting on candidate info (D05).

### P2

**NH58** — When map tiles do not load, the reader-facing panel reads: 'BASEMAP UNAVAILABLE — Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use'. An environment-variable name and a source file path are internal identifiers and may not render outside a technical-details disclosure.

**NH61** — RULING 70. Ballotpedia's Candidate Connection works because candidates volunteer answers and identity is verified before publication. The mechanism is not licensed and is worth more than the content: a questionnaire on this product's own site is original data with no licence, no copyleft and no dependency, and it is symmetric by construction because every candidate in a contest gets the same invitation and the same questions.

**PU01** — Read as an image on production 2026-08-22 at 430x932. The map at 07866 shows a panel reading "BASEMAP UNAVAILABLE -- Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use". That is an environment variable name and a dotfile path rendered to a reader, which the plain-language rule forbids outside a technical-details disclosure: identifiers, enum values and internal keys never render to a reader. The honest half of the message -- that tiles did not load and pins still work -- is right and should stay. Two questions for whoever takes it: whether the key is simply unset on the production deploy (in which case the message is doing its job for the wrong audience), and what a reader should see instead.

**M75** — On a phone, the map's legend crosses the bottom of an open meeting panel and covers the text underneath it.

**P03** — The one-tap yes or no, with an optional free-text answer, asked after the explanation and attached to a specific provision or a specific sourced position. This is the revenue path.

### P3

**AUD09** — The animation that flies the map to a state has no agreed speed budget, so nothing can tell whether a change made it slower.

**B18** — Sean asked for federal officials' town halls. There is no authoritative feed for them anywhere, so this row records what was checked and what it found rather than pretending a build is waiting.

**M13** — The radius control broke twice — once blanking results, once refusing to switch off — and both times the tests only covered the logic underneath, not the control a reader touches.

**NH62** — Recorded so no future session re-derives Ballotpedia as an available branch and starts building one.

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

**7 open · 58 resolved.**

### P2

**NH47** — pnpm test reported 1561 passing, 0 failing, while EIGHT guard tests had stopped running entirely. A deleted test and a passing test are indistinguishable in that output; the only instrument that can see the difference is the COUNT, and nothing checks it.

**NH69** — Every tracker run this session ended with THE WORKBOOK IS STALE and exit code 3: docs/tracker.xlsx is locked (docs/~$tracker.xlsx exists, which is Excel's own lock file). The two CSV stores are authoritative and were written correctly, and docs/tracker.md and docs/log.md regenerated from them - but the workbook Sean edits is showing the tracker as it was before this session, and saving it would write those older rows back over the stores.

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
