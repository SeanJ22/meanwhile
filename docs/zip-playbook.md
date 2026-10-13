> Historical discovery notes. The definition of done and append-only release obligations below are superseded by docs/rulings.md §0 and §3. Keep useful source methods; they do not gate publication or releases.

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

### State roll calls from weekly LegiScan datasets (SV-01, 2026-10-13)

Read `getDatasetList` for the requested state, then `getDataset` for each
session in the newest two legislative years, including special sessions.
The standing state contract checks the list weekly. Each native
`session_id` plus `dataset_hash` identifies an immutable saved release;
unchanged releases reuse their original bytes and capture date. A successful
unchanged check confirms the held projection and never records an outage.

Keep API keys and dataset access keys in private transport only. The saved
source list removes access keys, and recorded source URLs carry only public
operation, state, session and hash fields. The normal evidence vault retains
the source archive. Decode one state-sized archive member at a time with the
shared complete ZIP reader; reject a member outside the state's directory.

Bind positions to the same OpenStates person IDs used by linked legislators.
A unique held native LegiScan identifier is an exact join. Otherwise require
the same unique native member profile URL in the independently saved
OpenStates and LegiScan person records. Preserve each original URL; only an
official `.gov` publisher's `www.` alias and a trailing path slash normalize.
Keep the complete path and query. Record the exact promoted roster version
on each join, so verified votes survive a member's departure. Ambiguous joins
stay held, while independently verified member positions still publish.

Keep all acquired votes and literal publisher position labels. Reader may
limit its current view while Ask retains the recorded history. Report roll
calls and member positions per state. Render LegiScan and CC BY 4.0
attribution wherever its rows appear, and keep official publisher rows ahead
of intermediary duplicates.

*Evidence: `docs/source-ladder.md`, "LegiScan weekly state votes"; real source
fixtures and integration checks: `tests/legiscan-votes.test.ts`.*

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
| `node --experimental-strip-types scripts/legiscan-votes-refresh.mts --promote --state=<postal>` | Weekly state vote datasets, published through the registered per-state contract. |

### The tiered-discovery toolkit (NJ Hunt 5, added 2026-08-22 — items 2, 3, 10 and 11)

| Command | What it does |
|---|---|
| `pnpm wiki:muni --state NJ --county Morris [--confirm]` | **`wikipedia-municipality`, Tier A — the route six hunt sessions never walked.** One API read of a municipality's raw wikitext yields the form of government and what it implies about which bodies exist, the mayor with party and term, every council member with party, term and ward or at-large seat, the county governing body and constitutional officers via the transcluded officeholder templates, both districts, and the External links block. `--confirm` then FETCHES every footnote and asks the cited primary source whether it mentions the person, so each name comes back `CONFIRMED`, `LEAD`, `UNREACHABLE` or `NO_CITATION` — RULING 87: Wikipedia names the person, the citation proves them. Morris County: 39 of 39 municipalities, 843 official rows, 240 distinct officials, 768 citations confirmed, 726 distinct citation hosts. Writes `data/hunt/wikipedia-<universe>.json`. Ships NOTHING to a reader surface; it is a discovery record. Seams and failure modes in §8. |
| `pnpm wiki:graph --zip 07866 --state "New Jersey" [--budget N]` | **`wikipedia-government-graph`, Tier A — a crawl, not a list.** Seeds from the municipality articles for a zip and follows every link that resolves to a governmental entity touching that zip, then follows again. No depth cap — a branch stops when it leaves government — bounded instead by a fetch budget whose binding is REPORTED with the unexpanded frontier named. Classifies by Wikipedia CATEGORY rather than by title, with a title fallback for the barely-categorised agency articles and a body-word guard so a cheap heuristic can never eat a whole class of body. Writes `data/hunt/wiki-graph-<zip>.json`: every node with its URL and entity type, every edge with its outcome, what each node yielded, and every branch that terminated with why — **including the nodes that returned nothing**, because a route that failed is as reusable as one that worked. §9. |
| `pnpm nj:elec [--year Y] [--location NAME]` | **`filing-campaign-finance-local`, Tier A — the largest of `NH71`'s nine unwalked routes, closed.** The wall was on `elec.nj.gov` (Incapsula, not an app shell); the records are on `njelecefilesearch.com`, one hop away at rung 2. Reads the 1,215 location codes from the page's own option list rather than transcribing them, then queries the grid's own API at rung 7 with the DataTables form-encoded request shape. **Every location is paired with a control** and a response indistinguishable from the control is EMPTY — which is not a formality: the first working version used the wrong filter parameter, answered 200 with 326,271 records, and would have been recorded as a hit. §10. |
| `pnpm keys:walk [--zip Z]` | **Every held credential, called.** RULING 90 item 5 — an authenticated resource is walked before any unauthenticated one is exhausted. Seven credentials; three had never been called by anything in the repo. Reports per key: called or not, status, what it returned, owed fields closed, and what it WOULD close — including the honest nothings. Does not follow redirects blindly, because that is how an invalid credential reads as an empty result. §11. |


### The New Jersey toolkit (NJ Hunt, added 2026-08-22 — items 2.3, 3 and 5)

| Command | What it does |
|---|---|
| `pnpm nj:filing [--municipality M] [--pdf F] [--json OUT]` | **The branch that answers this session's headline.** Discovers the Morris County Clerk's and the NJ Division of Elections' CURRENT filed-candidate PDFs from those pages' own `href`s — never a hardcoded URL, because the clerk republishes at a new version path on every revision and both stay reachable — then parses name, office, party, slogan, **filed street address and filed email**. 272 candidates county-wide, 260 with an email, on 2026-08-22. Walks rungs 2 → 3 → 4 on discovery, because `www.nj.gov` refuses intermittently and `curl` clears it. Skips the ballot-position PDF by name: it is a scan with no text layer and belongs to rung 9. Reports every count; a zero-candidate parse exits NON-ZERO with the reason, because a parser that returns nothing has told you about itself. |
| `pnpm nj:search [--resume] [--contest C]` | **`search-index`, made mechanically walkable.** Five engines as a TREE (three SearXNG instances at rung 5, then Bing, Yahoo, DuckDuckGo, Mojeek), unioned rather than first-answer-wins, with a doubling rest per engine after a wall and a WAIT rather than a miss when all of them are resting. Title-cases the filed name before asking, because ALL-CAPS makes Bing drop a quoted phrase silently. Refuses a result set that never mentions the surname — a 200 whose content is not about the thing asked for is not a document. Classifies every URL into the manifest route it would be evidence FOR, and caps everything at LEAD (RULING 68). `--resume` keeps every candidate that already has hits and re-walks the rest. 272 candidates, 148 with at least one classified URL, 2026-08-22.
| `pnpm nj:rosters [--index] [--only M]` | **The New Jersey municipal-roster branch.** `--index` reads the county’s own Cities-and-Towns page — found by following the county home page’s `href`s, never guessed — and matches each official municipal website to its municipality with a TYPE-AWARE match, because New Jersey puts a borough and a township of the same name in the same county. Then walks each site’s own governing-body links and reports which pages carry a filed candidate’s name. 30 of 33 municipalities indexed, 167 pages read, 2 walls named, 2026-08-22.
| `pnpm nj:extract [--contest C]` | **From a page that names somebody to a field about them.** Re-reads each roster page and works PER PERSON: the smallest enclosing block around the FULL NAME, and nothing from outside it. Reconstructs the JavaScript-concatenated `mailto` municipal sites use (rung 8). Attributes a portrait by FILENAME where the publisher named the file after the person, and by position otherwise — saying which. Verifies every campaign-site lead by fetching it: HIT only when the page carries the name AND the race.
| `pnpm nj:portraits` | Downloads every portrait a hunt proposed and draws them into ONE contact sheet, shot full-page. RULING 2 makes a capture evidence only once it has been READ AS AN IMAGE; this is what makes reading six of them affordable. It approves nothing — RULING 55 leaves that with the author.
| `pnpm ad:library --name "First Last" --state ST` <br> `pnpm ad:library --roster <file.json>` | **RULING 66's four compliant routes to a walled social page** — `ad-library`, `social-archive`, `social-mirror`, `news-embed` — walked per person with each outcome named. Carries the **control query**: before guessing any identifier at a host it asks that host for a name that cannot exist and treats any answer within 2% of the control as EMPTY, which is what stops an SPA shell, a login wall or a no-results page reading as a find. Distinguishes four outcomes on purpose: `HIT`, **`LEAD`** (a page exists at a guessed handle and whose it is has NOT been established), `EMPTY`, and **`REFUSED`** (a wall or a missing credential — never counted as an absence, so no field moves toward exhaustion on it). `ad-library` needs `META_AD_LIBRARY_TOKEN`, which this project does not hold; see tracker `NS01`. |

**Two inherited tools grew New Jersey limbs rather than being replaced** — RULING 60:

| Command | What changed |
|---|---|
| `pnpm zip:universe <zip>` | Was hardcoded to New Hampshire's TIGER layers and a three-county NH governments file, so it enumerated New Hampshire for a New Jersey zip and produced a confident wrong answer. Now takes the state FIPS from the containing county in the national `county-us` layer, loads that state's committed layers, and cuts the governments slice from the full national Census file. A state whose layers are missing **fails loudly and names the file** rather than falling back. |
| `pnpm twig:pair [<zip>\|--zip <zip>]` | Minted `state:nh` OCD ids for every unit, so a township this registry holds nine bodies for read as "no division of its own". Now reads the OCD id `zip:universe` already resolved **by geometry**; the NH name template survives only as a FIPS-33-fenced fallback for special districts with no Census boundary. Also: a bare positional zip used to be silently ignored in favour of the default, and an unrecognised argument is now fatal. |

### The NJ Hunt 2 toolkit (added 2026-08-22 — RULING 67, 68 and 69)

| Command | What it does |
|---|---|
| `pnpm zip:divisions` | **A zip is an AREA.** Indexes `data/derived/zip-governments.json` — the 30 MB lattice-sampled edge list, too large to trace into a route — into a 108 KB per-zip list of OCD ids, for the zips in the covered states. `lib/ballot/zip-divisions.ts` unions it with the centroid answer so the ballot page shows every government whose territory reaches inside the zip. Never replaces the centroid answer; a zip absent from the index falls back to exactly the previous behaviour. This is what made Rockaway Borough visible to a 07866 reader. |
| `pnpm nj:ballot [--write]` | Generates `data/states/nj/ballot/nj-morris-2026.json` from the Morris County Clerk's CURRENT filed-candidate PDFs — 91 contests, 272 candidacies, each with a filed email — instead of a hand transcription that goes stale on the county's schedule. **Carries every previous id forward**, matching contests on division-plus-office and candidacies on contest-plus-filed-name, because reactions key on candidacy ids and re-minting one orphans a reader's answer invisibly. Refuses to guess a division: a jurisdiction that resolves to none produces NO contest and is NAMED in the run. Filed emails and street addresses go to a separate contacts file, never into the file the page reads. |
| `pnpm fec:directories` | RULING 69. Fetches the FEC's state-election-offices table and its Combined Federal/State Disclosure and Election Directory, and commits them as DATA — 58 and 349 rows — with provenance notes carrying the source URL, the fetch date, the byte count and the PDF's SHA-256. Reads the PDF link off the landing page's own hrefs, never hardcoded. Content-checks every response: a 200 whose body lacks the words the document must contain is not that document. |

**Two shared modules, both extracted rather than left where they were found:**

| Module | What it is |
|---|---|
| `lib/geo/zip-geography.ts` | RULING 67. Where a zip actually is, from files no enumeration reads to decide what to enumerate — TIGER state outlines, corroborated by the Department of Education's NCES LEA directory. `assertEnumerationGeography` throws when a run's resolved state or county disagrees. A witness with nothing to say is UNAVAILABLE and is counted neither way; a zip straddling a state line CORROBORATES rather than contradicts; a zip outside the committed geometry states OUR scope. Guarded in `tests/zip-geography.test.ts`. |
| `lib/hunt/control-query.ts` | RULING 68. The control query, moved out of `scripts/ad-library.mts` so it binds every route rather than the one that discovered it. `ControlledProbe` asks a host for an identifier that cannot exist before asking for a real one; `guessed: true` caps the outcome at `LEAD`; `isQueryEcho` catches the third shape a byte comparison misses, a no-results page that prints the query back. 22 of 41 manifest routes carry `controlQueryRequired`, 6 carry `guessesIdentifier`, and `tests/control-query.test.ts` fails the build if a guessing route is unflagged. |

### The twig toolkit (NH Hunt 4, added 2026-08-21 — RULING 57)

| Command | What it does |
|---|---|
| `pnpm twig:pair [--zip 03255]` | The coverage PAIR for a zip: units the Census of Governments places inside the first-rung circle, against units this registry holds a body for, reconciled — and every un-held unit NAMED with its distance, its type and the site the Census recorded. A count is not a name. |
| `pnpm image:view <url-or-file>…` | Renders any image a browser can decode — WebP and AVIF included — to a PNG that can actually be READ. RULING 2 requires a person to look at a capture; campaign sites serve formats that cannot be opened, and Squarespace serves WebP bytes under a `.jpg` URL. Prints the source's natural dimensions, because a 96×96 avatar upscaled to 640 looks like a portrait until you know it was 96 wide. |
| `pnpm portraits:normalise [--write]` | Sweeps every committed portrait for size and resamples what is over the cap. Never renames a file — a renamed portrait is a broken image — and REPORTS rather than silently corrects a file whose extension disagrees with its bytes. |
| `scripts/transcode-image.mts` | The shared normaliser `pnpm ship:candidate` runs every portrait through: decodes WebP and AVIF, names the format from the BYTES rather than from the plan's filename, and caps the served size. Every change it makes is recorded in the photo's own source string, so nothing we re-encoded is cited as though it were the bytes the source published. |

### The branch manifest (NH Hunt 6, added 2026-08-21 — RULING 61 and RULING 63)

**`docs/branch-manifest.md` is the named list of routes that must be walked
before this product may say a Kelly field does not exist for a named person.**
It is indexed by question — "how do I find a candidate's phone number", "how do
I reach a town clerk record" — so a session in another state finds the right
route without reading New Hampshire's specifics. Read it BEFORE hunting, not
when stuck (RULING 63).

Its machine-readable twin is `lib/hunt/branch-manifest.ts`, which is
authoritative for the route ids, the counts and the exhaustion verdict.

| Command | What it does |
|---|---|
| `pnpm manifest:doc [--check]` | Regenerates the route tables in `docs/branch-manifest.md` from the module. The document's prose and its question index are hand-written; the ROUTES are generated, because a hand-kept second copy of the list that decides whether a claim about a named person may render is a copy that goes wrong. `--check` fails when the document is behind. |
| `pnpm guard:census [--write] [--allow-removals]` | RULING 62. Every test file and every guard NAME in it, committed to `tests/guard-census.json`. A guard that stops existing fails the build BY NAME. `--write` refuses to erase a name without `--allow-removals`, so a deliberate removal lands in the census diff where a reader sees it. |
| `pnpm guard:history [--since <rev>] [--all]` | Walks every commit that touched `tests/` and reports every guard name that stopped existing at it, with the commit subject beside it. A name leaving is not by itself a defect — this produces the candidate list a person judges. |

**How to use the manifest in a hunt.** Take one field of one candidate. Walk
`requiredRouteIds(field)` in whatever order is cheapest. Record each as a
`ManifestBranch` carrying its `route` id, its `attemptedAt` from
`corepack pnpm stamp`, what came back, and `found`. Then ask
`judgeManifestWalk` — it returns `exhausted`, and when it does not, it hands
back **the routes still owed as a work list**, which is the useful output of a
failed exhaustion.

**How a route gets added.** Check first that it is not already named (RULING 63:
building a branch that already exists is a defect and is reported as one, with
the existing branch named). Then add it to `MANIFEST_ROUTES`, run
`pnpm manifest:doc`, and know that every absence earned under the previous
manifest version is now re-opened automatically — the version stamp on each
record does that without anybody remembering to go back.

**What actually yielded, so far.** One session of evidence, and it is thin on
purpose — this table grows and is never trimmed.

| Route | Walked | Hit | Note |
|---|---|---|---|
| `campaign-site` | high | high | The single best route for photo, blurb and contact at once, where a domain exists at all. |
| `campaign-social` | high | medium | The route that matters most in the smallest races. Opened in a LIVE BROWSER; a search snippet is not the source. |
| `filing-state` | high | medium | Yields the filed mailing address reliably and a phone rarely. |
| `body-roster-page` | high | medium | Incumbents only, by construction — which is exactly the asymmetry the equal-effort rule exists to catch. |
| `web-archive` | medium | low-but-real | Has already shipped a portrait here (a 2022 capture of a Senate seat page). |
| `search-index` | high | low | Cheapest route in the manifest and never sufficient on its own. |


### The re-walk toolkit (NH Hunt 5, added 2026-08-21 — RULING 52, 53 and 60)

| Command | What it does |
|---|---|
| `pnpm rewalk:candidates [--stamp] [--only=X]` | Re-walks every candidate field recorded FOUND and asks whether the claim still stands: the photo asset on disk, the campaign URL live, the quoted blurb still on the page it cites. `--stamp` writes `checkedAt` and NOTHING else — it never downgrades a field, because removing a fact about a named person over one refused branch is the failed-fetch-empties-a-full-surface defect at the candidate layer. Reports STANDS / WRONG / NOT VERIFIABLE / DUPLICATE KEY as a reconciling pair, with duplicates excluded from the error-rate denominator. |
| `pnpm rewalk:walls [--host=X]` | Re-tests every host this repo has ever recorded as walled, at rung 2 and rung 3, and prints what each returns TODAY against how the wall was described and when. RULING 53 gives a walled source a 14-day window regardless of how emphatically the wall was written down. Distinguishes OPEN from STILL WALLED from PATH MOVED, because a 404 is the host answering us and is a different hunt from a refusal. |
| `pnpm venue:hunt [--town X] [--url U]` | Reads a body's own page for the sentence that says where it meets. Built because Sutton's eighteen bodies had a live calendar carrying 1,312 events and not one meeting in this product: every event's `LOCATION` was empty, and the venue was in prose on the board's own page all along. Reports SENTENCES with the URL that carried them; never writes a wiring row, and never applies one board's published venue to another. |

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

### County offices are ONE branch serving SIX contests (NH Hunt 3, 2026-08-21)

`pnpm nh:county`. The six county races — Register of Probate, Register of Deeds,
Treasurer, Attorney, Sheriff, Commissioner — are the thinnest in the product and
the ones a reader can research least easily alone. **The county publishes an
office page for every one of them on one host**, so that is one branch serving
six contests, independent of the Secretary of State's filings, of the General
Court's roster, and of our own registry.

What it produced on Merrimack County, 2026-08-21: 8 of 8 pages read. Samantha
Morse named as **the Register** in the Registry's own staff directory — the
office she is standing for; Meghan Hagaman listed twice by the County Attorney's
own directory, as **County Solicitor** and **Assistant County Attorney**, while
standing for County Attorney. Both are specific verified pages that our
registry's name join could never have produced.

Three mechanics worth carrying to the next county:

- **A staff directory is a table.** Parse `<tr>` rows, not prose. Hagaman's roles
  came out of two table rows in one pass; the same page read as text yields the
  word "Hagaman" beside twenty repetitions of "Assistant County Attorney" and
  nothing joinable.
- **A group photo is a finding, and it is a refusal.** The Register of Deeds page
  publishes exactly one image of Morse: a six-person staff photograph captioned
  left to right. A group shot is prohibited at every door, so the photo is
  refused — and under RULING 52 that is a branch result about THAT IMAGE, never a
  conclusion that no portrait of her exists.
- **Never harvest the CMS's own addresses.** Every page on a Revize site carries
  `noreply@revize.com` and `webpageupdate_subscribers@revize.com`. Matching on
  the vendor DOMAIN rather than the mailbox name generalises to the next site.

**And Revize names its editable region `freeform-main`, not `<main>`.** Both
`<main>` and `id="main"` are absent from this theme. Extract with a BALANCED tag
walk, never a lazy `<div>…</div>` — a lazy match stops at the first closing tag,
returns a few characters, and reads as "found the content region" while
harvesting a wrapper. That is the empty-success shape wearing a parser's face.

### The NH General Court publishes NO House portrait, and a Senate portrait per SEAT (NH Hunt 3, 2026-08-21)

Two halves, and the first one nearly shipped three wrong faces.

**The House serves a PLACEHOLDER.** `member.aspx?pid=<pid>` carries
`<img src="/house/images/memberpics/nophoto.jpg">` — a real `src`, a real 200, a
real image. Sampled 2026-08-21 across six member pages: **0 real portraits, 4
placeholders** (two pids invalid). A hunt that trusted the `<img>` tag would have
shipped one grey placeholder as Karen Ebel's, Paige Beauchemin's and Gregory
Sargent's faces — the same class as the flag stock photo RULING 55 was adopted
over. **Check the filename, and read the image.**

So door 2 is dry at this branch, on this date. That is a branch result under
RULING 52 and goes on RULING 53's 14-day clock — not a conclusion that these
members have no published portrait anywhere.

**The Senate portrait path is keyed to the SEAT, not the person.**
`/senate/images/senators/<NN>.jpg`, two digits. Confirmed 2026-08-21 for seats
01, 07 and 15 — all HTTP 200, real JPEGs. This is why it is worth writing down
separately: a seat-keyed path means the Internet Archive holds the PREVIOUS
occupant's portrait at the same URL, which is how a former senator's picture is
recoverable at all (the route that produced Harold French's).

### An iCal export can be capped at the OLDEST N events (NH Hunt 3, 2026-08-21)

The adapter's docstring already warns that `/events/?ical=1` serves the current
VIEW rather than the calendar — Wilmot's month view returns four events where
the list view returns twenty-three. **Springfield, NH is the worse version of
that shape and the existing rule does not catch it.**

`springfieldnh.org/events/list/?ical=1` answers 200 with a well-formed calendar
of exactly **50 events, every one of them between 2023-11 and 2024-11**. So does
`/events/`, `/events/month/`, `/events/upcoming/`, `?eventDisplay=list`, and
`?tribe-bar-date=2026-08-01` — six views, one identical stale document. The
plugin's REST API at `/wp-json/tribe/events/v1/events` answers **404**.

**And the town has not stopped meeting.** Its own front page links
`events/cemetery-trustees-meeting-2026-08-11/` and
`events/conservation-commission-meeting-2026-09-03/`. <!-- expected-future: a real Springfield NH meeting the town publishes; the date is theirs, read 2026-08-21 --> The current meetings are
in the HTML.

Three things to carry:

- **A round number is a cap.** Fifty events is not what a town's calendar
  happens to hold; it is a limit. Treat any exactly-round VEVENT count as a
  paging or export ceiling until proved otherwise.
- **Check the feed's LATEST date, not just its count.** A feed that parses, and
  is well-formed, and carries fifty real meetings, can still be describing a
  year that has passed. `latest DTSTART` is one line and it is the check that
  catches this.
- **A stale feed is not a source, and wiring to it is worse than not wiring.**
  Eight Springfield bodies would have rendered as having no meetings while the
  town publishes them — the empty-success shape, shipped. They are recorded
  `KNOWN_UNCOVERED` instead: enumerated, real, visible to the gap ledger, and
  honest about the fact that no adapter reads their live route yet.

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

### NJ Hunt 6 — the wiring toolchain, and the routes it walks (2026-08-22)

**`pnpm tier:directory` — RULING 93's instrument.** Walks the directory the
tier above publishes about the tier below. Each route declares WHO PUBLISHES it,
WHICH TIER it is about, and a **control string** that must appear in the
response. Writes `data/hunt/tier-directories.json`.
*Interface:* `--route <id>`, `--list`.
*Measured on adoption day:* 8 routes, 8 answering, **851 entities** — of which
New Jersey's own local-government directory carried **624**, covering all 21
counties and all 564 municipalities with their official websites.
**The rung it taught:** `nj.gov/nj/gov/county/` — the URL USA.gov itself
publishes — answers **HTTP 200 with a styled "Page not found"**. The document is
at `/nj/gov/county/localgov.shtml`. A status check alone reads the dead path as
a success, which is why every directory route carries a control string.

**`pnpm muni:sites` — municipality → official site, control-checked.** Merges
three branches, state directory FIRST: `--state-directory`, `--wiki`,
`--county`. Every URL is FETCHED and the page must name the municipality and
must not title itself a different municipal type of the same name.
*Interface:* `--wiki <file> [--state-directory <file>] [--county <file>] [--out <file>]`.
*Measured:* 40 of 42 slugs resolved for Morris; 5 refused by the control check
and kept with their reason.
**The rungs it taught:**
- **The identity ladder.** Title and masthead ALONE refuse real municipal sites —
  Wharton and Chester Township both title themselves `Home`, and
  Parsippany–Troy Hills titles itself without half its own legal name. Read the
  title, the `<h1>`, `og:site_name`, then the leading visible text, and record
  WHICH one matched.
- **The TYPE claim is read only from the page's own self-description**, never
  from body text — Wharton, a borough, reported as a township because the word
  appears in its news copy.
- **The qualifier is not decoration.** New Jersey has FIVE Washington Townships
  and the state directory disambiguates them by county. Matching on name and
  type alone paired Morris County's township with BERGEN County's website.
- **A type word may never CROSS in a slug variant.** `chatham_borough` may fall
  back to `chatham`; it must never reach `chatham_township`.

**`pnpm roster:hunt` — read a governing body's roster off the body's OWN page.**
Tier B. Finds the roster page from the site's own navigation, extracts, and
records every attempt with its count.
*Interface:* `--index <file> [--only <slug>]`, or `--url <site> --label <slug>`.
*Measured:* 39 sites, 14 with a roster, **12 on a page whose OWN HEADING names a
governing body**, 57 members, 32 with an email, 24 with a phone.
**The rungs it taught, and every one of them was a silent partial:**
- **`<br id="isPasted">` is what a WYSIWYG editor emits.** A `<br>`-only pattern
  skips it, gluing a name to a term and an extension to an email. **Four of
  Rockaway Township's nine council members vanished that way** and the run
  reported five rows and no error.
- **`<style>` bodies are not text.** Joomla's SP Page Builder emits a per-widget
  `<style>` block INSIDE the content region; a naive tag-strip returns CSS media
  queries as the page's words, and a name test then finds nothing in them.
- **The page's OWN HEADING decides which body it is, never the anchor text that
  led there.** Anchor text alone chose Chatham Township's *Mayors Wellness
  Advisory Committee* as its governing body, because "Mayor" scores.
- **Three extraction shapes, and a site usually has exactly one:** a table whose
  rows carry a contact; repeated blocks carrying a `mailto:`; and **a list of
  per-member links to contact FORMS** — `Adrienne Zimmermann (Ward 2)` — which
  is how Denville publishes a council that the first two strategies read as
  empty.
- **A page may disagree with itself.** Rockaway Township's council page displays
  `hmorrison@` over a `mailto:` for `hkritz@` — a predecessor's mailbox. Ship
  the DISPLAYED address and record the mismatch.
- **A scoped re-run MERGES.** `--only` wrote a one-site artifact over a
  thirty-nine-site one, and nothing errored.

**`pnpm nj:winners` — the county clerk's certified election winners.** M62's
rung, and the strongest single record in the New Jersey hunt.
*Interface:* `[--url <pdf> --cycle <year>]`; defaults to Morris's three cycles.
*Measured:* **263 certified winners, 242 with an email, 246 with a filed street
address, across 34 municipalities.** Party, contact and filed address in one
born-digital PDF per cycle, certified by the election authority.
**The rungs it taught:**
- **Anchor on the PARTY TOKEN, not on layout.** The text layer arrives as one
  run-on line per page, so a column parser has nothing to hold. The party word
  appears once per row, between an upper-cased surname and an address.
- **A municipality name is only a row header when an OFFICE follows it.** Every
  winner's filed address ends `… Boonton NJ 07005`, so town names appear twice
  per row. Taking them all filed a COUNTY SHERIFF under Denville.
- **Use the document's OWN municipality strings.** It writes `Rockaway
  Township`, not `Rockaway Twp`; an abbreviation list matched 3 of 40.

**`pnpm nj:wire` — move confirmed people to a reader surface.** The step NJ Hunt
5 named as the next session's first job. Reads the three artifacts above and
writes `lib/registry/rosters-nj-morris.ts` plus a retrieval ledger.
*Interface:* `--dry` prints the gate decision per body and writes nothing.
*Measured:* **19 bodies wired, 126 members rendering, 102 with an email, 98 with
a party from a certified result.** 20 bodies OWED, each named with its reason.

**`pnpm census:key` — is the Census credential answering?** Serves `NS06`.
Asks three questions, because one cannot separate a bad key from a bad request:
the endpoint with the key, without it, and an endpoint needing none.
**The rung it taught:** the host's failure mode CHANGED between sessions — a
`302` with `X-DataWebAPI-KeyError: 1` became a **`200` with an HTML error
page and no such header**. A status check and a header check each now read a
dead credential as healthy. **Only asking whether the response is the DATA
requested survives both.**

**`pnpm shoot:officials` — capture the people on a body, as a reader sees them.**
A roster renders only once the reader OPENS the body, so `pnpm shoot` cannot
photograph one.
*Interface:* `<name> --zip <zip> --body "<row text>" [--exact] [--open "<section>"]`.
**The rungs it taught:**
- **`wtp.approximate_location` is the sessionStorage key**, not `wtp.location`.
  The wrong key leaves the app with no place and the shooter photographs the
  WELCOME OVERLAY while claiming to photograph a government.
- **Wait for the ROW, not for a clock.** The who-governs card is built from a
  fetch that lands well after `networkidle`.
- **A row's label is SPLIT ACROSS ELEMENTS.** `Denville` and `township` are
  separate spans, so `innerText.includes` finds nothing on any short element,
  and a scan that widens until it matches clicks the map marker behind the card.
  Use the framework's own text locator.

### The rung that invalidated every capture this repo had taken

**Playwright's `extraHTTPHeaders` applies to EVERY request, third parties
included.** MapTiler's CORS preflight does not allow `x-wtp-synthetic-run`, so
the basemap style request was REFUSED in every screenshot and every walk this
project has ever run:

```
Access to fetch at 'https://api.maptiler.com/maps/.../style.json'
has been blocked by CORS policy: Request header field
x-wtp-synthetic-run is not allowed by Access-Control-Allow-Headers
```

That is why NJ Hunt 5's captures showed *Basemap unavailable* on a production
site that was serving readers a working map. **The instrument was breaking the
thing it was measuring**, and no reader ever sent that header. Fixed at the
shared path in `scripts/browser.mts`: the marker now goes to our origin and is
stripped from every cross-origin request — which also stops leaking our run id
to every third-party host the page touches.

## 4a. WIRING — what it takes to move collected material to a reader surface

*(Added 2026-08-22, NJ Hunt 6. This section exists because the gap between
COLLECTED and RENDERING cost a whole session: NJ Hunt 5 named 261 officials and
rendered none of them.)*

**Collection is not the finish line, and the wiring step is not small.** The
route from a confirmed name to a reader is:

1. **The body must exist in `lib/registry/registry.json`.** Derived rows come
   from the committed boundary files, one `<ocdId>#governing` per division.
   **A curated row that collides with a derived id throws at build time**, so a
   named body may not simply be added alongside the derived one.
2. **The roster keys on that body id.** `BODY_ROSTERS` in
   `lib/registry/body-rosters.ts`; `governingRosterHoldersForDivision` looks up
   `<ocdId>#governing` and then `<ocdId>#board`.
3. **Generated rosters live in their own module** and are spread in, so RULING
   92 holds: the generator is what gets fixed.
4. **The guards are the specification**, and reading them first saves a rebuild:
   at least three members; a name of five characters; an office title of four;
   unique member ids ACROSS ALL ROSTERS; the source must be the body's own page
   and never a vendor host; `partisanship` may not be `UNDETERMINED`; every
   roster must resolve a presiding officer; and **an email must be on the body's
   own domain OR appear verbatim in a committed ledger under `docs/evidence/`**.
   That last one is the important one — write the ledger.
5. **The slugs will not match.** Census division ids carry the municipal type
   inconsistently (`chatham`, `randolph_township`); the encyclopedia carries
   whatever it disambiguated with; the clerk's PDF writes it a third way.
   Type-consistent variants, and a type word that never crosses.

**And the completeness gate, which is the judgement call.** A roster is a claim
about WHO SITS on a body, so a partial list does not under-state a field — it
states a false composition, and the members it drops are invisible rather than
marked missing. Wiring is gated on the member count reaching the seat count the
municipality's own form of government declares. **This is not RULING 26
suppression**: every member found is still held, still hunted on its RULING 53
clock, and every gated-out body is NAMED with its reason by `--dry`.


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

### The .gov registry supplies official links and acquisition routes

`cisagov/dotgov-data` publishes `current-full.csv` with every domain's registrant
organization, state and CISA `Domain type`. The monthly `dotgov` contract resolves
a commit and retains every row at that SHA. The 2026-10-12 source fixture has
16,876 domains, including 719 election-typed domains.

The typed `readDotGovProjection` Reader and `government-domains` edge family serve
this registry to government listings. A registrant attaches only to a unique
established government name and state under the existing identity rules. Ambiguous
and unmatched domains remain unattached. Census websites stay separately sourced.

Use CISA's election type for ballot and candidate-filing acquisition routes.
Searching names for "vote" or "election" does not replace that classification.

The registry is a list of domains, never a government coverage denominator. A
government with no .gov domain is absent, one government may hold several domains,
and a domain is not a body. The denominator continues to come from the Census of
Governments, NCES and official rosters.

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
  `data/states/nh/ballot/nh-merrimack-2026.json` both say *"the General Court's own site
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

## 2026-08-21 (NH Hunt 4) — twig enumeration, and eight rungs from real walls

### 7. TWIG ENUMERATION — how a small body is found when no menu lists it

*(New section, RULING 57. The other sections answer "how do I get this document";
this one answers the question that comes before it — **which bodies exist here at
all**, when the body is a cemetery trustee board, a village water district or a
committee that meets four times a year.)*

**Nothing here is optional and nothing here is enough on its own.** Every town
worked on 2026-08-21 produced a different subset, and every single one of them
produced bodies the others missed.

**A. The town's boards index — and it is an UNDERCOUNT, every time.**
Start here, but never stop here. Bradford's index lists eight boards; its
calendar files sittings for four more. Newbury's menu was an undercount too, and
that was recorded a session earlier. Treat the index as a floor.

**B. The sitemap, when the menu hides the index.** `bradfordnh.gov` links
"Supervisors of the Checklist" from its front page and NOTHING else
body-shaped — one link out of 97. `/sitemap.xml` is eighteen URLs, and one of
them is `/pages/boards-and-committees`, which lists the lot. Rung 10, and it is
the first thing to try when `pnpm bodies:enumerate` returns one row from a real
town.

**C. THE CALENDAR IS A BODY DIRECTORY, and it is the best one.** A town's
calendar names every body that actually meets, including the ones no page lists:

| Town | Bodies on the index | Bodies the calendar adds |
|---|---|---|
| Bradford | 8 | CIP Committee, Hazard Mitigation Committee, Facilities Use Committee, Independence Day Committee |
| Wilmot | 9 | Master Plan Committee, Safety Services Facility Committee, Transfer Station Advisory Group |
| New London | 12 | Archives Committee, Tri-Town Assessing Board, Capital Improvement Program |

**D. THE PAST VIEW, which is a different document.** Wilmot's Safety Services
Facility Committee and its Transfer Station Advisory Group appear on NO index in
that town and are absent from the upcoming feed. They exist in
`?tribe_event_display=past&ical=1`, three sittings and two, both in 2026. A body
that met in March and does not meet again until October is invisible to every
forward-looking rung there is.

**E. THE STATE REGISTER, for the class the town does not list at all.** A
village district is a separate government and a town's own site frequently does
not mention it. New Hampshire's Office of Business and Economic Affairs
publishes
`https://www.nheconomy.com/getmedia/f087979c-98b8-41b5-a2e0-1808faaa8ffe/village-districts-locations-addresses.csv`
— **91 districts, with host municipality, postal address, street address and
phone**, at rung 2. It is how Lake Todd Village District was found to have
territory in NEWBURY, against a note in our own registry saying no village
district reaches Newbury.

*Every state will have one of these and it will be somewhere different.* Look
for the state's municipal-services or economic-development agency, its
Department of Revenue's tax-rate tables (which list a district even at a $0.00
rate), and its Secretary of State's filings.

**F. THE STATUTE, for a body whose boundary is defined by law rather than
drawn.** RSA 432:12: "each of the 10 counties within the state is hereby
incorporated into a conservation district; each of the 10 districts shall be
known by the name of the county to which its boundaries conform." No geometry is
needed and none is published — the law IS the boundary.

**G. THE ANNUAL REPORT.** A county or town annual report names every officer and
department head, prints their contact details, and carries each one's own report
in their own words. Merrimack County's FY2025 report is 44 pages and was read at
rung 2 from a MEMBER TOWN's website (`chichesternh.org`) rather than the
county's own — the county's PDFs sit behind the same WAF as everything else on
that host, and a town that reprints the county report is a second publisher of
the same document.

#### What to do when a body is known to exist and publishes nothing

**Name it and ship it `KNOWN_UNCOVERED`.** That is the whole answer, and the
temptation to do something else is what this paragraph exists to refuse:

- **Do NOT leave it out.** A body absent from the registry is a body no reader
  can learn exists, and the gap ledger cannot see it either.
- **Do NOT wire it to a source that does not carry it.** Sutton's eighteen
  bodies could all have been wired to a live feed carrying 1,312 events — and
  every sitting would have dropped as `unknownVenue`, because that feed publishes
  no `LOCATION` at all. A wired body producing nothing looks exactly like a body
  that does not meet.
- **Do NOT give it a venue because a venue is usually the town office.** That is
  a guess about a specific sitting dressed as a fact, and a reader acts on it by
  driving somewhere.
- **DO record the branches walked and the date.** RULING 53's clock runs from
  there; the standing runner derives the next due time and records every
  re-walk attempt in the production data plane.

### A subcommittee's sittings can be filed under its PARENT board's category

Wilmot's Master Plan Committee meets, and its meetings carry
`CATEGORIES:Planning Board`. Its Transfer Station Advisory Group carries
`CATEGORIES:Select Board`. So:

- a **category-driven** adapter cannot separate the child from the parent, and
- a **title-driven** row over the same feed CLAIMS EVENTS THAT ALREADY BELONG to
  another body, and counts them twice.

The body is still real and still named. It ships `KNOWN_UNCOVERED` with the
reason recorded, and what is owed is a source that separates its sittings —
not a second row over the same events.

### One hall, eleven spellings, on one calendar

Warner's Town Hall appears in its own Google Calendar as: `Warner Town Hall, 5 E
Main St, Warner, NH 03278, USA`; `Town Hall, 5 East Main St. Warner, NH 03278`;
the same again **with two spaces before the zip**; `Town Hall, 5 E. Main St.,
Warner NH 03278`; `Town Hall, Lower-Level Meeting Room`; `Town Hall - Lower
Level`; `Town Hall - Main Auditorium`; `Warner Town Hall`; `Warner Town Hall,
Second Floor`; `Warner Town Hall, Main Floor, Stage`; and `Lower Meeting Room,
Warner Town Hall, 5 E Main St, Warner, NH 03278, USA`.

Every one is its own row in the venue cache. Do not fuzzy-match: a fuzzy match
that gets it wrong sends a reader to the wrong building and nothing catches it.
Dump the distinct `LOCATION` strings of the events a row actually matches
BEFORE writing the row.

### A Zoom URL in `LOCATION` is a fact, and it is not a building

Bradford writes a Zoom join link into `LOCATION` on 24 events. Do not key those
to the town hall via a `venueMatch` fallback: the fallback fires on ANY
unresolved location, so a standing-venue fallback silently pins a remote meeting
at a building. Bradford therefore gets no `venueMatch` at all — its blank and
Zoom rows drop, are counted, and cost nothing upcoming.

### A stale `.org` town domain, a live `.gov`, and a `www` host that resolves nowhere

`franklinnh.org` is what the search index carries for the City of Franklin. It
redirects to `www.franklinnh.org`, which no resolver this project can reach
answers for, and the apex serves a certificate for a different name — so rungs
2, 3, 4, 5 and 6 ALL fail, four of them with different errors. The town's live
site is **`franklinnh.gov`**, and Vincent Ribas's official portrait, his
councilor page and his phone are all on it.

**When every rung fails on a town domain with different errors each time, the
domain is the wrong one.** Try the `.gov`, then the `.us`, then the state's
municipal directory. It is a cheaper rung than any of the five.

### An Akamai 403 that a real browser does not see: rung 7 through the app's own XHR

`cfs.sos.nh.gov` — the NH Campaign Finance System — refuses rung 2, rung 3, rung
4 and **rung 6 with Playwright**, headless Chromium and a masked user agent
alike, all HTTP 403 from Akamai. A visible browser on the same machine and the
same IP gets HTTP 200. It is a headless-client wall, not an egress wall.

The route through is rung 7:

1. Load the app in a visible browser.
2. Read its own JS bundles from the page (`performance.getEntriesByType('resource')`
   gives every chunk) and grep them for endpoint strings. The API base is a
   plain literal — here, `https://cfsapi.sos.nh.gov/api`.
3. Call the API from the page's own context, where CORS is already allowed.

`PublicFilerDetails/GetFilingEntityDetails`, `POST`, body `{ filerName, pageNumber,
pageSize }` — and only `filerName` is honoured; `electionYear` and
`filerTypeCode` are accepted and ignored, so filter client-side. The response
row carries `candidateMailingAddress*`, `candidatePhone`, `candidateEmail`,
`candidateWebsite`, the whole committee block, and the treasurer's name. **The
search endpoint IS the detail endpoint** — no second call is needed, and the
per-filer detail endpoints all answer 401 or 500 anyway.

### A search summary is not a source

A web search reported Vincent Ribas as the sitting Merrimack County Commissioner
for District 2. The county's own board page names **Stuart D. Trachy**, and the
Secretary of State's county roster agrees. Ribas is a challenger and a sitting
Franklin city councilor. **Read the body's own page before believing a summary
about who sits on it** — a summary is a lead, and a lead is never a citation.

### Two official enumerations can disagree, and that is a finding

The Ashuelot Pond Dam Precinct is in the 2022 Census of Governments and is
ABSENT from New Hampshire's own village-district register, both read
2026-08-21. Neither is wrong to consult and neither settles it. It ships named,
with both facts recorded — RULING 57.

## 8. MANUAL HUNTING — every body worked by hand, and the branch each one became (NH Hunt 5, added 2026-08-21; RULING 60)

RULING 60: *the session hand-works bodies, and that is the point.* Where no
automated route reaches a body, the session reads the town report, opens the
warrant article, follows the name through the minutes, calls up the PDF. Then
**the route that succeeded is built into a named branch and applied across
every body of the same shape, with the count reached reported.** Hand-working
one body is how the branch that reaches the next fifty gets discovered.

This section is that record. Every row is a body somebody sat down and read.

### 8.1 The finding that made this section necessary

Twenty Census units at 03255 were named and un-held. Six of the seven towns
among them were un-held for a reason that has nothing to do with the towns:

| Town | The URL the Census of Governments records | What is actually there, read 2026-08-21 |
|---|---|---|
| Acworth | `http://www.acworth.cc` | DNS does not resolve. **No Internet Archive snapshot has ever existed** for that host, which is itself evidence the URL was never right. |
| Newport | `http://WWW.NEWPORTNH.NET` | Answers 200 — and is a parked domain whose sitemap contains one Cyrillic "uncategorised" category. |
| Grantham | `http://www.granthamnh.net` | Redirects to the live `granthamnh.gov`. Merely stale. |
| Croydon | (none recorded) | `townofcroydon.com` is a Squarespace **"Coming Soon"** page and has been since at least 2024-12-19. |
| Windsor | (none recorded) | `windsornh.gov` is a **GoDaddy parking lander** — a `.gov` that is not the town. |
| Lempster | (none recorded) | — |

**A hunt that trusted the denominator's own URLs would have recorded five of
these towns as publishing nothing.** All five publish a full boards index. The
Census of Governments is the right denominator for WHICH governments exist and
is not a source for where they publish; those are different questions and the
file answers only the first one reliably.

### 8.2 The branches, and how far each reached

**BRANCH — the `.gov` sibling.** When a recorded town URL is dead or parked,
try the same town name on `.gov` before concluding anything. Newport, Windsor
and Sullivan County were all found this way in one pass. *Reached: 3 of 6
towns hunted.* The trap it also exposes: `windsornh.gov` ANSWERS 200 and is a
parking lander, so a status code is not an identity — the title tag and the
page's own words are.

**BRANCH — the Virtual Town Hall / Drupal 7 `/boards` index.** Newport,
Croydon and Windsor all run the same install: `<Town>, NH |` in the `<title>`,
`/sites/all/...` asset paths, a `/boards` index, `/<body-slug>` pages, and
`/<body>/events/NNNN` for sittings. **Windsor's front page renders ZERO links
to a plain client and its `/boards` index renders ten.** Guessing the path from
the CMS family beat crawling the site. *Reached: 3 towns, 23 bodies.*

**BRANCH — the Internet Archive, rung 11, for a town whose site is GONE.**
Croydon's `croydon-nh.com` answers "Web Site Not Found" to a plain client AND
to a real browser on 2026-08-21 — so this is not a wall to climb, it is a site
that has been taken down. The 2026-05-21 snapshot carries the full boards
index. *Reached: 1 town, 6 bodies.* **The provenance is recorded as an archive
read with its snapshot date, never restamped as a live one** — the same
discipline `carryForward` follows for a refused source.

**BRANCH — the state register, for a class of body no town menu lists.** A New
Hampshire village district is a separate government and a town's own site
frequently does not mention it. The Office of Business and Economic Affairs
publishes every one of them with its host municipality, mailing address and
phone:
`https://www.nheconomy.com/getmedia/f087979c-98b8-41b5-a2e0-1808faaa8ffe/village-districts-locations-addresses.csv`
— **91 districts, 87 with a phone, 70 with a postal address.** It is the only
publisher that names the Eastman Village District at all. *Reached: the whole
class, 91 districts statewide.*

**BRANCH — one SAU page that names every member district's school board.** New
Hampshire school districts are administered in School Administrative Units, and
an SAU's school-boards page names the board of EVERY member district. **One
read of SAU 34 produced three separate Census units** — Hillsboro-Deering
Cooperative, Washington and Windsor. One read of SAU 24 produced two more.
*Reached: 6 school districts from 4 page reads.*

**BRANCH — the trade association's directory, when the body has no page.** The
Sullivan County Conservation District publishes nothing of its own. The New
Hampshire Association of Conservation Districts (`nhacd.net`) publishes its
address, its manager, and the part a reader actually needs: **"Board Meetings:
First Friday of each Month 2pm - 4pm."** *Reached: the conservation-district
class, 10 districts statewide.*

**BRANCH — the board's own page states its standing venue in prose.** Built as
`pnpm venue:hunt`; see 8.3.

### 8.3 The venue-in-prose branch, and its honest yield

**The wall.** A meeting with no venue is dropped. Sutton's eighteen bodies had
a live CivicPlus calendar carrying 1,312 events and **not one meeting in this
product**, because every event's `LOCATION` field is empty. NH Hunt 4 recorded
that honestly and refused to pin them at the town office, which was right: a
guess about a specific sitting dressed as a fact is exactly what the rule
forbids.

**The route.** The venue is not missing. It is in prose, on the board's own
page, in the board's own words:

> "The Sutton Planning Board meets at the Pillsbury Memorial Hall, 93 Main
> Street, Sutton Mills, NH on the second Tuesday of the month at 7:00 pm."

That is a sourced claim with a citation, which is the same standing on which
the Wilmot Selectboard's venue already ships.

**The branch, applied.** `pnpm venue:hunt` reads every body that is not LIVE
and has a page, tries the recorded homepage first and then the body's own
slug path, and reports the sentence with the URL that carried it.
***Reached: 157 pages read — 3 state a venue, 137 read and state none, 17 not
read.*** Two of the three are real finds (Sutton Planning Board; Wilmot Zoning
Board of Adjustment, which names the Town Office Building already in the venue
cache). The third names a schedule and no place, and is left in deliberately:
this instrument reports candidates and a session judges them.

**What the yield means, and it is not a disappointing number.** 137 boards were
READ and genuinely publish no standing meeting place. That is a dated
measurement about 137 pages, it is now on the record, and it is the reason the
next session should go to the posted NOTICE rather than the board page — the
notices are what RSA 91-A actually obliges, and they carry the room.

### 8.4 The one that stopped, and exactly where

**Sutton Planning Board — venue FOUND, wiring BLOCKED on a coordinate.**

The venue is sourced and quotable. What cannot be established is where it is.
The Census geocoder was asked three ways and returned a different place every
time:

| Asked | Returned |
|---|---|
| `93 Main Street, Sutton Mills, NH 03221` | 93 MAIN ST, **BRADFORD**, NH |
| `93 Main Street, Sutton, NH 03221` | 93 MAIN ST, **BRADFORD**, NH |
| `93 Main Street, Sutton Mills, NH` | 93 MAIN ST, SUTTON, **MA** |
| `93 Main St, Sutton, NH 03260` | no match |

Every venue-cache row carries a `coordinateSourceUrl` because a pin is a claim.
Shipping the Bradford coordinate would put a Sutton board in another town, and
shipping the Massachusetts one would put it in another state. **So the venue is
recorded as a finding and the wiring is not shipped**, which is a boundary stop
with its evidence attached rather than a failure. The next rung is a different
geocoder or the town's own published coordinates, and it is a tracker row.

### 8.5 The rule this section exists to make repeatable

Three of the four highest-yield branches above share one shape: **the body
itself publishes nothing, and somebody ELSE with a statutory or associational
reason to enumerate it publishes everything.** The state register for village
districts, the SAU for school boards, the association for conservation
districts. When a small body appears to publish nothing, the next question is
never "does it exist" — it is **"who is obliged to list it?"**

## NH Hunt 6, 2026-08-21 — eleven rungs and branches, from real walls

Every entry below is a wall this session walked into, or a route that produced
something. They are written in the order they were found, not in order of
importance, because the next session hits them in whatever order its own hunt
takes it.

### 1. A WALLED STATE DOCUMENT, REPUBLISHED BY A MUNICIPALITY (a `filing-state` sub-branch)

`sos.nh.gov` has been walled since 2026-08-13 and answers only at rung 5. Its
2026 cumulative candidate-filing PDF — every filed candidate in New Hampshire,
with domicile, mailing address, city, zip and party — is served at **rung 2,
HTTP 200, 432,565 bytes** by `goffstownlibrary.com/DocumentCenter/View/5981/`,
and again by `goffstownpolice.com/DocumentCenter/View/5981/`. A town library and
a town police department both mirror the state's document into their own
CivicPlus DocumentCenter.

**The generalisation is the useful part**: when a state publisher is walled, ask
who ELSE is obliged or motivated to hand the same document to the public. A
municipal clerk, a library, a police department and a school district all
republish state election material as a matter of routine, and none of them is
behind the state's WAF. This is the same shape as NH Hunt 5's "the body
publishes nothing and somebody with a statutory reason to enumerate it publishes
everything", pointed at a DOCUMENT rather than at a roster.

What it does NOT carry, counted: **no phone and no email**, for any candidate.
The columns are Candidate Name, Domicile, Mailing Address, City/State/Zip,
Party, and that is the whole of it. A route that establishes an address and
cannot establish a contact is still worth walking; it is not worth walking
twice.

### 2. A HOST CAN WALL RUNG 6 WHILE ANSWERING RUNG 2 — the inverse of the usual shape

`gencourt.state.nh.us` (→ `gc.nh.gov`) answers a plain fetch at HTTP 200 with 29
KB. The **live browser is refused** by a WAF: `Error 403 / Web Page Blocked /
Attack ID 20000051`, with the client IP printed on the block page.

Every entry in this playbook before today assumed the browser rung is the
STRONGEST one — that anything answering a human answers Playwright. It is not
true here, and the direction matters: a session that escalates from a
disappointing rung 2 to rung 6 gets a WORSE answer, and a 3,672-byte block page
reads like a page with nothing on it.

`pnpm rung6` now detects the block by its own text and reports `was REFUSED —
this host walls rung 6 while answering rung 2` rather than the byte arithmetic it
first printed, which read as *added nothing, this page is not JS-rendered*. **A
block that reads as a clean measurement is the empty-success shape wearing a
browser's clothes.**

### 3. A HOST CAN WALL ITS HTML AND SERVE ITS FEED FREELY — a PATH-SCOPED Cloudflare wall

`suttonnh.gov` returns the Cloudflare managed challenge (`Just a moment...`,
HTTP 403) on every HTML page, at rungs 2, 3 and 4, and headless Chromium cannot
clear it — the playbook already records that last part. The same host serves
`/calendar/ical/calendar.ics` at **rung 2, HTTP 200, 370,587 bytes** with no
challenge at all.

So a host is not walled or unwalled. It is walled PER PATH, and the path a
session happens to try first decides what it writes down. Try the machine-facing
paths — `.ics`, `.rss`, `.json`, `/sitemap.xml`, an export endpoint — before
recording a host as refusing.

### 4. RUNG 5 CLEARS A CLOUDFLARE MANAGED CHALLENGE

The same `suttonnh.gov` board pages: rung 2 **403**, rung 3 **403**, rung 4
**404**, rung 5 **200 with the document**. The relay is not running a browser and
is not solving the challenge; it is arriving from an egress the challenge does
not fire on.

Combined with entry 2 above, the ordering lesson is blunt: **rung 5 and rung 6
are not ranked.** They fail on different things, and a hunt that stops at
whichever it tried first has walked one branch.

### 5. A SECOND GEOCODER IS A BRANCH, AND THE CENSUS LABEL CAN BE WRONG ON A RIGHT POINT

The wall that kept Sutton dark for two sessions was a coordinate. The Census
geocoder was asked four ways for the Planning Board's published venue and
answered Bradford NH twice, Sutton **Massachusetts** once, and no match once — so
the venue-cache row could not be written, because a pin is a claim.

Walked again on 2026-08-21 with a second, independent provider:

| provider | point | label |
|---|---|---|
| Census | `43.334241, -71.953514` | 93 MAIN ST, **BRADFORD**, NH 03221 |
| OpenStreetMap | `43.334070, -71.953113` | **Sutton Town Hall**, 93 Main Street, Sutton, Merrimack County, NH 03221 |

**Thirty-eight metres apart.** The Census COORDINATE was correct the whole time;
only its CITY LABEL was wrong, because TIGER attributes the 89–99 MAIN ST
address range to Bradford. Two sessions read the label, disbelieved the answer,
and discarded a correct point.

`pnpm geocode` walks both and reports the PAIR — both points, both labels, and
the metres between them — and never averages a disagreement into a third point
neither provider returned. Nominatim also needs its **structured** query: the
same address as free text returned nothing, and
`street=…&city=…&state=…&country=USA` returned the town hall. An empty free-text
geocode is a false miss, not an absence.

### 6. DOMAIN-GUESSING IS A FALSE-POSITIVE MACHINE ON A COMMON NAME

`pnpm manifest:walk`'s `domain-search` route guesses sixteen domains per
candidate. On its first six candidates it produced four confident hits, and
**all four were other people**:

| guessed | who it actually is |
|---|---|
| `kathleendonnelly.com` | a novelist who writes K-9 mysteries |
| `ericadavis.org` | a Harris County, **Texas** school trustee candidate |
| `electfrench.com` | **French Hill**, of Arkansas |
| `samanthamorse.com` | a template site that never names an office, a county or a state |

A surname on a live domain is nothing. The route now requires a
CORROBORANT in the body — the town, the office, the state, or campaign
vocabulary — and reports a name-only match as **needing a person** rather than
as a find. Even corroborated, it is opened and read: `kathleendonnelly.com` and
`ericadavis.org` both pass the corroborant test, because a novelist's site says
"campaign" and a Texas candidate's says "elect".

**Never ship a domain a script found. Open it.**

### 7. A PARKED DOMAIN THE SEARCH INDEX STILL PRESENTS AS LIVE

`merrimackcountydems.com` is the top search result for the Merrimack County
Democratic Committee. Rung 2 returns 114 bytes; rung 6 renders 25 KB of
**GoDaddy parking page** — *"merrimackcountydems.com is parked free"*, with
related-search topics for Wisconsin and Massachusetts.

That is the third sighting of this shape in two sessions (`newportnh.net` with
Cyrillic categories, `windsornh.gov` as a GoDaddy lander, now this). **The
search index is a stale mirror.** A domain answering HTTP 200 is not a live
body, and a 114-byte rung-2 answer is a signal to escalate rather than a small
page.

### 8. `facebook.com` RENDERS ZERO CHARACTERS TO OUR HEADLESS BROWSER

Two campaign/committee pages read at rung 6 on 2026-08-21: `977,803` and
`928,697` bytes rendered, `0 chars of text` from `document.body.innerText`, no
emails, no phones. The login wall builds the DOM and paints nothing readable to
an unauthenticated automated client.

This matters more than it looks, because `campaign-social` is the highest-yield
route in the branch manifest for the smallest races — a campaign that lives on
Facebook still has a campaign site, and that rule protects exactly the
candidates least able to buy a domain. **The route is WALLED today, at rung 6,
and named as walled with its date.** It is not an absence, and the RULING 53
clock puts it back on the queue in fourteen days.

### 9. A PARTY COMMITTEE'S POST IS NOT THE CANDIDATE'S PAGE

A search result reads *"Dianne Schuett for Merrimack County Treasurer"* and
points at `facebook.com/61577753144555/posts/…`. Opened, the page id resolves to
**"Pembroke NH Democrats"** — a town committee that posted ABOUT her candidacy.

Recording it as her campaign page would have put a party committee's account on
a named person's card as though it were hers. The search result's TITLE was the
post's text, not the page's identity. Resolve a social id to its OWNER before
attributing it, every time.

### 10. A STATE ROSTER SPA SERVES THE IDENTICAL SHELL FOR EVERY MEMBER

`njleg.state.nj.us/legislative-roster/478/senator-mckeon` and `/473/senator-space`
both return **exactly 25,380 bytes** at rung 2 and neither contains its member's
name. At rung 6 they render 36,079 bytes and 3,108 characters — *"Senator John
F. McKeon (D), District 27"* and *"Senator Parker Space (R), District 24"*, each
with a district phone that matches what our record already held.

A byte count identical across two different URLs is the tell, and it is cheap to
check: **fetch two members and compare the sizes.** Identical means you are
holding a shell.

### 11. AN OFFICEHOLDER'S "SPECIFIC VERIFIED PAGE" CAN BE A PAGE FOR A PREVIOUS TERM

Five officials carried a `websiteUrl` nobody had checked. Three of the five
pointed at a page that was correct for an EARLIER term:

- Rachel Keshel → the **56th** Legislature, at a legislator id that is not hers.
  HTTP 200, 106,944 bytes, **surname nowhere in the document.**
- Rosanna Gabaldón → the **55th** Legislature.
- John McKeon and Parker Space → party **ASSEMBLY** pages, for two sitting
  **SENATORS**. McKeon's returned HTTP 404.

A stale official page is worse than none: it is a wrong claim about where a
named person's record lives, on the surface whose whole job is to say where a
claim came from — and it answers HTTP 200, so nothing notices. `pnpm
fix:official-pages` repairs these five with each replacement fetched and read
first, and REFUSES any repair whose stored value no longer matches what the
script expected.

**The check that finds this class**: does the page still name the person? A
200 is not a yes.

### The tools NH Hunt 6 built

| Command | What it does |
|---|---|
| `pnpm manifest:walk --name "…" [--town T] [--state NH] [--office O] [--site D]` | Walks the mechanically-walkable branch-manifest routes for one person and writes each as a `ManifestBranch` with its route id, date and result. Reports **what it could NOT walk, by name**, per field — a tool that counted its own coverage as the manifest's coverage would be the RULING 61 bar lowering itself. |
| `pnpm rung6 <url> [--wait ms] [--selector css] [--html] [--out f]` | Rung 6 walked DELIBERATELY, whatever rung 2 said. `pnpm ladder` stops at the first rung that READS, which is right for a wall and wrong for a false miss — a 200 with an empty detail region is a read by byte count and a miss by fact. Reports bytes-before against bytes-after, detects a WAF block as a refusal, and harvests contacts from `mailto:`/`tel:` hrefs as well as visible text. |
| `pnpm geocode "<address>"` | Two independent geocoders, reconciled, reported as a pair with the metres between them. Never averages a disagreement. Every hit carries the request URL, because `VenueEntry.coordinateSourceUrl` is required and a pin is a claim. |
| `pnpm fix:official-pages [--write]` | Repairs the five officials whose specific verified page pointed at a previous term or at nothing. Every replacement verified before applying; a stored value that no longer matches is REFUSED rather than forced. |
| `pnpm guard:census [--write] [--allow-removals]` · `pnpm guard:history` | RULING 62 — see §4. |
| `pnpm manifest:doc [--check]` | Regenerates the route tables in `docs/branch-manifest.md` — see §4. |

### The tools the audit remediation built (2026-08-24)

Not hunt tools. Every one of them is an instrument for proving something about
this repo's own code, and they are here because the next session that needs to
prove the same kind of thing should not rebuild them.

| Command | What it does |
|---|---|
| `pnpm tsx scripts/repro-against-shipped.mts [--rev R] [--live]` | **Reproduce a finding against the code AS SHIPPED, not against the fix.** Materialises a module from `git show <rev>:<path>` into a scratch file, re-points its relative imports at the live tree, and drives the finding against that. Nothing stale is committed and the revision is named. Its second technique is the one worth remembering: where the code under test sits in a branch deliberately unreachable by injection — `politeGetText`'s 403 ladder is gated on `!options.fetchImpl` — replacing `globalThis.fetch` gets underneath the gate so the REAL ladder runs with doubles below it. |
| `pnpm tsx scripts/a008-false-green-audit.mts [--count N]` | Replays two versions of a decision function over recent history and reports where they disagree. Written for the release gate; the shape generalises to any verdict function whose past answers are worth re-asking. The OLD logic is reimplemented in the script rather than imported, because importing the fixed module cannot answer a question about the broken one. |
| `pnpm tsx scripts/p002-module-table.mts [--top N] [--json F]` | The landing page's initial JavaScript **by module**, decoded from the build's own source maps and reconciled to the byte. `pnpm build`'s budget answers map-versus-application, which is the right question for a budget and the wrong one for a fix: you cannot put a bucket behind an async boundary. Requires `WTP_ATTRIBUTION_BUILD=1`. |
| `pnpm resolver:manifest` · `pnpm resolver:identity` | The geometry the server resolver may read, generated with SUPERSESSION as its rule, and the gate that proves a geometry change altered no answer — every supported zip through the old and new resolvers, compared as SETS. |
| `pnpm purge:synthetic [--target=production] [--apply]` | Removes only `run_class = 'SYNTHETIC'` from the collection stores, exports every row to a dated backup outside the repo first, and refuses if ORGANIC, UNKNOWN or AUTHOR moved by a single row. Dry run by default. |
| `pnpm tsx scripts/verify-p001-p002.mts` | Browser verification against a LOCAL production build (RULING 125). Its one transferable idea: it STAMPS each DOM element before the interaction and counts the stamps after, because a count would be satisfied by the same number of brand-new elements — which is precisely the defect it was written to catch. |
| `node scripts/tracker.mjs reopen <ID> --session=… --reason F` | Withdraws a resolution THIS SESSION wrote, while the row is still in the working store. `resolve` had no inverse, and the store has one writer, so a session that marked the wrong row had to choose between a false resolution and hand-editing a CSV. It keeps the resolution text and adds the withdrawal beside it. |

## Inheritance — what the next zip loads before it hunts (RULING 63)

**Read this before starting any zip. It is the first thing in the run, not a
reference consulted when stuck.**

### What to load, in this order

1. **`docs/branch-manifest.md`** — the named routes that must be walked before
   absence may be claimed. Start at its **Index by question**, not at the top.
   36 routes as of manifest `v1`: photo 7 · in their own words 10 · contact 35 ·
   campaign site 14 · specific verified page 8.
2. **This file's question index**, below.
3. **State which branches you inherited, in the run's first report line**, before
   hunting anything.

### Report branches inherited against branches newly built, as a pair

That ratio rising across zips is the only real evidence the method compounds. A
session that builds a branch which already existed has **committed a defect** and
reports it as one, naming the existing branch. Check the manifest BEFORE
building: duplication is worse than a gap, exactly as it is in the tracker.

### Which of New Hampshire's branches are expected to FAIL elsewhere

Recorded now rather than discovered later. All four are New England shapes and
nearly every branch this project has built so far was built against them:

| Branch | Why it will not travel |
|---|---|
| **The town clerk as the record of local filings** | Works because New England town government makes the clerk the record. Where a COUNTY runs elections — most of New Jersey and Arizona — the clerk holds nothing and the route is a dead end. |
| **The village-district register** | New Hampshire keeps a state register of village districts. Almost nowhere else has this category of body at all, and the states that do call it something else. |
| **Town meeting and SB2** | The annual town meeting IS the legislature here, and the town report enumerates every officer as a consequence. A township with a council and a manager publishes nothing equivalent. |
| **The school administrative unit above the district** | An SAU serving several districts is a New Hampshire structure. Elsewhere the district IS the unit, and looking for the layer above finds nothing and reads as a gap. |

**Rockaway Township, NJ (`07866`) is the median American shape and is the first
real test of whether any of this travels.** A council, a manager, a county that
runs elections, a regional school district, and no town meeting.

Where an inherited branch fails in a new jurisdiction it grows a **sub-branch**
per RULING 60 — recorded with the jurisdiction and the date — and is never
deleted. A branch that stops working is evidence the tree needs another limb,
never evidence the fact is unobtainable. The shapes named in `CLAUDE.md` as
certain to break these routes are **Alaska's boroughs**, **Arizona's
unincorporated county territory**, and **Louisiana's parishes**.

## NJ Hunt, 2026-08-22 — Rockaway Township (07866), and what the median American shape actually requires

**Read this before hunting anywhere that is not New England.** Rockaway
Township was chosen because it is ordinary — a township with a council and a
manager, a county that runs elections, a regional school district, a CivicPlus
portal, and no town meeting. New Hampshire was chosen as the worst possible
jurisdiction to generalise from. This section is the difference between them.

### 1. THE HEADLINE — NEW JERSEY PUBLISHES THE CONTACT, AND NEW HAMPSHIRE DOES NOT

NH Hunt 6 measured `contact` at **7 mechanically-walkable routes against 28
that need a person**, and reported ONE contact found for sixteen Merrimack
County candidates. The question this zip existed to answer was whether that
ratio is a fact about the country.

**It is not, and the reason is narrower and more useful than "New Jersey is
easier".** The manifest is the same in both states and the walker automates the
same seven routes in both. What changed is what two of the *other* routes
actually return:

| | New Hampshire | New Jersey |
|---|---|---|
| `filing-state` | name, town, party. Walled at rungs 2–3; rung 5 reaches it. **No contact.** | a candidate list AND a separate `-emails-` PDF. **The contact itself.** |
| `filing-county` | the county publishes no candidate list | one born-digital PDF, whole county, **filed email and filed street address for every office including school board** |
| Contact found | **1 of 16** candidates, after walking all 7 automated routes | **15 of 15** candidates, from ONE document each |

So the honest statement of the finding is: **the human-route dependency does
not hold. New Hampshire was the anomaly — not because it has fewer routes, but
because its filing authority does not publish what New Jersey's does.** The
dependency was never on the number of routes; it was on a per-state publishing
practice, and no national floor guarantees it either way.

**What this does NOT license.** Two states is two states. Arizona's counties,
Alaska's boroughs and Louisiana's parishes are all still unmeasured, and the
Census-of-Governments route that reached Morris County is a state-by-state
question every time. The next zip asks the same question again rather than
assuming the answer.

### 2. `pnpm nj:filing` — the branch, and how it finds its own documents

```
pnpm nj:filing                              # discover + parse, print counts
pnpm nj:filing --municipality "Rockaway Township"
pnpm nj:filing --pdf <local.pdf>            # parse a file already on disk
pnpm nj:filing --json out.json
```

Two documents, both rung 2, both with a real text layer:

- **The county clerk's filed-candidate list.** Morris County's carries 272
  candidates county-wide, 260 with a filed email and 260 with a filed address.
  A SEPARATE school-candidates PDF carries the board races, which is where the
  down-ballot tier lives.
- **The Division of Elections' `-emails-` companion.** The state publishes the
  contact list as its own file *beside* the candidate list:
  `2026-unofficial-general-candidates-us-house-emails-0727.pdf` next to
  `2026-official-general-candidates-us-house.pdf`. **A session that reads only
  the candidate list finds no contact and records an absence the neighbouring
  file disproves.** Look for the sibling.

**NEVER hardcode the PDF URL.** The clerk republishes at a NEW version path on
every revision (`/v/9/...-082126.pdf` supersedes `/v/6/...-080726.pdf`) and both
stay reachable forever. Discovery always fetches the clerk's own candidates PAGE
and reads its `href`s, taking the newest date stamp. The 082126 revisions found
on 2026-08-22 superseded the 080726 and 072826 revisions this project curated on
2026-08-14 — two weeks stale, and a stale filing read as current is a claim
about who is running.

**The ballot-position PDF is a scan with no text layer** and is skipped by name.
It is a rung-9 OCR job, not this branch.

### 3. `www.nj.gov` IS INTERMITTENTLY IMPERVA-WALLED, AND RUNG 4 CLEARS IT

Within one minute on 2026-08-22 the same URL returned: a real 85,920-byte page
to `curl` at rung 2, a real page to a bare Node `fetch`, and an Imperva
challenge to the polite serialized client. On a later run rungs 2 and 3 both
refused and **rung 4 (`curl`, whose TLS fingerprint passes what Node's does
not) cleared it**.

Two rules follow, and they are the ones this repo keeps relearning:

- **A wall observed once is not a wall.** A branch that had died on that single
  reading would have recorded `NJ Division of Elections — REFUSED`, which is
  exactly the shape `gc.nh.gov` and `sos.nh.gov` were both wrongly recorded
  under. `pnpm nj:filing` walks 2 → 3 → 4 and names each result.
- **`elec.nj.gov` is a DIFFERENT HOST and is genuinely walled** — a 212-byte
  Imperva challenge, recorded since 2026-08-19 and unchanged on re-walk. Do not
  generalise `www.nj.gov`'s intermittency to it, or its wall to `www.nj.gov`.

And the wall is not needed anyway: `filing-county` carries the same fields ELEC
would have been asked for. A walled route is not a lost fact when another
branch holds the same fact.

### 4. FOUR INHERITED NEW HAMPSHIRE BRANCHES FAILED HERE — AND WHAT REPLACED EACH

RULING 60 in practice. None was deleted; each grew a limb.

**4.1 `zip:universe` was hardcoded to New Hampshire.** It loaded `cousub-33`,
`unsd-33`, `elsd-33`, `scsd-33` and a three-county NH governments file. Run
against 07866 it resolved Rockaway Township's centroid *correctly* and then
enumerated New Hampshire, so `pnpm twig:pair 07866` reported a New Jersey
township's official universe as ONE unit — the *Nashua City School District*,
350 km away — and reconciled cleanly while doing it. **A confident,
arithmetically consistent, entirely wrong answer.**
*The limb:* the state FIPS now comes from the containing county in the national
`county-us` layer, the per-state TIGER layers are loaded by that FIPS, and the
governments slice is cut from the full national Census file already committed at
`data/reference/census_govt_units_2022.csv` (90,838 rows, every state). A state
whose layers are not committed now **fails loudly and names the missing file**
rather than falling back — a silent default is how a session measures the wrong
place and reports it as coverage.

**4.2 The Census name normaliser did not know `TWP` or `BORO`.** New Hampshire
spells its unit types out; the Census abbreviates and TIGER does not:

```
Census  "ROCKAWAY TWP SCH DIST"              -> "ROCKAWAY TWP"
TIGER   "Rockaway Township School District"  -> "ROCKAWAY"      no match
```

So the Rockaway Township School District — which the TIGER geometry places the
zip's centroid *inside* — was written out as `governsZip: false`. A district
that governs a reader's children reading as one that does not, because of four
letters.

**4.3 …and the obvious fix was worse.** Stripping `TOWNSHIP` and `BOROUGH`
along with their abbreviations made `BOROUGH OF ROCKAWAY` and `TOWNSHIP OF
ROCKAWAY` both normalise to `ROCKAWAY`. They are **separate municipalities with
separate councils, separate school districts and separate ballots**, and the
Borough's school district resolved onto the Township's OCD id — a join
collapsing distinct keys onto one row, which would have shown a Borough reader
the Township's board.
*The limb:* **the unit type is the discriminator and is EXPANDED, never
removed**, and moved to the end so the Census's `TYPE OF NAME` and TIGER's
`Name type` meet. Only words describing PURPOSE come out (`SCHOOL`, `DISTRICT`,
`REGIONAL`). A county is compared with its type stripped, because TIGER labels
counties bare and a county name is unique within a state — a municipality name
is not.

**4.4 `twig:pair` minted `state:nh` ids for New Jersey units.** Every branch of
its `divisionFor` template wrote `state:nh` and appended New Hampshire's `_town`
suffix, so `TOWNSHIP OF ROCKAWAY` — which this registry holds nine bodies for —
reported as **"no division of its own"** and the pair read 1 of 178.
*The limb:* read the OCD id `zip:universe` already resolved **by geometry**,
which is ground truth and carries no naming convention. The template survives
only as a New-Hampshire fallback for special districts that have no Census
boundary at any vintage, fenced to FIPS 33 so it can never again mint an id for
a state whose conventions it does not know.

**4.5 A bare positional argument was silently ignored.** `pnpm twig:pair 07866`
ran against the 03255 default and printed a full, correct, irrelevant report.
The header said 03255, which is exactly what makes it dangerous. Both forms are
accepted now and an unrecognised argument is fatal.

### 5. THE CONTROL QUERY — ASK THE HOST FOR SOMETHING THAT CANNOT EXIST

**The most transferable thing this session built.** `pnpm ad:library`'s first
run reported `HIT` on **16 of 16 candidates** for two different routes. A 100%
hit rate on guessed handles across sixteen different people is a measurement of
the instrument, not a discovery. One control proved it:

```
bsky.app/profile/janebradstreet.bsky.social ......  200,   5,989 bytes
bsky.app/profile/zzqxwvnonexistent99.bsky.social .  200,   5,989 bytes
instagram.com/janebradstreet/ ....................  200, 615,870 bytes
instagram.com/zzqxwvnonexistent99/ ...............  200, 615,886 bytes
concordmonitor.com/?s=Bradstreet .................  200, 195,196 bytes
concordmonitor.com/?s=Zzqxwvnonexistent ..........  200, 195,170 bytes
```

Three hosts, three shapes of one lie: an SPA shell, a login wall, and an
empty-results page that **echoes the query into its own HTML**, so a substring
test for the surname passes on a page with no results in it. All 200.

**So before guessing an identifier at a host, ask that host for a control
identifier that certainly does not exist, and treat any answer within a few
percent of the control as EMPTY.** This is the sixth sighting of the
zero-rows-reported-as-success shape in this repo and the first with a general
instrument against it. Use it for handles, slugs, domains, member ids, and any
search endpoint whose no-results page is a 200.

### 6. `LEAD` IS NOT `HIT`, AND THE DIFFERENCE IS A PERSON

Even with the control, a guessed identifier proves a page EXISTS and can never
prove **whose** it is. `instagram.com/vincentribas` answered 719,095 bytes
against a 615,950-byte control — a page is certainly there, and nothing in that
measurement says it belongs to the Merrimack County Commissioner candidate
rather than to any other Vincent Ribas. NH Hunt 6 recorded the same on domains:
four of the first four hits were other people.

A guessed-identifier route returns **`LEAD` at best**. It is work for a human,
counted separately from HIT and EMPTY, and it moves no field toward exhaustion
in either direction.

### 7. RULING 66 — WHAT THE COMPLIANT FACEBOOK ROUTES ACTUALLY YIELDED

Walked for all sixteen Merrimack County candidates, 2026-08-22, after the
control was fitted:

| route | HIT | LEAD | EMPTY | REFUSED |
|---|---:|---:|---:|---:|
| `ad-library` | 0 | 0 | 0 | **16** |
| `social-archive` | 0 | 0 | 16 | 0 |
| `social-mirror` | 0 | 15 | 1 | 0 |
| `news-embed` | 0 | 0 | 16 | 0 |

`ad-library` is **REFUSED, not EMPTY**: `graph.facebook.com/ads_archive` answers
HTTP 500 `OAuthException` without an access token, and the public Ad Library web
pages answer 403 with an anti-automation challenge. The token is issued against
an identity-verified Meta account, which is a credential decision for the author
— tracker `NS01`. **A refused route has not been walked for RULING 61 purposes**,
and a field it would have served stays *still owed* rather than moving toward
exhaustion. Recording those sixteen as EMPTY would have put sixteen false
negatives into an exhaustion count.

### 8. RULING 65 — THE FOOTER-ADDRESS BRANCH, AND ITS BOUNDARY

**The footer is an ELEMENT, not a character offset.** The first build took "the
footer" to mean the last 1,500 characters of stripped text and produced four
matches across nine pages that share one template — impossible, and the tell.
These pages carry long bodies (a select-board page ends in twelve years of town
reports), so the real footer sits at ~95% of the document. `<footer>` is
unambiguous and cannot drift with page length.

**And the pipe is a separator that has to go before matching.** Sutton's footer
reads `93 Main Street | Sutton Mills, NH 03221 | (603) 927-2408`, and an address
pattern guarded with `[^|]` — there to stop a match running across two unrelated
fields — refuses to cross it, so the route returned **zero on nine pages that
plainly carry an address**. Normalise `|`, bullets and middots to commas first.

**Reach:** 9 bodies in Sutton, **95 bodies across 17 hosts in three states**
(NH, NJ and AZ — including `rockawaytownship.org`). Sutton went from **1 body
live of 19 to 6**, and from **5 meetings to 37**.

**The boundary, which is the rule working.** RULING 65 fills a SILENCE; it never
overrides a body that says something about itself. Three bodies with a footer
address were deliberately not wired:

- **Ad Hoc Speed Sign Committee** — its own titles read `- Zoom Mtg`.
- **Warner River Local Advisory Committee** — its own titles read `@ Pillsbury
  Library`, a venue this hunt could not resolve; it is a multi-town river
  committee and Sutton's hall is a poor guess.
- **Sutton Free Library Board of Trustees** — its page states its own arrangement.

**Always count the feed before writing a wiring row.** A row for a body with no
sittings renders nothing and reports success.

### 9. A CivicPlus D9 SITE CAN SERVE THE VENDOR'S TEMPLATE SITEMAP

`suttonnh.gov/sitemap.xml` answers 200 with a valid sitemap containing exactly
one URL: `https://d9template1.civiccms.acsitefactory.com/` — the vendor's
Drupal 9 template host. **Rung 10 returns the vendor and none of the body's own
pages**, and a session walking it would find a well-formed sitemap with no board
pages in it and no signal anything was wrong.

### 10. PACING IS ITSELF A RUNG

`suttonnh.gov` served real HTML at rung 2 to the polite serialized client for
**18 board pages in a row**, and served a Cloudflare `Just a moment…` challenge
to an unpaced burst of `curl` requests minutes later. The wall did not come
down and did not stay up; it responds to REQUEST RATE. Do not record such a host
as walled from a burst, and do not record it as open from one lucky fetch — and
prefer the identified serialized client over hand `curl` loops when reading many
pages from one host.

### 11. READ THE BYTE COUNT BEFORE THE PARSER EATS THE BUFFER

`pdfjs` takes ownership of the `Uint8Array` it is handed and detaches it, so
`bytes.length` afterwards is **0**. The first run of `pnpm nj:filing` printed
`0 bytes` for two PDFs it had just parsed 272 candidates out of. A count read
after the operation that consumed it is a false zero reported as a measurement.

### 12. A 404 PAGE THAT ECHOES YOUR QUERY READS AS A HIT

`nhbar.org/find-a-lawyer/?fwp_lawyer_search=Hagaman` returns **HTTP 404** with a
167 KB body that contains the string `Hagaman` — because the 404 page echoes the
query. A substring test passes. Check the STATUS, then the control, then the
body — in that order.

### 13. A PO BOX IS NOT A STREET NUMBER

An address pattern anchored on a leading digit parsed `P.O. Box 999 Edison NJ
08818` as `999 Edison NJ 08818`. Two of the fifteen 07866 candidates file a PO
box — a sixth of the down-ballot tier — so this was not an edge case. Guarded in
`tests/filed-address.test.ts` by the shape it leaves behind:
`<number> <City> <ST> <zip>` with no street name.

### 14. ONE ZIP, TWO MUNICIPALITIES

**07866 covers Rockaway TOWNSHIP and Rockaway BOROUGH**, both at 0 km from the
centroid, and this product holds nothing for the Borough — which is running a
four-candidate council contest and two school-board seats that do not render.
Tracker `NJ01`, P1. New England's one-town-one-zip habit does not travel; check
the clerk's filing for a second municipality sharing the name before assuming
the zip is one place.

### 15. THE OFFICIAL-UNIVERSE PAIR IS MUCH LARGER IN NEW JERSEY

| | 03255 (Newbury, NH) | 07866 (Rockaway Twp, NJ) |
|---|---:|---:|
| units in the 25 km circle | 48 | **178** |
| units held | 48 | 5 |
| units with no body | 0 | **173** |
| bodies held | 412 | 13 |

Northern New Jersey is dense with boroughs, townships, fire districts, regional
sewerage authorities and municipal utilities authorities. That is an
enumeration finding rather than a defect — but it means **a New Jersey zip is
several times the work of a New Hampshire one at the same radius**, and the
fire districts and MUAs are the largest single unreached class.


---

## 7. TIERED DISCOVERY — what Tier A returned that Tier C could not (NJ Hunt 5, 2026-08-22)

**Arizona reads this section first.** It is the shortest path from "a new state"
to "most of the roster, named", and it is written as a measurement rather than
as advice.

RULING 84 tiers every manifest route: **A** answers many entities at once, **B**
is the entity's own official source, **C** is a per-entity search. The tiers are
walked in order and a field may not reach Tier C until A and B are walked for it.
Tiering the 42 routes that existed gave **A 14 · B 11 · C 17**; the session then
added 11 more Tier A routes, ending at **53 routes, A 25 · B 11 · C 17**.

### The measurement, stated as a pair

| | Tier C (per-entity search) | Tier A (broad sources) |
|---|---|---|
| What was walked | 5 engines as a tree, 272 candidates | one Wikipedia read per municipality; seven credentials |
| Cost | DuckDuckGo walled after **6** queries; Bing and Yahoo after ~**170** | 39 municipality reads; 7 API calls |
| Returned | 148 of 272 candidates with at least one classified URL; **124 with none** | **240 distinct officials named**, 768 citations confirmed; **119 owed fields closed from credentials alone** |
| What the 124 meant | a fact about one IP's rate ledger on one afternoon | — |

**The 124 were never unreachable.** They were rate-limited, and the previous
session's close-out named a paid search API as the constraint while a templated
encyclopedia page listing nine council members sat unopened two clicks from a
plain Google search. That is RULING 83, and this table is the evidence for it.

### The order to walk a new state in

1. **`Government of {state}`** — the structure article. Executive, legislative
   and judicial branches, every executive department, each linked to its own
   official `.gov`. This is RULING 87 at the STATE tier and it is the first
   thing to read.
2. **The county's Wikipedia article and every municipality's** — one parser,
   roughly 19,000 US articles. §8 below.
3. **The credentials already held** — RULING 90 item 5. An authenticated
   resource is walked before any unauthenticated one is exhausted.
4. **The state's own filing and campaign-finance systems**, found from the FEC
   Combined Federal/State Directory rather than guessed.
5. **The citation host map** the encyclopedia articles produce (§8), which is a
   derived list of who actually covers this state's politics.
6. **Only then** the per-entity search, for the fields Tier A structurally
   cannot carry: photos, a candidate's own words, a domain nobody linked.

---

## 8. THE WIKIPEDIA ROUTE — what the template yields, and where it breaks (NJ Hunt 5, 2026-08-22)

`lib/hunt/wikipedia.ts` · `pnpm wiki:muni --state NJ --county Morris --confirm`

### What the template yields

US municipality articles carry a `Local government` section with three sentences
in a small number of shapes: a **form-of-government** sentence, a
**body-composition** sentence, and a **roster** sentence. Plus a
`Federal, state, and county representation` section that transcludes
**officeholder templates** — and those templates are where the county governing
body and the legislative delegation actually live.

Morris County, 39 municipalities, one run:

| | |
|---|---|
| municipalities reached | **37 of 39** on the first pass, **39 of 39** after two seed-title corrections |
| governing body parsed | 36 of 37 |
| roster parsed | 33 of 37 on the first pass |
| official rows extracted | **843** |
| distinct officials named | **240** |
| citations CONFIRMED against a fetched primary source | **768** |
| LEAD · UNREACHABLE · NO_CITATION | 40 · 16 · 19 |
| distinct citation hosts | **726** |

**The citation-confirmation rate is 768 of 843 — 91.1%.** RULING 87: Wikipedia
names the person, the citation proves them, and the 40 LEADs are exactly the rows
a session must not ship.

### The officeholder templates are the prize

`{{NJ Morris County Commissioners}}` carries the **seven county commissioners AND
the three constitutional officers** — Clerk, Sheriff, Surrogate — in one prose
list with a footnote. `{{NJ Legislative 25}}` carries the senator and both
assembly members. `{{NJ Congress 11}}` and `{{NJ Senate}}` carry the federal
delegation. One template serves every municipality in the county, so it is
fetched once and cached, not 39 times.

**Follow redirects.** `Template:NJ Morris County Commissioners` is a redirect to
`Template:NJ Morris County commissioners`. A session that did not pass
`redirects=1` would record seven county commissioners as unreachable on the
strength of a capital letter.

### Where the template breaks — every seam, named

1. **The roster sentence has no reliable lead-in.** Rockaway Township says
   *Members of the Township Council are*; Montville says *Montville's Township
   Committee is comprised of*. Gating on a phrase list lost **4 of 39**. The fix
   is to SCORE every sentence by how many member-shaped entries it yields — prose
   scores zero, because prose has no `(R, 2027; Ward 4)` in it — and take the
   best. The phrase list survives only as reporting.
2. **The member parenthetical has at least four shapes.** `(R, 2027; At-large)`
   · `(R, 2026)` · `(Ward 3; D, 2027)` — seat BEFORE party · `(R, term on
   committee ends December 31, 2026; term as mayor ends 2024)` — two term
   clauses. Choose the clause that CARRIES A YEAR first, then the one not about
   holding an office.
3. **Sentence splitting must mask `<ref>` bodies.** A footnote is full of
   sentences that are not this sentence, and splitting inside one detaches every
   citation. Symptom: every extracted person has zero citation URLs, and the
   confirmation rate reads 0 of N for reasons that have nothing to do with
   Wikipedia. Footnotes come AFTER the full stop and belong to the sentence, so
   the end is pushed past any run of refs that follows.
4. **`, Sr.` is not a separator.** Dover's `Marcos Tapia-Aguilar, Sr. (Ward 4; D,
   2026)` produced a council member called `Sr.`.
5. **Office titles are glued to names**, and longest-first matters: `Deputy
   Director` before `Director`, or Morris County's deputy director enters the
   record as a person called *Director John Krickus*.
6. **The mayor sentence must be matched on RENDERED text.** `[[Mayor]] of
   Rockaway Township is` does not match `mayor of` until the wikilink is
   resolved. And the name may carry a middle initial — `Democrat James P. Dodd` —
   so the full stop cannot be excluded from the name pattern.
7. **Two seed titles were wrong, not two articles.** `Chatham, New Jersey` is an
   AREA article covering borough and township with no government section;
   `Mendham, New Jersey` is a redirect with no headings at all. The real titles
   are `Chatham Borough, New Jersey` and `Mendham Borough, New Jersey`. **A
   parser miss and a universe-list miss look identical in the output**, and
   telling them apart is what the returned `headings` array is for.
8. **A state whose municipality articles are not templated this way** has not
   been met yet. New England towns and New Jersey municipalities both parse.
   Alaska boroughs, Louisiana parishes and Arizona's unincorporated county
   territory are RULING 60's warning and are expected to need sub-branches.

### The citation host map — a derived press list, not a guessed one

An article's reference list is a bibliography of who publishes about this place,
assembled by people with no stake in our hunt. Counted across a county's articles
it ranks the outlets worth querying directly. Morris County's top non-archival,
non-government hosts: **nj.com (88), dailyrecord.com (78), northjersey.com (55),
newjerseyhills.com (44)**, with `nytimes.com` at 138 and
`njdatabook.rutgers.edu` at 75. That is the `press-outlet-map` route's raw
material, and it is strictly better than asking a general engine and hoping.

---

## 9. THE GOVERNMENT GRAPH — crawl it, do not list it (NJ Hunt 5, 2026-08-22)

`lib/hunt/wiki-graph.ts` · `pnpm wiki:graph --zip 07866 --state "New Jersey"`

**A list cannot be the fix, because the failure is that lists are finite** —
RULING 90. `wikipedia-municipality` reads NAMED pages, so it finds exactly what
the person who wrote the list thought of. It will never surface the New Jersey
Department of Banking and Insurance, whose rulemaking hearings on mortgages,
insurance premiums and pawnbroker licensing are precisely the *there is a hearing
Tuesday, go* surface this product exists for.

So the crawler seeds from the municipality articles for a zip and follows every
link that resolves to a governmental entity touching that zip, and follows again.

### The traversal rules Arizona inherits

- **Classify by CATEGORY, never by title.** Wikipedia's category graph is
  maintained by people with no stake in this. `Category:New Jersey state
  agencies` IS a state agency. Titles are used only to reject cheaply BEFORE a
  fetch, and every title rejection is RECORDED so a bad heuristic is visible.
- **A title heuristic must never be able to eat a class of body.**
  `/\bSchool\b/` is a sensible way to skip an article about a high school and a
  catastrophic way to skip `Rockaway Township Public Schools`. Any title
  containing a body word — District, Commission, Board, Authority, Department,
  Government, Council, County, Township, Borough, Court, Legislature, Senate,
  Assembly, Bureau, Agency — is never title-rejected.
- **Some agency articles are barely categorised at all.** `New Jersey Department
  of State` carries exactly one substantive category, `Secretaries of state of
  New Jersey`. A title fallback rescues these, and disqualifying categories still
  run first and still win.
- **The state article does not say "government" anywhere in its categories.**
  `New Jersey` carries `States of the United States`. Without a pattern for that,
  the crawl stops one hop short of `Government of {state}` — the richest node in
  the graph. Seed the structure article directly as well.
- **Scope is stated, not inferred.** A node is in scope if its state matches, or
  if it is one of the specific federal titles this zip's own representation
  section named. Without a scope test the crawl walks out through `United States`
  into every government on earth.
- **No depth cap. A FETCH BUDGET instead.** A depth cap silently decides the
  graph is three deep. A budget that binds is reported with the unexpanded
  frontier named, so the clip is a stated number rather than implied
  completeness.

### The artifact, and why failed nodes are kept

`data/hunt/wiki-graph-<zip>.json` records the graph AS WALKED — every node with
its Wikipedia URL and entity type, every edge with its outcome (`FOLLOWED`,
`ALREADY_VISITED`, `TITLE_REJECTED`, `NOT_GOVERNMENTAL`, `OUT_OF_SCOPE`,
`BUDGET_EXHAUSTED`, `FETCH_FAILED`), what each node yielded, and every branch
that terminated with why.

**Nodes that returned nothing are kept.** A route that failed is as reusable as
one that worked, and keeping it is what stops the next state paying for the same
discovery twice — RULING 63 applied to a traversal rather than to a branch.

---

## 10. NJ ELEC — the wall was on a different host (NJ Hunt 5, 2026-08-22)

`lib/hunt/nj-elec.ts` · `pnpm nj:elec`

`NH71` recorded `filing-campaign-finance-local` as *the single highest-value
unwalked route in this state*, with the reason: **`elec.nj.gov` answers 212 bytes
to a plain client, which is a JavaScript application shell — rung 6 is owed.**

Both halves of that were wrong, and RULING 52 predicts both:

1. **It is not an app shell. It is an Imperva/Incapsula bot-management
   challenge** — `<META NAME="robots" CONTENT="noindex,nofollow">` plus an
   `/_Incapsula_Resource` script, served identically for every path on the host.
2. **The records are not on that host.** `elec.nj.gov` is the agency's brochure
   site. The filings live on **`njelecefilesearch.com`**, which answers **rung
   2** at HTTP 200 with 166 KB of server-rendered HTML and no challenge at all.

It was reached by walking **rung 5** against the walled host — the reader-service
rendering listed the search links — and then simply asking the host they pointed
at. *A wall on one host had been recorded as a wall on the fact.*

### Rung 7 — the grid's own API, and the shape

`/api/VWEntity/Entities20`, **form-encoded** POST carrying the standard
DataTables server-side request (`draw`, `columns[i][data]`, `order`, `start`,
`length`, `search`) plus the filters. A JSON body is rejected with
`{"errors":{"Columns":["The Columns field is required."]}}`. The real filter is
`LocationCodes`, and the 1,215 location codes are READ from the page's own
`<option>` list rather than transcribed.

### RULING 68 caught a false hit here, and it is worth stating exactly

The first working request used `CountyCode` — which is the parameter that
POPULATES THE MUNICIPALITY DROPDOWN and is not a filter on the entity search at
all. The API accepted it and answered **HTTP 200, 47,737 bytes,
`recordsTotal: 326271`**, first row a union PAC from 1995.

Without a control that would have been recorded as *200 filed campaign-finance
entities for Rockaway Township*. The control — the same request with a location
code that cannot exist — returned **byte-identical** output. With the right
parameter: Rockaway Township **8**, Rockaway Borough **11**, both controls **0**.

---

## 11. THE HELD CREDENTIALS — walk them first (NJ Hunt 5, 2026-08-22)

`pnpm keys:walk` · RULING 90 item 5.

Seven data credentials in `.env.local`. **Three had never been called by anything
in this repo**, confirmed by sweeping the tree with `git grep -a --untracked`
rather than by trusting the register. One run:

| Key | Status | Returned | Owed fields closed |
|---|---|---|---:|
| `CONGRESS_API_KEY` | WIRED | 18 sitting members, NJ + NH, each with the chamber's own portrait and an official page | **36** |
| Open States / Plural | committed BULK file, no quota | 61 legislators for these two zips, out of 7,976 rows | **61** |
| `FEC_API_KEY` | WIRED | 77 federal candidates; committee records carry treasurer, street, zip and agent phone | **22** |
| `DATA_GOV_API_KEY` | never called | 42 govinfo collections; `CDIR` carries member offices and phones | 0 |
| `CENSUS_API_KEY` | never called | **INVALID — the host refuses it** with `X-DataWebAPI-KeyError: 1`; a keyless call is refused too | 0 |
| `LDA_API_KEY` | never called | the API answers, and closes **nothing** at either zip — it is federal lobbying only, with no county or municipal layer | 0 |
| `LEGISCAN_API_KEY` | Per-state standing contracts, weekly | attributed bill roll calls and exact OpenStates person positions | 1 source-fixture position verified |

**119 owed fields closed from credentials alone**, all of it available while the
previous session was measuring how fast a free search engine would rate-limit it.

### Two traps, both of which produced a false zero first

- **The FEC candidate LIST endpoint carries no address.** `/v1/candidates/`
  returns 24 fields and every one is identity or status. `/v1/committees/`
  carries `treasurer_name`, `street_1`, `city`, `zip` and
  `designated_agent_phone_number`.
- **Do not follow redirects blindly.** The Census API answers a bad key with
  `302` + `X-DataWebAPI-KeyError: 1` + `Location: .../invalid_key.html`. Follow
  it and you get HTTP 200 and a page of HTML, which parses as **zero rows** — and
  a zero-row extraction reported as an empty result is the failure the
  constitution names five separate times. The key was not missing data. The key
  was rejected.


## Index by question (RULING 63)

At 175 KB and growing, this file is one a session will skim. Find the entry by
asking for it.

| The question | Where |
|---|---|
| How do I get bytes past a wall? | The canonical 14-rung ladder is in `CLAUDE.md`, and its numbering is the only one that reaches the database. |
| Which rung do I try after a plain fetch fails? | Not in order. §NH6 entries 2 and 4: rung 5 and rung 6 fail on DIFFERENT things and are not ranked. A Cloudflare challenge falls to rung 5; a WAF that blocks browsers answers rung 2. |
| The page answered 200 but the facts are not in it. | §NH6 entry 10, and `pnpm rung6`. A 200 with an empty detail region is a FALSE MISS. Compare two URLs' byte counts — identical means a shell. |
| The whole host refuses me. | §NH6 entry 3 — try its machine-facing paths (`.ics`, `.rss`, `.json`, sitemap) before recording the host as walled. Walls are PATH-SCOPED. |
| A state publisher is walled and I need its document. | §NH6 entry 1 — a municipality, library, police department or school district very likely republishes it. |
| How do I find where a body meets? | §2 and `pnpm venue:hunt`. The board's own page states it in prose more often than any feed does; an empty `LOCATION` is not a placeless meeting. |
| I have a venue and no coordinate. | §NH6 entry 5 and `pnpm geocode`. Two providers, reconciled. A wrong CITY LABEL on a right POINT is the trap. |
| How do I enumerate a town's boards when the menu undercounts? | §2 (the lettered where-to-look ladder), the town's own `/boards-committees` index, its annual report, and its calendar feed's own event titles — Sutton's feed named sixteen bodies its registry entry knew nothing about. |
| How do I reach a candidate's phone, email, photo, words, or site? | **`docs/branch-manifest.md`**, indexed by exactly those questions. |
| A script found a campaign domain. Can I ship it? | §NH6 entry 6. No. Four of the first four hits were other people. Open it. |
| The search index says this body has a website. | §NH6 entry 7 — check it is not a parked domain. Third sighting. |
| Is this social account really the candidate's? | §NH6 entry 9 — resolve the id to its OWNER. A search result's title can be a post's text. |
| An official's page 200s. Is it right? | §NH6 entry 11 — does it still NAME them? Three of five pointed at a previous term. |
| A guard disappeared / the suite went quiet. | §4, `pnpm guard:census` and `pnpm guard:history`. RULING 62. |
| What must I load before hunting a new zip? | The Inheritance section above. RULING 63. |
| Which of these routes will break in another state? | The Inheritance section's table above. |
| **NEW JERSEY / anywhere that is not New England** | |
| How do I reach a candidate's phone or email outside New England? | §NJ 1 and 2. In New Jersey the COUNTY CLERK publishes it: one born-digital PDF, whole county, school board included. `pnpm nj:filing`. This is the route New Hampshire does not have. |
| I found the state's candidate list and it has no contacts. | §NJ 2 — look for the SIBLING file. New Jersey publishes `...-candidates-us-house-emails-<MMDDYY>.pdf` beside `...-candidates-us-house.pdf`. Reading only the first records an absence the second disproves. |
| The clerk's PDF URL has a version segment in it. | §NJ 2 — never hardcode it. Every revision gets a new path and the old one stays reachable, so fetch the clerk's PAGE and read its own hrefs. |
| A host answered once and refused the next time. | §NJ 3 and §NJ 10. `www.nj.gov` did both inside a minute; `suttonnh.gov` refuses BURSTS and serves a paced client 18 pages in a row. Pacing is itself a rung, and rung 4 (`curl`) clears Imperva where Node is refused. |
| My enumeration tool gave an answer for the wrong state. | §NJ 4.1 — `zip:universe` was hardcoded to New Hampshire's TIGER layers. Anything loading a `-33` layer by name is suspect outside NH. |
| A Census unit name will not match its TIGER polygon. | §NJ 4.2 and 4.3 — the Census abbreviates (`TWP`, `BORO`) where TIGER spells out. EXPAND the type, never strip it: stripping collapses a Borough onto a Township of the same name. |
| A guessed handle, slug or domain returned HTTP 200. | §NJ 5 — ask the host for a name that CANNOT exist and compare. An SPA shell, a login wall and a no-results page all answer 200, and a search page echoes your query so a substring test passes on nothing. |
| I have a 200 at a guessed identifier. Can I ship it? | §NJ 6 — no. That is a `LEAD`, not a `HIT`: it proves a page exists and never whose it is. A human opens it. |
| Can I reach a campaign's Facebook page? | §NJ 7 and RULING 66 in `docs/branch-manifest.md`. Not directly — it is walled and the wall is NAMED, not defeated. Four compliant routes exist; `ad-library` needs a credential this project does not hold (tracker `NS01`) and reports REFUSED, never EMPTY. |
| A board page states no venue. Can I use the town's address? | §NJ 8 — yes, RULING 65, from the `<footer>` ELEMENT and cited as the footer, never as the board's own words. But NOT where the body says something better about itself (a Zoom title, its own named venue). |
| Rung 10 returned a sitemap with nothing in it. | §NJ 9 — a CivicPlus D9 site can serve the VENDOR's template sitemap instead of its own. |
| My byte count says 0 after a successful parse. | §NJ 11 — `pdfjs` detaches the buffer you hand it. Read the length BEFORE extraction. |
| A 404 page contains the name I searched for. | §NJ 12 — it echoed your query. Check the status first. |
| An address parsed as a bare number plus a city. | §NJ 13 — a `P.O. Box N` truncated by a leading-digit anchor. |
| Does this zip cover only one town? | §NJ 14 — 07866 covers Rockaway Township AND Rockaway Borough, both at 0 km. Check the clerk's filing for a second municipality of the same name. |

---

# NJ HUNT 2 — 07866, second pass (2026-08-22)

**Inherited before hunting anything, per RULING 63:** `docs/branch-manifest.md`
at v2, 41 routes, and this playbook's question index. **36 branches inherited,
0 newly built, 0 duplicates** — the whole session ran on routes that already
existed, and what it added was not new routes but the discovery that the
instrument measuring them was wrong.

That is the finding, and it is worth stating before the entries: *this session
built no new way of reaching a fact, and moved the coverage number at 07866
from 5 of 178 to 90 of 142.* The work was not hunting. It was fixing five
instruments that agreed with themselves about the wrong answer.

## NJ2 1. A ZIP IS AN AREA, AND ASKING IT AS A POINT LOSES WHOLE GOVERNMENTS

**The defect, in one sentence: 07866's ZCTA centroid falls inside Rockaway
Township, so a Rockaway BOROUGH resident entering their own zip saw the
Township's government, none of their own, and a four-candidate council race
that did not render at all.**

`CLAUDE.md` already contained the premise — *a ZCTA crosses city, county, school
district and legislative boundaries, so a zip can never resolve a ballot* — and
the ballot page resolved one centroid and rendered the answer as the reader's
ballot, which treats a ZCTA as though it could.

**The rung:** the zip's whole AREA, not its centroid.
`data/derived/zip-governments.json` already held it — every ZCTA sampled on a
0.01° lattice against the committed TIGER polygons — and had held it since
Prompt B. Nothing needed fetching. `corepack pnpm zip:divisions` indexes it per
zip as OCD ids (`data/derived/zip-division-ids.json`, 108 KB, 279 zips in the
covered states), and `lib/ballot/zip-divisions.ts` unions it with the centroid
answer so nothing a reader saw yesterday can disappear.

**What it does NOT claim, and this matters:** not that a reader at this zip
votes in all of them. They do not. It is why `CLAUDE.md` says to prompt for a
street address when a reader wants their actual ballot, and why anything
surfaced this way renders with the jurisdiction printed beside it.

**Check any new zip for this before anything else.** Two municipalities sharing
a name and a zip is not a New Jersey curiosity — Rockaway Township and Rockaway
Borough are the case here, and the clerk's own filing lists both. A zip that
resolves to one town is a hypothesis until the filing agrees.

## NJ2 2. THE MOST DANGEROUS SHAPE: AN ANSWER THAT RECONCILES WITH ITSELF

RULING 67. **Five instances found, five fixed**, and the reason to read this
section is that every one of them PASSED its own consistency check.

| Instrument | What it did | Why nothing caught it |
|---|---|---|
| `twig-pair.mts` | Counted 37 units as inside a 25 km circle around Rockaway, Camden and Ocean County among them | `meetingsNearZip` is `true \| false \| "UNRESOLVED"` and was TYPED `boolean`. `"UNRESOLVED"` is a non-empty string. `filter((u) => u.meetingsNearZip)` passed type-checking and passed everything downstream |
| `zip-universe.mts` | Every unit that does not contain the zip centroid read as "no division of its own" | `ocdId` was read off the containment result, so a unit could only acquire an IDENTITY by having JURISDICTION. Rockaway Borough, 0 km away, with a body already in this registry, read as a gap |
| `zip-universe.mts` | No county ever resolved a distance | The distance lookup used `normalize` where the containment test used `normalizeCounty`. `COUNTY OF MERCER` → `MERCER COUNTY` vs TIGER's `MERCER`. The null became `UNRESOLVED`, which fed the row above |
| `measure-focus.mts` | Treated New Jersey's own layers as foreign at a New Jersey zip | `const mine = zip === "85701" ? "04" : "33"` — every zip that is not Tucson was New Hampshire |
| `build-gap-ledger.mts`, `verify-pilot-zips.mts` | Wrote a hand-typed state name into a generated ledger beside a count | Nothing compared the label with the zip |

**The pair at 07866 read `5 held + 173 missing = 178  (reconciles)`.** It is
`90 + 52 = 142`. The 2.8% coverage figure the previous session reported was an
artefact of two of these, not a measurement.

**The rung, and it generalises to every instrument in this repo:** an
enumeration STATES the geography it resolved to, and is checked against the
zip's own geography established from files it does not read.
`lib/geo/zip-geography.ts` does it with two DISTINCT PUBLISHERS — TIGER's state
outlines (geometry) and the Department of Education's NCES LEA directory
(mailing addresses). RULING 52 counts independence over dependencies, not over
names, and two Census files off one source table would be one witness.

**A witness with nothing to say is UNAVAILABLE** — never agreement, never
disagreement. 03255 has no LEA at its zip; reading that silence either way
would be inventing a measurement.

**And a zip can genuinely straddle a state line.** ZIP 86044 (Tonalea, AZ) sits
on the Navajo Nation and NCES records districts in both AZ and UT there. The
first version called that a contradiction and refused to enumerate. A witness
naming several states, one of which is the geometry's answer, CORROBORATES it.

## NJ2 3. A NAME MATCH ACROSS A STATE COLLAPSES GOVERNMENTS

**New Jersey has FIVE Washington Townships.** Bergen, Burlington, Gloucester,
Mercer, Morris and Warren. Four Washington Township school districts. Two
Mansfields. Two Fairfields.

Matching a Census-of-Governments unit to a TIGER polygon BY NAME handed all
five the same OCD id, and the run reported a higher resolution rate for it —
which is the trap. *A match rate is not evidence of a correct join; only
per-key uniqueness is.*

**The rungs:**

- **A municipality is keyed by (name, COUNTY).** TIGER's county-subdivision
  GEOID is `SSCCCNNNNN` and its first five digits are the county. Exact, and it
  needs no name cleverness.
- **A school district has no county in its GEOID**, so contested names are
  settled by the unit's own administrative point falling inside the polygon —
  and contested is decided ACROSS THE WHOLE ENUMERATION rather than per unit.
  One claimant takes it; several are separated by their admin points; where
  that leaves more than one, NOBODY takes it and the contest is printed.
- **Containment BREAKS TIES; it never gates a match.** Requiring it outright
  refused Rockaway Borough School District, whose office is at a 07866 address
  whose ZCTA centroid is in the Township. True of any district whose office is
  near its own edge.
- **Then ASSERT distinctness and throw.** `zip:universe` now stops the run on
  any OCD id assigned to two units.

## NJ2 4. THE CENSUS AND TIGER DISAGREE ABOUT THE MUNICIPAL TYPE WORD, IN BOTH DIRECTIONS

    Census  "ROCKAWAY TWP SCH DIST"           → "ROCKAWAY TOWNSHIP"
    TIGER   "Rockaway Township School District" → "ROCKAWAY TOWNSHIP"   ✓
    Census  "DOVER PUBLIC SCH DIST"           → "DOVER"
    TIGER   "Dover Town School District"      → "DOVER TOWN"            ✗

Fourteen Morris-area districts this registry already held read as gaps because
of one word. **But the word cannot be stripped** — that is what collapsed
Rockaway Borough onto Rockaway Township once already.

**The rung: try the exact type-preserving match FIRST, and relax ONLY when the
relaxed name answers to exactly one polygon.** Rockaway relaxes to two
candidates and is refused; Dover relaxes to one and is taken. The relaxation
count is printed.

## NJ2 5. THE CENSUS WRITES A FICTITIOUS ROW INTO THE LAYER A GOVERNMENT IS NOT IN

Rockaway Borough is `FUNCSTAT A` in `place-34` and `FUNCSTAT F` in `cousub-34`.
`F` is Census filling its geographic hierarchy. `lib/registry/derive.ts` already
knew this and built the registry's body from the PLACE row — so a tool reading
cousub only produces `county:morris/place:rockaway_borough`, which is a key
matching nothing, and reports a held unit as a gap for a second reason after
the first is fixed.

**The rung: redirect an `F` county-subdivision to its active place row BY
GEOID** — for a coextensive place the last five digits of the cousub GEOID are
the place code. Checked across the whole committed layer before it was relied
on: all 29 fictitious New Jersey subdivisions map to exactly one active place
each, none unmatched.

## NJ2 6. A GEOID IS NOT A KEY ON ITS OWN

Morris County is `34027`. New Jersey's **state upper legislative district 27**
is also `34027`. Keyed on GEOID alone, whichever file loaded second won, and
07866's division index came out carrying `sldu:27` and no Morris County at all.

**The rung: key on (LAYER, GEOID), and assert no key resolves to two ids.**

## NJ2 7. A FILING PDF'S NON-CANDIDATE ROWS ARE DATA, AND THEY BLEED

Four defects in the Morris County Clerk's two documents, all found in one
re-read, three of which put wrong words into rows about NAMED REAL PEOPLE.

| What the clerk writes | What it did |
|---|---|
| `No Nomination Made <Party>` — a seat a party filed nobody for | Sat between one contest's last candidate and the NEXT contest's municipality, so 20 candidates were filed under places like `Made Democratic Butler Borough` |
| `NO PETITION FILED` — the school list's version, non-partisan so no party follows | Same, plus it stranded the school list's DISTRICT column (`Town`, `Township`, `Watchung Hills Regional`) as the trailing Title-Case run |
| The page-one column header | `City State Zip Email` became the municipality for the four US Senate candidates |
| `NO LOCAL ELECTION Roxbury Township` | The all-caps heading pattern ate the `R`, leaving `oxbury Township`, whose Title-Case tail is `Township` — so the clerk's statement about Roxbury published as a statement about a municipality called `Township` |

**The rungs:**

- **An all-caps heading run must not be followed by a lower-case letter.**
  `[A-Z.'\-/]+(?![a-z])` ends it exactly where the capitals do.
- **Strip the header by anchoring on a phrase both documents print, and STOP at
  the header's last column** — a greedy strip took the header and the first
  municipality with it.
- **Remove the unfilled-seat phrase GLOBALLY, not end-anchored.** It sits BEFORE
  the next jurisdiction, so an end-anchored strip matches nothing.
- **The hyphen and the slash are part of a place name.**
  `Parsippany-Troy Hills Township` matched from `Troy` onward and published as a
  township called `Troy Hills`, which does not exist. `Chester
  Borough/Township` is ONE filing jurisdiction for a district two
  municipalities run together.
- **Read the DISTRICT column rather than skipping it.** `Rockaway Township
  MEMBER OF THE REGIONAL BOARD OF EDUCATION` is a MORRIS HILLS REGIONAL seat;
  resolving it from the municipality gave it the Township's own district, so
  two different boards' contests came out sharing one division.

**And the rows themselves are a FINDING.** 42 seats across the two documents
where the filing authority states that a party filed nobody. That is
publishable information about whether a race is contested, and the parser was
throwing it away.

## NJ2 8. A GENERATED BALLOT MUST CARRY THE OLD IDS

Regenerating `data/states/nj/ballot/nj-morris-2026.json` from the clerk's current filing
took it from 6 contests and 15 candidacies to 91 and 272, every one with a filed
email. **Minting fresh ids broke nine guards, and what they were guarding is the
real hazard: the REACTIONS store keys on candidacy ids.**

Re-minting a person's id does not lose a formatting detail. It orphans a
reader's answer about a named person, and the orphan is invisible — the new
record simply has no reactions rather than obviously wrong ones. That is the
revenue path quietly losing rows.

**The rung: match the previous file on properties of the WORLD, not on the old
naming convention.** A contest matches on DIVISION plus office; a candidacy on
its contest plus the filed name. 21 of 21 prior ids carried. A carried contest
also keeps its TITLE, because the old titles were written by a person and say
things the office string cannot.

**And an authority's document goes stale on ITS schedule, not ours.** The
clerk republished between the two sessions: 272 candidates became 328. A hand
transcription's only symptom of staleness is a contest that does not render.

## NJ2 9. A FILTER THAT MATCHES NOTHING IS NOT AN EMPTY PLACE

`pnpm venue:hunt --town Sutton` printed **`0 body(ies) not LIVE under Sutton`**
and exited. Sutton has nineteen. The filter was a case-SENSITIVE substring
against `place:sutton_town`.

It was caught only because the tool exits non-zero on a zero-page read. The
SENTENCE was false and read as a fact about Sutton.

**The rung: an argument that matches nothing STOPS the run and names the
argument.** "Your filter matched nothing" and "this place has nothing owed" are
different answers and may never print as the same one.

## NJ2 10. WHAT THE FEC's DIRECTORIES ANSWER, AND WHAT THEY DO NOT

RULING 69. `corepack pnpm fec:directories` →
`data/reference/fec_state_election_offices.csv` (58 rows) and
`data/reference/fec_combined_federal_state_disclosure_directory.csv` (**349
offices across 56 jurisdictions**, 316 with a URL, 328 with a phone, 243 with an
email). Public domain, federal works.

**They answer half the question the NJ Hunt raised, and it is the expensive
half.** They name WHO the authority is in every state and territory and how to
reach a human there. They do NOT say what that authority publishes — so they
cannot tell you whether the next state's county clerks put a filed email in a
PDF the way Morris County's does. That still takes a walk. What they remove is
finding out who to walk to.

**They paid for themselves immediately.** `elec.nj.gov` was recorded here as
Imperva-walled and re-walked still walled. That had been read as *ELEC is
unreachable*. It is not — it is ELEC'S WEBSITE that is unreachable, and the
directory hands over a named Executive Director, a telephone number and a
postal address for the same records: a compliant route straight to rung 13 that
no WAF can refuse.

**A HOST being walled is not a BODY being unreachable**, and this repo had
collapsed the two again without noticing.

## NJ2 11. THE PDF IS THE CONTAINER, NOT THE DOCUMENT

RULING 69 says fetch the directory PDF into `data/reference/`. RULING 20 says
PDF binaries do not go in git. Both hold if what is committed is the CONTENT —
349 parsed rows as a CSV — with the PDF's URL, byte count and SHA-256 in the
provenance note. The conflict is on a Needs Sean row rather than settled by a
session.

*Worth generalising:* a reference document that ships as a PDF is still
reference data. Parsing it is usually better than committing it — a CSV diffs,
a PDF does not, and the parse is what a session actually reads.

## NJ2 12. THE CONTROL QUERY BELONGS IN THE LIBRARY, NOT IN THE TOOL THAT FOUND IT

RULING 68. `lib/hunt/control-query.ts`. 22 of 41 manifest routes now carry
`controlQueryRequired`, and 6 carry `guessesIdentifier` — which caps them at
`LEAD` forever, because a page at a guessed handle is a page and never proof of
whose it is.

**A third shape a byte comparison alone misses:** a no-results page that prints
`no results for Bradstreet` CONTAINS the surname, so a substring test passes on
a page saying the opposite. `isQueryEcho` REMOVES the echo and asks whether the
term survives, rather than judging each occurrence by what sits near it — on a
real results page the heading sits a couple of dozen characters from the first
genuine headline, so any proximity window wide enough to catch the echo also
catches the article.

## NJ2 — THE QUESTION INDEX

| The question | Where |
|---|---|
| A reader's own town is missing from their zip. | §NJ2 1. Ask the zip as an AREA. `pnpm zip:divisions`. |
| My coverage pair reconciles. Is it right? | §NJ2 2 — reconciling proves arithmetic, not geography. Check the state externally. |
| An enumeration returned a confident answer for the wrong place. | §NJ2 2. `lib/geo/zip-geography.ts`, two distinct publishers. |
| A tri-state field is being used in an `if`. | §NJ2 2 — `"UNRESOLVED"` is truthy. Check the TYPE against the data, not against the declaration. |
| Two governments got the same OCD id. | §NJ2 3 — key by (name, county); assert distinctness and throw. |
| A district name will not match its polygon. | §NJ2 4 — expand the type word, relax only when the relaxed name is unique. |
| The registry's id for a town does not match TIGER's. | §NJ2 5 — `FUNCSTAT F` is Census filler. Redirect to the active PLACE row by GEOID. |
| A GEOID matched the wrong thing. | §NJ2 6 — a county and a legislative district can share one. Key on (layer, geoid). |
| A filing PDF put strange words in a candidate's jurisdiction. | §NJ2 7 — `No Nomination Made`, `NO PETITION FILED`, and the column header all bleed forward. |
| How do I know whether a race is contested? | §NJ2 7 — the clerk states unfilled seats explicitly. 42 in Morris County. Record them. |
| I want to regenerate a ballot file. | §NJ2 8 — carry the old ids or you orphan readers' reactions, invisibly. |
| A tool reported zero for a place I know has bodies. | §NJ2 9 — check the ARGUMENT before believing the answer. |
| Which office receives filings in state X? | §NJ2 10 — `data/reference/fec_*.csv`. It names the office, never what it publishes. |
| A host is walled. Is the body unreachable? | §NJ2 10 — no. Get the phone number and go to rung 13. |
| A reference document is a PDF. | §NJ2 11 — parse it; commit the rows and the hash. |
| A guessed identifier returned 200. | §NJ2 12 and §NJ 5–6. `LEAD`, never `HIT`. |
| A search page contains the name I searched for. | §NJ2 12 — remove the echo and ask whether the name survives. |


---

# NJ HUNT 3 — 07866, 2026-08-22

Twelve entries. Append-only: nothing above this line was edited, and where an
entry corrects an earlier one it says which and leaves the earlier one standing
with a dated note beside it.

## NJ3 1. THE COUNT THAT IS RIGHT AND THE ARRAY THAT IS WRONG

A snapshot stated `461 total meetings` and held 455, and the refusal was
correct. The defect was one line: `total` was read off `served`, the array
from BEFORE the second duplicate-collapse pass, while `meetings` was written
from `finalRows`, the array after it.

**They are equal on every run where that pass drops nothing, which is almost
every run.** It read correct for months and refused the first time
carry-forward put a duplicate back and the pass earned its keep.

**The rung:** when a surface states a count of an array, the count and the array
must come from the SAME expression. `snapshotCounts(rows, collapsed)` takes one
array and derives every count from it, so there is no second array in scope to
point at. That is stronger than checking the two agree — it removes the degree
of freedom that let a correct check be handed wrong inputs.

## NJ3 2. A CARRY KEY MUST BE THE MINT KEY, EXACTLY

The Morris ballot mints a contest id from **jurisdiction + office + division**
and carried ids on **division + office**. A `Map` keeps the last write, so three
contests that minted three distinct ids all read back one.

That is not hypothetical anywhere with REGIONAL school districts. New Jersey
allocates a regional board's seats per constituent municipality: Chester,
Mendham and Washington Township each elect members to the West Morris Regional
board, one division, one office title, three genuinely different contests. A
rebuild collapsed 90 contests to 87, orphaned four candidacy ids, and would have
shown every Chester and Mendham reader Washington Township's candidates for a
seat they do not vote on.

**The rung:** bucket prior records by the ambiguous key and disambiguate on the
dimension the id itself encodes; where several match and none disambiguates,
carry NOTHING and mint. A wrong carried id attaches a reader's reaction to the
wrong person's race. A fresh id is merely a gap.

**Expected to travel:** everywhere with regional or joint districts — New
England SAUs, Midwestern joint school districts, any consolidated fire or water
district electing per member town.

## NJ3 3. CERTAINTY WAS ALREADY MEASURED AND NOBODY WAS READING IT

`data/derived/zip-governments.json` samples every ZCTA on a 0.01° lattice and
records, per government, how many of that zip's points fell inside it. That
number answers "does this government cover the WHOLE zip or part of it", which
is exactly the question RULING 71 turns on, and it had been sitting in a
committed file since the file was built.

**The zip's total is the sum of its COUNTY-layer samples.** Counties and county
equivalents tile the United States with no gaps and no overlaps, so every
sampled point falls in exactly one. Checked across all 33,791 zips in the
national file before being relied on: every zip has at least one county edge and
no edge anywhere exceeds its zip's county sum.

At 07866: Morris County 64 of 64 and Morris Hills Regional 64 of 64 — certain;
Rockaway Township 55, Rockaway Borough 6, Denville 3 and their three local
school districts — partial. **184 of the 279 zips this repo has committed
geometry for cross at least one governing boundary.**

**Expected to travel:** everywhere, because the lattice is national. The
committed index is scoped to covered states; the source file is not.

## NJ3 4. A STATEWIDE OFFICE HAS NOTHING TO MEASURE, AND UNKNOWN IS NOT A DEFAULT

The first deploy of the RULING 71 pill put *Could govern you* on **Member of the
United States Senate** at 07866, because a statewide division is absent from a
lattice index — there is no sub-state extent to be partial about — and it fell
through to UNKNOWN, and UNKNOWN rendered the pill.

**The rung:** classify by SHAPE where there is nothing to measure. A division
matching `country:us` or `country:us/state:XX` exactly is certain.

**And the deliberate exception:** a congressional or legislative district looks
federal and is NOT statewide. A zip crosses a congressional line as readily as a
municipal one, those layers are absent from the lattice edge list, and the
district reached the page by being resolved from the ZCTA CENTROID. Rendering it
unmarked would assert it is the reader's House race on the strength of one
point. The pill is true there.

## NJ3 5. HOW THAT WAS CAUGHT, WHICH IS THE TRANSFERABLE PART

A capture script that prints the DOM facts it was taken against BEFORE the image
is opened. The pilled and certain contest titles were in that list, by name, and
the wrong one was visible without looking at a single pixel.

A screenshot of that page would not have shown it either: the defect is a pill
that is PRESENT and PLAUSIBLE, not one that is missing. A DOM assertion alone
would not have shown it, because the DOM was exactly what the code intended.
**Print the classification, not just the count.**

## NJ3 6. AND THE OTHER HALF — THE IMAGE CAUGHT WHAT THE DOM COULD NOT

The same run's DOM reported the pill's full sentence. The 430×932 IMAGE showed
only "Could govern you", because a `max-width: 460px` rule hid the action half
to keep the pill on one line.

That is not a cosmetic trim. Stripping the invitation leaves a bare uncertainty
marker beside a body's name, which reads as the per-card completeness statement
RULING 44 deleted rather than the offer RULING 71 specifies.

**The rung:** where a sentence's MEANING depends on all of it, no media query
may drop part of it. It wraps. Guarded, so a future rule cannot hide it by
`display`, `visibility` or `font-size`.

## NJ3 7. FIX ONE INSTANCE, SWEEP THE CLASS — AND THE MAP WAS THE SECOND ONE

`NJ01` fixed the ballot page's centroid resolution. The map's card — headed
literally **"Who governs here"** — was the same defect and stayed live: at 07866
it read *"4 bodies govern the area around 07866"* over a list holding Rockaway
Township and not Rockaway Borough.

**The rung:** when a resolver is fixed, grep for every caller of the OLD
resolver rather than for the symptom. Both surfaces now call
`divisionIdsForZipArea`, and a guard asserts both do, so a third surface cannot
be added on the point-only behaviour quietly.

## NJ3 8. A RESOLVER WIDENING NEEDS A CAN-ONLY-ADD CLAUSE

Widening the map's divisions is where a full surface goes quietly empty. Three
conditions, and each is load-bearing: only on a TYPED zip (a panned viewport
names no place); only when the point lookup SUCCEEDED (a failed resolution
handed on as an empty set becomes "nothing governs here"); and the widened set
must be a SUPERSET or it is not used.

## NJ3 9. A RUNTIME DATA FILE IS TRACED PER ROUTE, AND A DEDUP SCRIPT ATE ONE

Adding `zip-division-ids.json` to `/api/meetings` as a second key in
`outputFileTracingIncludes` is a duplicate-property error. Fixing it with a
regex one-liner deleted the `/ballot` entry, which sat inside the matched span.
Two files stopped being traced for the ballot page, and `tsc` and `pnpm build`
were both happy: a missing trace entry is not a build error, it is a deploy
quietly short of two files.

**The rung:** after any scripted edit to a config, `git diff <last-good> -- <file>`
and read it. The diff should be exactly the intended change and nothing else.
And run the SUITE, not just `tsc` and `build` — `tests/coverage-manifest.test.ts`
is what knows the difference.

## NJ3 10. THE CLERK'S DOCUMENT GIVES CONTACT AND GIVES NOTHING ELSE — MEASURED

New Jersey handed over 328 filed emails from one county-clerk PDF, mechanically,
where New Hampshire needed a person for nearly every contact. The obvious next
question is whether PHOTO, BLURB and CAMPAIGN SITE behave the same way here.

**They do not, and this is measured rather than assumed.** Across all 272
candidacies on the Morris ballot:

| field | held | route |
| --- | --- | --- |
| contact (email) | **272 of 272** | `filing-county`, one document |
| ballot slogan | **70 of 272** | `filing-county`, same document |
| campaign site | **0 of 272** | no route has produced one |
| photo | **0 of 272** | the document carries none |

The clerk's filing carries name, party, email, address and sometimes a ballot
slogan. It carries no portrait, no prose about the candidate, and no URL. **The
contact windfall was a property of that DOCUMENT, not of New Jersey**, and a
session that generalised it would report a hunt it never ran.

## NJ3 11. A GUESSED DOMAIN THAT ANSWERS IS STILL A LEAD

Walking `domain-search` for the four Rockaway Borough Council candidates:
`patrickmcdonald.com` answers 200 and carries the surname. It is recorded as a
**LEAD**, not a HIT, because the identifier was GUESSED — a squatter's parking
page carries a name, "Patrick McDonald" is a common name, and *is this the filed
candidate* is a judgement about a real person.

The control query ran first: five impossible domains through the same guesser,
zero answered 200, so no host-family signature had to be excluded. Running the
control is what makes the three EMPTYs mean anything.

## NJ3 12. THE 52 UNHELD UNITS AT 07866 ARE A DIVISION GAP, NOT A HUNT GAP

`pnpm twig:pair --zip 07866` gives 90 of 142 held, and **52 of 52 unheld rows
read "no division of its own"**. Not one is a body somebody looked for and could
not find. Two classes:

- **18 SPECIAL_DISTRICTs** — fire districts, sewerage authorities, a power
  authority. No TIGER polygon exists for these at any vintage, so no geometry
  pipeline will ever reach them and they need an identity mechanism that is not
  a polygon. RULING 57 still applies: they can be NAMED without geometry.
- **34 GENERAL_PURPOSE and SCHOOL_DISTRICT units** — real TIGER polygons exist,
  and they sit in Sussex, Passaic, Essex, Bergen and Warren counties. This
  repo's committed `place-34` holds 67 features and `cousub-34` 66, all Morris.
  The gap is the CLIP-COUNTY scope, one county per covered state.

**And the denominator matters more than the fraction.** 142 is the count inside
the first-rung 25 km circle, not inside the zip. The nearest unheld unit is 6.44
km away and the furthest 24.7 km; every government whose territory actually
reaches inside 07866 IS held. Reporting "90 of 142" without that sentence
describes a coverage-WIDTH decision as though it were a hunt failure.

---

## THE NEW JERSEY CANDIDATE HUNT — NJ Hunt 4, 2026-08-22

**Read this section first if you are opening a new state.** It is the one that
generalises. Everything below was learned in Morris County, New Jersey against a
272-candidate, 90-contest county ballot where the filing document carried a name,
a party, an email, a street address and nothing else — no portrait, no prose, no
URL for anybody.

### Q: The clerk's filing gave me names and nothing else. Where do the other fields live?

**Not in one place, and the highest-yield route is not the obvious one.**
Measured, Morris County, 2026-08-22:

| Route | What it reached |
| --- | --- |
| `filing-county` (the clerk's PDF) | 272 of 272 contacts. Spent — it carries nothing else. |
| `search-index` (made mechanical) | 148 of 272 candidates returned at least one classified URL |
| `body-roster-page` via the municipal branch below | 18 candidates, with the government's own page naming them |
| `candidate-platform` (GoodParty) | 76 of 272 — the single biggest host, and worth the least |
| `campaign-site`, verified by reading | 5 confirmed campaign sites in the whole county |

**Five campaign sites in 272 candidacies is the finding, not the failure.** These
are borough councils and school boards; most of these people do not have a
website, and the product's job is to say so honestly rather than to keep looking
for one that does not exist. What they DO have is a government page, a filed
email, and often a Facebook page.

### Q: How do I get every municipality's official website without guessing 39 hostnames?

**Ask the county, and find its index by following its own links.**

The guesses failed and are recorded because guessing is the tempting move:
`morriscountynj.gov/Residents/Municipalities`, `/Government/Municipalities` and
`/municipalities` all answered **404** on 2026-08-22.

The index exists and the county home page links it. Fetch the county home page
at rung 2, read its `href`s, and take the one whose path is about towns —
`/Residents/Community-Information/Cities-and-Towns`. It carries the official
website of every municipality in the county. **One document, 39 municipalities.**

`pnpm nj:rosters --index` does exactly this and writes
`data/states/nj/hunt/nj-morris-municipal-sites.json`.

**This travels.** Every county in the United States that has a website has a page
listing its municipalities; almost none of them is at a path you can guess.

### Q: The county index matched the wrong town. Why?

**Because New Jersey puts a borough and a township of the same name in the same
county, and thirty of its 564 municipalities collide that way.**

Chester borough and Chester township. Mendham borough and Mendham township.
Boonton town and Boonton township. Rockaway borough and Rockaway township. A
first version matched each host to the longest municipality name it contained and
produced four wrong rows — Boonton town's site assigned to Boonton TOWNSHIP,
Chester borough's to Chester TOWNSHIP — while the four it took the sites from read
as having no website at all.

**Both sides must declare a TYPE and the types must agree.** The municipality's
type comes from its OCD slug (`_township` / `_borough` / `_town`); the host's
comes from the host string. An untyped host may serve any municipality, but only
after every typed host is assigned.

**And a hostname has no words in it.** The second version used `\btown\b`, which
matches nothing inside `townofmorristown.org` — so Morristown's own site and
Morris Township's `morristwp.com` both came out untyped and were assigned to each
other's government. Two wrong rows, and the give-away was that both were wrong in
the same swap. **Substring, longest type first, no word boundaries.**

30 of 33 municipalities matched after the fix. The three that did not —
Madison (`rosenet.org`), Pequannock and Washington Township — have hostnames
carrying no form of their name, which no index-side rule can fix; they need the
search index or the municipality's own letterhead.

### Q: The council page publishes emails and my fetch sees none.

**Read the page's own JavaScript. The address is there in two pieces.**

Butler Borough's council page carries no `mailto:` anywhere. What it carries is:

```js
a = 'rverdonik'; b = 'butlerborough.com'; document.write(" ");
```

— the anti-harvesting idiom every CivicPlus-era municipal site uses, which
assembles the address in the browser. A plain fetch sees the two halves and no
address, and records "no email published", which is a **false miss** about a
sitting councilman whose address the borough publishes on its own page.

This is **rung 8** — the structured data the prose hides — and it is not
circumvention: nothing is authenticated, nothing is decoded, no access control is
passed. The page published the address; it published it in two pieces.

`scripts/nj-hunt4-extract.mts` reconstructs it and marks the address as
`javascript-concatenated (rung 8)` so a reader can tell it from one lifted out of
an `href`. It reached **4 of the 9 official emails** this session found.

### Q: The roster page names twelve people and carries nine emails. Whose is which?

**Work inside the person's own block, and anchor on the FULL NAME.**

The smallest enclosing `<tr>` / `<li>` / `<div>` / `<td>` containing the name is
that person's row on every vendor this county uses, because a roster is a list of
people. Take the email, the phone and the portrait from inside it and nothing
from outside it.

**A surname is not a key.** Anchoring on the surname alone attributed a Lincoln
Park block reading *"Janet Cassidy, Superintendent of Recreation"* to WILLIAM
Cassidy, and a Kinnelon vote tally reading *"CHIRDO, Mabey, Lewis"* to Sean
Mabey. Both would have shipped another person's contact under a candidate's name.
The anchor is `Given Family` or `Family, Given`, and the block itself has to carry
both names. That cost six of twenty-four apparent matches, and all six were wrong.

### Q: How do I attach a portrait to the right face?

**The filename is the strongest attribution on the page, and it is free.**

Proximity is a weak instrument: half these vendors put the face in one `<div>`
and the name in the next, so a tighter block loses the portrait and a looser one
risks attaching a face to the wrong person — the worst single error this product
can make.

These municipalities name the file after the person:
`chathamtownship.org/wp-content/uploads/jen_rowland.jpg`,
`kinnelonboro.org/Images/thumb.Mabey 400.jpg`,
`mendhamnj.org/Images/thumb.Althoff1.png`,
`mountainlakes.gov/wp-content/uploads/2014/09/Muilenburg-Photo-scaled.jpg`.
A surname in the URL of an image on that person's own government's roster page is
the **publisher saying whose face it is**, and it does not depend on where the
markup puts the two.

**And it is not infallible, which is why a person still looks.** Kinnelon
publishes `thumb.Franks.jpg` on a page naming *Cynthia Frank*. FRANKS is not
FRANK. Any doubt about identity fails at every door, so that portrait was refused
and her photo stays owed.

`pnpm nj:portraits` downloads every proposed portrait and draws them into ONE
contact sheet, so six faces are judged in one look instead of six. RULING 2 makes
a capture evidence only once it has been read as an image; this is what makes the
reading affordable.

### Q: The search index stopped answering after two hundred queries.

**It is a rate wall, it is a fact about the hour, and the answer is more front
doors.**

DuckDuckGo's HTML endpoint answered this machine at 09:0x and was serving HTTP
202 with an empty result set by 09:1x — **six queries**. Bing and Yahoo both
walled after roughly 170. A single-engine hunt would have written 180 honest-
looking absences off one IP's rate ledger.

The engine tree, in the order worth trying, and independence counted over the
DEPENDENCY rather than over the name:

1. **SearXNG public instances** — `priv.au`, `opnxng.com`, `paulgo.io`,
   `search.mdosch.de`, `searxng.site`, `searx.perennialte.ch`. This is the
   ladder's **rung 5**: the instance queries the upstream engines from ITS
   server, so our requests are not on the walled rate ledger at all. Of
   twenty-six public instances probed on 2026-08-22, **three** were answering
   with results — a public instance is somebody's hobby server, so the pool is
   re-probed rather than trusted.
2. **Bing** — results are `b_algo` blocks whose href is a `ck/a` redirect
   carrying the target base64url-encoded in `u=a1…`. Decode it; the breadcrumb in
   the title is a usable fallback.
3. **Yahoo** — `d-ib` anchors, target in a `/RU=…/` path segment.
4. **DuckDuckGo HTML** — `result__a` anchors, target in `uddg=`.
5. **Mojeek** — its own crawler, so genuinely independent, and it returns few
   rows.

Three mechanical rules make the tree work:

- **A walled engine is RESTED, not hammered** — a doubling backoff from one
  minute, capped at fifteen. Asking a walled engine again immediately, 272 times,
  is what turned a temporary wall into an apparent 180-candidate absence.
- **When every engine is resting, WAIT.** "All four are resting for another forty
  seconds" and "nothing on the internet knows about this person" are completely
  different statements, and writing the first as the second is the false miss
  this whole project exists to refuse.
- **The control query must not rest an engine.** An engine that answers
  `"Zzyzx Qwertling"` with zero results is the control WORKING — and zero rows is
  also how a rate wall looks, so the engines that behaved correctly were being
  rested before the run asked a single real question. Clear the ledger after the
  control.

### Q: Bing gave me a shoe brand instead of the candidate.

**Two separate traps, and both look like an empty result.**

1. **ALL-CAPS defeats the quoted phrase.** County clerks file names in ledger
   caps. `"Melissa BURNSIDE" Rockaway New Jersey Borough Council` came back with
   ten results about a shoe brand and not one mention of the person;
   `"Melissa Burnside"` returned the Borough's own directory at rank 1. Title-case
   the name before asking — `surnameDisplayCase` in `lib/ballot/name-case.ts`
   already does it, and `searchableSurname` beside it strips the generational
   suffix a search must not carry.
2. **A thin query gets the quotes dropped silently.** Word ORDER matters:
   `"Melissa Burnside" Rockaway Borough Council New Jersey` worked and
   `"Melissa Burnside" Rockaway NJ` did not, same engine, same minute. Put the
   office before the state and keep the query long.

**The mechanical defence against both is the standing rule made checkable: a 200
whose content is not about the thing asked for is not a document.** If no row in
a result set mentions the surname, that engine has failed THIS query — record it
and ask the next engine. It is what caught both traps.

### Q: Which hosts are worth classifying, and which are never evidence?

Recorded from 272 candidates' worth of results:

| Host family | Route it is evidence for |
| --- | --- |
| `goodparty.org` | `candidate-platform` — a LEAD, never a photo or a blurb (its headshots come from `assets.civicengine.com`, BallotReady's CDN) |
| `newjerseyhills.com`, `tapinto.net`, `patch.com`, `dailyrecord.com`, `morrisfocus.com`, `parsippanyfocus.com`, `dovernow.com` | `local-newspaper` — the candidate's own words in an announcement piece; **never a photo** |
| `onyourballot.vote411.org` | `lwv-questionnaire` |
| a host carrying the surname | `campaign-site`, and still only a LEAD until the page is READ |
| `*.nj.us`, `*.gov` | `gov-staff-directory` |
| `civic-mirror.com`, `oppintell.com`, `change.org`, `votewiser.com`, `smarter.vote`, `ballotready.org` | aggregators — a LEAD at most |
| `voterrecords.com`, `whitepages`, `spokeo`, `radaris`, `truepeoplesearch`, `fastpeoplesearch`, `beenverified`, `zoominfo` | **never evidence of anything** |

### Q: What did NOT work, so I do not spend the afternoon on it again?

- **`nj.gov` directory paths are not guessable.** `nj.gov/education/data/dir/`,
  `nj.gov/education/directory/` and `nj.gov/dca/home/roster.shtml` all 404 to a
  plain client. They were guesses; they are LEADs that failed, not walls.
- **`elec.nj.gov` answers 212 bytes** — a JavaScript application shell. NJ ELEC
  is the highest-value unwalked route in this state (New Jersey imposes local
  campaign-finance filing on council and school-board candidates above a
  threshold) and it needs **rung 6**.
- **A campaign site can answer 200 without its own candidate's name.**
  `strobelforschoolboard.com` did. That is a JavaScript build and a false miss at
  rung 2, not an absence — rung 6 is owed to it and to every site like it.
- **Two municipal hosts were walled**, both Cloudflare managed challenge:
  `victorygardensnj.gov` and one other. Named, not defeated (RULING 12). The
  other 28 municipalities answered.

### Q: Is a law firm's page a campaign site?

**No, and the classifier will offer it to you.** `dawkinswarrington.com` carries
Clifford D. Dawkins' surname and is his law firm; `chippersonlaw.com` is Rita C.
Chipperson's. A surname in a hostname is a guess about a person (RULING 68) and
these verify as LEAD rather than HIT precisely because the page names the person
and says nothing about the race. They are `bar-directory` evidence — a real route,
a working contact, a different field — and county-attorney and judicial races are
full of them.
