# The tracker — what is left

**GENERATED FILE — do not hand-edit.** Written by `corepack pnpm tracker:views`
(`scripts/tracker.mjs`) from `docs/tracker-working.csv`. It cannot disagree with the
store, because it is derived from it.

Generated 2026-08-24 (America/Phoenix, from `pnpm stamp`).

Open rows only. Finished work is in `docs/tracker-resolved.csv` and on the
**Resolved** tab of `docs/tracker.xlsx`, which is the record of what was decided
and when. Nothing is ever deleted.

---

## Where the project stands

- **252 open**, 409 resolved.
- **46 waiting on Sean** — the first section below.
- P1 by section:
  - Needs Sean — **7** · **OVER THE FIVE-ROW CAP: THIS SECTION IS STOPPED**
  - New Hampshire hunt — **2**
  - New Jersey hunt — **0**
  - Arizona hunt — **0**
  - Visual feedback — **1**
  - Data infrastructure — **1**
  - Product / UI — **1**
  - Constitution & rules — **1**
  - Repo & ops — **1**

**1 section(s) over the cap.** A section over five P1 rows is STOPPED, and that is reported as a fact. Nothing is relabelled to fit — a demotion changes the label and not the situation.

---

## Needs Sean

Anything only Sean can unblock: an API key, a legal review, a business decision, a visual judgment, and specifically go look at the site and confirm this is right.

**46 open · 42 resolved.**

Only Sean closes a row here. A session may open one and may work it.

### P1

**B05** — Two lawyers, probably: one on privacy and one on election law. Both have long lead times and several other rows are waiting on them.

  Pending review.

**NH108** — The questionnaire instrument is built and 272 invitations are generated, every one with invitedOn null, so nothing has been sent to anybody. The page a candidate types into is buildable and is NH104. SENDING is not a build, it is four decisions, and they are all yours: (1) the sending DOMAIN this goes out from, because a civic questionnaire arriving from a generic address is the one a campaign deletes; (2) an email PROVIDER CREDENTIAL, which this project does not hold and cannot obtain on your behalf; (3) DELIVERABILITY WARM-UP, because 272 near-simultaneous messages from a cold domain is the textbook shape of a spam classification, and being classified once is close to unrecoverable; and (4) WHETHER THE INVITATION GOES OUT BEFORE OR AFTER 3 NOVEMBER 2026, which is a judgement about the election and not a technical question at all. Raised as ONE row on purpose so you can rule once rather than in four pieces, and so a session cannot start building a send path on the strength of having answered one of them.

**NH142** — NS11 recorded the mirror scrubbed and verified by re-read on 2026-08-24. A sweep at the start of this session found six occurrences of five live credentials back in it. Nothing un-scrubbed it: handoff re-runs the transcript exporter, which rewrites the mirror out of the local jsonl files, and those are deliberately never scrubbed. The mirror is scrubbed again and handoff now scrubs it immediately after every export and re-reads to confirm. ROTATION IS STILL THE FIX and only you can do it: 0 of the 9 credentials in NS11 are rotated as of this session, proven by the sweep still finding every current value in a leaked location.

**NH169** — pnpm secrets:sweep found six credential VALUES in three transcripts on the Drive mirror. CONGRESS_API_KEY (twice - 8/17 and 8/18), FEC_API_KEY, PLURAL_API_KEY and LEGISCAN_API_KEY (all 8/17), and CENSUS_API_KEY (8/24, from another session that ran today). All three files have been scrubbed and re-read clean. RULING 127 is explicit that this is not enough: a value written to a synced folder must be assumed READ, so scrubbing is cleanup and ROTATION is the fix. That is yours - the accounts are yours and no session can do it. Rotate all five, then prove it the way RULING 95 asks: CALL the dead key and confirm it is refused, and CALL the new one and confirm it answers with the data requested. Both halves matter, because the Census host answers a dead key with HTTP 200 and an HTML page titled Invalid Key, so a status check alone reads a corpse as healthy. Nobody pasted these: the leak mechanism RULING 127 names is a tool printing a resolved URL back, and several of these APIs carry the key as a query parameter. This session neither caused nor touched the leaks; it found them at the ship gate and is routing them to you.

**NS11** — The brief named one leaked key (Census). A sweep BY VALUE across the repo, the Drive mirror and the local session transcripts found NINE distinct credentials in plaintext: CONGRESS_API_KEY, PLURAL_API_KEY, FEC_API_KEY, LEGISCAN_API_KEY, CENSUS_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL, WTP_PRODUCTION_DATABASE_URL_READONLY and WTP_PRODUCTION_DATABASE_URL_WRITE. The last three are database connection strings carrying passwords, and one of them is the PRODUCTION WRITE credential. The Drive mirror — the surface that leaves this machine — held six of them and has been SCRUBBED (0 remaining, verified by re-read). The local ~/.claude transcripts still hold all nine and were deliberately NOT edited: they are the runtime's own files and corrupting session state to remove a secret that has already escaped would be a real cost for no security. A value written to a synced folder must be assumed read. Scrubbing is cleanup; ROTATION IS THE FIX, and only Sean can rotate these.

**NS15** — pnpm walk:all found it: the deploy's database was missing two committed migrations, 0019_next_scarlet_witch and 0020_dazzling_deathbird, both of which create and extend the speak_your_mind table. They were merged this morning with the feature (1803be2) and never applied. The surface is LIVE — components/speak/speak-your-mind.tsx renders inside the official and entity modals and /api/speak answers — so on production every insert naming those columns failed, the route caught it, and the page served normally. A reader typing what they would say to their representative got no error and their words were dropped. THE SESSION APPLIED THEM rather than opening this and waiting, because it is live data loss on a collection surface and the migrations are additive and were authored to be applied: 6 statements, journal now 21 of 21 committed and 0 pending, verified by a second dry run. This row is here because you should know a session wrote to the production database, and because the question worth your judgement is the OTHER half: how many readers typed into that box between the merge and now, and whether anything should be said to them. Nothing about the identity boundary changed — speak_key_hash carries its own digest prefix per RULING 141 and tests/db-schema.test.ts passes.

**T05** — The abuse policy is written but the review path behind it does not exist. No free-text answer can be accepted until somebody can actually act on a threat.

  Waiting on reaction capture (P03).

  Pending review.

### P2

**B01** — The product is called Meanwhile on screen while the real name is decided. Nothing a reader sees changes until Sean settles it; when he does, one file changes and the whole site follows.

**NH105** — Opened 2026-08-23. The instrument is built and the invitation list is generated - 272 of 272 Morris County candidacies, every row carrying invitedOn: null because nothing has been sent. The message is docs/candidate-questionnaire-invitation.md, quoted in full, plus a reminder message. FOUR THINGS ARE YOURS AND NONE OF THEM IS A SESSION'S CALL: (1) the message itself - it goes out under this product's name to 272 named people asking for votes; (2) a monitored reply address a person actually reads, which the message promises three times and which does not exist yet; (3) the schedule - one send date, two reminder dates and a deadline, which are constants at the top of scripts/questionnaire-invitations.mts and are quoted in full in that file and in data/questionnaire/invitations-nj-morris-2026.json; one edit moves all 272 symmetrically; (4) whether sparkwtp.netlify.app comes off its password wall first, because a candidate following the link today hits a password prompt. RULING 112 governs everything about the instrument itself; this row is only the decision to contact real people.

**NH165** — Rule 4 of your BC-11 ruling is built: nothing typed into Speak Your Mind is ever auto-forwarded, and content the triage reads as a threat or as menacing is stored with review_state HELD and excluded from everything. What does not exist is the surface where you READ that queue and act on it - which is exactly what T05 says about the abuse policy generally. This row links the two: the HOLD half now has a concrete first surface, and the REVIEW half is still yours to unblock. T05 stays open and only you close it. The tiers are docs/abuse-policy.md's own T1/T2/T3, not new ones, and the rules that decide are lib/speak/triage.ts with the harsh-political-speech cases planted in the test so over-filtering fails the build.

**NH32** — The intake tripwire raised an alarm on 2026-08-21 at 00:28 UTC: a search_log insert was refused in production. The alarm is doing exactly what it was built for. The problem is that its output prints five dashes where the database's reason should be, so the one thing needed to diagnose it is the one thing not recorded. Production schema is in sync at 0015, so a missing column is ruled out.

**NH43** — RULING 60's residual. NH Hunt 5 hand-worked every un-held unit at 03255 and holds 48 of 48. Three bodies inside those units were reached by nothing, and each is listed below with every branch already walked and what each returned. The ruling asks you to hunt one or two yourself and return the process, which then gets built as a branch the same way the six in zip-playbook.md section 8 were.

**NS01** — The Meta Ad Library is the single best compliant route to a campaign that lives on Facebook, and it is the one route in the manifest that this project cannot walk at all. Political-ad disclosure is mandatory by law, so any candidate who buys a single ad appears there with the campaign's website, its paid-for-by disclaimer and often a contact. The API refuses every unauthenticated request (graph.facebook.com/ads_archive answers HTTP 500 OAuthException), and the public Ad Library web pages answer HTTP 403 with an anti-automation challenge. Measured 2026-08-22 for all sixteen Merrimack County candidates: ad-library REFUSED 16 of 16, and that refusal is recorded as a refusal rather than an absence, so no candidate field moved toward exhaustion on it. A token is issued against an identity-verified Meta developer account, which means it is tied to a real person and to that person's acceptance of Meta's platform terms. That is a standing commitment to a third party and a legal question wearing an API key, which CLAUDE.md lists as an ask-before. It is also the reason no session may make it: RULING 12 says a wall like Facebook's is named and not defeated, and authenticated access risks the account it runs under. This row exists so the decision is documented and yours, with counsel's read, rather than made quietly inside a session. NOTHING is blocked on it — the other three RULING 66 routes are built and walked, and the answer may simply be no.

**NS12** — RULING 125 moves every walk onto the local production build and leaves exactly one question that needs Netlify: which SHA is live. pnpm deploy:live reads it from Netlify's deploy API in one call with zero requests to the site. There is no NETLIFY_AUTH_TOKEN in .env.local and the Netlify CLI config on this machine holds no user, so the tool correctly reports CANNOT-TELL and exits 3 rather than passing. A Personal Access Token from Netlify (User settings, Applications, Personal access tokens) added to .env.local as NETLIFY_AUTH_TOKEN closes it.

**NS13** — RULING 124 item 5 makes pnpm closeout REFUSE a separate push to main, per Sean's instruction that records ship inside the PR or not at all. CLAUDE.md's merge-cadence rule permits separate close-out commits for a stated reason: a document cannot name the commit that contains it. Most of that reason is now gone — RULING 125 moves walks onto a local build, so the walk numbers ARE knowable before the ship. What remains genuinely unknowable in advance is the deploy SHA. This session's position: that is an operational fact read from Netlify's deploy record afterwards and it does not need to live in a commit at all. If Sean disagrees, the merge-cadence rule needs amending rather than the tool.

**NS14** — Your brief said to read VOTE411's terms from its own site before extracting anything and to treat it as restricted until the terms say otherwise. There are no terms. Read 2026-08-24: /terms-use, /terms-of-use and /privacy-policy are all HTTP 404 on vote411.org, lwv.org/terms-use is HTTP 404, and neither the homepage nor its footer links a terms document — the only assertion anywhere is the footer's copyright notice. Its robots.txt permits crawling everything except admin, user and search paths, but a crawl permission is not a licence. So nothing was extracted and it stays RESTRICTED. The judgement that is yours: an absent terms document is not a permissive one, and VOTE411 is a nonprofit's compilation about public records rather than a government publication — the same question RULING 70 asks of Ballotpedia and RULING 93 asks of usmayors.org. If you want it walked, say so and it will be.

**T01** — The page that says, in plain words, what the product collects, how it is used, and that anonymous totals may be sold. Written before any marketing page, because the marketing has to be true.

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

### P3

**C01** — A sample of what a buyer actually receives: one Pima County measure broken into its provisions, with support per provision and counts by how well each answer was verified. Synthetic numbers, clearly labelled, built to show rather than to sell.

**NH08** — The Town of Newbury publishes its whole calendar as a feed nobody had wired, and it has more meeting dates on it than the portals we were using. Both now ship, and when they both carry the same meeting the site shows the one with the agenda attached. That is a change to what you see at 03255 and it is worth a look.

**NH164** — Your BC-11 ruling asked for the disclosure to be drafted this session, marked for your review as COPY, and shipped as drafted meanwhile. It ships as: 'What you write may be shared - without a name, because we don't hold one - with campaigns, organizations, and researchers working to understand what people want.' Three things in it are load-bearing and worth checking: it says MAY rather than will, because a commitment not honoured on every instance is worse than a reserved right; it gives the REASON there is no name inside the sentence, because anonymously is a promise and we-don't-hold-one is a checkable fact; and it names the buyer classes out loud at the moment of typing. The framing above the box reads 'What would you say if [the body] were standing in front of you?' and the placeholder is 'What would you want to say?'. Change any of it and the words live in lib/speak/copy.ts.

**NH166** — OFF-3 asked for the superintendent's photo from the TUSD site, queued for your review under the photo rules, with the rest of the board swept alongside. NOT DONE this session and reported as not done rather than smoothed. Two things you may want to rule on. First, the four-door rule: a district's own site publishing a portrait of its own superintendent is door 2, an official government-published portrait, and TUSD is not a .gov host - so whether door 2 reaches a school district's own domain is your call and not a session's. Second, the app spells him Gabriel Trujillo; the 8/24 brief dictated Gabrielle. The naming rule says the app's spelling is authoritative, so nothing was changed - but if the app is wrong, that is a data fix and it wants your word first. The board's other five members already carry portraits; he is the one initials circle on that card.

**NS10** — RULING 119 gives tribal nations their own category, and they needed identifiers. The canonical national list of government identifiers - opencivicdata/ocd-division-ids - has no tribal category at all: read on 2026-08-24, its entire top-level vocabulary is states, districts, territories and courts of appeal, and searching it for the three nations by name returns only Navajo COUNTY, Arizona. So this project minted its own, built on the Census Bureau's own codes for tribal areas with the federal code recorded beside each one.

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

**32 open · 5 resolved.**

### P1

**HUNT01** — Walk every single governing body around Newbury, New Hampshire to full depth — who sits on it, when it meets, where its records are. The first place the product tries to answer completely.

**HUNT04** — The 47 people who filed to run around Newbury, New Hampshire. None has been researched. Every one of them is a card a reader will meet.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

### P2

**NH02** — Newbury's own site lists a Parks and Recreation Committee and a Housing Committee in its sitemap, and both pages ask for a password. They are real committees the town has not published. We never sign in to anything, so their membership and meetings have to come from somewhere else.

**NH04** — We now hold all three county commissioners, the delegation's officers and every department head by name. What the county publishes for reaching any of them is one main number. The Kelly standard asks for a working contact per person and the county does not print one.

**NH05** — Ten Newbury boards now read their meetings off the town's own calendar, and the town has not posted a single upcoming date for any of them. Seventy-eight of their past sittings are on that calendar, so they do meet. A reader who wants to attend one cannot find out when from anything the town publishes.

**NH122** — cfs.sos.nh.gov ANSWERS: Node fetch gets HTTP 200 and 65,928 bytes. But the page is an Angular single-page app whose HTML is a shell, and the campaign-finance data endpoints were not found. Rung 6 (a live browser, which would reveal the calls) is REFUSED with 403 by the edge — curl is also refused, and only Node's fetch passes, which inverts the usual assumption that the browser is the strongest rung. Reading the served JS bundles (a new route, recorded in the expansion log) surfaced only lobbyist paths; the campaign-finance routes are in lazy chunks this pass did not locate.

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

**NH116** — He is running for US Senate and is owed a photo at 03255. His campaign site publishes exactly one picture of him: a clean solo studio portrait, refused on 2026-08-24 on two stated grounds rather than on composition. The file is named 'Picture Trinity campaign shot high def 2007 001.jpg' - the publisher dating it to 2007, nineteen years ago - and it is served at 220px in 5,699 bytes, which is below any size this product could render as a portrait.

**NH35** — Warner's own boards index names 26 governing bodies. Its calendar files sittings for 16 of them. The other ten are named in the registry and ship KNOWN_UNCOVERED: the Cemetery Trustees, the Community Power Committee, the Corridor Committee, the Economic Development Advisory Committee, the Groundwater Protection Committee, the Highway Safety Committee, the Housing Advisory Committee, the Joint Loss Management Committee, the Mink Hills Recreation Committee and the Record Preservation Committee.

**NH36** — Wilmot's Master Plan Committee, its Safety Services Facility Committee and its Transfer Station Advisory Group all meet, and the town files their meetings under CATEGORIES:Planning Board and CATEGORIES:Select Board. A category-driven read cannot separate them and a title-driven row over the same feed would claim events that already belong to another body. All three are named and KNOWN_UNCOVERED.

**NH41** — The Lake Todd Village District's own site, which the Census of Governments records as laketoddvillagedistrict.us, answers HTTP 404 at rungs 2, 3, 4, 5 and 6, and so does the Town of Bradford's news item for its meeting. The Internet Archive - rung 11, and the rung that produced this district's own words for an earlier session - answered 'Temporarily Offline' on 2026-08-21.

## New Jersey hunt

Everything owed to a reader in New Jersey — Rockaway Township and 07866 first.

**36 open · 5 resolved.**

### P2

**NH113** — The scheduled NJ filing refresh rebuilds data/ballot/nj-morris-2026.json and the file comes back reordered even when nothing about the ballot has changed. Run 32711668624 on 2026-08-24 showed 1,013 insertions against 1,013 deletions across two files while the clerk's own totals were identical - 272 candidacies, 90 contests, both PDFs still dated 08-21-26. So the workflow reports 'data/ballot/ CHANGED' and runs the full gate on every single run. That is not just noise: a real republish by the clerk will look exactly like the churn, and the one signal that would tell somebody the ballot actually moved is the one being spent every day on nothing.

**NH115** — pnpm roster:stale, built 2026-08-24 for NH73, compares the Morris County Clerk's 263 certified winners against the 271 people this project holds on Morris body rosters. Of 234 municipal winners: 99 are confirmed in our rosters, 90 belong to municipalities we hold no roster for at all (a coverage gap), and 45 belong to places where we DO hold a roster that does not name them. Those 45 are the NH73 shape - a roster that may be showing a reader somebody who is not in the seat. Boonton Town has 13 of them and Chester Township 7.

**NH38** — Six of the 40 New Jersey senators carry a websiteUrl on assemblydems.com or njassemblygop.com - a party caucus page for the Assembly, for people who now sit in the Senate. Two of them, John McKeon and Parker Space, answer HTTP 404 and surfaced in the officials audit as MISS-404.

**NH66** — 44 of the 90 Morris County contests are Boards of Education, and the municipal-roster branch built this session reaches municipalities only. A school district publishes its board members on its own site exactly as a borough publishes its council, so the same branch should reach them - what is missing is the INDEX step: there is no equivalent of the county's Cities-and-Towns page listing every district's website.

**NH67** — search-index was made mechanically walkable this session and walked all 272 candidates: 148 came back with at least one classified URL and 124 came back with none, because Bing and Yahoo both began refusing after roughly 170 queries. That 124 is a fact about one IP's rate ledger on one afternoon, not about those 124 people, and it may never be read as an absence.

**NH72** — NJ Hunt 6 wired 19 of 39 Morris municipalities' governing bodies. The other 20 are OWED, not absent, and `corepack pnpm nj:wire --dry` names every one with its reason. Three reasons, in order of frequency: (1) the confirmed member count does not reach the seat count the municipality's own form of government declares, so a partial list would state a false composition; (2) the form-of-government line states no seat count at all, so completeness cannot be checked; (3) the county clerk's certified winners do not reach the municipality, so the SEATS' partisanship is unsettled under M62. Every one of these is closed by more hunting, not by loosening the gate. The nearest wins: Boonton (7 of 8 confirmed), Dover (5 of 8), Netcong (4 of 6), Long Hill (4 of 5).

**NH88** — data/hunt/wiki-graph-07866.json holds 80 leader entries harvested on 2026-08-22, and 5 of the 72 usable ones store the Wikipedia link syntax as part of the person's name - "Joseph Jackson ([[Republican Party (United States)" is what the file actually contains for the Mayor of Rockaway Township, and one office title is stored as "[[City manager". A consumer reading the name field straight out gets a string that is not a name. NOTHING WENT RED, because nothing was empty: this is RULING 100's shape, an extraction that came back with some rather than none, and only reading the rows shows it. The fix belongs in the graph's own generator per RULING 92, and that generator reads Wikipedia over the network, so the artifact is owed a regeneration when egress is available. scripts/mine-wiki-leaders.mts cleans the markup at read time as a stopgap and exports cleanWikiText; it is a workaround, not the fix.

**NH89** — The 2026-08-23 session mined two committed corpora that had never been read for the fields they answer, and produced leads it could not confirm because every outbound host was refused at that environment's egress. data/hunt/campaign-site-leads-nj-morris.json holds 12 campaign-site leads across 12 of 272 candidates, 8 of them STRONG (selenformorriscounty.com, joehathawayforcongress.com, strobelforschoolboard.com, rebeccabennettforcongress.com, corybooker.com and three more) against a field that stood at 0 of 272. data/hunt/wiki-leader-leads-07866.json holds 9 New Jersey municipal roster leads - mayor, manager and clerk for Rockaway Township, Rockaway Borough and Denville - none currently held as an officeholder. EVERY ROW IS A LEAD AND NOT A HIT: a domain matching a candidate's name is a guessed identifier, and Wikipedia names a person while the citation proves them (RULING 87). What is owed is the control check - fetch each, confirm the page self-identifies with the filed name, the office and the cycle - which is one fetch per lead for a session that has egress. Regenerate the leads with pnpm mine:campaign-sites and pnpm mine:wiki-leaders.

**NJ02** — The official-universe pair at 07866, measured 2026-08-22 against the 2022 Census of Governments: 178 units within the first radius rung, 5 held, 173 with no body, 13 bodies held across those five. Compare 03255, which is 48 of 48. The five held are Township of Rockaway (9 bodies), County of Morris, Morris County Soil Conservation District, Morris Hills Regional District and Rockaway Township School District. Every un-held unit is named in the twig:pair output rather than counted, per RULING 57. This is the enumeration finding, not a defect: the New Jersey universe is simply much larger inside 25 km than Newbury's, because northern New Jersey is dense with boroughs, townships, fire districts and regional authorities. The work is to name and reach them, one shape at a time, and the fire districts and municipal utilities authorities are the biggest single class.

**NJ06** — data/ballot/nh-merrimack-2026.json gives the contest "Executive Councilor, District 2" the ocdId ocd-division/country:us/state:nh/county:merrimack/place:newbury_town. New Hampshire's Executive Council District 2 covers 81 cities and towns; Newbury is one of them. Two consequences: the contest renders only for readers whose divisions include Newbury, so the other 80 towns in the district never see their own Executive Council race; and the id is a wrong join key, which CLAUDE.md makes the universal key for districts, offices and elections. Found while verifying RULING 71's certainty classification -- the contest read as CERTAIN at 03255, which is accidentally the right answer for the wrong reason (Newbury covers the whole zip, and District 2 does cover Newbury). The right division is an Executive Council district, which this repo has no committed geometry for. Fixing it means either committing that layer or recording the contest against the state with a scope note.

**NJ08** — The other half of the 52. Fire districts, sewerage authorities and a power authority -- ROCKAWAY VALLEY REGIONAL SEWAGE AUTHORITY, five PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICTs, three MONTVILLE TOWNSHIP FIRE DISTRICTs, HANOVER TOWNSHIP FIRE DISTRICTs 2 and 3, PEQUANNOCK RIVER BASIN REGIONAL SEWERAGE AUTHORITY, NEW JERSEY PUBLIC POWER AUTHORITY, SOUTHEAST MORRIS COUNTY MUNICIPAL UTILITIES AUTHORITY, PEQUANNOCK-LINCOLN PARK-FAIRFIELD SEWERAGE AUTH, WANAQUE VALLEY REGIONAL SEWERAGE AUTHORITY, MUSCONETCONG SEWERAGE AUTHORITY. No TIGER polygon exists for any of them at any vintage, so no geometry pipeline will ever reach them. RULING 57 says a body is NAMED FIRST and hunted second, and that a body with no source and no site is still entered and still rendered. scripts/twig-pair.mts already has divisionlessBodyFor(), so the mechanism exists in one place and has not been generalised. Eleven of the eighteen publish a website, listed in the twig:pair output.

**NJ09** — Measured 2026-08-22, not assumed. Across all 272 Morris candidacies: contact 272 of 272, ballot slogan 70 of 272, campaign site 0 of 272, photo 0 of 272. Both of the fields that are held come from ONE route -- filing-county, one county-clerk PDF -- and that document carries no portrait, no prose about a candidate and no URL. So New Jersey's mechanical contact windfall is a property of that DOCUMENT and does not generalise to the other three fields. pnpm nj:fields walks a contest and reports per route; the Rockaway Borough Council four were walked (Burnside, McDonald, Dawkins Jr., Natale) and returned filing-county empty, campaign-site not walkable, domain-search one lead (patrickmcdonald.com, capped at a lead under RULING 68 because the identifier was guessed) and three empty. 86 of the 90 contests are unwalked, and no candidate anywhere has had the full named route list walked, so no absence has been earned for anybody in either zip.

**NJ11** — The wikipedia-municipality parser reads 39 of 39 Morris County municipalities and parses a roster for most of them. Jefferson Township and Pequannock Township return zero council members while their Local government sections plainly carry one, and both are Faulkner Act municipalities. Chatham Borough and Montville parse a roster but return no form-of-government string. These are parser seams rather than absences and must never be reported as absences about those bodies. The seams already found and fixed are written up in docs/zip-playbook.md section 8 - the roster sentence has no reliable lead-in so every sentence is scored, ref bodies must be masked before sentence splitting or every citation detaches, generational suffixes are not separators, and office titles are glued to names longest-first. These two are the next ones. The diagnostic is the headings array the parser returns on every record.

**NJ12** — Carries forward what NH71 recorded, minus what this session closed and plus what tiering revealed. CLOSED THIS SESSION: filing-campaign-finance-local (NJ ELEC) - the wall was on elec.nj.gov and the records are on njelecefilesearch.com at rung 2; 19 filed entities across the two 07866 municipalities with both controls clean. STILL OWED, with tier: lwv-questionnaire (Tier A) - onyourballot.vote411.org returned candidate-detail pages in search results last session and none has been opened, and it is the highest-value unwalked Tier A route left because one ballot page answers a whole contest. party-committee-roster (Tier A) - the Morris County Republican and Democratic committees publish slates and neither has been walked. filing-prior-candidacy (Tier A) - the manifest calls it the most under-used route in the list and it is under-used again. bar-directory and licensing-board (Tier C) - two candidates surfaced as attorneys through their firms' own sites and njcourts.gov has never been asked. records-request (Tier B) - rung 13, not reached. announcement-archive (Tier C). ad-library (Tier A) - NS01 is tabled by Sean and was not touched. press-outlet-map (Tier A) - the route was BUILT this session and its host list DERIVED from 726 distinct citation hosts, but the outlets' own site searches have not yet been queried.

**NJ13** — From the 8/22 walkthrough, NOT STARTED this session (no hunting was in scope). Morris County has solid representation data and most commissioners have no photo — the first-listed and one other have none, a third does. If one commissioner has an image the rest are findable by the same route. WHAT IS OWED: source photos for every official on that body through the four doors, then open ONE photo review row for Sean. Photos never block anything: every other field renders immediately, photos-first ordering is presentation and not a completeness gate (RULING 50), and a photo decision keys to the ASSET rather than the person — refusing a bad banner once withheld a good Senate portrait.

**NJ17** — Conceived and walked 2026-08-24. Every HTTPS campaign site has a TLS certificate and every certificate is in a public append-only log searchable by substring, so crt.sh is one of very few routes that searches the whole web by NAME without a search engine. The control is clean: an impossible substring returns HTTP 200 with []. Three of four live queries returned HTTP 502 from crt.sh's own nginx. That is a wall on those queries, not an absence of certificates. Re-walk on the RULING 53 clock.

**NJ18** — The press-outlet-wp-search route asks newjerseyglobe.com and morristowngreen.com their own /wp-json/wp/v2/search once per distinct surname — 258 surnames, 516 questions, control clean on both hosts. Those searches named 4,056 distinct articles. Harvesting them at a polite rate is several hours. pnpm hunt:sites now takes --max-pages so a run states BOTH numbers when it stops short, and the disk cache means every page already fetched is free on the next run. What is owed is finishing the harvest and mining it.

**NJ20** — After the sitemap branch, pnpm roster:hunt reaches a confirmed governing-body page on 17 of 39 municipal sites and 82 members. The other 22 report a FAILED extraction with candidate pages found and fetched — so DISCOVERY is no longer the binding constraint; EXTRACTION is. Each failure names the site and the pages tried. What is owed is reading a sample of those pages and naming the shapes lib/hunt/roster-page.ts cannot parse, as a class rather than one site at a time.

**HD06** — Three people are running for the Rockaway Township Board of Education and twelve things about them have never been looked for.

**HD14** — Two people are running for the Morris Hills regional school board's Rockaway Township seats and eight things about them have never been looked for.

**HD17** — Three people are running for United States Senator in New Jersey and six things about them have never been looked for.

**HD20** — Two people are running for the Morris County Board of Commissioners and five things about them have never been looked for.

**HD21** — Two people are running for Congress in New Jersey's 11th district and five things about them have never been looked for.

**HD25** — One person is running for the Rockaway Township school board's unexpired term and four things about them have never been looked for.

### P3

**NH107** — Promoting the rung-1 campaign-site leads turned up attorney bio pages for two Morris County candidates — chippersonlaw.com for Rita C. Chipperson and dawkinswarrington.com for Clifford D. Dawkins. Both were briefly and wrongly promoted as campaign sites by a first version of the evidence test, and both are correctly recorded as MISS for that field now: a law firm page is not evidence of a candidacy. But it IS a real find for a different field. The branch manifest already names the route — bar-directory, which it describes as reaching an office address and a direct line — and the manifest's own index says to try it first when a candidate is a lawyer. Nothing read these two pages for a phone or an address.

**NH114** — data/hunt/nj-morris-certified-winners.json holds 263 rows and some of them carry an office that is plainly not an office. Carolyn Dempsey's reads 'DEMPSEY', Robert Simpson's reads 'SIMPSON' - the surname landing in the office field - and several read null outright, among them Robert H. Conley, Howard Kritz, Maria Cote, Louis R. Maffei and James A. Lynch. The row count is right and the names are right, so every count over this file reconciles and reports success.

**NH57** — The welcome overlay offers four starting zips and labels 07866 'Rockaway Twp., NJ'. Two municipalities sit in that zip and the product now renders both, so the label names one of them and silently drops the other — for a Borough resident it is the wrong town.

**NH68** — Robert Strobel is a Board of Education candidate and strobelforschoolboard.com answered HTTP 200 to a plain fetch with no mention of his name anywhere in the HTML. That is the classic JavaScript-rendered page: a false miss at rung 2, not a wall and not an absence. The extractor recorded it EMPTY, which is honest about the fetch and wrong about the candidate.

**NH71** — The branch manifest names 41 routes. This session walked search-index, filing-county, body-roster-page, gov-staff-directory, campaign-site, campaign-social, candidate-platform, local-newspaper, web-archive and domain-search. The rest were not walked and each one's reason is recorded here rather than left as a silence, because a route nobody names is a route the next session rediscovers as new.

**NH74** — The township's own Township Council page shows `hmorrison@rockawaytownship.org` as Howard Morrison's address, and the link behind it targets `hkritz@rockawaytownship.org`. Howard Kritz held the seat before Morrison and appears in the Clerk's certified 2023 winners, so the mailto is a predecessor's mailbox the page never updated. We ship the DISPLAYED address, which is what the body publishes as his, and record the mismatch rather than silently preferring either. Worth telling the township: the link on their own page reaches the wrong person.

**NH76** — `corepack pnpm nj:winners` reads the Morris County Clerk's certified general-election winners: 263 people across three cycles, each with a party, a filed street address and usually an email, certified by the election authority. NJ Hunt 6 wired the PARTY from it for 98 sitting officials and used the email only as a fallback where the body's own page publishes none. What is owed is the rest: the filed addresses are unused, and the same document class exists for every New Jersey county and for the school-board and fire-district races the municipal walk does not reach.

**NJ04** — RULING 65's footer-address branch wired seven Sutton bodies on 2026-08-22, and three were deliberately left out because each has better evidence about itself than the town's footer has about it. Ad Hoc Speed Sign Committee: its own feed titles read 'Ad Hoc Speed Sign Committee - Zoom Mtg', so it meets on Zoom and pinning it at 93 Main Street would send a reader to an empty building; the playbook already records that a Zoom URL in LOCATION is a fact and not a building, and this is the same rule read from a title. Warner River Local Advisory Committee: its titles read 'WRLAC Mtg @ Pillsbury Library', a venue this session could not resolve to a coordinate, and it is a multi-town river committee so Sutton's town hall is a poor guess; the work is to resolve Pillsbury Library. Sutton Free Library Board of Trustees: its page states its own meeting arrangement, so it is a STATES A VENUE case. Each has four future sittings, two, and an unknown respectively.

**NJ10** — Read as an image on production 2026-08-22. With the zip-area widening in place the card at 07866 lists both municipalities, and the Borough's row reads "Rockaway  MUNICIPAL" while the Township's reads "Rockaway township  MUNICIPAL". A reader cannot tell which is which, which is the exact confusion RULING 71 exists to remove -- borough and township are coequal forms and these are two separate governments sharing a name. The label comes from the division's own name in the registry, which for the place layer is the Census's "Rockaway" for the CDP-style entry. The fix is a labelling decision about which of the two committed names a row shows, and it wants a look at the other states before it is made.

**NJ14** — Of the 07866 ballot's 272 candidacies, 235 resolved to an ELEC location and 37 did not. Fifteen of the 37 are correctly out of scope: US Senate and two congressional districts file with the FEC, and the state-level contest files elsewhere. The rest are REGIONAL SCHOOL DISTRICTS — West Morris Regional, Morris Hills Regional, Hanover Park Regional — plus Long Hill Township and Parsippany-Troy Hills, whose names did not resolve against the ELEC dropdown under any of the six municipal suffixes tried.

**NJ19** — The certified-winners sweep names Washington Township among the 17 dark municipalities, and it is absent from both data/hunt/nj-morris-municipal-sites.json (30 rows) and data/hunt/muni-sites-nj-morris.json (39 rows). The state's own directory at nj.gov/nj/gov/county/localgov.shtml names it as wtmorris.org, read 2026-08-24. That host answers rung 3 with a 1,331-byte Sucuri CloudProxy JavaScript challenge titled 'You are being redirected...', so rung 6 is owed. The same directory lists four different Washington Townships across four counties, so the Morris one must be identified by its position in the county section rather than by name — the Boonton / Boonton Township problem this project has already paid for once.

**NJ21** — A finding rather than a defect, recorded because it decides how symmetry is kept. The Morris County Democratic Committee publishes an index of its 39 municipal committees linking 22 distinct municipal committee websites, reachable in one request through its own WordPress REST API. The Morris County Republican Committee publishes no municipal committee index at all — 25 pages in its sitemap, 8 of which name somebody on this ballot, and no outbound link on any of them survives the campaign-site filter. This is RULING 60's sub-branch rule arriving inside one county rather than across states: a route proven on one party's site is proven for that PUBLISHER, not for the office. The session's answer was to turn the shape the Democratic index revealed into a guessed-domain route applied to both parties with the same patterns and the same number of guesses each.

## Arizona hunt

Everything owed to a reader in Arizona — Vail (85641) and downtown Tucson (85701) first.

**16 open · 0 resolved.**

### P2

**AZ01** — NOT STARTED this session. AZ-1: "Know the basics" needs more topics — hunting and fishing ("Am I allowed to hunt or fish?", a common question when somebody moves states) and state abortion law. Both contentious, which is exactly why a clear factual account of where the state stands is owed: state what the law is, cite it, take no position. AZ-2: the state comparison holds one comparison at a time, which is right, but Back returns to Arizona alone when the expected destination is the map — either a reset pill or state pills in the title bar, with deselecting a state dropping it from the comparison, and the same pill pattern on the ballot. AZ-3 (applies across the board, Arizona is only the example): the voting section is five separate items — next election, add to calendar, check registration, where can I vote, search the Secretary of State's tool — and should read as next election, 2026, early voting, with the rest of the noise cut. AZ-4 and AZ-5 (ruled together): three links to the same registration destination inside about ten lines deduplicate to ONE prominent pill, "Check whether you're registered to vote", pointing at the reader's Secretary of State; same pattern for polling location. The Secretary of State is the only authoritative source for either, and a reader who trusts an in-app answer and does not check loses their vote. AZ-6 is positive: the federal-representative pill system works and stays.

**AZ02** — POST https://seethemoney.az.gov/Reporting/GetNEWTableData answers HTTP 200. Posted with a guessed body it returns a two-byte empty payload, which is a statement about our request rather than about Arizona's records. The sibling name GetDetailedTableData is a 404, so the endpoint name is exact. robots.txt is 404 and there is no terms-of-use page at the guessed path — both recorded as measurements rather than as permissions.

**NH37** — Every Arizona officeholder's stored page URL carries a legislature number, and 67 of the 90 carry one that is not the current session: 5 at legislature 54, 23 at 55 and 39 at 56. Two of them surfaced as MISS-GENERIC in the officials audit - Rachel Keshel and Rosanna Gabaldon - and the rest are latent, waiting for their seat to be wired to a district.

**NH83** — Carried forward unchanged from AZ01. The 2026-08-23 session did not reach Arizona. Read as an image from the 8/22 capture of the ballot near 85701, the registration destination appears three times inside about ten lines: Check whether you're registered to vote as an inline link, the Secretary of State's own tool named beneath it, and a third box below the card repeating Check whether you're registered to vote. They deduplicate to ONE prominent pill pointing at the reader's Secretary of State, and the same pattern applies to polling location. The Secretary of State is the only authoritative source for either, and a reader who trusts an in-app answer and does not check loses their vote. AZ-1 also still needs hunting and fishing and state abortion law in Know the basics, both written to the plain-language register with the law stated, its source named and a fetch date, and no position taken.

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

**5 open · 39 resolved.**

### P1

**F01** — Sean's full walk of the product on 2026-08-18, forty-odd findings across cards, meeting order, votes, the ask box, the ballot and the map. The parent row that keeps the whole batch together; the individual findings became their own rows.

### P2

**NH163** — Sean's 8/24 walkthrough of the app, recorded as sixteen captures between 11:54 and 12:27. Every id was built and verified against a local production build in the visual-0824 session, with the captures read as images. Opened as ONE row because they were worked as one item list and share one verification pass; the per-id endings are on the Session record and in the session's close-out. Kept open only until Sean has looked at the result — the work itself is done and the gates are green.

**VF05** — Five issues, NOT STARTED this session. MTG-1: the "Governs your area" pill overlaps the next meeting date in the meetings box. MTG-2: Meetings, then Rockaway Township Municipal / Township Council, opens MULTIPLE pop-ups at once — it should open the large battlecard for that specific meeting, one surface. MTG-3: the large meeting battlecard's location is not clickable and has no Add to Calendar; Add to Calendar exists under Meetings but Meetings has no directions. Directions and Add to Calendar must both be available from Overview and from Meetings. MTG-4 (ruled): assume the venue is missing from created calendar events and build it so the event carries the venue in the location field alongside date and time — a no-op if it already works. MTG-5: "Make Your Voice Heard" renders fully expanded and the reader scrolls past all of it to reach the next meeting; it becomes a collapsed drop-down with the content kept verbatim.

**M92** — Bodies and districts on the map still click straight out to a website. Sean and the tester both wanted a card that tells you about the thing first, with the website as one of the things on it.

### P3

**VF01** — Read as an image on production f20e1e9 at 430x932. On the map's who-governs card the pill sits inline in each body row, between the body name and the type label. At phone width that squeezes the name into two and three lines - Rockaway Township School District wraps to three, Denville Township School District to three - and the pill itself wraps to two or three lines beside them. Every word is legible and the classification is correct; the row is simply cramped, and six of eight rows carry it at this zip. The pill reads well on the ballot page, where it wraps under a wide heading rather than competing with a narrow column. Worth a look at whether it belongs under the row rather than inside it on narrow viewports, or whether the type label should move.

## Data infrastructure

Sources, ingest, denominators, extraction, crawlers. The machinery that turns a public record into a row.

**75 open · 102 resolved.**

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

**NH110** — walk:all against production on 2026-08-23, deploy 6a8ba907304b640008d06090, reports one regression: lib/db/migrations/0016_known_cerebro.sql is in the tree and has not been applied to the live database. It creates three tables and nothing else - questionnaire_invitations, questionnaire_responses and questionnaire_tokens - with no ALTER and no DROP, so it touches no existing data. It arrived with the questionnaire stack merged in 9399a69. NO READER IS AFFECTED TODAY: nothing has been sent, all 272 invitations carry invitedOn null, and the route catches the failed insert and still serves the page. It becomes blocking the moment a candidate can submit an answer, because the answer would have nowhere to land.

**NH140** — Found while building the A-002 conservation contract. In boardbook, civicplus, diligent, clerksboards and legistar the counter TALLIES an online-only meeting that is then kept per D18; in iqm2 and revize the same field is a real drop with a continue behind it. One field name, two meanings, in a shared type. Conservation works around it with a declared countedButProduced term; the real fix is moving the kept-tally out of the drop counts.

**NH27** — Springfield is one of Kearsarge seven member towns and had no bodies in this registry at all. Eight are now enumerated and recorded KNOWN_UNCOVERED. They are not wired because the town iCal export is capped at the OLDEST 50 events and stops at 2024-11-07 - six different views all return the identical stale document and the plugin REST API answers 404. The town has NOT stopped meeting: its own front page links events/cemetery-trustees-meeting-2026-08-11 and events/conservation-commission-meeting-2026-09-03 [expected-future: the town's own published meeting date, read 2026-08-21]. The live meetings are in the HTML, and no adapter here reads that shape for this town yet. Wiring to the stale feed would have shipped eight bodies rendering as having no meetings while the town publishes them.

**NH28** — Springfield was found by probing six conventional iCal paths against the town host - one request, and a town that had been dark since the registry was built produced eight named governing bodies. The same probe was run against Bradford, New London, Warner and Newbury; only Springfield and Newbury answered. Sutton at www.sutton-nh.gov does not resolve at all and needs its real host found. The remaining towns need the OTHER branches walked - vendor portals, board pages, minutes archives - rather than the conclusion that they publish nothing. Six of seven member towns were dark and this session moved one of them.

**NH29** — Springfield NH went from zero bodies in the registry to eight enumerated and the gap ledger is byte-identical at 22383 bytes before and after. The ledger measures special-district coverage against the Census of Governments, which is right and is not the whole of coverage: RULING 9 says the Census counts GOVERNMENTS and the product renders BODIES, and a New Hampshire town is one government and a dozen or more bodies. So the instrument that is supposed to say how covered a place is cannot see the unit the product actually renders. Six of Kearsarge seven member towns are dark at the body level and nothing measures that. This is a defect in the instrument rather than a gap in coverage, which is why it is a row and not a ledger entry.

**NH46** — One of the three coverageNotes in data/ballot/nh-merrimack-2026.json ends with a paragraph of internal record-keeping that reaches a reader on the ballot page: 'CORRECTED 2026-08-21 under RULING 52: this note used to end ... That was true when it was written on 2026-08-14 and is FALSE now - re-walked 2026-08-21, gc.nh.gov answers a plain rung-2 fetch at HTTP 200. A wall is recorded with the date it was last tested...'

**NH75** — Playwright's extraHTTPHeaders applies to EVERY request a context makes, third parties included. MapTiler's CORS preflight does not allow x-wtp-synthetic-run, so the basemap style request was refused in every capture and every walk. That is why NJ Hunt 5's captures showed BASEMAP UNAVAILABLE against a production site serving readers a working map. Fixed at the shared path in scripts/browser.mts. This row is open for the QUESTION IT RAISES rather than the fix: what else has an instrument of ours been breaking while measuring it? The shape - a synthetic marker leaking into a third-party request - is worth sweeping for beyond the browser.

**NH79** — pnpm dupes reads 2114 function bodies across 806 files and finds 26 groups where the same logic lives in more than one file. Two were consolidated on 2026-08-23: four copies of the outbound User-Agent, which CLAUDE.md makes law, and two of the person-name normaliser, one of which sat inside the tool that CHECKS whether the same person is shown twice - so the audit was using a different definition of a person from the resolver it audits. The other 24 are recorded in tests/duplicate-implementations.json with a disposition and a reason each. Six are ALLOWED for reasons that hold: the two intake key paths must stay unable to converge because the stores may never join, React context accessors are three identical lines by construction, and the .mjs date helper cannot import TypeScript because the pre-commit hook runs without tsx. Eighteen are OWED. The guard fails on a NEW group, so the class cannot grow while the backlog is worked, and the baseline only shrinks. The heaviest three: six byte-identical useSyncExternalStore subscribe callbacks across the hooks, four separate CSV parsers with the tracker stores downstream of two of them, and - the worst of the set - tests/district-hits.test.ts carrying its own copies of inRing, inPolygon and contains, so the test that checks point-in-district geometry proves its own copy works and says nothing at all about the shipped one.

**NJ03** — lib/sources/http.ts gives the Cloudflare interstitial signature a 20 KB maxBytes floor, with a comment explaining exactly why: Cloudflare injects its challenge-platform script into ORDINARY pages, so reading the marker at any size would mark a working source refused. The Imperva/Incapsula signature has no such floor, and Imperva injects _Incapsula_Resource script tags into ordinary served pages in the same way. Swept on 2026-08-22 with git grep -a --untracked: no committed fixture currently carries the marker in a real page, so this is a LATENT risk and not a live defect, which is why it is a row rather than an edit. Diagnose before fixing applies with force here — changing a challenge detector without evidence would risk the opposite failure, a real wall read as a page. What would settle it is a recorded fixture of a large Imperva-fronted page that is genuinely served, which www.nj.gov can supply.

**NJ16** — Measured 2026-08-24 with pnpm search:rung. Mojeek, Brave, Ecosia, Startpage and Bing all Disallow: /search in their own robots.txt, so they are not walked at any rung. html.duckduckgo.com and lite.duckduckgo.com publish Allow: / and answer HTTP 202 with a challenge page at rungs 2 and 3; rung 6, a live browser with JavaScript executed, renders the sentence 'Unfortunately, bots use DuckDuckGo too.' This is a WALL and no field moves toward absence on it. It matters because two of the five moves of the stuck protocol are literally 'type this into a search box', so an argued absence cannot be earned through that move today. The compliant routes that replaced it are in docs/sources.md.

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

**NH102** — Found 2026-08-23 walking unitedstates/images at commit aec3e4a88af843b282c0576f420b930f6a9a46ad. H001104 Jon Husted, A000383 Alan Armstrong and G000608 Darline Graham are sitting members and the GPO pictorial-directory corpus carries no file for any of them. This is a FINDING about that corpus on that date, not an absence of a photograph: the photo rule's doors 2, 3 and 4 are unwalked for these three, and RULING 53 puts the corpus itself on a 14-day re-walk. NOT a gap-ledger row because it names three PEOPLE and a route, not a body's coverage.

**NH117** — pnpm bodies:spanning, built 2026-08-24 for RULING 121, finds bodies carrying the same name under more than one division. Two were merged this session because Sean ruled on them by name - Lake Todd Village District and the New London-Springfield Water System Precinct. Ten more share a name and have NOT been merged, because a shared name is not proof of a shared body: a Master Plan Committee in Wilmot and one in Grantham are almost certainly two committees, not one.

**NH16** — Bradford, New Hampshire publishes every agenda and minute set on a vendor platform this product has never seen. Its own town website carries no boards index and no calendar, so the vendor is the only route to the town's meetings.

**NH17** — The consolidated miss list says newbury.nh.gov/sitemap.xml is a 403 and that robots declares none. It answers HTTP 200 at 43,484 bytes. A sitemap is the discovery rung for every page on a site, and this one has been closed to us on a stale reading.

**NH39** — James Gallagher, a U.S. Representative sworn in on 2026-06-10, has no websiteUrl at all - the congress-legislators dataset this registry reads has not yet published his House page. Kate Murray is the one New Hampshire officeholder pnpm nh:fix-pages could not repair, because she is not on the General Court's current roster; a former member's page is the archive's hunt.

**NH40** — cfs.sos.nh.gov holds first-party contact details for every New Hampshire candidate who registered a committee, and it refuses rungs 2, 3, 4 and 6 with an Akamai 403 - headless Chromium, a real Chrome channel and a masked user agent alike. A visible browser on the same machine and the same IP gets HTTP 200. It was harvested by hand this session through the app's own XHR at rung 7, which is a procedure and not a script, so nothing in CI can repeat it.

**NH42** — pnpm twig:pair reports 48 government units inside 03255's first-rung circle, 28 with a body in this registry and 20 without. Seven of the twenty are not missing a body so much as missing a DIVISION: Sullivan County itself, and the towns of Lempster, Croydon, Newport, Windsor, Acworth and Grantham are not in the shipped division list at all, so no body could be attached to them.

**NH53** — The walker covers 7 of the 36 manifest routes mechanically. Per field that leaves 4 of 7 photo routes, 8 of 10 blurb, 29 of 35 contact, 10 of 14 campaign site and 6 of 8 verified page needing a person — reported by name on every run, never counted as walked. Each route automated is a whole class of candidate the manifest can be exhausted against without a session reading pages one at a time.

**NH54** — A statewide New Hampshire candidate-and-results database exists at electiondatabase.nhpr.org and nh.electionstats.com. Every /candidates/view/<Name> URL from the search index returns the SPA's 404 shell — 41,148 bytes, identical for a known-good name — and rung 6 confirms a genuine 'Page Not Found'. The path has moved. It would serve many candidates at once if found: prior candidacies, districts, and results.

**NH70** — New Jersey has two places named Silver Lake, Census GEOIDs 3467590 and 3467650, and placeIdentity keys on state plus name, so both slug to state:nj/place:silver_lake. The widened geometry clip surfaced it and the build refused to write, correctly - a duplicate join key is a join that collapses. It is fixed for the build by suffixing EVERY side of a collision with its Census GEOID, and the underlying identifier convention is still not unique.

**NH87** — RULING 107's wider sweep found this and it is the one site of 31 that is a real restamp rather than a reading path. scripts/ship-staged-portraits.mts writes collectedAt: new Date() on every portrait it commits (lines ~175 and ~193), but the collection happened earlier, when the portrait was STAGED from Wikimedia Commons. The ship step is not the read. It cannot be fixed where it stands, because the staged ResultRow carries no collection date to carry forward - so the fix is in the STAGING step, which has to start recording one, and then the ship step carries it rather than minting. Until then the provenance date on every Commons portrait is the day somebody ran the shipper. Pinned in tests/freshness-provenance.test.ts as the single entry of KNOWN_UNDECLARED, a baseline that may only shrink; run pnpm freshness:audit --all to see it.

**NH95** — pnpm schools:classify reaches 510 of 514 rendered districts across five one-to-one branches, up from 295 of 514. The four it does not reach are named on every run and each was read by hand against the committed Census files: AZ Indian Oasis-Baboquivari Unified District, which the 2022 Census of Governments spells BABOQUIVARA; AZ Tonto Basin Elementary District, which the Census calls TONTO SCHOOL DISTRICT 33; AZ Union Elementary District, whose whole distinctive name is the word Union — a structural word in every district name in the country, so it cannot be keyed; and NH Prospect Mountain High School Joint Maintenance Agreement District, which is not in the 2022 Census of Governments at all and is therefore RULING 57's two-enumerations-disagree finding rather than a miss. None of the four renders a refusal: they carry the unclassified-school class definition, which describes what a school system is and names the open question rather than asserting who governs the schools. WHAT WOULD CLOSE IT: a hand-evidenced alias table, which needs a source a session can cite for each pairing — NCES state_leaid does not decode to the Census district number, so the join has to come from somewhere with network.

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

**26 open · 140 resolved.**

### P1

**P02** — Mapping candidates' stated positions onto the issues on a reader's ballot, every one carrying its source. Never a score, never a ranking — the positions side by side and the reader deciding.

  Waiting on candidate info (D05).

### P2

**NH104** — Opened 2026-08-23 by the session that built the instrument. WHAT EXISTS: the versioned five-question instrument (lib/questionnaire/instrument.ts, docs/candidate-questionnaire.md), the office-class classifier, the response record with versioning and withdrawal, the single-use token auth, the three Positions empty states wired into the battlecard, the Drizzle schema and migration 0016, and 272 of 272 generated invitations. WHAT DOES NOT EXIST: (a) the reader-facing page a candidate opens their link on and types into, with the word-limit check shown as they type; (b) the send path - and per RULING 107 it must stamp invitedOn AS IT SENDS, never from the plan, because the Positions empty state reads exactly that field to decide whether to tell a reader we asked; (c) the reminder job on the two planned dates; (d) the read path joining a stored response onto the battlecard Positions section. NOTHING may be sent until the Needs Sean row approving the message is answered.

**NH58** — When map tiles do not load, the reader-facing panel reads: 'BASEMAP UNAVAILABLE — Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use'. An environment-variable name and a source file path are internal identifiers and may not render outside a technical-details disclosure.

**NH61** — RULING 70. Ballotpedia's Candidate Connection works because candidates volunteer answers and identity is verified before publication. The mechanism is not licensed and is worth more than the content: a questionnaire on this product's own site is original data with no licence, no copyleft and no dependency, and it is symmetric by construction because every candidate in a contest gets the same invitation and the same questions.

**PU01** — Read as an image on production 2026-08-22 at 430x932. The map at 07866 shows a panel reading "BASEMAP UNAVAILABLE -- Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use". That is an environment variable name and a dotfile path rendered to a reader, which the plain-language rule forbids outside a technical-details disclosure: identifiers, enum values and internal keys never render to a reader. The honest half of the message -- that tiles did not load and pins still work -- is right and should stay. Two questions for whoever takes it: whether the key is simply unset on the production deploy (in which case the message is doing its job for the wrong audience), and what a reader should see instead.

**PU03** — NOT STARTED this session. ASK-1: "When is the next meeting?" returns "Where to look: Meetings near you" and explains that the map shows collected meetings, with nothing to click. Give the reader a control right there, tappable on mobile. NH-3: "When does school start again?" returns "we don't have a sourced answer for who owns this topic yet" — the school district owns this and it must be routed. THE STANDARD FOR BOTH is NH-2, which Sean called out as the thing to replicate: coverage disclosure with denominators (35 agendas read, 9 more held but unreadable and therefore excluded), honest gaps, the relevant record surfaced, and a NAMED HUMAN with a phone number and an email. He called the contact details the best part.

**PU05** — The 8/22 brief said to fetch the Census ZCTA-to-congressional-district relationship file — free, keyless, national. MEASURED 2026-08-23: NO SUCH FILE EXISTS for the current Congress, and four Census directories were walked to establish it. rel2020/zcta520/ holds six files and none of them is CD. rel/ holds only zcta_cd111_rel_10.txt, the 111th Congress with 2010 ZCTAs — two rounds of redistricting stale. rel2022/ and rel2024/ hold Connecticut-only files. baf2020/'s CD assignment file is dated 2020-12-11 (116th) and baf/'s is dated 2011-01-21. WHAT IS OWED, and the machinery for it already exists: scripts/build-zip-governments.mts samples every ZCTA on a 0.01-degree lattice against TIGER cartographic boundary layers and has been verified across all 33,791 zips. Adding a cd layer to its LAYERS list gives per-zip congressional-district sample counts nationally, and the existing partial-versus-whole arithmetic then answers "one district or more than one" for every zip in the country by exactly the method the who-governs pill already trusts. 07866 itself is settled independently: it sits entirely within NJ-11, confirmed against the House zip lookup.

**M75** — On a phone, the map's legend crosses the bottom of an open meeting panel and covers the text underneath it.

**P03** — The one-tap yes or no, with an optional free-text answer, asked after the explanation and attached to a specific provision or a specific sourced position. This is the revenue path.

### P3

**AUD09** — The animation that flies the map to a state has no agreed speed budget, so nothing can tell whether a change made it slower.

**B18** — Sean asked for federal officials' town halls. There is no authoritative feed for them anywhere, so this row records what was checked and what it found rather than pretending a build is waiting.

**M13** — The radius control broke twice — once blanking results, once refusing to switch off — and both times the tests only covered the logic underneath, not the control a reader touches.

**NH141** — Found by the A-007 sweep for catch-return-valid shapes. lib map districts.ts returns an empty array when queryRenderedFeatures throws, so an exception is indistinguishable from a viewport with no districts in it. Nine other sites of the same shape were assessed and fail closed; this one does not, and how it should behave is a visual decision.

**NH167** — LAY-4 puts Who Governs Here and the meetings count in a floating region beneath the rail, and both live in one fixed flex column so they cannot overlap at any viewport. At 1440x900 the rail wants 662px and the who-governs card wants 350px or more against 876px of column, so they do not both fit and something is always scrolling. The rail is capped at 58% of the column: at 70% the card had 100px, less than its own header. Both scroll internally so nothing is unreachable either way, and WGH-6 is the real answer - clicking Who Governs Here minimizes the rail and the card takes the whole column. The number decides what a reader sees BEFORE they choose, and it is the kind of call worth looking at on a real screen.

**NH168** — MTG-6 titles a venue card with the body and MTG-7 puts the sitting's own name on the entry beneath. Where a source publishes a DIFFERENT bodyName per sitting - Tucson Unified does, with names like GOVERNING BOARD AGENDA SPECIAL MEETING - the entry carries something distinct and it reads well. Where a source publishes ONE name for every sitting, as Tucson Parks and Recreation does, the entry repeats the card title. Sean's own reference capture 12-01-44 shows the same repetition and he marked only the jurisdiction prefix, so nothing was changed here. Worth a look on a real card: the honest options are to drop the entry title where it equals the card title, or to leave it as the anchor for the date and the agenda link.

**NH62** — Recorded so no future session re-derives Ballotpedia as an available branch and starts building one.

**PU06** — Measured 2026-08-23 at 07866 against a local production build: TWELVE instances across NINE contests on /ballot, unchanged by this session. The MAP panel was fixed — six rows each carrying the full sentence became six asterisks and ONE pill, read as an image — but the ballot page renders the pill per contest heading, which RULING 28 permits and which Sean nonetheless called the headline UX problem of the New Jersey pass. WHAT IS OWED: decide whether the ballot page takes the same treatment (one page-level pill, marks on the affected contests) and, wherever the sentence survives, make it one clear deliberate annotation, bolder and more explicit than the current small text. It is not a completeness statement and it never gates a page.

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

**13 open · 69 resolved.**

### P1

**NH106** — Established 2026-08-23 by asking GitHub directly, because gh is absent from this container and corepack pnpm main:green therefore answers CANNOT TELL - which is the correct fourth verdict and says nothing about main. main's tip 3d453fd (the merge of PR #162, a HUMAN commit rather than the NH85 bot-tip shape) FAILED build check, run 32664443326, at 2026-08-23T20:30:04Z. IT IS NOT THE RULING 81 SHAPE: 19 steps ran and the Test step ran for 81 seconds before failing, so the runner started and the tree was really tested. Lint passed, tsc passed, and BOTH build jobs passed - only the gates job is red. THE CAUSE IS ONE THING, FOUR TIMES: tests 1853, pass 1848, fail 4, skip 1, and every one of the four is 'NO CHROMIUM INSTALLED. Wanted build 1234; searched /home/runner/.cache/ms-playwright.' - three in tests/beacon-guard.test.ts and one in tests/chromium-pin.test.ts. The workflow's 'Install the browser the suite needs' step (corepack pnpm exec playwright install --with-deps chromium) reported SUCCESS in 27 seconds and left nothing the suite can find. So the step's success is not evidence a browser exists, which is the same shape as a 200 that is not a document. WHY NO FIX WAS PUSHED. It reproduces identically on the base branch, so it is not any diff's failure and a session cannot verify a CI-only change from a container with no way to run CI. The one 'fix' available locally would be to let the guard pass with no browser, and scripts/browser.mts says in as many words that nothing here may report a pass - softening it would delete the guard rather than repair the runner. WHAT IS OWED: read the install step's own log for run 32664443326 (it is not in the tail this session could fetch), and decide between pinning the Playwright version the image can actually serve, caching ~/.cache/ms-playwright, or asserting the executable exists as its own workflow step so a silent no-op install fails where it happens rather than eighty seconds later inside the suite. RELATED BUT DIFFERENT: NH96 is the same class in the SESSION CONTAINER, where a substituted Chromium 1194 makes the same test report CANNOT RUN by name rather than fail. Locally the suite is 1947 / 1946 pass / 0 fail / 1 skipped. On the runner it is 4 failures. Same pin, two environments, two different answers.

### P2

**NH103** — Found 2026-08-23 writing the first test that imports lib/officials/body-definitions.ts at RUNTIME rather than reading it as text. Two separate ESM defects were in the chain and both were invisible because nothing had ever imported that file under node --test. (1) body-definitions.ts and lib/registry/census-school-systems.ts used EXTENSIONLESS relative imports, which Next's bundler tolerates and Node's ESM loader refuses - FIXED this session, 3 sites. (2) school-dependency.ts still imports data/derived/school-district-dependency.json with no `with { type: json }` attribute, so ERR_IMPORT_ATTRIBUTE_MISSING. WORKED AROUND rather than fixed: lib/officials/body-form.ts takes the dependency as a PARAMETER instead of importing it. WHAT IS OWED: decide whether to add the import attribute (verify the Next build accepts it first) or to move the JSON read behind a function. Until then any new test importing that module transitively fails, and the failure names the JSON rather than the cause. THE CLASS, swept: 3 extensionless relative imports under lib/**/*.ts, all fixed; 10 more under components/**/*.tsx and lib/state/*.tsx are OUT OF SCOPE with the reason - they are React components reached only through the bundler and never imported by node --test.

**NH139** — The external audit of ae5b178 read 50 files of an unestablished denominator and did not perform Phase 2, the Drive consistency check. Neither number is known. A second pass owes both: the denominator of files that exist and should have been read, and the Drive comparison that was never run.

**NH47** — pnpm test reported 1561 passing, 0 failing, while EIGHT guard tests had stopped running entirely. A deleted test and a passing test are indistinguishable in that output; the only instrument that can see the difference is the COUNT, and nothing checks it.

**NH69** — Every tracker run this session ended with THE WORKBOOK IS STALE and exit code 3: docs/tracker.xlsx is locked (docs/~$tracker.xlsx exists, which is Excel's own lock file). The two CSV stores are authoritative and were written correctly, and docs/tracker.md and docs/log.md regenerated from them - but the workbook Sean edits is showing the tracker as it was before this session, and saving it would write those older rows back over the stores.

**NH85** — RULING 75's third part asks GitHub rather than the working tree, and the four verdicts it keeps apart are green, red, pending and could-not-tell. Measured on 2026-08-23: both of this session's commits to main are GREEN on GitHub - d0f2831 carries build default, build standalone and the gates, and e83db50 carries those plus the tripwire. But main's TIP was 7112307, an intake-tripwire[bot] commit pushed minutes later, and no check has ever been registered against it. So main:green exits 2 with CANNOT TELL on a healthy tree, and it did the same on 750e094 at the start of this session. Seven workflows push main daily, so the tip is a bot commit far more often than it is a human one, and a gate that reads could-not-tell as its normal answer is a gate a session learns to walk past. What is owed is a decision about the shape rather than a patch: either the scheduled workflows' pushes to main run build check too, or main:green reports on the newest commit that HAS a check and says how many bot commits sit above it. The second keeps the Actions budget RULING 78 protects; the first is stricter. Nothing is broken today and the distinction between the four verdicts must not be softened to make this go away.

**NH96** — NH91 is closed: playwright is pinned to an exact version, EXPECTED_CHROMIUM_REVISION is committed in lib/ops/chromium-pin.ts and checked against playwright's own browsers.json, and scripts/browser.mts launches whatever complete Chromium the image has by explicit path while NAMING the substitution. Two of the three tests that could not run now run and pass on build 1194. THE THIRD CANNOT, and it is a real finding rather than a harness problem: the plant that proves the guard can fail asserts that an unload-time sendBeacon escapes extraHTTPHeaders, and on Chromium 1194 the headers DO reach it, so the beacon arrives declared. That is a measurement of build 1194 and says nothing about the pinned 1234, so the test reports CANNOT RUN with the substituted build named rather than asserting either way. WHAT WOULD CLOSE IT: the container image carrying the pinned build, at which point the plant runs against the browser it was written for. Nothing in the repo can fix it — this is a fact about the image.

**PB07** — Four of the five scheduled jobs run the full test suite before they push. The fifth does not, so a broken document can reach the repository unchallenged.

### P3

**NH86** — Measured 2026-08-23. corepack pnpm closeout fails its build gate with "pnpm build refused (exit 1)" and no TS diagnostic, while the same build run on its own exits 0; pnpm closeout passes the gate in 9 seconds. This is the same failure already recorded for pnpm handoff --ship, one script later: close-out.mjs shells out to pnpm run build, and through corepack that inner call cannot run. The gate is honest about it - it refuses rather than passing - which is exactly the four-verdict discipline working, and it still cost a debugging round because nothing in the repo says so at the point of use. What is owed is small: close-out.mjs and handoff.mjs should detect a corepack-shimmed parent and say which command to run instead, rather than reporting a build refusal that is really an environment refusal. A note in CLAUDE.md's Commands section would do at a minimum.

**PD02** — The local development database is eight migrations behind production, so nothing can be tried locally against the real schema.

**PD05** — The production walk creates rows under two different run labels and then counts only one of them, so it under-reports how many rows it wrote.

**PE02** — The short summary file generated at the end of every session still reads the frozen pre-rebuild tracker, so it reports a priority count on a scale that no longer exists. Nothing a reader sees is affected; the next session opens on a number that means nothing.

**RO02** — Found 2026-08-23 while running the gates. pnpm exec node scripts/check-lint-allowlist.mjs refused with five unlisted warnings, and stashing every change in this session proved all five were already on main: scripts/guard-history.mjs (unused sep), scripts/tier-directory.mts (unused readFileSync), and three in tests/coverage.test.ts. All five were unused imports or an unused local and all five are fixed here. THE ROW IS FOR THE SHAPE, not the fix: this check is not part of build-check.yml, so a gate that a session is expected to run by hand had been red for an unknown number of sessions with nothing reporting it. Worth deciding whether it joins the CI gate or the handoff gate, remembering RULING 78 — a gate that runs three times for one merge is one gate and two copies of it.

---

Every row also carries who opened it, the technical detail, and the full session
record. Those are in the spreadsheet and are left out here on purpose: this file
answers what is left, and the spreadsheet answers everything else.
