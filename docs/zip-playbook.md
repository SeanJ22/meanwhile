# The zip playbook

**What "done" means for a zip code, and how to get there.** Born 2026-08-15
(the NH/NJ depth session), tracker **R13**.

This document exists because the same work was being re-derived every session.
A place is not covered because somebody worked on it; it is covered when a
list of checkable things is true of it. That list is section 1. Everything
after it is the how.

## The preamble the author wrote first

**The rungs written here are the rungs discovered so far.** Every new state is
presumed to teach new ones — a filing system nobody has seen, a vendor nobody
has met, a wall that opens from an angle nobody tried. **Discovering and
recording a rung is the work, not a deviation from it.** A session that spent
two hours learning that a state publishes its certified results as `.xls`
behind an Akamai wall and wrote none of it down has spent the discovery and
kept nothing.

**This file is APPEND-ONLY.** A rung that stops working gets a dated note
beside it — never a deletion. The next state may hit the same wall from a
different side, and the record of what failed is half the map. (`sos.nh.gov`'s
browser-UA rung worked on 2026-08-13 and had closed by 2026-08-14; both facts
are load-bearing and both are still written down.)

**Every zip or depth run ends with a playbook diff** — what was added — or an
explicit "nothing new," stated in the standing report. That rule is in
`CLAUDE.md` and it is permanent.

## 1. The definition of done for a zip

Machine-checkable where it can be, named-and-dated where it cannot. A zip is
done when every line is true or its exception is recorded with rungs.

| # | Check | How it is verified |
|---|---|---|
| 1 | **The who-governs set is complete against the official universe** | `docs/coverage-audit-by-county.md` — Census of Governments as the denominator, never our own registry (CLAUDE.md). The county audit answers "do we know all the bodies?" |
| 2 | **Every body governing the point is ingested, or its miss carries rungs** | `pnpm census:zip <zip>` prints INGESTED / NOT-INGESTED / NOT-ATTEMPTED per body with the vendor named. There is no "blocked". |
| 3 | **Officials to the Kelly standard** | Every seat on every wired body has a named holder with a source; party from a certified record or null; term note from the body's own page. `pnpm officials:audit`. |
| 4 | **Photos per the four doors** | Every roster member either has a portrait recording which door it shipped through, or honest initials with the doors tried recorded. `docs/photo-report.md`. |
| 5 | **Meetings live, or honestly absent with a denominator** | The snapshot carries meetings for every wired body; every adapter states fetched/normalized/dropped. A jurisdiction with no upcoming sitting says why. |
| 6 | **Ballot with plain-language summaries** | Contests, candidates and measures for the next election, each analysis sourced and rendered verbatim. |
| 7 | **Funding** | FEC committee + contributor surfaces where a federal candidate is on the ballot, behind the named ripcords. |
| 8 | **Ask-box topics resolve to this jurisdiction** | Every everyday-topic route lands on a body that actually governs the point — never another state's (the M53 contamination class). |
| 9 | **A stranger can read it** | The stranger test: no assumed local knowledge, every office explained, every body peopled. Walked at 390×844. |
| 10 | **Misses carry rungs, per candidate and per body** | `docs/source-ladder.md` + `lib/registry/coverage-audit.ts`. Equal effort per candidate within a race is a hard rule, not a target. |

## 1a. NEW HAMPSHIRE PRODUCES A DRAFT, NOT A FINISHED PLAYBOOK

(Added 2026-08-20, the NH Hunt, and it is a warning about this document's own
first state.)

Everything in §3 dated 2026-08-20 was learned at 03255 — the Town of Newbury,
the Kearsarge Regional School District and Merrimack County. **New Hampshire is
the worst jurisdiction in the country to generalize a method from**, and a
session reading these rungs as national is going to be wrong in ways that are
hard to see:

- **Town meeting government.** The legislative body of a New Hampshire town is
  the voters, assembled once a year. There is no council to have a roster, no
  ordinance calendar, and the budget is a warrant article rather than a
  document a finance department publishes. "Find the council" returns nothing
  because there is no council.
- **The selectboard is not a council.** Three people, elected at large, running
  the town between town meetings. A method that looks for wards, districts or
  seats finds none.
- **SB2.** A town that has adopted RSA 40:13 splits its town meeting into a
  deliberative session and a ballot vote on a different day, so the same
  government has two "town meetings" that are not the same event. Newbury's
  calendar carries both.
- **SAUs layered over districts.** A School Administrative Unit is an
  administrative body that may serve one district or several, and the DISTRICT
  is the government. Kearsarge Regional School District is SAU 65 and one
  district across seven towns; the SAU and the district publish on one site and
  are not the same entity.
- **The county does almost nothing a county does elsewhere.** Merrimack County
  runs a jail, a nursing home, a sheriff's office, a registry of deeds and an
  attorney's office — and no roads, no schools, no zoning, no land use. Its
  legislative body is not its commissioners: it is the county DELEGATION, every
  state representative elected from the county sitting together to vote the
  county budget. A method that maps "county legislative body" onto "board of
  commissioners" is wrong here in a way that is invisible from outside.
- **Village districts and precincts (RSA 52).** Real governments with elected
  commissioners, their own budgets and their own meetings, and no boundary
  published anywhere by anybody. Eighteen of them are named in the gap ledger
  for 03255 alone.

**Rockaway Township, New Jersey is the test of whether any of this
generalizes.** A township with a mayor, a council, wards, a professional clerk,
an AgendaCenter and a municipal budget document — the shape most of the country
has. Rungs that survive both are method; rungs that only work at 03255 are New
Hampshire, and this section is where a later session comes to find out which is
which before trusting one.

## 2. The source ladder per jurisdiction type

**TWO LADDERS, AND ONLY ONE OF THEM IS NUMBERED** (rewritten 2026-08-20, Prompt
C item 6; `docs/rulings.md` RULING 16).

- **The RETRIEVAL-MECHANICS ladder is `CLAUDE.md`'s fourteen rungs**, and its
  numbering is the numbering that reaches the database as `walledAtRung`. It is
  about getting bytes past a wall: plain fetch, header set, different client,
  different egress, live browser, the page's own network calls, structured
  markup, linked documents, sitemaps, the Archive, the vendor platform, the
  records-request path.
- **The DISCOVERY ladder is below, and it is LETTERED**, deliberately. It is
  about where a document LIVES, which is a different question. It used to be
  numbered one to thirteen in `docs/source-ladder.md`, and that meant "rung 7"
  in a throw site and "rung 7" in a document were different rungs with nothing
  saying so. Letters cannot collide with numbers, so the collision cannot come
  back.

`docs/source-ladder.md` keeps the per-body EVIDENCE — every hunt, every rung
walked, every miss with its URL. Its own numbered header list is retired in
place with a dated note and lives here now.

### THE DISCOVERY LADDER IS A TREE (RULING 52, added 2026-08-21, NH Hunt 3)

**The lettered list below is not walked to a verdict.** A to M are BRANCHES —
independent routes to the same fact — and a branch coming back empty is one
measurement on one date, never a finding about the fact. The letters are an
ordering of where to look FIRST, not a sequence that terminates in
"unreachable". A ladder produces that answer because a ladder has one
direction; a tree does not have it available.

Three walls this repo had written down as permanent fell in one session
(2026-08-21), and all three had a defensible RUNG history behind them:
`gc.nh.gov` answers rung 2 at HTTP 200 after being recorded as refusing every
client including browsers; `sos.nh.gov` fell at rung 5 after being walled
host-wide since 2026-08-13; Kearsarge's nine board emails were in the page's own
`href`s after two sessions recorded them absent. Rungs prove the retrieval
discipline was followed on ONE route. Nothing about a rung count proves a second
route was ever tried.

**How a branch is chosen.** Take the branch that fails for a DIFFERENT REASON
than the one that just failed. That is the whole heuristic and it is what makes
the tree worth more than a longer ladder:

- A host refused you → take a branch through a **different publisher**, not a
  different header. Different headers are rungs 2–4 on the same branch.
- A document does not exist where it should → take a branch through a **body
  that files the same fact for its own purposes** (the county clerk holds what
  the town will not publish; the state holds what the county will not).
- A page is a dead end → take a branch through **a different format of the same
  publication** — the `.ics`, the JSON the widget calls, the PDF, the RSS.
- Every online branch is dry → the **records-request branch** is a branch and
  not a defeat, and it is made and recorded rather than described.

**Independence is declared, not inferred.** Two routes that fail for the same
reason are one route wearing two names, so a branch records what it goes
*through* — a host, a vendor, a publisher — and independence is counted over
distinct dependencies. Nothing automated can tell that two hostnames sit behind
one WAF; a person can, and writes it down. `lib/hunt/discovery.ts` holds the
model and `independentBranchCount` is the function that does the counting.

**Reconciling two branches that both answer.** If they agree, record both — the
second is what makes the first checkable. If they DISAGREE, that is the finding
and it renders as one; the product does not quietly prefer one sourced claim
over another. `verdictOf` returns `divergent` for exactly this case.

**And no branch result is permanent** (RULING 53). Candidate fields go stale in
7 days, bodies and rosters in 14, and walled sources in 14 regardless of how
emphatically the wall was recorded. Past its window a record is re-walked before
it is relied on.

### The discovery ladder, A to M

Walked in order, each recorded with `attemptedAt` and its result. Reaching M
without an answer is the point at which rungs get invented — a body is
exhausted when the IDEAS run out and that has been recorded, never when the
list runs out.

- **A. Resolve the real domain first.** Search results go stale —
  `newburynh.org` does not resolve; `newbury.nh.gov` does. Common shapes:
  `<town>.<st>.gov`, `<town><st>.gov`, `<town>.org`, `<district>.k12.<st>.us`,
  `<district>.org`, `co.<county>.<st>.us`, `<county>county.gov`, and `.net`
  where `.org` is dead (`merrimackcounty.net`).
- **B. The body's own page on that domain.** The specific board page, not the
  jurisdiction homepage — it usually links the calendar directly.
- **C. The clerk, secretary or administrator page** — frequently different
  from the body's page, and where notices actually get posted.
- **D. Machine-readable feeds on that domain.** Try, do not assume: `/rss`,
  `/feed`, `/RSSFeed.aspx`, `/AgendaCenter`, `/Calendar.aspx`,
  `/calendar.ics`, `?ical=1`, `/events.ics`, `/api`, `/sitemap.xml`,
  `/robots.txt`. Read `robots.txt` and `sitemap.xml` as discovery.
- **E. CMS-standard paths for whichever platform the site runs.** Identify the
  CMS first (CivicPlus, Granicus OpenCities, Revize, Municode, GovOffice,
  Apptegy, WordPress, Squarespace), then try its conventions. **Never infer
  the agenda vendor from the website CMS** — Tucson runs Granicus OpenCities
  and is not a Legistar client, which would have been wrong twice.
- **F. The agenda vendor portal, and its API before its HTML.** Legistar,
  OnBase Agenda Online, NovusAgenda, Diligent Community / BoardDocs,
  iCompass / CivicWeb, Simbli, PrimeGov, CivicClerk, Municode Meetings,
  Apptegy Thrillshare, Granicus IQM2. The list is open-ended; add every new
  one here.
- **G. Undocumented endpoints behind the portal.** Most portals render from
  JSON they fetch themselves — watch the network requests on the meeting-list
  page and use the endpoint the page uses. The same public data the page
  shows, in the form the page already receives it.
- **H. Embedded third-party calendars.** A Google Calendar embed exposes
  `calendar.google.com/calendar/ical/<id>/public/basic.ics`; Trumba and
  Localist have derivable public feeds.
- **I. Statutory posting locations.** AZ requires the agenda on the body's
  website 24h ahead (A.R.S. § 38-431.02); NJ requires 48h notice (N.J.S.A.
  10:4-8); NH requires notice in two public places or a newspaper, and no
  agenda at all (RSA 91-A:2). Follow the statute to where notice lives. A
  *formal records request* is this rung's manual sibling and is never
  automated — in AZ it is where § 39-121.03's commercial-purpose machinery
  attaches.
- **J. County and state clearinghouses.** County clerks aggregate; some states
  run public-notice sites; press associations run legal-notice portals.
  (Verified misses: NH has none; nhmunicipal.org's board is NHMA's own.)
- **K. The parent or overlapping body's feed.** Pima's board sat as the
  Library District and Ajo Domestic Water; joint meetings appear on both
  parties' calendars (Tucson content reachable via `pima.legistar.com`).
- **L. The Wayback Machine**, for a page that moved rather than vanished.
- **M. Community and social channels as LEADS ONLY** — never a citation. A
  lead is `UNVERIFIED` until the body's own posting is found.

**And after M: add rungs.** Any route that works gets written back — into this
lettered list when it is a new PLACE to look, and into `CLAUDE.md`'s numbered
ladder only when it is a genuinely new RETRIEVAL CLASS. A new technique inside
an existing mechanics rung enriches that rung and does not renumber anything.

### What to try FIRST, per kind of government

This is the part that saves the hours.

### County

1. The county's own domain, then the clerk-of-the-board page (not the
   commissioners' page — the clerk is who posts).
2. The vendor portal: Legistar (`<county>.legistar.com`), Granicus IQM2
   (`<slug>.iqm2.com/Citizens/Calendar.aspx?From=&To=`), CivicPlus, Revize.
3. Where the calendar is JS-only, the notices/agendas *document* page on the
   same site usually carries the history as dated PDFs — the day-not-hour
   shape (M59). Merrimack County NH is the worked example.

### Municipality — city

1. `<city>.gov` / `<city>az.gov` / `.org`, then the Clerk's boards directory.
2. **Never infer the agenda vendor from the website CMS.** Tucson runs
   Granicus OpenCities and is an OnBase agenda tenant. Wrong twice if assumed.
3. The Clerk's directory is usually the *complete enumeration of bodies* —
   Tucson's listed 56. That is the density source for a city, and it is one
   page.

### Municipality — New England town

1. `<town>.<st>.gov` is the modern shape (`newbury.nh.gov`); `.org` is often
   dead. Resolve the real domain before anything else.
2. Town portals (iCompass CivicWeb) frequently carry **only the selectboard**.
   Do not assume the portal is the town. Newbury's CivicWeb tenant published
   20 sittings in 2026 and every one of them was the Selectboard (verified
   2026-08-15, whole-year query, TypeId 10 on all 20 rows).
3. The other boards — planning, zoning, conservation — live on the town site
   as notice pages or PDFs. NH posts notice under RSA 91-A:2 with *no agenda
   requirement at all*, so a town may lawfully publish a date and a place and
   nothing else. Plan for the day-not-hour shape.
4. The town's **annual report** is a first-class source for rosters, terms and
   town-meeting results, and it is a PDF that often serves at 200 from a host
   whose HTML pages 403.

### School district

1. `<district>.org` or `<district>.k12.<st>.us`, then the "Board" or "School
   Board" section, then "Agendas and Minutes" — the agenda page is nearly
   always a distinct URL from the board page.
2. Vendors seen: Apptegy Thrillshare (`api.thrillshare.com/api/v4/o/<orgId>` —
   the JSON the district's own site renders from), BoardBook Premier
   (`<orgId>` on the org page, server-rendered whole archive), Diligent
   Community / BoardDocs, Simbli.
3. Regional/cooperative districts in NH and NJ govern a *different* set of
   towns than the elementary district. A zip can sit in two districts at once
   and both are its government.

### Special district

1. The Census of Governments individual-units listing gives the name and often
   a web address. Start there, because these are the class the registry
   structurally lacks and nobody stumbles across them.
2. Fire districts, water precincts and village districts in NH (RSA 52) are
   real governments with elected commissioners and their own meetings.

## 3. Rungs and recipes discovered, with their dates

Append here. Each entry: what it is, how to do it, when it was verified.

### The party recipe (M62, 2026-08-15) — verbatim from the session that found it

*Evidence: `docs/source-ladder.md`, "M62 — the certified-results rung, walked 2026-08-15 — the evidence".*

**A general-election canvass usually does not print party.** Pima County's
certified general canvass and the Morris County Clerk's official summary
report both carry candidate names and vote totals and no affiliation at all.
The documents that state party are:

- **Arizona** — the certified **primary** canvass, where the races are
  themselves headed by party: `DEM Board of Supervisors District 1`,
  `REP Board of Supervisors District 4`.
- **New Jersey** — the county clerk's certified **"Winners of the General
  Election"**, which has a Party column (the summary report does not).
- **New Hampshire** — the Secretary of State's certified county-office
  results, which print the party as a letter beside the name:
  `Steve Shurtleff, d`.

**And the same documents prove the negative.** Arizona school district
governing board races appear in Pima's general canvass with no party beside
any candidate, and appear in the party-organised primary canvass under no
party heading at all — they are not in that election. That is the election
authority's own record saying these seats carry no party, which is a far
stronger answer than "the district's page doesn't mention one".

New Hampshire towns **adopt** a partisan or non-partisan ballot system under
RSA 669, so the statute alone cannot answer it for a particular town — the
town's own ballot or annual report has to.

### The verify-the-absence rung

Never record "no party", "no meetings", "no photo" from a page that simply
did not mention the thing. Find the document that would have carried it and
show that it does not. The negative is a claim and carries the same evidence
burden as the positive — see the school-board example above, where the
absence of a party heading in a party-organised document is the proof.

### The NH Secretary of State ladder (2026-08-15, walked to the end)

`sos.nh.gov` refuses this network. The ladder that works anyway:

| Rung | Attempt | Result |
|---|---|---|
| 1 | A committed filing snapshot already in this repo | Right host, often the wrong document — honestly wrong |
| 2 | Search-index cache | **HIT** for the document *path*, proving the file exists and is indexed |
| 3 | The direct document path under `sos.nh.gov/sites/g/files/…` | **403**, host-wide. Try it per document anyway — the same trick **works** on `newbury.nh.gov`, which 403s its HTML and serves its PDFs at 200 |
| 4 | Internet Archive dated mirror | **HIT** — and the archive URL, with its date in it, is what gets cited, because it is the document that was actually read |
| 5 | The author's residential browser | The manual rung. Not needed here |

The browser-UA rung (a full Chrome UA string) worked on 2026-08-13 and had
**closed by 2026-08-14** — Akamai now 403s that too. Recorded, not deleted:
it may open again, and it still works on other hosts. (Those two dates are
wall clock. The older records in `docs/source-ladder.md` label the same two
sessions "08-16" and "08-18", which were sequence numbers running ahead of
the clock under a convention retired 2026-08-14; `docs/state.md` §18 explains
them to a stranger.)

Two hosts that 403 a general-purpose fetcher and **admit this project's
identified User-Agent**: `tucsonaz.gov` and `morriscountyclerk.org`.

### CivicPlus: the boards live in a different calendar category (2026-08-15)

*Evidence: `docs/source-ladder.md`, "A township's boards are in a different calendar category (M77) — the evidence".*

Rockaway Township's wired iCal feed is `catID=25`, and it carries the Township
Council and nothing else. **`catID=30` is a second calendar** carrying the
Planning Board and the Board of Adjustment with real start times. Probing the
category ids is the rung: most return a 477-byte empty calendar, and the two
that do not are the whole density story for a township.

The matching archive is the `AgendaCenter` page, whose `<div id="cat<N>">`
blocks are per-body. Bind the id to the heading **in the DOM** — never by
document order — and never take every document on the page, or one board's
meetings get filed under another's.

**CivicPlus announces a cancellation by editing the SUMMARY text**
(`"Board of Adjustment Meeting Cancelled 8/18/26"`), not by an iCal `STATUS`
property. A `summaryMatch` prefix therefore matches the cancelled sitting too,
and it must be recognised as CANCELED rather than rendered as a meeting that
will happen.

### The served window is the fetch window (M76, 2026-08-15)

*Evidence: `docs/source-ladder.md`, "The served window is the fetch window (M76) — the evidence".*

Every adapter had `WINDOW_BACK_DAYS = 30` while the app serves
`CONCLUDED_LOOKBACK_DAYS = 90`. Sixty days of published, retrievable history
were being dropped at the fetch, at every zip, silently — a density loss that
no count check caught because each adapter honestly reported what it fetched.
Adapter windows now derive from `lib/meetings/constants.ts`. **Check this
first when a jurisdiction looks thinner than its portal.**

### A town's portal may not be the town (2026-08-15)

*Evidence: `docs/source-ladder.md`, "A town's portal may not be the town (M79) — the evidence".*

**Never read a vendor tenant as the government.** Newbury's iCompass CivicWeb
portal published **20 sittings across the whole of 2026 and every one was the
Selectboard** (`TypeId` 10 on all 20 rows — a whole-year service query, not a
sample). The Planning Board, Zoning Board of Adjustment and Conservation
Commission are not on it at all, and a session that had read the portal as
"the town's meetings" would have recorded the town as fully covered while
missing three of its four boards.

The check is one query: ask the tenant for a whole year and count the distinct
type ids. One type id means one body, and the rest of the government is
somewhere else.

Corollary: `MeetingTypeList.aspx?type=<n>` **ignores the parameter** on that
tenant — every value 1–15 returned the identical page. Type discovery comes
from the service payload's own `TypeId`s, never from the type-list page.

### The published annual schedule (2026-08-15)

*Evidence: `docs/source-ladder.md`, "The published annual schedule is a source shape, not a vendor (M78) — the evidence".*

A source shape, not a vendor, and the one to try when a body runs no portal:
the body publishes its whole year of dates on one page with a single sentence
underneath naming the time and the room.

```
Monday, January 26, 2026
Monday, February 23, 2026
…
All meetings begin at 6:30 P.M. and are held in the Board of Education -
Board Conference Room.
```

Ladder rung 2, no portal in the path, and how a very large number of American
school boards publish. It is an adapter now (`lib/sources/schedulepage/`,
`AgendaSourceType: "SCHEDULEPAGE"`), so the next one is a wiring row.

Three rules that came with it, each one a way to get it wrong:

1. **Parse the time from the body's own sentence; never default it.** No
   sentence means `startPrecision: "DAY"` and a card that says the time was
   not posted.
2. **Require the weekday prefix on the date.** A bare `August 17, 2026` in a
   footer or a news teaser would otherwise become a meeting. The schedule list
   is the only place a body writes the weekday out.
3. **Join documents on the date in the body's own link text**, never on a
   filename.

And record `VENDOR_API: MISS` when there is no vendor. "This district runs no
portal" is a finding about the district; leaving it unrecorded makes it look
like a gap in the hunt.

### The browser rung, and what it is actually made of (M79, 2026-08-15)

**A 403 to this pipeline is a rung, not a wall.** `kearsarge.org` and
`newbury.nh.gov` both refuse the civic-index client on every path — root,
agendas page, sitemap, RSS — and both serve the identical pages to a browser.
Between them they were hiding a school board's whole two-year calendar and a
town's three land-use boards.

The measurement is the part worth keeping, because the obvious guess is wrong:

| Client | Headers | Result |
|---|---|---|
| Node `fetch`, civic-index UA | ours | **403** |
| Node `fetch`, full Chrome header set | Chrome's | **403** |
| `curl`, the *same* Chrome header set | Chrome's | **200** |

The filter reads the **TLS/HTTP2 client fingerprint**, not the `User-Agent`.
A session that swapped the UA, got another 403 and wrote "browser rung closed"
would have recorded a wall that is not there — which is why the row above
exists rather than a sentence saying "send a Chrome UA". `politeGetText(url,
{ profile: "browser" })` sends the browser header set in-process and, on a
403, re-issues through the system `curl`. The identification survives:
`…Chrome/139.0.0.0 Safari/537.36 we-the-people civic meeting index (contact:
…)`. We look like a browser to a filter and like ourselves to a human.

Nothing here is an access control — no login, no token, no robots directive
naming these paths, and every page is one a public body is statutorily obliged
to publish. Pacing, `Retry-After` and serialization are unchanged.

### Three more shapes of "the body's own page" (M79, 2026-08-15)

The published annual schedule above was the first. It is a family, and the
adapter now dispatches on `shapes` in the wiring row. A body may declare more
than one and they union by date.

- **`month-table`** — a two-column table, month in the left cell, one sitting
  per row in the right: `Apr 2 Staff Nominations`, `September 10 - Budget
  Presentations`. **The year is the whole problem**: only the first month cell
  and the January cell state one. Track it two ways — a stated year sets it,
  and a month ordinal that goes backwards rolls it forward — because a
  schedule filed twelve months early is invisible until a reader shows up at
  an empty room.
- **`dated-list`** — `August 11, 2026 - 6:00pm` per line, with a sentence
  naming the venue. **Scope it to the body's own block** (`sectionMatch`); the
  same page carries a news teaser, a minutes archive and a document list, all
  full of dates. Expect malformed rows: Newbury writes `June 9,2026` with no
  space and puts two dates in one paragraph, so scan per match, not per line.
- **`agenda-list`** — the document listing *is* the schedule. Drupal
  municipal sites publish `<span property="dc:date" content="2026-08-18T19:00:00-04:00">` <!-- expected-future: the Newbury Planning Board's next sitting, quoted verbatim from the town's own markup as read 2026-08-15; a schedule example that postdates the read is the normal case for a schedule and this one is in the committed fixture tests/fixtures/schedulepage/newbury-planning-board.html -->
  beside each document link, so no time is ever inferred. Two rules: bind rows
  to one board with a **path prefix** (the town's template gives every board
  identical markup, and a prefix-free parse files one board's Thursday under
  another's), and **never let the link text become the sitting's title** — it
  names the document ("Agenda", "Meeting Minutes"), and a card titled after
  the piece of paper we found it in is not a meeting name. Read the label for
  one thing only: `April Meeting is Cancelled` is the town's cancellation
  signal.
- A row timed at **exactly local midnight** is a document date, not a meeting
  time. `startPrecision: "DAY"`, per M59.

### The schedule table carries things that are not meetings (M79, 2026-08-15)

Kearsarge's board calendar includes the town election and two filing
deadlines, written in exactly the same shape as a sitting. Rendering "Election
Day in your Town" as a school board meeting at 6:30pm at 114 Main Street is a
fabricated claim about a government. Drop them — and **count them**, because a
silent skip and a real absence must never look alike. Same for the table's own
header row, which is not an undated sitting and must not spend a drop.

### A published schedule can contradict itself, and a venue can be missing

Two findings from Newbury that generalize:

1. **The CMS date field and the agenda body can disagree.** A Zoning Board
   agenda carries `dc:date` of Thursday 2026-08-13 and the heading
   `Wednesday, August 12, 2026`; another is timed 7:00**am** in the field while
   its items run from 7:05 p.m. Render the structured field the town's own
   listing renders — that is what a reader browsing the site sees — and record
   the discrepancy rather than smoothing it.
2. **A board can publish its schedule and not its place.** Newbury's Zoning
   Board of Adjustment publishes four 2026 agendas and states its meeting
   location on no rung walked: not the department page, not three agendas read
   in full, not the town's events listing. Its two sibling boards each state
   theirs in their own words — and taking the Town Office from them for this
   board is exactly the guess the venue table exists to refuse. **The venue is
   its own hunt**, and a body can be source-found and still not renderable.
   Wire the ones you can place; record the one you cannot, with the next rung
   named.

   > **2026-08-15, the mobile round-two session — the venue was there.** Not
   > in the prose, which is why three careful reads came back MISS: it is in
   > the department page's own **contact markup**, a vCard `street-address`
   > block plus a `See map: Google Maps` link carrying
   > `q=937+Route+103%2C+Newbury%2C+NH%2C+03255%2C+us`. The board is LIVE on
   > one curated venue row and no other change, exactly as the note above
   > predicted — but on a rung it did not name. See **Prose said no; ask the
   > markup** below. The refusal to infer from the siblings stands: the
   > independent answer agreed with them, which is the one thing an inference
   > could never have proven.

### Probe the calendar category ids (2026-08-15)

On CivicPlus, and by extension any CMS with numbered calendar feeds: **the
boards are usually not in the council's category.** Rockaway's council feed is
`catID=25`; `catID=30` is a second calendar carrying the Planning Board and
the Board of Adjustment with real start times. Thirteen of the fifteen ids
tried returned a 477-byte empty calendar — the probe is cheap and it tripled
a township's coverage.

Bind each archive block's category id to its **own heading in the DOM**, never
by document order, or one board's meetings get filed under another's.

### Check the adapter's window before hunting a second source (2026-08-15)

When a jurisdiction reads thinner than its portal, the first suspect is our
own fetch window, not the publisher. Every adapter here had a 30-day lookback
against a 90-day served window, under a comment asserting they matched. No
count check catches this: the adapter honestly reports what it asked for.
Adapter windows now derive from `lib/meetings/constants.ts`.

### State roll calls: LegiScan, and the join that fails silently (2026-08-15)

*Evidence: `docs/source-ladder.md`, "The district mapping, and the failure it hides — the evidence".*

Bulk first — `getDatasetList` → `getDataset`, one ZIP per state session,
refreshed Sunday mornings. Store `dataset_hash`, compare it, **never
re-download an unchanged dataset**. Never touch the legiscan.com front end.
The data is CC BY 4.0 and the attribution renders wherever it appears.

**The district mapping is the whole risk, and getting it wrong does not
throw — it produces a low match rate, which looks exactly like a thin
roster.** Two shapes so far:

- **Statewide numbering** (AZ, NJ, and every state's upper chamber seen so
  far): `HD-040` → `sldl:40`.
- **County numbering** (NH's House): `HD-12-HIL` is Hillsborough 12, and the
  Census SLDL code is the county's **zero-based alphabetical** ordinal
  concatenated with the two-digit district number → `sldl:512`. Belknap is
  ordinal 0, so its codes lose the leading zero: Belknap 7 is `sldl:7`, not
  `sldl:007`. Both details were wrong on the first pass and both were silent.

**Assert the mapping against your own boundary labels.** Our geojson carries
`State House District Merrimack 08` beside `sldl:608`, which turns the
mapping from a remembered fact into a checked one. Do this for every new
state before trusting a match rate.

**Match on district AND surname, never name alone** — the district identifies
the seat and the surname is compared only within a district that already
matched. Fold accents and generational suffixes: "Walter"/"Walt", "Mary
Jane"/"Mary", "James"/"Jim" all occur between a legislature's own roster and
LegiScan's.

**Report the match rate WITH its denominator, per state.** A large unmatched
count is usually not a gap: most of a legislature governs outside our clipped
boundaries. What matters is that every roster seat that COULD match did.

### Let the surface drive the clip (2026-08-15)

*Evidence: `docs/source-ladder.md`, "The clip, stated — the evidence".*

A snapshot that holds "the N most recent" of anything must ask what the
surface renders. Arizona published 7,283 roll calls in one session and
**votes in bursts** — the 60 most recent covered two days, so any member
absent those two days would have rendered an empty record that reads as
"never votes". The clip is now the union of each member's own twelve most
recent, which guarantees every member with a record has one to show.

### Prose said no; ask the markup (2026-08-15)

**A page that answers MISS for a fact stated in a sentence has not been asked
for the same fact stated in markup.** Municipal CMSs publish addresses
structurally all the time — vCard `location`/`adr`/`street-address` blocks,
`See map` links carrying the address in a query string, JSON-LD `Place`,
`<meta>` geo tags — and a reader scanning a rendered page for "the meeting is
at" never sees any of it. Newbury's Zoning Board of Adjustment sat at
`KNOWN_UNCOVERED` for a day on exactly this: three rungs of prose, all
honestly MISS, over a page that carried the address in its own contact pane
the whole time.

So a venue hunt on a CMS page has a rung before the minutes and the posted
notice, and it is nearly free:

1. Grep the retrieved HTML for `street-address`, `class="adr"`, `vcard`,
   `geo`, `maps.google`, `google.com/maps`, `openstreetmap`, `application/ld+json`.
2. Read the address out of the **map link's query string** where the visible
   text does not carry it — that is where the author found this one.
3. Cite the markup, not the rendering: the row's `addressSourceUrl` is the
   page, and the note says which block it came from.

The same move is worth trying for meeting TIMES (`dc:date`, `<time datetime>`)
and for body names, and it applies to any host, not just this vendor.

### A hover-only menu is invisible to a click-walking rung (2026-08-15)

`newbury.nh.gov` reveals its boards list **on hover, with no click** — there
is no expanded state a walk can reach by clicking, so a rung that enumerates
navigation by clicking finds nothing and reports an honest MISS over a
complete list. Two lessons: read the **markup** of the nav (the `<ul>` is in
the HTML whether or not a pointer ever touches it), and treat "the menu did
not open" as a retrieval failure, never as evidence about what the town
publishes. The author found this list in his own browser by hovering.

### The town's one building, and the label it uses (2026-08-15)

Newbury's convention — and New England towns do this constantly — is that
**every physical town meeting happens at one place**, published under a single
label ("Newbury Offices" in the site footer of every page) with the street
address behind a map link rather than in the label. Two consequences for a
New England town: one curated venue row can unlock several bodies, and the
label the reader should see is the town's own, not a name reconstructed from
the address. Resolve each body on its own published string anyway — the rows
are cheap, and one body meeting somewhere else is a wrong pin for exactly the
reader who turned up.

### Newbury's boards, as the author observed them (2026-08-15) — a denominator

The town's own boards list, read from the hover menu, in full: Advisory
Budget, Blodgett Sewer, Cemetery Trustees, Conservation Commission, Joint
Assessing, Joint Loss Management, Beautification, Energy, Library Trustees,
Septic, Planning, Selectboard, Trust Funds Trustees, Zoning Board of
Adjustment. **Fourteen bodies.** Recorded as the observed universe for this
town — a denominator to measure coverage against, not a work list and not a
commitment. Four are wired today (Selectboard, Planning, Conservation
Commission, Zoning Board of Adjustment); the other ten are `NOT_ATTEMPTED`
and must be recorded that way rather than as silence. Note that this list is
the *town's own* enumeration and the coverage rule's denominator still comes
from the Census of Governments — the two are cross-checks on each other, and
a body on one and not the other is a finding.

### The county feed's agenda ITEMS are a special-district directory (D19, 2026-08-17)

Not the county's body list — its **agenda items**. Pima County's Legistar
client exposes exactly four bodies, all Board of Supervisors variants, so a
body-list rung says the county has no special districts. Its agendas say
otherwise: reading the items under "BOARD OF SUPERVISORS SITTING AS OTHER
BOARDS" across fifteen live agendas names **seven** distinct governments, none
of which appear anywhere else in the feed —

- Flood Control District Board
- Library District Board
- Improvement District Board
- Stadium District Board
- Rocking K South Community Facilities District Board
- Wildflower Community Facilities District
- Ajo Domestic Water Improvement District

**How to walk it.** `GET <slug>/events/<EventId>/eventitems` per event, one
request each, serialized. An item with no `EventItemMatterFile` is a heading;
inside the sitting-as region each heading names the acting board, and
"SITTING AS THE BOARD OF SUPERVISORS" hands control back. This is a
per-EVENT fetch, so it belongs at ingest and never per reader.

**Two traps, both found by running it rather than by reading it.**

1. **Typography is not a government.** "PAGE BREAK" appears five times inside
   the region across those agendas and opened a segment on the first live run,
   cutting the item after it off the district that was actually acting. Rule
   the ladder inherits: a heading with no letter in it, and a named list of
   layout markers, name no body — and neither opens a segment nor closes one.
2. **A per-sitting name is not a body key.** Diligent publishes a different
   `bodyName` for every committee of one government ("Regular Governing
   Board", "Finance and Audit Committee Meeting"), so keying anything on it
   splits one college district into several. The meeting id's
   `<source>:<tenant>` prefix is the government.

**Why it matters beyond Pima.** ~39,555 special districts nationally, and this
is the 4.7.6 thesis measured: a large share sit inside county feeds already
wired, reachable by reading items rather than by 39,555 separate hunts. All
seven resolve to UNRESOLVED against the registry today and that is the correct
answer — Census publishes no boundary for a special district, so no division
exists to match. They are recorded as unresolved with their published heading
as evidence, never attributed to the county. Naming them is D31.

### A virtual meeting is invisible to every radius filter (D18, 2026-08-17)

A meeting whose published location names no place — "Virtual Meeting", "Via
Zoom Webinar", "Microsoft Teams (Virtual)" — has no coordinates, so a
distance filter excludes it silently at every rung. **Twelve real public
meetings across one refresh**, three of them a body that meets ONLY online.
Counting the drop is not enough; a drop counter is a number in a log, and the
reader still sees nothing.

The rung: fetch and keep them, place them nowhere, and reach them by asking a
different question than distance —

- the division containing the map centre, for a body that has one;
- the same government's in-person sittings being in radius, for a body that
  does not (a community-college district, an authority, a special district).

Neither invents a coordinate. Detection is a location-string list
(`PLACELESS_LOCATIONS`), which is append-only like everything else here: a new
vendor's phrasing is a new entry, and until it is added that vendor's virtual
sittings drop as an unknown venue rather than being kept.

### The VTS Drupal 7 family — one CMS, a town and a school district (NH Hunt, 2026-08-20)

**Recognise it by its `generator` meta tag and its theme path.** `<meta
name="generator" content="Drupal 7">` plus `sites/all/themes/custom/vts_aurora`
in the asset URLs. That is Virtual Towns & Schools, and in New Hampshire it
runs the Town of Newbury AND the Kearsarge Regional School District — a
municipality and a school district on one shape, which is why this is a family
rung and not a site note.

What the family gives you, in order of value:

| Where | What is there |
|---|---|
| `/boards` | every board and committee, as links |
| `/departments` | every department, as links |
| `/sitemap.xml` | **the real enumeration** — Newbury's carries 363 URLs and names three bodies the boards menu does not |
| `/calendar/ical/export.ics` | **the whole calendar as iCalendar.** Newbury's is 1,157 events |
| `/calendar/feed/YYYY-MM` | the month, as RSS |
| any board page | a `views-table` roster: `views-field-title`, `views-field-field-job-title`, `views-field-field-staff-phone`, `views-field-field-staff-email` |
| any person cell | `/user/NNNN/contact` — the site's own contact form for that person, which is a working contact route |

**The boards menu is an UNDERCOUNT and the sitemap is the denominator.** Newbury's
hover menu lists fourteen boards; its sitemap carries Parks & Recreation, the
Housing Committee and the Transfer Station Committee as well. Two of those
three answer `302 → /user/login?destination=node/NN`, which is the site's own
access control and is where the hunt stops — we never authenticate past one.
The third is a prose page with no table. Seventeen is the floor, not fourteen.

**A board's menu entry can be a redirect OFF the town's domain, and the
redirect is the trail.** Five of Newbury's:

```
/newbury-energy-committee          → newburyenergynh.org
/newbury-beautification-committee  → newburybeautification.org
/fire-rescue-department            → fire.newbury.nh.gov
/newbury-public-library-trustees   → newburynhlibrary.net
/joint-assessing-board-…           → sunapeenh.gov/joint-assessing-board
```

The last one is the important shape: a JOINT board of three towns, published by
a different member town. A hunt that treats the 301 as a refusal loses five real
bodies and gets the publishing government wrong about a sixth.

### Rung 4 is a `curl`, and it beats Node on two different walls (NH Hunt, 2026-08-20)

Two separate measurements, one day, one host:

1. **The redirect could not be READ.** `politeGetText` reports the 301; a
   `redirect: "manual"` probe from the same process gets a Cloudflare 403 with
   no `Location` header at all. `curl -sL -w '%{url_effective}'` follows it in
   one call and prints where it went.
2. **The document could not be FETCHED.** `https://www.newbury.nh.gov/calendar/ical/export.ics`
   answers **403 to Node's fetch and 200 to `curl`, 467,525 bytes, with EITHER
   User-Agent.** Nothing about the headers mattered. It is a TLS-fingerprint
   wall and rung 4 is the whole answer to it.

`lib/sources/http.ts` now walks rung 2 → 3 → 4 on any 403, for every adapter,
not just the ones that opted into the browser profile. Before that change the
plain profile stopped at rung 2 and called a serving feed a wall.

### The Cloudflare interstitial outgrew the size floor (NH Hunt, 2026-08-20)

`challengeIn()` had one global 20 KB floor, on the reasoning that a long article
quoting "Checking your browser" is a page. Cloudflare's current managed
challenge is **29,809 bytes** and sailed straight through it — so Kearsarge's
board-roster page was handed to the extractor as a document, read for its
tables, and reported as `ZERO_ROWS`. A wall rendered as an emptiness.

The floor is now per-signature. `window._cf_chl_opt`, `challenges.cloudflare.com`
and "Performing security verification" are unambiguous and apply at any size;
`cdn-cgi/challenge-platform` KEEPS the floor, because Cloudflare injects that
script into ordinary pages and both of this repo's recorded `schedulepage`
fixtures carry it.

### Headless Chromium does not clear a Cloudflare managed challenge (NH Hunt, 2026-08-20)

Rung 6 read every Cloudflare-challenged page on `newbury.nh.gov`. It did **not**
clear `kearsarge.org`'s: the interstitial reports "Incompatible browser
extension or network configuration" and never resolves. A HEADED launch was
tried and is not available in this environment (`browserType.launch: spawn
UNKNOWN` — no display session). Both are rungs, both recorded, and the honest
next rungs are 11 and 9.

### Rung 11 has TWO doors, and the availability API is the worse one (NH Hunt, 2026-08-20)

`https://archive.org/wayback/available?url=…` returns the CLOSEST snapshot,
which for the Kearsarge board roster was **2023-07-29** — three years stale and
silently presented as the answer. The CDX index returns the list:

```
https://web.archive.org/cdx/search/cdx?url=<url>&output=json&filter=statuscode:200&limit=-3
```

That named three captures, newest 2023-11-30, which is the honest finding: the
Archive holds nothing current for this page. Add `id_` after the timestamp
(`/20231130130742id_/`) to get the original bytes without the Archive's own
toolbar, which otherwise lands in the extraction as page furniture.

### A county's own "Board of Commissioners" page may name no commissioners (NH Hunt, 2026-08-20)

Merrimack County's does not. Four paragraphs, a Zoom link, no names. **The names
are in the county's own Annual Report**, in a "County Directory · Officers and
Department Heads (Current)" table on page 5, with every elected officer and
department head — and repeated over the commissioners' signature block on page
6, which is the second reading that makes it a verification.

Revize sites put those reports in a Document Center whose file links are
relative and unquoted in the HTML; the direct path
`/<Category>/<Sub>/<File Name>.pdf` 302s to the CDN and serves. `pnpm extract
text` reads them: 37 pages, born-digital, no OCR.

**Generalise it:** where a county or town page describes a body without naming
it, the annual report is rung 9 and it is almost always there. Ask for the
report before concluding the body is unpublished.

### An empty `LOCATION` is not a placeless meeting (NH Hunt, 2026-08-20)

D18's `placeless` means the body published a location string naming no
building — "Virtual Meeting". Newbury publishes **no `LOCATION` line at all** on
any of its 1,157 events. Reading that silence as an assertion dropped
twenty-four of its public meetings before the row's own `venueMatch` was ever
consulted. An absent field and a field saying "nowhere" are different facts.

### One feed, many bodies: fetch it ONCE (NH Hunt, 2026-08-20)

Ten Newbury bodies are wired to one `export.ics`. The `ical` adapter's loop is
per wiring row, so the town was being asked for the same 466 KB document ten
times per refresh — and its reputation limiter started refusing pages it had
served minutes earlier. Politeness is not a nicety here; it is the difference
between a working source and a wall you built yourself.

### A hunt ledger needs carry-forward too (NH Hunt, 2026-08-20)

The refresh corollary is not only about the meetings snapshot. Three successive
sweeps of Newbury read 88, then 82, then 77 people, because the host's limiter
tightened as the sweeps went on — and each run overwrote the last. A hunt ledger
that a failing run can empty is the same defect one layer sideways.
`pnpm hunt:roster` now merges: a page that fails keeps its last successful line
with its ORIGINAL `attemptedAt`, marked `carriedFrom`, and the run prints
people-on-the-ledger against people-read-this-run.

## 4. The scripts that exist

| Command | What it does |
|---|---|
| `pnpm census:zip <zip…>` | The who-governs table: every body governing the point, ingested / not-ingested / never-hunted, vendor named. Offline. |
| `pnpm meetings:report` | What each target zip resolves through the live composite, with per-source counts. Live network. |
| `pnpm officials:audit` | Roster completeness against the Kelly standard. |
| `pnpm ingest <source>` | One adapter, locally. |
| `pnpm signal:snapshot` | Freeze aggregates for calibration. |
| `pnpm stamp` | Today, `America/Phoenix`. Every written date comes from here. |
| `pnpm verify-stamps` | Audits `CLAUDE.md`'s Adopted dates against git history. |
| `pnpm legiscan:fetch` | State-legislature roll calls for AZ/NJ/NH, hash-gated. `--force` re-downloads. |

### The branch toolkit (NH Hunt 3, added 2026-08-21 — RULING 52 and 53)

| Command | What it does |
|---|---|
| `pnpm stale` | Which dated measurements are past their RULING 53 window and owed a re-walk. Reports and never re-walks — re-walking is a hunt, and a hunt needs a session's judgement. Prints the pair per source, names its own blind spots, and says the total is a floor. |
| `pnpm nh:roster [--name=X]` | The General Court's own roster as a branch INDEPENDENT of our officeholder registry. See the two-chamber recipe below. |
| `pnpm watch:workflows [--open] [--asof=]` | RULING 56. Opens a Needs Sean row when a scheduled job fails twice consecutively. `--asof` holds the detector against a window whose outcome is already known, which is how it was proved without breaking anything. |

**The NH General Court, two chambers, two branches** (2026-08-21). Worth
recording as a shape rather than as one state's trivia: *the same host can treat
two paths of one body completely differently, and meeting the refusal on one is
no evidence at all about the other.*

- **House — the name index is published as a form control.**
  `gc.nh.gov/house/members/` answers rung 2 at 200 and carries a `<select>` of
  every member: `<option value="700">Ebel, Karen</option>`. **The option value
  IS the `pid`** in `member.aspx?pid=` — confirmed against Gregory Sargent,
  whose option value 10832 matches his already-recorded pid. One request yields
  a complete name-to-page index: **384 members of 400 seats**, measured
  2026-08-21. This is the general lesson — *a `<select>` is a published index* —
  and it is worth reaching for before any search engine.
- **Senate — a path-scoped WAF, so there is no index and the DISTRICT is the
  key.** `gc.nh.gov/senate/members/` answers **403** to the same client that
  gets 200 from the House path one directory over. But
  `senate/members/webpages/district07.aspx` answers 200 (districts 01, 07, 15
  and 24 all confirmed). Twenty-four requests cover the chamber.

A session that met the 403 and stopped would have written down "the Senate
roster is walled", which is the sentence RULING 52 exists to stop.

**And where a value is already known, never re-derive it from prose.** The first
version of this tool parsed the district back out of the senator's page and
harvested `District Maps` from the site navigation — a menu item, about to be
written into a named senator's record. The district was the loop variable all
along. This is the playbook's own "strip the navigation before harvesting"
lesson, and it still caught the session that wrote it down.

### The extraction toolkit (F11, added 2026-08-20)

Four layers, one contract. **A ZERO-ROW EXTRACTION IS A FAILED EXTRACTION,
never an empty document** — every layer returns an outcome of `EXTRACTED`,
`ZERO_ROWS` or `CANNOT_RUN` with its counts, and the CLI exits non-zero on
anything but the first. `ZERO_ROWS` ("the layer ran and produced nothing") and
`CANNOT_RUN` ("the layer could not look") are deliberately different: a
scanned agenda recorded as a document that published nothing is a false claim
about a public body.

| Command | Layer | What it does |
|---|---|---|
| `pnpm extract text <file\|url>` | 1 · `lib/extract/text-layer.ts` | The text layer of a born-digital PDF, one row per page that carries text. All pages empty ⇒ `ZERO_ROWS` naming OCR as the next rung, never "the document is empty". A non-`%PDF` input is `CANNOT_RUN`, so a challenge page served at 200 cannot read as a silent PDF. |
| `pnpm extract tables <file\|url>` | 2 · `lib/extract/tables.ts` | Agenda and budget grids, reconstructed from text-item POSITION — rows grouped by baseline, cells cut where the horizontal gap exceeds the row's own median character width. Limits stated in the refusal: no ruling-line detection, no spanned cells, no table joined across a page break. |
| `pnpm extract ocr <file\|url>` | 3 · `lib/extract/ocr.ts` | Scanned PDFs, through a LOCAL `tesseract` binary. The engine is deliberately not a dependency — the deploy never OCRs anything, and the WASM build plus language data would join the file-count budget for a path that only runs in a hunt. No engine on PATH ⇒ `CANNOT_RUN` naming the install, NEVER "no text". `opts.engine` injects a better one. |
| `pnpm extract payload <file\|url> [--find "text"]` | 4 · `lib/extract/embedded-payload.ts` | CMS pages that ship their content as an escaped JSON payload inside a `<script>`. Reads all three encodings — plain JSON script, assigned object literal, and the DOUBLY-encoded string-whose-value-is-JSON that is Apptegy's shape. `--find` reports every hit with its KEY PATH, which is what makes a hit evidence rather than a substring match. |
| `pnpm extract auto <file\|url>` | 1 → 3 | The ladder in code: text layer first, escalating to OCR when the text layer reports a scan. |

**Layer 4 is why F11 stopped being about PDFs, and it is verified against the
page that produced the row.** Vail Unified's superintendent was carried as
"Carruth" — a surname with no given name. The link was in the static HTML, the
page answered 200 to a plain fetch, and "John Carruth" was in that HTML six
times. Fetch and discovery both worked and the EXTRACTION read nothing, because
Apptegy hydrates from an embedded payload and the rendered prose carries only a
news blurb saying "Superintendent Carruth".

Verified live on 2026-08-20 — one fetch, not a hunt:

```
pnpm extract payload https://www.vailschooldistrict.org/page/superintendent --find "John Carruth"
FIND "John Carruth" — 6 hit(s)
  script 3  page.content.structure.nodes[2].nodes[0].nodes[0].content.html
  script 3  page.content.structure.nodes[2].nodes[0].nodes[1].content.altText
  ...
EMBEDDED_PAYLOAD EXTRACTED rows=1151 bytes=1401792  scripts=14 scriptsWithJson=6
```

Six hits, matching the six occurrences F07 recorded, each with the key path it
came from. `tests/extract.test.ts` holds the shape offline, including the
doubly-encoded case and the negative — a page whose prose has the name and
whose payload does not.

### Layer 5 — the roster table (NH Hunt, added 2026-08-20)

| Command | Layer | What it does |
|---|---|---|
| `pnpm extract roster <file\|url>` | 5 · `lib/extract/roster-table.ts` | **Who sits on a board**, off the body's own page. Reads Drupal 7 Views tables by their `views-field-*` cell classes — the CONTRACT is the class names, not the column order — and falls back to `<thead>` labels for hand-built tables. Returns section, name, title, phone, email, contact-form URL and the bracketed term where the page prints one. Zero rows is `ZERO_ROWS` naming the tables it saw and rejected, never "this board has no members". |

Built because the record was reachable and unreadable, which is friction and
never refusal: Newbury's Selectboard page answers 200 to a plain fetch and its
three members sit in a `views-table` that nothing here could turn into rows.

**What it never does:** infer a role for a person with no title cell, parse a
term into a date, or follow a `/user/NNNN/contact` link. Those are the caller's
decisions and the next rung's work.

**The header-row trap, recorded because it produced a fabricated person.** A
`<tr>` inside `<tbody>` can BE the header — Kearsarge's district directory has
one, `Name | Position | Phone`, with the same cell classes as the fourteen real
rows below it — and the first run of this layer carried "Name" into the roster
as the district's fifteenth staff member. The layer now drops a row whose name
matches a header label.

### `pnpm hunt:roster` — walk a list of body pages and keep the ledger (NH Hunt, added 2026-08-20)

```
pnpm hunt:roster <urls-file> [--out docs/evidence/<name>.jsonl]
pnpm hunt:roster --url https://www.newbury.nh.gov/selectboard
```

One URL per line; `#` comments; anything after a tab or two spaces is a LABEL
carried onto every person that page produces. `WTP_HUNT_PACE_MS` sets the gap
between pages (default 4000).

It is the harness a town hunt actually needs, and everything in it is a rule
from `CLAUDE.md` made mechanical:

- **It walks the ladder.** Rung 3 first; a 3xx escalates to rung 4 (`curl -sL`,
  which follows the hops Node cannot read); a challenge escalates to rung 6
  (a guarded headless browser, opened once and reused).
- **It writes every rung down, worked or not.** One JSON line per page with the
  URL, the redirect chain, the final URL, the HTTP status, the rung, the wall
  in the source's own words, the extraction outcome, its counts, and the rows.
- **It carries forward.** A page that fails keeps its last successful line with
  its original `attemptedAt`, marked `carriedFrom`.
- **It states counts, not a number.** Pages attempted / read / with a roster /
  people, then the walls by name, then the pages that read cleanly and carried
  no roster — which is a finding about the PAGE and never about the body.

Committed URL lists live in `data/hunt/`: `newbury-bodies.urls`,
`kearsarge-bodies.urls`, `merrimack-county-bodies.urls`. Their ledgers live in
`docs/evidence/nhhunt-*.jsonl` and are read by `tests/body-rosters.test.ts` as
proof that a published contact was published.

## 5. The state folders

`states/<st>/NOTES.md` is a state's own memory — its filing systems, its
vendors, its walls, its statutory posting rules. Appended by every session
that learns something about that state. The playbook is the method across all
states; `NOTES.md` is what is true of one.

---

## 6. The federal rung — solved once, nationally (added 2026-08-16)

**Every zip in the country resolves federal officeholders through ONE rung
now, and it is not a hunt.** `unitedstates/congress-legislators`, SHA-pinned,
carries the roster, the id crosswalk, birthdays, term dates, party, DC
contact, district offices, committees and membership, and official social
accounts for all 537 sitting members. See `docs/source-ladder.md` for the pin
and the two boundaries on it.

**What that means for a new state's depth run:** the federal tier is DONE
before the run starts. Do not hunt a member's phone number, district office
or committee seat — it is in the snapshot, joined by bioguide. A depth run's
effort goes to the state and local tiers, where nothing equivalent exists.

**What it does NOT solve, stated so nobody reaches for it:** it is a
DIRECTORY. No votes (the chambers), no money (FEC), no statements (PRL). And
it has no state or local scope at all — a state legislator's contact still
comes from the state's own roster, and a local member's from the body's own
page.

New commands: `pnpm congress:fetch`, `pnpm congress:migrate`.

### The two-column trap — a UI rung, but it belongs here

A row that puts a `white-space: nowrap` label beside a value in a fixed-width
card **will always eventually starve the value**, and the failure mode is
silent: the value renders one character per line and nothing errors. It shipped
to production twice from the same pattern — a person's name beside their
office title in a 300px popup, and it was about to do the same on the
who-governs card's seat rows.

**The rung, for any surface where a label can be arbitrarily long — an office
title, a body name, a jurisdiction:** stack it. Do not tune the width.
Measure it with `lab.scrollWidth > lab.clientWidth`, which is what "overflows
its box" looks like as a number.

### The .gov registry is a rung, never a denominator (2026-08-16)

`cisagov/dotgov-data`'s `current-full.csv` is the cheapest first rung in any
hunt for a body's own publications: 16,501 domains with the registrant's own
organization name and CISA's own `Domain type`. **693 of them are typed as
election offices** — City 332, County 288, State or territory 36, Special
district 33, Tribal 4 — and that is the named rung for a ballot or
candidate-filing hunt in a county nobody has worked before. Committed at
`data/dotgov/snapshot.json`, SHA-pinned, `pnpm dotgov:fetch`.

**Use CISA's `Domain type`, never a name match.** A name match on "vote" or
"election" would sweep in a town called Election and miss every secretary of
state; the registry already classified these and reading its answer is both
cheaper and right.

**It is a list of DOMAINS and it is never a coverage denominator.** A
government with no .gov domain is absent from it entirely — small towns,
school districts and special districts routinely publish on a `.org`, a
`.us`, a vendor subdomain, or a Facebook page — so counting .gov domains
would undercount exactly the bodies hardest to cover, which is the Sunnyside
class of miss. One government may hold several domains; a domain is not a
body. M still comes from the Census of Governments and the official rosters.

### A CSS state class must BEAT the base class, not merely differ from it

The confirmation pill shipped invisible for seven hours because
`.reaction-choice--settled` was written above `.reaction-choice` at the same
specificity: the base rule's background won on source order, and near-white
text on the panel ground measured **1.01:1** in light theme. Every class name
read correctly in review, and in DARK theme the same broken cascade measured
15.60:1 — so a dark-theme check would have passed it.

**The rung:** a state modifier for a base class is written as
`.base.base--state`, doubled, and sits with the base rather than above it.
**And the check is a computed RATIO in BOTH themes**, never a class-name
assertion and never a single-theme look — `tests/reaction-pill.test.ts`
resolves the rendered class list through the stylesheet by specificity and
source order and asserts the literal fill and a 4.5:1 floor.

### A scope-limited resolver states OUR scope, never THEIR absence

`representationForDivision` reads a POINT-SCOPED coverage summary, so every
district the reader is not standing in came back empty — and the empty array
rendered as "No sourced officeholder for this division yet" over people the
same page had already loaded. Measured before the fix: **24 of 24**
non-containing divisions we hold officeholders for rendered zero.

**The rung, whenever a resolver's answer depends on where the reader is:**
resolve by the OBJECT'S OWN KEY. An OCD-ID is already a path, so a route that
answers by division spells it as one — `/api/representation/ocd-division/...`
— and every cache keys on the division by construction rather than on a query
string a CDN may drop (D40). Bind the response to the key it was asked for
and discard one that names a different key.

**And there are THREE empties, not one:** we hold nobody (ours), the lookup
is still in flight (ours, and not an absence), the lookup failed (ours, and a
different fact again). Each gets its own sentence.

### Playwright `page.evaluate`: no inner functions, still, every time

Cost two runs this session on top of the two it has cost before. `tsx`
compiles `const fn = () => {}` inside an evaluate body into a call to
esbuild's `__name`, which does not exist in the browser: `ReferenceError:
__name is not defined`, thrown from inside the page. Inline the logic or use
a `for` loop. This is written down for the third time because it keeps being
rediscovered.

### REFERENCE IMAGES COMMIT TO `screenshots/` BEFORE A SESSION

Standing entry, carried forward: a brief that describes a reference image
without a repo path cannot be checked against it. Briefs point at repo paths.

### WHERE a fetch rung RUNS matters as much as what it does (2026-08-16)

The rung ladder has always been about the REQUEST — which client, which
headers, which URL. This session found the other axis, and it cost a
production outage before anyone looked.

`kearsarge.org` and `newbury.nh.gov` answer **200 to both the index profile
and the browser profile from a residential IP**, measured this session. The
same requests from a **GitHub Actions runner get 403**, and the log proves
`curl` ran and was refused too: a missing binary rejects with `spawn curl
ENOENT`, and every failed run recorded `HTTP 403`, which is the message
`curlGetText`'s own non-2xx path throws. So the wall is neither the TLS
fingerprint (the M79 finding) nor a missing tool — it is the **runner's
egress IP**, and no header, client or fingerprint change reaches it.

**The rung, written for the next state:** when a host that serves you refuses
the scheduled job, do not go looking for a better request. Record WHERE each
attempt ran. A rung is `(client, headers, URL, EGRESS)`, and a ladder that
records only the first three will send a session hunting a header that was
never the problem.

Two things follow, both shipped:

- The refresh must not overwrite good data with the absence a refusal
  produces (`lib/meetings/carry-forward.ts`, and the CLAUDE.md rule).
- An adapter serving several bodies across several hosts isolates them, or
  one host's WAF deletes bodies in another state.

### Kearsarge's neighbouring towns — rungs walked, nothing wired (2026-08-16)

03255's meetings-near view shows Newbury venues only. The other Kearsarge
towns hold meetings inside the radius. Rungs attempted, per town, so the next
session starts where this one stopped rather than re-walking:

| Town | Host | Index profile | What it publishes | Next rung |
|---|---|---|---|---|
| New London NH | `newlondon.nh.gov` (GovOffice) | 200 | `/calendar` renders ONE server-side `<table>`, no feed, no `dc:date` | a `month-table`-family parse, or a new shape |
| Warner NH | `warnernh.gov` (WordPress) | 200 | `/calendar` server-rendered; `/feed/` is the SITE feed; `/events/feed/` answers **200 with ZERO items**; no Tribe Events API (`/wp-json/tribe/events/v1/events` → 404) | parse `/calendar`; the empty feed is the empty-success shape and must never be recorded as a hit |
| Bradford NH | `bradfordnh.gov` | 200 | `/calendar` → **404**; the path is elsewhere | find the real path before claiming anything |
| Wilmot NH | `wilmotnh.org` (WordPress) | 200 | `/calendar` path present, not read to page level | probe the page |
| Springfield NH | `springfieldnh.org` (Weebly) | 200 | not read to page level | probe the page |
| Sutton NH | `www.suttonnh.gov` | **403** | — | **the browser rung** — 200 to a browser profile, measured. Same wall as Kearsarge and Newbury, and the same rung clears it. |

None is `NOT_ATTEMPTED` any more, and none is claimed as publishing nothing.
Every one is "exists, found, not wired", which is a work item.

## Verification rungs, not source rungs — what g5 added (2026-08-16)

This file is mostly about reaching records. This entry is about proving a
surface is right once the records are in it, because the same session lost
half a day to a measurement that was green on a broken build.

**A visual measurement that cannot distinguish correct coverage from
incorrect coverage is not a correctness test. Every visual guard must assert
WHAT is affected, not only how smoothly.**

`pnpm measure:extrusion` measures how smoothly the state effect's edge falls
off, and it passed at full marks on a build whose mute covered the entire map
at the zoom a reader lands on — including the state the reader was standing
in. A perfectly smooth gradient over the wrong area is still the wrong area.
The rungs that follow from it, in the order they are worth trying:

1. **Anchor a visual check to the SUBJECT, not to pixels.** Sample real
   lng/lat through the live projection, so the check follows the geometry the
   feature is supposed to follow. A hard-coded pixel is only correct at one
   camera.
2. **Sample far from where the reader is looking.** The defect was invisible
   to anything that sampled near the entered zip, because near the centre
   there is nothing to compare against. North Tucson and Drexel Heights
   caught it; downtown never would have.
3. **Compare the surface against ITSELF with the feature disabled**, never
   against a different part of the same frame. Terrain, tiles and labels vary;
   only the feature may differ between two frames of the same camera.
4. **Read the exclusion distance off the shipped spec, never as a constant.**
   A fixed "sample 80 px inside the border" exceeded New Hampshire's own
   width at continental zoom, so the check could not run exactly where the
   defect was hardest to see — and the standing fix for a check that cannot
   run is always to loosen it until it proves nothing.
5. **A measurement that can pass while wrong needs a second measurement of
   the other quantity.** Smoothness and coverage are different questions and
   the same instrument cannot answer both.
6. **Where the DOM is right and the pixels are wrong, measure pixels.**
   `getBoundingClientRect` is layout, not paint. A panel whose rows were
   present, positioned and counted correctly rendered nothing at all.
7. **An intermittent defect is measured as a RATE.** The first A/B of the
   panel's paint failure looked decisive and was not — the control arm
   painted on its second run. Repeat every arm and print "n of m", or the
   result is whichever answer the tester wanted.
8. **A browser check for a no-hover defect must never move the mouse.**
   Playwright's own `click()` moves the pointer, and a pointer move was the
   thing that repaired the defect. Open with a DOM `click()` from inside the
   page.
9. **Chromium DROPS geometry it cannot rasterize rather than clamping it**,
   and a dropped mask reads as full coverage. Measured: an identical-topology
   clip path is honoured at ±2000 px and dropped at ±8000. Anything projected
   to screen and handed to a clip, mask or filter is cut to the viewport
   first. This is the same wall g5's predecessor hit at the SVG filter region
   and it will be hit again.

---

## The denominator comes from outside, and it is a TWO-STEP (2026-08-16, h)

Append-only, per R13. What the h depth run at 03255 added.

An official count is not a denominator. "Merrimack County contains eighteen
special districts" does not establish that eighteen special districts touch
this zip. **Step A** is the authoritative universe; **Step B** is the
jurisdiction mapping; skipping B leaves you with a number rather than a
denominator, and skipping A leaves you with a registry that defines its own.

1. **Enumerate EVERY county the serving radius reaches, not the county the zip
   is in.** 03255 sits in Merrimack County and its 25 km circle crosses into
   Sullivan and Hillsborough. Before this run the official denominator for
   03255's meetings-near universe **did not exist in the repository** — the
   committed extract held Merrimack alone. Enumerating one county and calling
   it the neighbourhood is the Sunnyside miss with a wider radius.
   `pnpm gus:extract <unpacked-xlsx-dir> <FIPS>...` does step A for any county
   in the country.

2. **Special districts resolve to `UNRESOLVED`, never to `false`.** The Census
   publishes **no boundary for special districts at any vintage**, so geometry
   cannot answer whether a village district reaches a zip. Forty of 03255's
   166 enumerated units are in this state. Recording them as "does not govern"
   because no boundary was found is the render-default rule's manufactured
   claim, one layer upstream in the data.

3. **Carry TWO distances and label which is which.** `boundaryKm` — nearest
   point of the unit's own territory, generous, the upper bound on what could
   possibly show. `venueKm` — the unit's published administrative address, a
   PROXY for where it actually sits, and what decides whether a pin appears.
   At 03255 they differ by eighteen units. A single number smuggles one answer
   in under the other's name.

4. **UNITS are not BODIES, and no external enumeration exists for bodies.**
   The Census counts one row for the Town of Newbury; the product's
   denominator is its Selectboard, Planning Board, Zoning Board of Adjustment,
   Conservation Commission and the rest. So the body universe is a two-layer
   denominator: the unit universe is authoritative and external, the body
   universe per unit is a hunt against that unit's own published board list.
   A unit whose board list has not been read is `BODIES_UNENUMERATED` — a
   named gap, never a body count of one.

5. **State and federal seats are in neither universe.** The Census enumerates
   governments, not offices. Governor, Executive Council, state senate and
   house, congressional and Senate seats have to be carried separately or they
   silently vanish from a "complete" count.

## Reading a CMS page: strip the navigation before harvesting anything

The single highest-yield rule this run produced, and it nearly cost a false
finding.

**Every page on a CMS site carries the same menu, and the menu is the site
talking about itself — not the page answering your question.** Harvesting town
names from Kearsarge Regional School District's pages returned *Bradford, New
London, Sutton*: the three towns with school BUILDINGS, named in the navigation
of all 496 pages. The district's actual membership is **seven** towns, and a
regional district by definition serves towns with no school of their own —
Newbury, Springfield, Warner and Wilmot are exactly those four.

The three-town answer is plausible, confidently derivable, and wrong. Cut
`<nav>`, and cut everything before the last shared navigation landmark, before
any harvest.

- **A regional board seats its members BY TOWN**, so its members page answers
  the roster AND the membership in one fetch. Take both while you are there:
  reaching the page is the expensive part, and a second visit for the second
  field pays the whole discovery cost again. Kearsarge's also volunteered year
  first elected, term expiry and committee assignments, none of which the
  field matrix asked for.
- **Never read a member list off a map.** Goshen is 8.5 km from 03255 and is
  not a member; Warner is 14.2 km and holds three of nine seats.

## A rate wall is not a fingerprint wall

`kearsarge.org` already had a recorded wall — the TLS/HTTP2 fingerprint filter
(2026-08-15, M79), where a full browser header set from Node is refused and
`curl` with identical headers is served. It has a **second, different** one:
`robots.txt` publishes `Crawl-delay: 10` and the host enforces something like
it. A burst of fetches earns HTTP 403 where the **same client, paced**, is
served 200.

Two walls on one host, and the wrong diagnosis sends you hunting clients when
the answer is patience. **Read `robots.txt` for the crawl delay before
deciding a 403 is a fingerprint**, and retry once after a full delay before
escalating a rung. This is a technique inside rungs 3–4, not a new rung.

- **Read the vendor off the page footer rather than guessing it.** This host
  was tagged Schoolwires/Apptegy on a guess; the footer says **CivicPlus**.
  That matters operationally: rung 12 — the vendor platform underneath — is
  only reachable once you know which platform, and CivicPlus is already named
  in the ladder's own text.

## An empty spreadsheet cell can eat its neighbour

For any `.xlsx` the ladder's rung 9 hands you — and government data arrives as
`.xlsx` constantly.

An empty cell is written self-closing, `<c r="G24141" s="12"/>`, and a naive
`/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/` matches it anyway: `[^>]*`
absorbs the trailing slash and the lazy body runs on to the NEXT cell's
`</c>`, swallowing it whole. **Every column after the first empty one reads
shifted.**

The symptom is the dangerous part. A shifted column does not look like a parse
bug; it looks like a **data difference**. Twelve of Merrimack County's eighteen
special districts vanished from the first extraction because their
`FIPS_STATE` had slid one column left into `WEB_ADDRESS`, and the natural
reading was "the 2022 workbook disagrees with our committed extract."

- **Branch on the self-closing slash explicitly.** Do not let an attribute
  class swallow it.
- **Print rows read, rows matched, and the per-category split on every run.**
  This was caught only because a whole class of government came back
  suspiciously small against a number already held. Without the count, it
  reads as a clean run.
- **Prefer `FIPS_STATE` over `STATE` in Census workbooks.** `STATE` is the
  postal abbreviation; the numeric code is in `FIPS_STATE`, and preferring the
  wrong one matches zero rows in every county.

## A count derived at read time stops being true when the data grows a new case

The scheduled meetings refresh failed twice on `snapshot holds 217 meetings
but sources claim 193`. Nothing about the retrieval was wrong: 193 rows were
fetched fresh and 24 were carried forward for a source the CI runner's egress
cannot reach. The gate was right to refuse — what it was measuring had gone
stale.

The invariant was written when a snapshot held exactly one kind of row, so
"the rows present" and "the rows this run fetched" were the same number and
either could stand for the other. Carry-forward introduced a second kind and
never told the arithmetic. **A derived count is a claim about an assumption,
and the assumption is invisible in the expression that derives it.**

- **Record the number at the moment it is true, beside the thing it counts.**
  The snapshot now states `fresh`, `carried` and `total`, written where they
  are produced. The old expression is still there — it just has to agree with
  a recorded number instead of standing in for one.
- **A count must be recountable against its own rows.** The per-source
  `carriedForward` number had existed for a day and could not be checked
  against anything, because no ROW said it was carried. Marking the rows is
  what turned a claim into a measurement.
- **When a gate fails on real data, suspect the gate's model before the
  data.** "Loosen it to `>=`", "skip it when carried rows are present", "make
  the per-source claims include the carried rows" — each makes the failure go
  away and leaves a test that cannot tell correct from incorrect.
- **Plant the failure before trusting the fix.** Four mutations of the real
  committed file (counts block removed; fresh disagreeing with the per-source
  sum; a carried row with no last-fresh instant; fresh + carried not closing)
  were each run against the real gate and each failed it. A test written after
  a fix and never seen fail proves nothing.
- **The same defect has a render half, one layer up.** Every reader-facing
  freshness statement derived from the snapshot's single `generatedAt`, so the
  footer said "last checked 6 hours ago" about rows nobody had reached in a
  day. Where data grows a second kind, look for every surface that summarizes
  it with one number.

## A vendor subdomain that does not exist can still answer 200 (D22, 2026-08-17)

NovusAgenda serves an `Error.aspx` page — styled, logo'd, with a working left
nav — for **any** `<anything>.novusagenda.com/agendapublic/` subdomain that has
no tenant behind it. It answers HTTP 200, 1384 bytes, `Microsoft-IIS/10.0`, and
the only thing distinguishing it from a real tenant is the `action="Error.aspx"`
on its form and a base64 `__VIEWSTATE` that decodes to "An HTTP error occurred."

Twenty-three candidate tenant names were probed for the four zips' bodies.
Twenty-two returned that page. One — `vailschools` — returned a real 78 KB
portal carrying **zero** meeting rows, which is the archive already recorded on
D22.

Three rungs come out of this and they generalize past this vendor:

- **A per-client subdomain is a namespace, and a namespace can have a
  wildcard.** "The subdomain resolves and answers 200" is not evidence that a
  body is a client. Probing tenant names is still a good rung — it is how you
  find a tenant nobody linked — but the ANSWER has to come from the content.
- **Measure the body against a sibling you know is real.** 1384 bytes against
  78576 bytes settles it in one comparison; a status code never would. Where a
  vendor namespace is being swept, fetch one known-good tenant in the same run
  so there is a length and a shape to compare against.
- **This is the fifth sighting of "exists and carries nothing".** The others:
  an empty RSS feed recorded as working, a zero-match join presented as a clean
  build, a scripted edit that edited nothing and exited 0, and the original
  NovusAgenda 200 that D22 was opened on. The rung is always the same — ask
  what came back, by count, and compare the count to something.


## An egress wall is intermittent, and the ladder rung to walk is a DIFFERENT EGRESS (g13, 2026-08-18)

Rung 5 already says a CI runner's refused IP is an egress wall and not a header
problem. This adds the shape that made it hard to see, and it is worth its own
paragraph because the tell is a *pattern across runs*, not a single response.

`revize` took `HTTP 403 for https://www.merrimackcounty.net/` on the scheduled
refresh, and `iqm2` failed the same run. Both had succeeded from the same
runner six hours earlier and both succeeded again six hours later. Meanwhile a
plain `curl` from a developer's egress — **no browser headers, no client swap,
nothing from rungs 3 or 4** — returned 200 and 184 KB, with the notices page's
sixteen dated documents intact.

Three things follow, and each cost time before it was written down:

- **Do not hunt headers on an intermittent 403.** Rungs 3 and 4 are the natural
  reflex and they are the wrong ladder entirely. One fetch from a second egress
  settles it in seconds: same client, same headers, different IP.
- **The confirmation is CONTENT, not the status code.** A 200 from another
  egress only proves the host answers you. Fetch the actual page the adapter
  parses and count what is on it — sixteen dated PDFs spanning 2.9.26 to
  8.24.26 is what rejects "the archive moved or vanished upstream". A status
  code alone would have left that suspect open.
- **An intermittent egress wall is a WAF reputation call, not a policy.** There
  is nothing to negotiate and nothing to route around permanently; the correct
  response is that the pipeline survives it honestly. That is what
  carry-forward is for, and it is why `publishedLookbackDays` now exists: a
  source refused for one run must come back whole, not partly.

**The failure this uncovered, worth checking on any source with an archive
rung:** carry-forward clipped the carried rows to the app's 90-day serving
window, but the revize archive rung applies no back clip at all. Eight of
fourteen sittings carried and six vanished. Where an adapter deliberately
retrieves further back than the serving window, its carry-forward window has to
say so — otherwise a refused run silently returns a shorter archive than the
last good one, and the count line reads "8 carried" with nothing to compare it
against.

## A relative document link resolves against the SECTION PATH, and 404s from outside (g18, 2026-08-18)

Found hunting Merrimack County's public comment policy (D25). The Board's
notices page names the policy and links it, and following that link from
outside the site returns 404 — as does every other document on the page.

**What is actually happening.** The CMS serves the page under a section path
(`/board_of_commissioners_/public_notices,_agendas,_minutes,_.php`) and writes
its document hrefs RELATIVE. Resolving a relative href against that page URL
builds `/board_of_commissioners_/Board%20of%20Commissioners/…`, which does not
exist. The documents live at the **site root**:
`https://www.merrimackcounty.net/Board%20of%20Commissioners/…`.

**The rung.** When a document link off a CMS page 404s, strip the section
prefix the page itself is served under and re-resolve from the root before
concluding anything about the document.

**What proves it is the path and not the file**, and this is the checkable
half: fetch a SECOND document from the same page. Every document 404ing the
same way is a path fault; one document 404ing while its siblings answer is a
missing file. Merrimack's `Public Notice 2.9.26.pdf` 404'd identically, which
settled it in one extra fetch.

A 404 here is not "the body publishes no policy". It is a URL this end built
wrong, and reporting it as an absence would have been asserting absence from
our own bug.

## The comment-access rung is the policy CODE, not the meetings page (g18, 2026-08-18)

Also from D25, and it generalises past one district.

- **A school board files its rule under a policy code.** Tucson Unified's is
  **BEDH, "Public Participation at Board Meetings"** — the NEPN/ASBA code most
  American districts use. Going straight to the manual's section index and
  looking for BEDH beat reading agendas. Try BEDH first on any district with a
  coded policy manual.
- **A county or municipality's rule is on its OWN site, not the vendor's.**
  Morris County's `iqm2` calendar answers 200 and contains no comment language
  at all, because a vendor calendar is a list of dates. The rule was one fetch
  away on `morriscountynj.gov`.
- **"public comment" is a FALSE-LEAD string on a school board site.** Tucson
  Unified's `/Comments` page matched it and is about commenting on PROPOSED
  POLICIES during their reading period — nothing to do with speaking at a
  meeting. Match the string, then read what it is attached to.
- **Ask whether the rule distinguishes MEETING KINDS before recording it.**
  Morris County has a comment portion at every evening meeting and none at its
  5 p.m. work sessions unless the Director grants one. A row that said "there
  is a comment period" would have sent a reader to a work session to speak.

## Read the body's OWN AGENDA before the law that created the body (g19, 2026-08-18)

Five Tucson boards sat as honest `UNKNOWN` comment-access rows for four
sessions. Every hunt read the Clerk's per-board PAGE — schedule, venue, roster
— found no comment procedure, and went looking for a harder rung. g18 re-walked
those pages, confirmed there is no shared platform-level rule, and named the
Tucson City Code chapter creating each board as the next target.

**The rung that actually closed all five was one rung LOWER and free.** The
board page links its own agenda:

```
https://clerksboards.tucsonaz.gov/boards/?run=currentagenda&board=<N>
https://clerksboards.tucsonaz.gov/boards/?run=pastagenda&board=<N>
```

and the agenda PDF carries the participation rule in its standing header —
ladder rung 9, linked documents in every format. All five closed in one pass,
each with a DIFFERENT rule, which is why no single code chapter could have
closed them either.

**The generalisation: a published agenda is the body describing its own
meeting, in its own words, on the record.** When a body's landing page is
silent about procedure, the agenda is the next rung, ahead of the statute, the
charter and the code. It is cheaper, it is per-body, and it is the body's own
voice rather than a general rule that may or may not bind this board.

Two traps came with it, both live:

* **`currentagenda` is often a CANCELLATION NOTICE**, not an agenda. Tucson
  board 38's current agenda was one page saying the August meeting was
  cancelled — no procedure, no items. Fall through to `pastagenda` and take a
  real one. A cancellation notice read as "the agenda carries no rule" is a
  false miss.
* **An agenda ITEM DURATION is not a per-speaker time limit.** Two of these
  boards publish timed agendas — "4. Call to the Audience – 2 minutes (1:06
  p.m.)". That is the slot the item occupies, not what one speaker gets.
  Rendering it as a speaker limit would be a fabricated rule about a real
  body. Where no per-speaker number is published, the field stays null.

## A path-scoped WAF: the root answers, the deep link refuses (g19, 2026-08-18)

Newbury, NH was recorded by g18 as a WALL — HTTP 403 at rung 2 (plain fetch,
identified UA) and rung 3 (full browser header set) — with rungs 4, 5, 6 and 11
named as next. **Rung 4 was enough, and it took one command.** `curl`, sending
the SAME identified User-Agent that had just been refused, is served HTTP 200.
So it was a TLS-fingerprint filter, exactly the class curl beat in the f
session, and not an egress problem and not a header problem.

The new part is what the 200 did NOT cover:

```
https://www.newbury.nh.gov/                      curl → 200   (80,561 bytes)
https://www.newbury.nh.gov/selectboard           curl → 200   (90,511 bytes)
https://www.newbury.nh.gov/administration/...    curl → 403
https://www.newbury.nh.gov/minutes-and-agendas   curl → 403
```

**The filter is path-scoped as well as fingerprint-scoped.** A 403 on the URL
you were handed is not evidence about the host. Re-enter at `/` and walk the
site's own navigation: the rule was three links from the front page the whole
time, in a PDF titled with the town's own typo ("Selecboard Public Input Rules
of Participation"), which is also why a title search would have missed it.

**Corollary worth more than the row it closed:** the walled
`/administration/links/selectboard-meeting-minutes-agendas` path 302-redirects
to `newburynh.civicweb.net/Portal/MeetingTypeList.aspx` — a **CivicWeb**
portal that answers 200. Reading the redirect target of a refused URL is free
and identifies the vendor platform (ladder rung 12). Newbury's meetings have a
vendor platform underneath and nothing in this repo knew it.

## A New Jersey municipality's comment rule lives in the CODE (g19, 2026-08-18)

Rockaway Township, NJ: g18 fetched three township-website pages — the council
page, AgendaCenter, and the council-meetings page — HTTP 200 each, 112KB to
203KB, and **no comment language of any kind on any of them**. Not a wall and
not an emptiness: the rule was simply somewhere else.

It is in the township CODE, on eCode360: **§ 2-5.14, "Addressing the Council"**
(three minutes in the regular public portion, two minutes on an ordinance
outside it, presiding officer may grant more), with § 2-5.7 putting "Open to
the public" fifth on the order of business.

The rung, stated generally: **for a New Jersey municipality, go to the
municipal code's council-procedure chapter before its CivicPlus pages.** The
Open Public Meetings Act pushes the rule into an ordinance, and an ordinance
lands in the codified code — which is indexed, searchable and stable — while
the website carries meeting logistics. Find the code host by searching
`<municipality> <state> eCode360` rather than guessing the customer id: the
short ids (`RO1130`) 404, and the code lives at a numeric guid
(`ecode360.com/33531816`) that only search returns.

`verifiedAt` stays null on these: eCode360 is a third-party publisher, not the
township's own host, so it is a second-rung read under the verification rule
however faithful the text is.

## Widening a schedule grammar is how a body escapes a "publishes nothing" bucket (g19, 2026-08-18)

Tucson's 56 Clerk boards were re-classified by fetching all 56 pages again and
running every published Meeting Time through the grammars the parser ships
TODAY, rather than carrying the previous session's classification forward. The
result: **27 parseable, 29 declined, 27 + 29 = 56.**

Two of the three that moved were already named as parser gaps. **The third was
not, and it is the lesson**: board 130 publishes "4th Wednesday of THE month @
5:30 p.m." — an ordinary Nth-weekday rule that the recurrence regex declined
because it required the word "each". So it sat inside the "publishes no fixed
schedule" bucket, looking like a finding about the body when it was a finding
about our own regex. **One word.**

The discipline this pays for: **a classification count is re-measured against
today's parser, never inherited.** A bucket labelled "publishes nothing" is a
claim about somebody else, and every grammar widening silently makes that claim
staler. Re-running the classification is cheap; the claim is not.

Two grammars were added at the same time and both are general:

* **Month-restricted Nth-weekday** — "Quarterly basis: every 3 months on the
  3rd Monday (Jan, Apr, Jul, and Oct)". The months come from the parenthetical.
  "Quarterly" with no months named is DECLINED, because the word alone does not
  place a date.
* **Month-name dates** — "January 22, April 16, 2026 and July and October 2026
  TBD". A month with no day yields no date and is never rounded to the 1st: the
  body has said it will meet and has not said when, which is a different fact
  from a date we could print.

The bug inside the second one is worth carrying: `(\d{1,2})?` for the day
greedily ate the first two digits of a bare four-digit year, so "October 2026"
parsed as **day 20** — a date the body never published, invented by a
quantifier, with the year left unset. The day group needs a non-digit after it.
A greedy quantifier next to an optional year is a date-fabrication machine.

## An index that carries IDs and no titles: searching its text is a FALSE MISS (g19, 2026-08-18)

The House publishes an index of every roll call it has taken. It carries the
congress, the session, the roll number, the result, and the bill's TYPE and
NUMBER. It does not carry a single bill title.

So searching that index for "stock" returns zero across 645 roll calls, and
the sentence that wants to come next — "the House has not voted on banning
congressional stock trading" — is a claim about the House built entirely out
of a fact about the index. It is the false-miss shape at its purest: the
answer is right there and we asked the wrong question of it.

The rung is one step further in. Take the DISTINCT measures the chamber
actually voted on (645 roll calls collapse to 397 measures), resolve each to
its official title, and search the titles. H.R. 7008, the Stop Insider Trading
Act, is the third hit. Then read that bill's own actions for the roll call —
roll 280, on passage, 232-198, verified at the Clerk's own XML where the party
totals add to exactly that.

**The general rule: before concluding from a search, ask what the thing you
searched actually contains.** An index of identifiers cannot answer a question
about subjects, however many rows it has. Cache the resolved titles — 397
requests once is fine, 397 requests per run is not.

## A bill folded into another one appears in NO public-law list (g19, 2026-08-18)

The April 2024 package: the House passed four separate bills, the Senate took
one of them as the vehicle and passed the package, and **only the vehicle
became a public law**. So three of the four appear in no public-law list, for
any congress, under any title — searching `/law/{congress}` for "Israel
Security Supplemental Appropriations Act" is structurally guaranteed to return
nothing, and reporting that as "no such law" describes our route rather than
the record.

The record names them itself. `/bill/{congress}/{type}/{number}/relatedbills`
on the vehicle (H.R. 815) returns all four by their official titles with their
bill numbers. Read from the official record, never typed from memory.

**Generalised: when a measure is missing from the list it "should" be in, ask
what it was folded into, and read the container's own cross-references.** A
bill, an amendment, a consolidated appropriation and a reconciliation package
all do this.

## PDF agenda text: two extraction traps, both caught by the real corpus (g19, 2026-08-18)

Extracting agenda ITEMS out of PDF text that has lost its layout. Both of
these produced confident, wrong, reader-facing rows against the committed
corpus, and neither would have shown up against a hand-written fixture.

**A single-letter item marker is ambiguous with an abbreviation.** Agendas
really do letter their items — "A. Hearing - Rezoning Closure" — so `[A-Z]\.`
looks like a fair marker. It also matches `W. Congress Street, 1st Floor`,
which was extracted as an agenda item off a Pima County agenda, twice.
Compass directions (N/S/E/W) at the head of a line are addresses far more
often than items; refusing them loses a genuine item lettered W. if one ever
exists, and that is the right trade, because losing a true row costs less than
printing a false one.

**A numeric marker fires mid-sentence.** Splitting on `(?=\s\d{1,2}\.\s+[A-Z])`
turns "Cable Channels: Cox 96. Television viewing will be available in the
lobby" into an agenda item that is half of somebody's sentence about a cable
channel. An agenda item begins after the previous one ENDS, so require the
marker to follow a sentence terminator: `(?<=[.:;)])(?=\s\d{1,2}\.\s+[A-Z])`.

**And the quantifier trap beside them, from the same session's date parsing:**
`(\d{1,2})?` for a day, sitting next to an optional four-digit year, ate the
first two digits of the year — "October 2026" parsed as **day 20**, with the
year left unset. A greedy quantifier next to an optional year is a
date-fabrication machine. The day needs a non-digit after it.

The discipline all three share: **run the parser over the real corpus and read
the output**, not just the count. Every one of these passed its own tests and
produced a wrong row on real text.

## A guard on the SIZE of a result does not guard its IDENTITY (g19, 2026-08-18)

A fetch script rewrote a committed artifact and lost verified data while
reporting success. The first fix was "never write FEWER refs than are already
there". It was not enough: it preserved the COUNT and allowed a REPLACEMENT,
and the next run swapped one entry's verified roll call for a different one of
equal length. The count-based guard passed it.

**Same-count is not same-answer.** Where the existing value is a verified
claim, the rule has to be FILL-ONLY — a run may populate what is empty and may
not touch what is resolved — because changing a resolved claim is a correction,
and a correction is a deliberate edit by someone who has read both, not a side
effect of a refresh.

The related discipline, which cost a same-session diff against `git HEAD` to
notice: **a total that stays flat can hide a component that fell.** The run
printed "18 of 20 carry at least one roll call", which was true before and
after, while House coverage went 18 to 15 — the entries kept their Senate refs.
Report the components, not just the total.

---

## 2026-08-19 (g20) — five rungs, from four real walls

### 1. A New Hampshire STATE host is a different wall from a New Hampshire MUNICIPAL one

The playbook already records Newbury falling at rung 4: curl, sending the same
identified User-Agent that got a 403, is served 200. **That does not
generalise to the state's own hosts.** Three `*.nh.gov` state hosts —
`www.governor.nh.gov`, `www.council.nh.gov`, `cfs.sos.nh.gov` — refuse this
egress at rungs 2, 3 AND 4 alike: an identified User-Agent, a full browser
header set, and a browser User-Agent through curl all take a 403 of 370–422
bytes titled "Access Denied".

**The rung that clears it is 6, the live browser.** `cfs.sos.nh.gov` renders
fully in a real Chromium from the same machine and the same IP that curl is
refused from, which means the filter is on the CLIENT rather than the egress.

So: on a `nh.gov` host, do not spend rungs 3 and 4 hunting headers. Try rung
4 once (municipal sites still fall there) and go straight to rung 6.

### 2. Rung 11 is cheap and should be wired in, not walked by hand

Where a host refuses every rung, the Internet Archive frequently holds the
page — and an archived copy of a government's own page is that government's
own published words with a date attached. `scripts/fetch-candidate-corpus.mts`
now calls `archive.org/wayback/available` automatically on any non-OK
response and records what it found beside what the live host did. It found
`governor.nh.gov` at 2026-06-16 and `council.nh.gov` at 2025-05-24 on its
first run.

Record the snapshot as what it is — the archive's URL and the archive's
timestamp. Never restamp it as a fresh read of the live site.

### 3. A 405 from a single-page app is NOT evidence that a route exists

Probing five invented `/api/...` paths on `cfs.sos.nh.gov` returned **405
Method Not Allowed** for every one, which reads exactly like "the route is
there and POST is the wrong verb". It is not. The same paths answered **200
with the 65,928-byte SPA shell** to a GET: the host serves a catch-all, and
its static handler rejects POST on everything.

**Disprove a 405 with a GET before recording a route.** Five plausible
endpoint names were one step from being written down as findings.

### 4. An SPA's API base lives in the LAZY chunks, not the main bundle

`main-*.js` on an Angular build carries the router and the chunk names and
nothing else useful. Grepping it for `/api/` returns zero. Fetching all 50
chunks it names and grepping those returns the API host in one line —
`https://cfsapi.sos.nh.gov/api` for the New Hampshire Campaign Finance
System, a hostname that is not guessable from the site's own.

The sweep is one browser call: read the main bundle, extract every
`chunk-*.js` it names, fetch each, and search the lot.

### 5. A cross-origin API host needs the tab NAVIGATED to it, not fetched from the page

`fetch("https://cfsapi.sos.nh.gov/...")` from a page on `cfs.sos.nh.gov`
fails with `TypeError: Failed to fetch` — that is the browser's CORS block
and says nothing about the server. Navigating the tab to the API host itself
turns the same requests into 200s.

A "Failed to fetch" from a page is not a wall on the server. It is a wall
between two origins, and the way past it is to stand on the other one.

## Rungs discovered by g21, 2026-08-19 (the voting-locations hunt, B19/B16)

Append-only, per R13. Six entries, all from real walls.

### 1. A CivicPlus page's own widget state names the map app, and the map app's item data names the data

The chain that landed Pima County's 148 vote centers is three rungs deep and
none of them is HTML scraping:

1. **Rung 8** — `www.pima.gov/3199/Pima-Votes` is CivicPlus, and its page
   embeds its whole widget tree as JSON. A `Voting Locations` BUTTON in that
   JSON carries `"link":"https://experience.arcgis.com/experience/<id>/"`.
   The prose said "here is a map"; the markup said which map.
2. **Rung 12** — an ArcGIS Experience Builder app's configuration is public
   at `https://www.arcgis.com/sharing/rest/content/items/<id>/data?f=json`,
   and `.../items/<id>?f=json` names its OWNER, which is how you prove the
   app is the authority's own rather than a lookalike (`julia.jones@pima.gov_Pima`).
3. **Rung 7** — grep that config for `FeatureServer|MapServer` and the data
   layers fall out. Query one with
   `/0/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=json`.

Any county whose "find your polling place" is an ArcGIS map is reachable this
way, and what comes back is better than the HTML: coordinates, election
labels and room names, machine-readable, from the authority's own service.

### 2. An ArcGIS ORG SEARCH finds layers the same body's open-data portal does not list

`gisopendata.pima.gov` publishes 190 datasets and NOT ONE polling or voting
location among them — g20 recorded that correctly, and it is true of the
portal. It is not true of the county.

`https://www.arcgis.com/sharing/rest/search?q=orgid:<ORGID>+(vote OR voting
OR poll OR election)&sortField=modified&sortOrder=desc&f=json` returned 33
items on Pima's org, including "Election Day Vote Centers", "EVS Locations"
and "mobileVotingSites", all edited the day of the walk.

**A body's open-data portal is a CURATED subset of what it publishes.** The
org search is the uncurated one. Get the org id from any one of the body's
feature-service URLs (`services2.arcgis.com/<ORGID>/...`) or from an item's
`orgId`.

### 3. A found endpoint gated by a captcha is a rung WALKED AND REFUSED, not a wall

New Hampshire's statewide list of clerks and polling places
(`app.sos.nh.gov/statelistclerkandpolling`) refuses rungs 2, 3, 4, 5, 6 and 9.
Rung 11 recovered the archived Angular bundle, and the bundle named the
endpoint: `ClerkandPolling/GetClerkandPollingList`, with `GeneratePDF` and
`GenerateCsv` beside it.

**It was not called.** The tool gates that call behind reCAPTCHA, and
circumventing bot detection is one of the four things `CLAUDE.md` says we
never do — alongside authenticating, breaching clickwrap, and degrading
service.

Record it as what it is: the rung was reached, the door was found, and it was
left shut on principle. That is neither a wall nor an exhaustion claim, and
the next rung (13, the Department of State's public-records request path) is
where the next session starts.

### 4. `sos.nh.gov` and `app.sos.nh.gov` refuse rung 6 as well — g20's entry 1 does not reach them

Entry 1 above says NH state hosts fall at rung 6, the live browser. That was
measured on `governor.nh.gov`, `council.nh.gov` and `cfs.sos.nh.gov`, and it
holds for those three.

**It does not hold for the Department of State's own hosts.** A real headless
Chromium, JavaScript executed and content awaited, takes a 403 from both
`www.sos.nh.gov` and `app.sos.nh.gov`, with an Akamai body
(`errors.edgesuite.net`, `Reference #18....`). A hosted fetcher on a
completely different network takes the same 403, so it is not this egress
alone.

Two walls wear one hostname suffix. Do not generalise a `*.nh.gov` result
from one host to another; measure the host you are on.

### 5. A layer's `dataLastEditDate` is the rung that decides whether geometry is usable

New Jersey's own Office of GIS publishes statewide `Election Districts for
New Jersey` and `Ward Boundaries for New Jersey` — an unambiguous rung-12 hit
from the state's own organisation, exactly the geometry a precinct-level
polling-place answer needs.

Its `editingInfo.dataLastEditDate` is **2021-11-24**, and the publisher's own
title begins `MATURE SUPPORT`.

A HIT is not the end of the check. Every ArcGIS layer's `?f=json` carries
`editingInfo` with `lastEditDate`, `schemaLastEditDate` and
`dataLastEditDate` in epoch milliseconds, and a layer five years older than
the election it would be used to answer about is not usable for that answer.
**Read the edit date before building on the layer**, and where it fails,
refuse with the date named rather than shipping a stale assignment.

### 6. An HTML table's `rowspan` silently drops rows, and the drop looks like the authority's silence

Morris County's polling-place tables share one location across several wards
with `rowspan`. A naive read — split `<tr>`, split `<td>` — gives Boonton's
ward 1 a location and wards 2, 3 and 4 nothing, which renders as a town
whose county published no location for most of its voters.

Carry a pending-spans map keyed by column when parsing any government table.
The parser in `scripts/fetch-voting-sites.mts` is the shape.

Same run, same class: the first cut **dropped** any site whose address did not
geocode, and 25 real published locations vanished — a cross-street address
("21 Blue Mill Road & Sand Spring Rd") is not something the Census one-line
geocoder resolves. A retrieval failure on our side may never be written into
the data as the authority not having published. Keep the row, drop the pin,
and say which.

## The Kearsarge towns, walked to page level — g21, 2026-08-19 (M123)

The table at the top of this section recorded these six towns at host level.
This is what they look like from the page.

### 7. An `.ics` feed serves the CURRENT VIEW, not the calendar — a 5x silent clip

`https://www.wilmotnh.org/events/?ical=1` returns **four** events. HTTP 200,
`text/calendar`, valid iCalendar, nothing to complain about.

`https://www.wilmotnh.org/events/list/?ical=1` returns **twenty-three** — the
same total the plugin's own REST API reports at
`/wp-json/tribe/events/v1/events`.

The default URL exports whatever view the page is on, and the default view is
the month. Nineteen public meetings are missing and every signal says the
retrieval worked. **Name the list view explicitly, and cross-check the count
against the plugin's own API before believing a feed.**

### 8. `CATEGORIES` is how one town feed serves several boards

The Events Calendar files each event under the board that owns it —
`Select Board`, `Planning Board`, `Cemetery Trustees`. That is better than
matching on the title, and it is better in a way that matters: Wilmot files a
"Transfer Station Advisory Group meeting" under Select Board, which a
title match would have dropped and which is a real sitting of that board.

Where a feed carries no categories, the fallback is a title match, and a title
match with no needle must match NOTHING rather than everything.

### 9. A month GRID does not have to be parsed as a grid

New London's GovOffice calendar is a `<table>` of day cells. Every event
inside one carries its own tooltip block:

```html
<div class="eventTip">
  <div class="tipTitle">Board of Selectmen - 5:30 PM - Whipple Memorial Town Hall</div>
  Thursday, August 20, 2026 at 5:30 PM
</div>
```

Date, weekday, year and time, in the town's own words, beside the title —
which also names the room. So the grid's geometry never has to be understood,
and there is no cell-position arithmetic to be wrong about.

**But it serves ONE MONTH**, and the page publishes its own
`?Type=B_EV&SEC=<id>&month=9&year=2026` navigation. A row that reads only the
default view reports this month as the body's whole calendar — for a board
that sits twice a month, two sittings — and that reads exactly like a body
with nothing scheduled.

### 10. Sutton's browser rung no longer clears it (dated note on the table above)

The table above records Sutton NH as **403 to the index profile, 200 to the
BROWSER profile**. On **2026-08-19** `www.suttonnh.gov` and `suttonnh.gov`
both answered **403 to both profiles** from this egress. The entry is not
deleted — this file is append-only and the next state may hit the same wall
from a different side — but a session starting from it should expect the
browser rung to fail and go to rung 5, a different egress.

### 11. A "no calendar" town can be a vendor town with a JavaScript front end

`bradfordnh.gov/calendar` 404s, which is where the earlier walk stopped. The
town's HOME page carries `/_app/immutable/chunks/Calendar-*.js` — a SvelteKit
build — and, in its server-rendered payload, twelve links of the form
`https://towncloud.io/go/bradford-nh/agendas/359` with a sibling
`.../PDF/get_agenda_document_link`.

So Bradford is a **TownCloud** town: a vendor this repo has not met, with a
predictable per-tenant path. A 404 on a guessed calendar path is not evidence
that a town publishes nothing; the platform underneath is rung 12 and it was
sitting in the homepage's own markup.

### 12. A feed can be STALE rather than empty, and the two need different words

`https://springfieldnh.org/events/?ical=1` answers 200 with **fifty** events.
Every one of them is from **2024**. Meanwhile `springfieldnh.org/events/`
lists sittings dated 2026 — `select-board-meeting-2026-08-24`, <!-- expected-future: the town's own event slug, read 2026-08-19 -->

`cemetery-trustees-meeting-2026-08-11` — on a plugin that is not The Events
Calendar (its own `wp-json/tribe/...` is a 404, and its listing pages carry
`?pagination=1&event_archetype=event`).

A feed with fifty rows passes every count check a zero-row feed would fail.
**Check the newest date in a feed, not only its length**, and where it is
older than the body's own listing, the feed is not the source.

## Portrait rungs, at scale — g21, 2026-08-19 (D50 item 7d)

The half that makes the remaining portraits survivable. Round 3's findings are
the template and they are written down here so the next state costs what this
one did.

### 13. A chamber does not key its portraits by the id you have

Two chambers, two schemes, and neither is the member id our registry carries:

* **The New Hampshire Senate keys its portraits by DISTRICT**, not by member.
  A hunt that walks member ids finds nothing and reports a chamber that
  publishes no portraits — which is false about a chamber whose every member
  has one.
* **The New Hampshire House declares its portrait by TEMPLATE CONTROL ID** —
  `id="pageBody_imgMember"` — with a filename id (`409302.jpg`) that appears
  **nowhere else on the page**. There is no pattern to derive and no id to
  join on; the control id is the only stable handle.

**Find the handle before walking the list.** Open one member page, find what
identifies the portrait, and confirm the same handle on a second member of the
same chamber. A scheme confirmed on one page is a guess.

### 14. `alt` text can assert an absence that is not there

Two New Hampshire senators were recorded as having **no portrait**. Both had
one. Their pages label the image `alt="NH State Seal"` — a template default
the chamber never edited — and a hunt filtering on alt text discarded a real
portrait as a placeholder.

**A fabricated absence, found by going to look.** Filter on what the image IS
(dimensions, bytes, content type), never on what the page CALLS it. Alt text
is authored by whoever last edited the template and is not a claim about the
file.

### 15. Staged is not shipped, and the difference is a human

The portrait pipeline has two terminal states and they must not be collapsed:

* **STAGED** — fetched, EXIF-strippable, sole subject, door recorded. Every
  machine-checkable rung passed.
* **SHIPPED** — a person looked at it.

`docs/photo-review.md` (`pnpm photo:review`) is where the second happens. A row
may ship carrying a stated doubt — the `review` field on the manifest row — and
the list says WHAT the doubt is, so the reviewer is not asked to guess what
they are looking at. Two rows carry one today: distance shots the author asked
to see.

**Identity and composition are different questions.** Any doubt about identity
fails at every door, permanently. Composition is a judgment the author makes,
and it is the one the flagged rows are asking about.

### 16. Collecting a portrait and rendering one are different numbers, and they drift

g20 shipped 110 portraits and the rendered count moved by **zero**, because
none of those officials sits on a covered division. The manifest counts people
we HOLD a portrait for (902 today); the census counts people the product
RENDERS (750, of whom 591 have one).

Both numbers, every time. And the join between them is worth running rather
than assuming: asked directly whether any portrait we hold sits beside a slot
rendering initials — across all 231 empty state-legislator and curated-roster
slots, matched by id and by normalised name — the answer is **zero**. Nothing
is being held back; the empty slots are genuinely uncollected.

That is the honest answer to "put the picture we have in there": there was no
such picture, and the way to know was to compute the intersection rather than
to assert it either way.

### 17. "The browser rung clears it" is the most perishable entry in this file

Twice in one session a standing entry saying rung 6 opens a host did not
reproduce:

* **Sutton NH** — the table above records 403 to the index profile, 200 to the
  BROWSER profile. On 2026-08-19 both profiles took a 403.
* **`cfs.sos.nh.gov`** — entry 1 above records rung 6 clearing it, measured
  earlier the same day. A real headless Chromium took a **403** from it hours
  later, with an Akamai body.

Neither is deleted; this file is append-only and the next state may hit the
same wall from a different side. But a session planning around "rung 6 clears
this host" should **re-measure before relying on it**, and should treat a
WAF's disposition as a fact with a shelf life rather than a property of the
host. Egress reputation, rule updates and rate history all move it.

The stable entries in this file are the ones about STRUCTURE — where a feed
lives, how a platform keys its records, what a field means. Those keep. The
ones about who a WAF lets through do not.

## Territory resolves nationally in one pass, and it is cheap (Prompt B, 2026-08-20)

**Which governments govern a zip does not need a per-state hunt.** The Census
publishes national cartographic boundary files, they are public domain, and the
whole country joins in **fourteen seconds**. Every session before this one
resolved territory a state at a time; that was never necessary.

**The seven files, all from `https://www2.census.gov/geo/tiger/`, fetched by
`corepack pnpm tiger:fetch` into `.cache/tiger` (gitignored):**

| File | Vintage | Rows |
|---|---|---:|
| `GENZ2023/shp/cb_2023_us_county_500k` | 2023 | 3,235 |
| `GENZ2023/shp/cb_2023_us_place_500k` | 2023 | 32,608 |
| `GENZ2023/shp/cb_2023_us_cousub_500k` | 2023 | 36,367 |
| `GENZ2023/shp/cb_2023_us_unsd_500k` | 2023 | 10,894 |
| `GENZ2023/shp/cb_2023_us_elsd_500k` | 2023 | 1,957 |
| `GENZ2023/shp/cb_2023_us_scsd_500k` | 2023 | 480 |
| `GENZ2020/shp/cb_2020_us_zcta520_500k` | 2020 | 33,791 |

**`cb_2023_us_zcta520_500k` IS A 404 — checked, not assumed.** ZCTA is a 2020
product and there is no 2023 edition, so any join of these layers carries a
three-year vintage gap between the zips and the governments. State it; do not
paper over it.

### Rungs this added

* **A shapefile needs no dependency.** `lib/geo/shapefile.ts` reads the `.zip`,
  the `.shp` (polygon types 5 and 15) and the `.dbf` in about 200 lines. It
  refuses a file whose geometry and attribute counts disagree, because
  shapefile records pair **by position** — a tolerated mismatch gives every
  feature past the gap another feature's name.
* **THE ENCODING IS IN THE FILE. READ IT.** Every Census boundary zip ships a
  `.cpg` sidecar and these all say `UTF-8`. Hardcoding `latin1` — the
  historical dBase default, and a reasonable guess — wrote a Texas place name
  as mojibake across the whole national output.
* **Point-in-polygon needs a latitude-band edge index to finish.** These layers
  carry 3.4 million vertices (`cousub`) and 2.2 million (`unsd`). A plain ray
  cast does not complete; bucketing each polygon's edges by latitude band once
  turns the whole national join into 14 seconds.
* **Sample the ZCTA, then ask the government.** A 0.01° interior lattice
  (≈1.1 km) misses any government smaller than the lattice — it left **2,213
  incorporated places and CDPs** looking like they belonged to no zip. A second
  pass that takes each unreached government's own representative interior point
  and finds its containing ZCTA recovered 2,581 of them. Reporting the first
  pass alone would have been a method limitation rendered as a fact about the
  country.

### Two things in these layers are NOT governments

Both were found by reading the pilot output, and either would have put a
fictional body in front of a reader.

* **Pseudo-entities.** TIGER tiles its layers without holes using the reserved
  local codes `99997` ("not defined"), `99998` (water) and `99999`
  (unorganized). 85641 resolved to `School District Not Defined` [`0499997`].
  **27 nationally.**
* **Statistical entities.** **12,587 of 32,608** `place` rows are CDPs
  (`LSAD 57`) and **5,198 of 36,367** `cousub` rows are CCDs (`LSAD 22`). A CDP
  is a name the Census gives a populated area so it can publish statistics for
  it; a CCD is a statistical subdivision drawn where there are no minor civil
  divisions. Neither has a council, a budget, a meeting or an elected official.
  Also statistical: `LSAD 23` (census subarea), `46` (unorganized territory),
  `00` (no description).

  **`CITY` and `COUNTY` are NOT stripped** when classifying — `Albertville
  City` and `Marshall County` are different governments and both agencies keep
  the word. And New England gores, grants, plantations, locations and purchases
  land in `UNCLASSIFIED` rather than being guessed into either bucket, because
  their governmental status varies by state and by entity.

### The wall this cannot climb

**TIGER publishes no special-district boundary at any vintage. Not a subset —
none.** So **39,555 of 39,555** special districts are unresolved, and they are
43.55% of every government in the country. No amount of work with these files
moves that number.

Four rungs, named and not walked (tracker `PB02`):

1. County assessor / auditor special-district tax-levy layers — they carry
   boundaries because they have to bill them.
2. State special-district registries, where a district files its territory with
   the secretary of state or a local-government commission.
3. Per-state GIS open-data portals publishing fire, water and library district
   layers county by county.
4. The district's own published service-area map, per district.

**A district office's mailing zip is not territory.** A county water authority
head-quartered downtown serves the county, and 39,542 of these districts carry
a mailing zip that says nothing about where their authority runs.

### Joining two agencies' names is a normalizer problem before it is a data problem

The Census-to-NCES school-district crosswalk matched **2,038 of 13,859** on the
first attempt, and that number was a finding about the normalizer rather than
about the data. Census writes `CASTRO VAL UNIFIED SCH DIST`, `CAYUGA IND SCH
DIST 902`; CCD writes `Castro Valley Unified`, `ASPERMONT ISD`. With
abbreviation expansion, district-type acronym expansion (`ISD`, `CUSD`, `UFSD`,
`CCSD`, …) and structural-token removal it matches **9,776**.

**A join returning almost nothing looks exactly like two universes that do not
overlap.** Only opening the unmatched rows tells them apart — and district
numbers must be held OUTSIDE the key and used only to break a tie both sides
recorded, because Illinois numbers its districts on both sides and Texas on one.

### RUNG 5 IS REAL, IT IS CHEAP, AND IT BRINGS DOWN THREE WALLS THIS REPO HAD WRITTEN OFF (NH Hunt 2, 2026-08-21)

`CLAUDE.md`'s rung 5 is g3's finding stated as a rule — a rung is
`(client, headers, URL, egress)`, and a refusal aimed at where the request
COMES FROM is not a header problem. It has been in the ladder since the g
sessions and **nothing in this repo could walk it.** Two tracker rows and one
constitution paragraph recorded rung 5 as "owed" and stopped there.

`lib/hunt/egress.ts` walks it: a public reader service fetches the public URL
from its own address and returns the page as text. It is NOT residential-proxy
spoofing, which stays prohibited; it authenticates nothing and accepts no terms;
it carries a public URL and nothing else, and `assertPublicUrl` refuses anything
with credentials, a private host or a non-web scheme.

**Three standing walls fell to it in one session:**

| Host | What the record said | What rung 5 did |
|---|---|---|
| `sos.nh.gov` (and `cfs.sos.nh.gov`) | *"refuses this network"* — host-wide since 2026-08-13, worked around via the Internet Archive | **200.** HTML pages, and PDFs as extracted text. The archive detour is no longer the primary route |
| `nh.gov` family — `council.nh.gov`, `governor.nh.gov`, `revenue.nh.gov` | not previously measured | **200.** These 403 at rungs 2, 3, 4 AND 6 — a guarded headless browser is refused exactly as a plain fetch is, which is what proves it is an EGRESS wall and not a fingerprint or a JavaScript problem |
| `kearsarge.org` board roster (`NH01`) | *"headless Chromium does not clear a Cloudflare managed challenge"* | **200** — and so did rung 4 on the same day, see below |

**The provenance cost, and it is real.** What comes back is the reader service's
markdown RENDERING of the page, not the origin's bytes. A fact read this way is
cited to the ORIGIN — that is the document that exists — and the retrieval note
says which route reached it. It is therefore the WRONG rung for anything where
the exact bytes are the evidence: a `contentHash`, an `.ics` feed, a PDF you
mean to store. Those stop at rung 4 or go to rung 11.

**The relay's 200 is the RELAY'S, not the origin's.** It answers HTTP 200 for a
page the origin refused and puts the origin's status in the body:
`Warning: Target URL returned error 404: Not Found`. The first version of the
reader returned that as a successful read, and `pnpm probe:site` duly printed
"HTTP 200 via rung 5" for a New Hampshire Executive Council page that does not
exist. `readViaEgress` now parses that annotation and raises the origin's status
as the refusal it is. A wall arriving through a wall-breaking rung, wearing a
200, is the exact shape this repo has spent six sightings learning to refuse.

### A WALL OBSERVED ONCE IS NOT A WALL (NH Hunt 2, 2026-08-21)

Three of the walls re-walked this session were gone, and one of them was gone in
a way that cost a whole tracker row:

- **`gc.nh.gov` / `gencourt.state.nh.us`.** `CLAUDE.md` and
  `data/ballot/nh-merrimack-2026.json` both say *"the General Court's own site
  refuses every client this project has, browsers included"* (written
  2026-08-14). It answers a **plain rung-2 fetch at HTTP 200** and probably has
  for some time. Nobody re-checked, because the wall was written down and a
  written-down wall reads as a fact rather than as a measurement with a date on
  it. Four of the five Kelly fields for four candidates came off that host in
  one pass once somebody tried.
- **`kearsarge.org`'s board roster.** `NH01` records rung 6 loading a Cloudflare
  interstitial that never resolves. On 2026-08-21 **rung 4 (`curl`) read it at
  200, 73,695 bytes.** The playbook's own note on this host says the wall is a
  RATE wall — *"a burst of fetches earns 403 where a paced fetch is served
  200"* — and that is consistent: a paced single fetch gets the page.
- **`hopkinton-nh.gov`.** Refused a raw `curl` with a Cloudflare "Just a
  moment…" challenge, refused a guarded headless browser with "Incompatible
  browser extension or network configuration" — and read at 200 through `curl`
  minutes later, from the same machine, with the same User-Agent. **The
  challenge is transient.** A single observation of a Cloudflare managed
  challenge is not a finding about the host.

**So: re-walk before recording, and re-walk before believing.** `pnpm ladder`
exists so that costs one command.

### `pnpm ladder` — the retrieval ladder as a command (NH Hunt 2, added 2026-08-21)

| Command | What it does |
|---|---|
| `pnpm ladder <url> [--out <file>] [--stop-at <rung>] [--json]` | Walks rungs 2 → 3 → 4 → 5 → 6 in order, stops at the first that returns the document, and PRINTS EVERY RUNG WITH ITS RESULT — including the ones it did not need, marked `NOT_ATTEMPTED` rather than left off. `--out` writes the body of whichever rung read it. |

Every rung body goes through `challengeIn()` before it counts as a read, so a
Cloudflare interstitial at HTTP 200 is reported as WALLED with the challenge
named. A URL no rung reads exits non-zero with the message that the rungs above
6 are still owed and that this is **never an absence**.

**Rungs 2 and 3 are RAW fetches here, deliberately not `politeGetText`.**
`politeGetText` walks 2 → 3 → 4 by itself on a 403, which is right for an
adapter and wrong for a ladder: the first run of this tool used it and printed
"rung 2 READ, 200, 74,600 bytes" for a page whose raw rung 2 is a Cloudflare 403
and whose rung 4 is a 200. A `walledAtRung` written from that would have been
wrong in the database, in the direction that makes a wall disappear.

### `pnpm probe:site` — what a campaign site publishes about its own candidate (NH Hunt 2, added 2026-08-21)

| Command | What it does |
|---|---|
| `pnpm probe:site <url> [<url> …] [--json]` | Reports `og:image`, `twitter:image` and every non-structural `<img>` with its `alt`; `mailto:` and `tel:` links and phone-shaped prose; `og:description`, `meta[description]` and the first substantial paragraph, verbatim; and the rung that read the page. Four of the five Kelly fields, from one call. |

It reports CANDIDATES for a photo and never picks one — the four-door rule and
the composition standards are a judgement about a named person's face.

**The lazy-load placeholder is what most campaign sites put in `src`.**
WordPress themes ship a `data:image/svg+xml` spacer of the right aspect ratio in
`src` and the real file in `data-src` / `data-lazy-src` / `data-original`. The
first run of this printed five identical inline SVGs for a site whose portraits
were all present. A probe that reads the placeholder reports "no photo here"
about a page full of photographs.

**Revize resolves an image `src` from the SITE ROOT, not from the page's own
directory.** Merrimack County's Register of Deeds page writes
`Departments/Register of Deeds/Images/Morse 1.30.25.jpg`; resolved against the
page's directory that 404s, and resolved against the root it serves. A relative
resolver reports a false miss on every Revize portrait in the product.

### `pnpm nh:legislator` — the New Hampshire General Court, per member (NH Hunt 2, added 2026-08-21)

| Command | What it does |
|---|---|
| `pnpm nh:legislator "<name>" [--chamber house\|senate] [--out <file>]` | Resolves a name against the current House roster (769 members) and Senate roster (24), and prints the member's page URL, official portrait, `@gc.nh.gov` email, phone, mailing address and — for senators — the biography they wrote themselves. |
| `pnpm nh:legislator --list house\|senate` | The whole roster, name and pid. |

**Four of the five Kelly fields for any sitting New Hampshire legislator, from
one host.** The portrait is photo door 2.

Three traps, all found by the first version getting them wrong:

- **`nophoto.jpg` is the chamber's own placeholder and is not a portrait.**
  Shipping it puts a grey silhouette under the words "official New Hampshire
  House portrait" — a render default manufacturing a claim. Returned as `null`
  by filename.
- **The member page's name and district come from its own `<h1>` and its
  CENTERED `<h3>`**, not from the flattened page text. The first version
  returned the site's `<title>` as the member's name and three lines of
  navigation chrome as their address.
- **A phone test must be anchored on the WHOLE phone shape.** A test for "three
  digits and a separator" ate the street number off `209 Squires Ln` and
  reported a representative whose address begins at their town.

**A former member's page survives and their portrait does not.** Confirmed on
two people — Jason Gerhard (Merrimack 25, 2022–2024) and Dianne Schuett
(2008–2024). Their `member.aspx?pid=` pages answer 200 and carry no image. The
pid for a former member is recoverable from an Internet Archive capture of the
roster page from a session they served in.

### THE SEAT IS THE PATH: a former senator's portrait lives at the CURRENT holder's URL (NH Hunt 2, 2026-08-21)

The New Hampshire Senate serves portraits from `/senate/images/senators/07.jpg`
— **keyed to the DISTRICT, not to the person.** Harold French held District 7
until Daniel Innis took it, and both faces have lived at that one URL.

So for a former senator the route is the Internet Archive capture of the Senate
roster from a session they served in: find the card headed with their name, take
the `im_` URL beside it, and the archive serves the right face.

**And the trap is the same fact pointed the other way.** Fetching that path live
for Harold French would have shipped Daniel Innis's photograph under Harold
French's name. Both were read as images before either shipped, which is the only
reason it did not happen. This is not a Senate quirk — any body that serves
portraits by seat has it.

### A ROSTER'S CONTACTS CAN BE IN THE `href` AND NOT IN THE CELL (NH Hunt 2, 2026-08-21)

Kearsarge's board-members page publishes **twelve `mailto:` links** — each
board member's NAME is the anchor text and their district email is the `href` —
and it always did. An extractor that reads table CELLS as text gets the nine
names and drops the nine addresses, and what it hands back looks exactly like a
page that carries no contacts.

That reading was recorded on 2026-08-17 as *"the district publishes no
per-member phone or email on this page — the absences are honest, not
unhunted"*, and repeated on 2026-08-20. **Honest-looking and wrong**, and worse
than a wall, because a wall stays open as a work item and a recorded honest
absence closes the question.

Two more traps on that one page: the column HEADERS also link to a member's
address, so a first-mailto-wins parse gives every member the same email; and one
member's row carries three addresses — his district one, a personal
`@verizon.net` one the page exposes, and a typo of the first.

### TOWNCLOUD — a vendor family, and a slug probe that reports every guess as a hit (NH Hunt 2, 2026-08-21)

Bradford, New Hampshire publishes its agendas on `towncloud.io/go/bradford-nh`.
Its own town site links out to it and carries no boards index of its own, so the
vendor IS the route to the town's bodies.

- **The table is a server-side DataTables POST** to `/go/<slug>/table_data`,
  carrying `table_class=AgendaHomeTable` and a `context[city][…]` blob. A
  replayed POST answers 422 without the page's own session, and so does the same
  POST issued from inside the page. The route that works is rung 6 driving the
  table's own paging control — 227 rows, 12 distinct bodies.
- **A meeting-derived body list is a FLOOR, not a denominator.** A body that has
  not met inside the published window is invisible to it.
- **`towncloud.io/go/<anything>` answers HTTP 200 with an empty shell.** All six
  other Kearsarge member towns "existed" on it by status code and none does. The
  check that works is the rendered row count.

### `pnpm bodies:enumerate` — what bodies does this town have? (NH Hunt 2, added 2026-08-21)

| Command | What it does |
|---|---|
| `pnpm bodies:enumerate <town-site-url> [<url> …] [--json]` | Reports every link whose ANCHOR TEXT names a governing-body shape, with its href, the rung that read the page, and whether the final URL redirected. Separates links that look like documents (minutes, agendas, warrants) from links that look like bodies. |

The contract is the ANCHOR, not the markup: New Hampshire town sites are five
CMS families and a long tail, and every one of them puts its boards in a
differently-shaped menu — but all of them link each body's own page with the
body's name as the anchor text. False positives are left IN, because a missed
body is invisible and a wrong line is one a session reads and discards.

`selectboard`, `select board` and `board of selectmen` are all live in New
Hampshire and a town uses exactly one; a vocabulary missing any of the three
skips that town's governing body, which is the one body it is least acceptable
to miss.

**A town that marks its own boards `(E: Elected  A: Appointed)` has published
its own denominator, and it is better than any external count.** Warner does
this for 31 offices — including one marked "Dissolved", which is a body a
name-based enumeration would have put on a reader's map.

### FIVE OF SEVEN KEARSARGE MEMBER TOWNS HAVE MOVED TO `.gov` (NH Hunt 2, 2026-08-21)

`bradfordnh.org → bradfordnh.gov`, `nl-nh.com → newlondon.nh.gov`,
`sutton-nh.org → suttonnh.gov`, `warner.nh.us → warnernh.gov`. They redirect
today and the school district's own board page still links the old ones. A link
we hold is a link that will break; `pnpm bodies:enumerate` prints the redirect
so a stale link is visible rather than inferred.

`suttonnh.gov` refuses rung 2 and admits rung 4 — the same TLS-fingerprint shape
as `hopkinton-nh.gov`.

### NEW HAMPSHIRE SPECIAL DISTRICTS: THE ANSWER IS A TAX TABLE, NOT A MAP (NH Hunt 2, 2026-08-21)

TIGER publishes no boundary for any special district at any vintage, so
geometry cannot say whether a village district reaches a zip. Three documents
answer it instead, and together they resolved all eighteen at 03255:

1. **`data/derived/zip-governments.json`** — which town(s) the ZCTA falls in.
   03255 is 109 of 109 sample points in Newbury town, so the question reduces to
   "does this district include territory in Newbury".
2. **RSA 52:1** — a village district is fixed by *"the selectmen of the town or
   towns"* over *"such parts of the town or towns as may seem convenient."*
   Note the plural: **a district may span towns**, so a name-based inference is
   not safe. One of the eighteen spans two towns and names neither in its title.
3. **The NH Department of Revenue Administration's annual Village District Tax
   Rates** — 106 district-rate rows grouped by municipality, and it lists a
   district **even at a $0.00 rate**, which is what makes an absence meaningful.
   A district appearing under two municipalities is asterisked and appears
   twice. `revenue.nh.gov` is 403 at rungs 2, 3 and 4 and unarchived; rung 5 is
   the route.

**RSA 432:12 settles conservation districts outright**: each of the ten counties
*"is hereby incorporated into a conservation district"* whose boundaries
*"conform"* to the county. No map needed, ever.

**A dead district website is still in the archive, and its history page is where
the towns are named.** Lake Todd Village District's site is 404 at every rung
including 5 and 6; the Internet Archive's 2014 capture says in the district's
own words that it is *"located in Bradford and Newbury"* and posts its warrant
*"outside the Newbury Town Office."*

### A LIBRARY OR A POLICE DEPARTMENT MAY MIRROR THE DOCUMENT A STATE AGENCY REFUSES YOU (NH Hunt 2, 2026-08-21)

The New Hampshire Secretary of State's cumulative candidate filing list — the
document behind every candidate on the New Hampshire ballot — is served at 403
from `sos.nh.gov` to rungs 2, 3, 4 and 6. **Goffstown Public Library and the
Goffstown Police Department each host a copy in their own document centres**,
at 200 to a plain fetch, and a search-index query finds them by the document's
own title.

That is a rung-10 shape worth naming: a state document that a municipality is
required to post locally often IS posted locally, on a host with no edge filter
in front of it. Cite the original; record the mirror as the route.

### THE FEC IS THE EQUAL-EFFORT INSTRUMENT FOR A FEDERAL CONTEST (NH Hunt 2, 2026-08-21)

Thirteen candidates for one Senate seat is thirteen unequal name searches, or
one API pass at the same rung for all of them. Every federal candidate past the
$5,000 threshold has a Statement of Organization naming their committee's
**website, email, phone and address** —
`/v1/candidates/search/`, then `/v1/candidate/<id>/committees/`, then
`/v1/committee/<id>/`. Eleven of nineteen New Hampshire federal candidates were
reachable that way in one pass.

- **No FEC record is a legitimate STATE, not a wall.** A candidate need not
  register until they raise or spend $5,000. Record it as that, and check the
  loose surname search too — two of the eight had records from earlier cycles
  and none for 2026, which is a different fact from never having filed.
- **The committee's filed email is often a COMPLIANCE FIRM's**
  (`PAPPAS@MBACG.COM`, `GOODLANDER@CAPCOMPLIANCE.COM`). It is a real filed
  contact and it would read on a card as "this is how you reach this person".
  For a sitting member of Congress the committed `unitedstates/congress-legislators`
  directory has their DISTRICT OFFICE line, which is the number that answers the
  public.
- **A surname search collides.** "Maxwell" returns Maxwell Saal — a different
  person whose GIVEN name matches the surname being searched.

## 7. The candidate hunt — how a candidacy is taken to Kelly depth (NH Hunt 2, added 2026-08-21)

New territory for this playbook. Forty-seven New Hampshire candidacies were
worked to this method on 2026-08-21; it is a draft that Rockaway Township will
test.

**The unit of work is the CONTEST, not the candidate.** RULING 26 and the
equal-effort rule: every candidate in a contest gets the same rungs before the
next contest starts. Doing the incumbents first across all contests produces a
ranking.

**Order is local first.** Register of Probate before Governor. The offices a
reader has never heard of are the ones nobody else covers.

### The rungs, in order

1. **The filing record.** The state's cumulative candidate filing gives the
   name as filed, the party, the office and — in New Hampshire — the **domicile
   town and the filed mailing address, for every candidate at once.** That is
   one document reaching the whole ballot at the same rung, on the same day.
2. **The office roster.** A state's roster of current officeholders establishes
   INCUMBENCY, which the filing does not. In New Hampshire that is the
   Secretary of State's County Roster.
3. **The legislature's own roster.** Any candidate who currently sits in the
   state legislature has a portrait, an email, a phone, an address and a
   specific verified page on one host. Check EVERY candidate against it —
   four of forty-seven were sitting members and two of those were running for
   Congress rather than for a legislative seat.
4. **The FEC**, for federal offices. See above.
5. **The body's own page**, for anyone holding office — a county's department
   page, a governor's office, an executive council. This is photo door 2.
6. **The campaign site.** A name-based domain sweep is cheap and finds perhaps a
   third of them; a nonpartisan candidate directory is the trail to the rest.
7. **The site itself**, through `pnpm probe:site` and then rung 6 if it renders
   client-side.

### What a domain sweep finds that is NOT a campaign site

All of these were live at HTTP 200 in one sweep and not one is a campaign site:

- **A parking lander** — `stevenendres.com` and `benweir.com` are 114 bytes
  whose whole body redirects to `/lander`.
- **A registered domain publishing a construction notice** —
  `meghagaman.com` is a Squarespace "Coming Soon" page. Linking a reader to it
  is friction with nothing at the end of it.
- **An unfinished template** — `dannicholsonfornh.com` is his FEC-filed website
  and its body is Wix's own placeholder prose. It is LINKED, because it is his
  filed site and a reader looking for it should find it, and nothing on it is
  quoted, because there is nothing on it that he wrote.
- **Another family's website** — `mcclory.com` is a McClory genealogy site with
  a different person's email on it.
- **A personal or business site that is not a campaign** —
  `haroldfrench.com` is auctions, real estate and folk art, copyright
  2002–2018, and names an office he no longer holds. It supplied a working
  CONTACT that matches his filed address exactly, and it is not recorded as a
  campaign site.
- **An empty React shell** — `rogersforcountyattorney.com` is 1,105 bytes at
  rung 2 and indistinguishable from the landers above. **At rung 6 it is a full
  campaign site** with the primary date on it. A rung-2-only sweep would have
  recorded a real campaign as a parked domain.

### Reading the image is not optional, and here is what it caught

Three photographs were refused this session that every signal short of looking
said were portraits:

- **`victor-formal.jpg`, alt text "Victor Orlando", in an `/images/headshots/`
  path** — read as an image, it is a stock photograph of the United States flag.
  There is no person in it.
- **A campaign's `og:image` and `twitter:image`, both the same file** — read as
  an image, a scanned cover of a 1978 New Hampshire Grand Jury manual.
- **A "SocialShare.jpg"** — a portrait beside a wordmark reading the candidate's
  name and the office. A banner, which the composition standard forbids by name.

And one was refused on the copyright rule rather than composition:
`Monkman_Manzur_Campaign_022.jpg` carries a **photographer's credit in its
filename**, and photographer-credited images are prohibited at every door.

Two more shapes: a "WMUR" television screengrab of a courtroom (a screengrab,
a group shot and a broadcaster's image, three prohibitions at once), and an
"Introductory photo" that is the candidate with a child in a canoe.

### Where the identity evidence comes from when there is no headshot page

The site's own ALT TEXT and FILENAME, on a single-candidate domain: `mee.jpg`
on a site whose banner reads "FORMER REP. JASON GERHARD — CANDIDATE FOR SHERIFF
2026!", and "Pete leaning on a granite post" on a site titled "Sheriff Pete
Shephard". Neither is proof on its own; both are proof on a domain that belongs
to one person and says so.

### A contact that is NOT this person's

Recording one of these is a render default manufacturing a claim about a named
person, and each was refused:

- **An office line that now reaches their opponent.** Erica S. Davis appears in
  four archived captures beside (603) 228-0101 — the Register of Deeds office
  line, which now answers to the person who beat her.
- **The site vendor's address.** `office@dardenstudio.com` appears as the only
  `mailto:` on two different candidates' sites, which is how it was recognised.
- **A named staffer's address**, where the campaign publishes its own alongside.
- **A dead `@gc.nh.gov` address** belonging to a legislative seat a former
  member no longer holds.

### A social page needs authenticity, and Facebook will not let you check

`CLAUDE.md`'s campaign-site rule lets a social page stand in for a site when it
self-identifies with the filed name, the office AND the cycle. **Facebook serves
a login wall to every unauthenticated client, including rung 5**, so that
self-identification cannot be read — and we never authenticate. The honest
record is a NAMED WALL, not an absence, with rung 11 owed against a capture from
before the wall.

### A party-hosted candidate page is a case the rules do not yet cover

One candidate's only public presence is a page on a political party's website —
his name, the office, his own words, a contact. The campaign-site rule wants a
reader to reach it; the organizations-render-as-filed rule forbids this product
characterising an organization; and `contact-pills.tsx` labels every non-Facebook
campaign link "Campaign site", which would present the party's site as his.
Routed to the author rather than decided in a hunt.
