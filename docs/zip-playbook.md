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

## 2. The source ladder per jurisdiction type

The general ladder — thirteen rungs and "rung 14 is: add rungs" — lives in
`docs/source-ladder.md` and is not repeated here. What follows is what to try
FIRST for each kind of government, which is the part that saves the hours.

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

Every adapter had `WINDOW_BACK_DAYS = 30` while the app serves
`CONCLUDED_LOOKBACK_DAYS = 90`. Sixty days of published, retrievable history
were being dropped at the fetch, at every zip, silently — a density loss that
no count check caught because each adapter honestly reported what it fetched.
Adapter windows now derive from `lib/meetings/constants.ts`. **Check this
first when a jurisdiction looks thinner than its portal.**

### A town's portal may not be the town (2026-08-15)

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
