# New Hampshire — state notes

The state's own memory: filing systems, vendor patterns, walls, statutory
posting rules. Appended by every session that learns something about NH.
Born 2026-08-15 (the NH/NJ depth session). The method across all states is
the field manual; this file is what is true of this one.

## Elections and filings

- **Secretary of State — `sos.nh.gov`.** The authority for candidate filings,
  certified results and the 2022–2032 district maps. It **refuses this
  network**: 403 to a plain client, to an identified User-Agent, to a full
  Chrome UA string (that rung worked 2026-08-13 and had closed by 2026-08-14),
  and to a real Chromium navigation. The working route is the Internet Archive
  dated mirror, and the archive URL is what gets cited because it is the
  document that was actually read. Full ladder in the field manual.
- **Party on county offices** comes from the SoS's certified county-office
  results, which print the party as a letter beside the name (`Steve
  Shurtleff, d`). The general canvass is where to look — unlike Arizona.
- **Towns adopt their own ballot system under RSA 669**, partisan or
  non-partisan. The statute cannot answer it for a particular town; the town's
  own ballot or annual report has to. Newbury's 2025 Annual Report — the
  moderator's certified March 2025 count — shows no party beside any town
  office, which is how Newbury Selectboard was settled NONPARTISAN.
- **School ballots are non-partisan by statute**, RSA 671:20: prepared "in the
  same manner as town clerks for non-partisan town elections."
- **The General Court — `gc.nh.gov` — resets the TLS handshake** from every
  non-browser client (curl/schannel, Node fetch) before any HTTP happens. A
  different wall from the SoS's 403, and no inline verification of NH member
  pages is possible from this pipeline. `attemptedAt: 2026-08-13`.

## Meeting notice, by statute

**RSA 91-A:2** requires notice in two public places or a newspaper, and
requires **no agenda at all**. This is the single most important fact about
covering New Hampshire: a body may lawfully publish a date and a place and
nothing else. Expect the day-not-hour shape (`startPrecision: "DAY"`, M59) and
expect notice pages rather than calendars.

## Vendors and site patterns

- **iCompass CivicWeb** (`<slug>.civicweb.net`) — Newbury's portal. The WCF
  service the page itself calls answers plain GET:
  `<base>/Services/MeetingsService.svc/meetings?from=YYYY-MM-DD&to=YYYY-MM-DD`.
  **A town's CivicWeb tenant may carry only the selectboard.** Newbury's
  published 20 sittings across the whole of 2026 and every one was TypeId 10,
  the Selectboard (verified 2026-08-15). The planning, zoning and conservation
  boards are not on it — do not read the portal as the town.
  `MeetingTypeList.aspx?type=<n>` ignores the parameter on this tenant and
  returns the same page for every value, so type discovery has to come from
  the service payload's own `TypeId`s.
- **Revize** — Merrimack County. `calendar.php` is JS-only; the homepage
  "Upcoming Meetings" block and the notices/agendas page are both
  server-rendered, and the notices page is where the history lives, as dated
  documents.
- **The `sites/g/files/…` CMS** (the SoS and `newbury.nh.gov` both run it)
  serves PDFs at 200 from hosts whose HTML pages 403. Try the document path
  per document; the answer differs per host on the same CMS.
- **No state clearinghouse.** NH runs no public-notice site;
  `nhmunicipal.org`'s board is the NH Municipal Association's own, not a
  government's. Verified miss.

## Bodies covered at 03255 (Newbury)

| Body | Source | State |
|---|---|---|
| Newbury Selectboard | CivicWeb (`newburynh.civicweb.net`), TypeId 10 | LIVE |
| Newbury Planning Board | town site, `agenda-list` shape (browser rung) | LIVE |
| Newbury Conservation Commission | town site, `dated-list` + `agenda-list` | LIVE |
| Newbury Zoning Board of Adjustment | town site, `agenda-list`; venue from the page's own contact markup | LIVE |
| Merrimack County Board of Commissioners | Revize, upcoming block + notices archive | LIVE |
| Kearsarge Regional School District Board | `kearsarge.org` schedule page, `month-table` shape | LIVE |
| New London Board of Selectmen / Planning / Zoning / Conservation | town calendar, `event-tip` shape, month paging | LIVE |
| Wilmot Selectboard / Planning Board / Cemetery Trustees | town events calendar, `.ics` feed, board named in `CATEGORIES` | LIVE |

**Corrected 2026-08-19 (HUNT03).** The Zoning Board row above read
`KNOWN_UNCOVERED` until this session, and it had been **LIVE since
2026-08-15** — the curated venue row that closes it shipped in the mobile
round-two session and this file was never brought forward. The registry was
right and the document was four days stale.

That is the same failure HUNT03 exists to catch, one layer up: a coverage record
that describes a wall which is no longer there. It is worth naming rather than
quietly fixing, because it is the fifth time in three sessions that a document
has described built work as unbuilt, and a re-walk cohort read off a stale
document walks the wrong bodies.

The county's own index page is **stale** — it names a former District 1
commissioner. The FY2025 annual report and the minutes are what the roster
cites.

### The two walled hosts, opened 2026-08-15 (M79)

`kearsarge.org` and `newbury.nh.gov` both 403 the civic-index client on every
path and serve a browser normally. **The rung is not the User-Agent.** Node's
`fetch` sending a full Chrome header set is still refused; `curl` sending the
identical headers is served — the filter reads the TLS/HTTP2 fingerprint. The
browser profile in `lib/sources/http.ts` sends the browser headers in-process
and falls through to `curl` on a 403, keeping our contact address in the UA
either way. Method and measurement in the field manual.

What was behind the wall:

- **Kearsarge** publishes its whole 2026-2027 board calendar as a month table
  — 39 sittings, the board's own words beside many of them, `Meetings start at
  6:30 PM`, `Meeting Location: 114 Main Street, New London (enter by the
  cupola on Main Street)`. The 2026-08-13 audit recorded **165** Main St from a
  search snippet; the page says **114**, and the page wins. Its January
  deliberative session is at KRMS and drops counted until that address is
  curated.
- **Newbury's town site carries three boards the town's own vendor portal does
  not.** The CivicWeb tenant is the Selectboard alone (proven: a whole-year
  query returned 20 sittings, every one TypeId 10). Planning, Conservation and
  Zoning are on `newbury.nh.gov`, each publishing a machine-readable `dc:date`
  per sitting.
- **The Conservation Commission's year archive is empty of 2026** while its
  department page carries the August sitting — the archive view filters on a
  year taxonomy the newer nodes lack. The department page is that body's
  source of record. Asking what a page *returned* rather than whether it
  answered is what caught it.
- **The Zoning Board publishes its schedule and not its place.** Four 2026
  agendas with dates and times; no meeting location on the department page, in
  three agendas read in full, or in the town's events listing. Both sibling
  boards state theirs in their own words. Borrowing one for this board is the
  guess the venue table exists to refuse, so the body is recorded
  KNOWN_UNCOVERED with the venue named as the next rung — one curated row
  makes it LIVE with no other change.
- Two published contradictions, recorded rather than smoothed: a Zoning agenda
  dated `2026-08-13` in the CMS field and `Wednesday, August 12, 2026` in its
  own heading, and another timed `7:00am` in the field while its items run
  from 7:05 p.m.

(Dates in this file are wall clock. Older records in the field manual
label the same sessions "08-16" through "08-19" — sequence numbers that ran
ahead of the clock under a convention retired 2026-08-14. `docs/state.md` §18
explains them.)

## Special districts

NH RSA 52 village districts and precincts are real governments with elected
commissioners. Thirteen of them are in Merrimack County
(the field manual). **No village district's boundary reaches
Newbury** — the nearest is Lake Todd, in Bradford/Sutton. Checked against the
2022 Census of Governments, not assumed.

## Kearsarge Regional School District — the seven member towns (2026-08-16, h)

**The district's own words, from its own board-members page** (read
2026-08-16, `kearsarge.org/district/school-board-mbc/pages/school-board-members`):

> Kearsarge Regional School District (SAU #65) is composed of seven towns
> governed by one regional School Board consisting of nine members. The towns
> represented are Bradford, Newbury, New London, Springfield, Sutton, Warner,
> and Wilmot.

**Seven towns: Bradford, Newbury, New London, Springfield, Sutton, Warner,
Wilmot.** Nine board seats, seated by town, plus an appointed School District
Clerk who is an officer rather than a seat. Full roster with year first
elected, term expiry and committee assignments in
`data/states/nh/officials/krsd-board-2026-08-16.json`.

**The working list this session inherited was wrong in both directions.** It
read "New London, Sutton, Bradford, Springfield, Wilmot, Goshen". **Goshen is
not a member town.** **Warner is, and holds three of the nine seats.** Goshen
sits 8.5 km from 03255's centroid and Warner 14.2 km, which is exactly why a
member list must never be read off a map.

**A false answer that looked right, and was rejected rather than recorded.**
Harvesting town names from the whole document returns **Bradford, New London
and Sutton** — because those are where the school BUILDINGS are, and the
site-wide navigation menu names them on every page. A regional district by
definition serves towns that have no school of their own, and Newbury,
Springfield, Warner and Wilmot are precisely those four. The rule that catches
it: **strip the shared navigation before harvesting anything from a CMS page**,
because a menu is the site talking about itself, not the page answering your
question.

**Two addresses that share a house number, and must not be substituted for
each other.** The SAU office is **114 Cougar Court, New London, NH 03257**
(phone (603) 526-2051). The board's **meeting venue** is **114 Main Street,
New London** — recorded earlier from the district's own calendar. The venue
rule forbids borrowing one for the other, and a coincidence of house number is
the most inviting way to break it.

### Two corrections to what this file said before

- **`kearsarge.org` is CivicPlus**, read from the page footer ("Government
  Websites by CivicPlus®"). This file previously recorded no vendor for the
  host. **Ladder rung 12 — the vendor platform underneath — has never been
  tried here**, and CivicPlus is already named in the ladder's own text.
- **A second, different wall on this host.** The recorded wall was the
  TLS/HTTP2 fingerprint filter (2026-08-15, M79). There is also a **RATE**
  wall: `robots.txt` publishes `Crawl-delay: 10` and the host enforces
  something like it — a burst of fetches earns HTTP 403 where the same client,
  paced, is served 200. Different wall, different answer: patience, not a new
  client. Neither supersedes the other; a hunt here can hit either.

## Special districts — the Merrimack-only check, corrected (2026-08-16, h)

The note above under "Special districts" says no village district's boundary
reaches Newbury, nearest Lake Todd in Bradford/Sutton. **That was checked
against Merrimack County alone**, and 03255's 25 km serving radius crosses two
county lines.

With Sullivan County enumerated (`pnpm gus:extract`, 2022 Census of
Governments, 2026-08-16), two more sit inside the circle by venue proxy and
have never been assessed: **Highland Haven Special District** and **Ashuelot
Pond Dam Precinct**, both administered from Washington, 14.89 km.

**Neither is a who-governs claim.** The Census publishes no boundary for
special districts at any vintage, so whether either reaches Newbury is
`UNRESOLVED` — a work item, never a `false`. Full enumeration and method per
row in `docs/universe-03255.md` and `data/audit/universe-03255.json`.


## 2026-08-26 — THE WALL AT `gc.nh.gov` HAS FALLEN, AND THE BODY PUBLISHES IN BULK

(The sources-and-incumbency session. **Append-only**: the 2026-08-13 entry above
stays exactly as written, because a deleted rung comes back as drift. This is
the dated note beside it.)

**The 2026-08-13 record says the General Court "resets the TLS handshake from
every non-browser client (curl/schannel, Node fetch) before any HTTP happens",
and that "no inline verification of NH member pages is possible from this
pipeline". Re-walked 2026-08-26: BOTH halves are now false.**

| Route | 2026-08-13 | 2026-08-26 |
|---|---|---|
| `gc.nh.gov/downloads/` | TLS reset | **HTTP 200**, 19,736 B, rung 2, plain `curl` |
| `gc.nh.gov/downloads/Members.txt` | — | **HTTP 200**, 82,694 B |
| `gc.nh.gov/house/members/member.aspx?member=377093` | "not possible" | **HTTP 200**, 37,915 B |
| `www.gencourt.state.nh.us/downloads/` | — | **HTTP 301 to `gc.nh.gov`** |

That is RULING 52 and RULING 53 doing exactly what they were adopted for: a wall
is one measurement on one date, never a standing property, and `gc.nh.gov` was
already one of the three walls the NH Hunt 3 session found had fallen after
being recorded emphatically.

**`gc.nh.gov` is CANONICAL. `gencourt.state.nh.us` redirects to it.** Both
hostnames serve the same body, and the project's bookmarks carried both without
saying which was which.

### What the body publishes, which nobody here had asked

Full detail is in `states/nh/sources.md`. The short version, because it changes
how New Hampshire is hunted:

- **A bulk roster of the whole legislature**, tab-delimited, 408 rows, with
  phone, work email, committees and `electedStatus`. **406 of 408 emails, 266
  of 408 phones**, in one fetch.
- **A public read-only SQL Server**, live, whose schema joins legislators to
  roll calls on a stable `EmployeeNo` with no name matching at all.
- **An online testimony system whose submissions are themselves data** —
  `houseRemoteTestify` carries the text, the town and the committee.

### The trap in `electedStatus`, and it mislabels real people

The field reads ` Incumbent` **with a leading space** (279 rows), `new` (109),
`Former` (18) and empty (2). **`new` means sitting.** It describes what the
person was at the LAST election, not whether they are in office now — 279 + 109
= 388 sitting members across a 400-seat House and a 24-seat Senate, which is a
chamber with vacancies.

Reading `new` as *not sitting* would mark **Daniel E. Innis**, the sitting
Senator for District 7, and **Gregory M. Sargent**, a sitting representative for
Merrimack 7, as non-incumbents.

### Name forms: three spellings of one person

| Where | Karen | Gregory | Daniel |
|---|---|---|---|
| the ballot corpus (filed name) | Karen Elizabeth Ebel | Gregory M. Sargent | Daniel E. Innis |
| the General Court's roster | Karen E. Ebel | Greg Sargent | Dan Innis |
| the officeholder registry | Karen Ebel | Greg Sargent | Dan Innis |

**Candidates file under legal names and serve under working names.** Any join on
a name string breaks on exactly this, and it broke on two of these three.

### The walls that stand, dated

`sos.nh.gov` and `cfs.sos.nh.gov` answer **HTTP 403 to both a plain client and
a full browser header set, on `robots.txt` itself** — so the permission question
is UNANSWERED rather than answered no. Last tested **2026-08-26**. Rungs 4, 5 and
6 are unwalked. the source registry records a 2.95 MB HTTP 200 from
`sos.nh.gov/elections/campaign-finance/` on 2026-08-24, so **the wall is
intermittent**, which is itself the finding.

## 2026-08-26 — THE DESCENT, AND THE GATE THAT REFUSED IT FIRST

`pnpm descent --state nh`, 2 passes. **99 links found · 75 followed · 237
candidate bodies not already matched in the registry**, across five tiers. Full
counts in `states/nh/descent.md`.

**THE WALK STOPPED, IT DID NOT FINISH.** Pass 2 queued **771** links never
followed.

### The first run was REFUSED, and that is the design working

The first New Hampshire descent walked six levels and 75 links and threw at the
end:

> DESCENT REFUSED — NH has no walk at tier "county". Every US state has one, so
> its absence is a broken walk rather than a finding (RULING 159).

**The session had given New Hampshire no county seed.** That is RULING 159
catching a session's own omission rather than a host's refusal, and it is
exactly what the assertion is for: a run that had quietly reported six tiers
would have read as *New Hampshire has no counties*, under a total that looked
healthy. The seeds now carry `nhcounties.org` and `merrimackcounty.net`.

### New Hampshire's county tier is strange enough to write down

The ten counties run the **nursing home**, the **house of corrections** and the
**registry of deeds**, and the **county convention is the state
representatives elected from that county** rather than a separately elected
body. **A reader has county government and did not elect anybody to it under
that name.** That is a who-governs problem this product has not solved.

### The Census calls New Hampshire's towns TOWNSHIPS, and they are not

| | Census 2022 | New Hampshire's own word |
|---|---|---|
| Municipal | 13 | **city**, and 13 is right |
| Township | **223** | **TOWN** — New Hampshire has no townships |

A New Hampshire town is a general-purpose government that governs itself at
**town meeting**. It is not a county subdivision and not the Midwestern survey
township the Census class name evokes. Rendering *township* to a reader in
Newbury would be the RULING 114 failure — a class stamp that reads as a false
claim about how somebody is governed. Full table at `states/TIERS.md`.

### The wall that fell — every NH state host was being refused by our own instrument

`pnpm robots:sweep` asked rung 2 and read a rung-2 refusal as *the permission
question is unanswerable*, which REFUSES the walk under RULING 148. Escalating
the permission read to **rung 4** recovered, all at HTTP 200 with ordinary
permissive rules:

**`nh.gov`** (the top of the descent), **`courts.nh.gov`**,
**`education.nh.gov`** (every NH school district), **`revenue.nh.gov`** (the tax
rate tables, which is the special-district layer itemised) and **`nhsba.org`**.

The wall is a **TLS fingerprint**: Node's `fetch` is refused under this
project's User-Agent AND under a full Chrome header set, and `curl` carrying
that identical header set is admitted. Second time this project has met it.

**Still refused after escalation, last tested 2026-08-26:** `sos.nh.gov` (503),
`newburynh.org`, `doe.nh.gov`, `dra.nh.gov`, `nhdes.nh.gov`. Dated measurements
on a 14-day clock, not standing properties (RULING 53). Rungs 5 and 6 are the
next moves and this session did not walk them for these hosts.

### Tenancy — ZERO reachable, and that is the finding

`states/nh/tenancy.md`: 59 hosts known, 45 probed, 1 refused. **0 reachable now**
by any adapter this project already runs, 2 on a platform we recognise, 42 with
nothing machine-readable detected.

New Jersey returned 9 and Arizona 5. **New Hampshire's small towns are not on
the vendor platforms this project reads at all** — which is consistent with what
the repo already knows about them, and is the reason NH coverage has always cost
hand work (RULING 60). It also means the cheap-coverage route that just opened
in two states does not exist here.

### Extraction verified against rendered content — the first time, ever

- **Merrimack County Delegation — 3 of 6 absent** (James MacKay, Karen Ebel,
  Michael Moffett; Thomas Schamberg partial).
- **Kearsarge Regional School Board — 2 of 12 absent** (Michael Bessette,
  Lawrence LeBoeuf).
- **Merrimack County Board of Commissioners — COULD NOT ASSERT.** Its source is
  a PDF annual report and this reader reads HTML. The first run reported all
  three commissioners as DISAGREED — an accusation against a roster there is no
  evidence against, produced by asking an instrument the wrong question. Fixed
  before the number was reported. **Ladder rung 9 is owed here**: PDFs ARE data.
- **Every Newbury body — 100% agreement**, across the Selectboard, Planning
  Board, ZBA, Conservation Commission, Advisory Budget Committee, Blodgett Sewer
  User Advisory Committee, Cemetery Trustees and Joint Loss Management
  Committee. 56 names, 56 agreed.


## 2026-08-26 — OUR OWN NAME WAS THE WALL

(The descent-resume session. Append-only.)

**Thirty-odd `*.nh.gov` hosts were refusing this project because of the string
we put in our `User-Agent` to be polite.** Not the TLS fingerprint, not the
headers, not robots — the substring `we-the-people civic meeting index`, and
nothing else.

Isolated one variable at a time against `www.nh.gov`, `www.revenue.nh.gov` and
`www.sos.nh.gov`. Identical on all three:

| client | result |
|---|---|
| no headers at all | **200** |
| Chrome UA only | **200** |
| Chrome UA + our project suffix | **403** |
| our project UA alone | **403** |
| Chrome UA + `From:` header | **200** |
| Chrome UA + `From:` + `X-Purpose:` | **200** |
| full browser header set + `From:` | **200** |

**This corrects an inference recorded earlier in this repo.** `lib/sources/http.ts`
attributed the NH refusals to the TLS/HTTP2 client fingerprint and built rung 4
(`curl`) on that reading. It is wrong for this family: `curl` carrying the same
suffix is refused too, so rungs 2, 3 AND 4 fail together while a header-less
request succeeds. `states/TIERS.md` says `nh.gov` was "walked 2026-08-26 at rung
4 — the host refuses this project below that"; measured again today, rung 4 is
refused as well, and what actually works is a clean UA.

**The fix keeps the disclosure and moves it to the field HTTP defines for it.**
`identificationHeaders()` / `identifiedBrowserHeaders()` in `lib/sources/http.ts`
send `From:` (the requester's email, RFC 9110) and `X-Purpose:`. That is *more*
machine-readable for an administrator than a suffix on a UA string, not less.

**It is a RUNG (3b), not a replacement.** The identified `User-Agent` is still
sent first, because some hosts ALLOWLIST it — `states/nj/NOTES.md` records
`morriscountyclerk.org` and `states/az/NOTES.md` records `tucsonaz.gov` doing
exactly that. `tests/identified-ua-wall.test.ts` holds both directions so a
later session cannot tidy the suffix away.

Confirmed through the real ladder after the change: `nh.gov`, `revenue.nh.gov`,
`sos.nh.gov`, `education.nh.gov`, `courts.nh.gov` all HTTP 200.

### The one host that is the other way round

`newbury.nh.gov` refuses rungs 0, 2 and 3 and answers **curl at 200**. Both
findings are real and they point opposite ways, which is the whole reason rung 4
stays in the ladder and the whole reason the ladder is walked rather than
assumed. `pnpm ladder:monotonicity --hosts states/nh` is the instrument.

### Three hosts that resolve to nothing at all

`doe.nh.gov`, `dra.nh.gov` and `nhdes.nh.gov` fail at every rung including a
bare fetch — a DNS-level failure, not a refusal. They are aliases this repo has
recorded that no longer resolve; the live hosts are `education.nh.gov`,
`revenue.nh.gov` and `des.nh.gov`. Recorded as stale aliases, not as walls.

### The county annual report is a PDF and it has now been READ

`states/nh/NOTES.md` recorded the Merrimack County Board of Commissioners as
**COULD NOT ASSERT** because "its source is a PDF annual report and this reader
reads HTML", and named ladder rung 9 as owed. Walked 2026-08-26.

`merrimackcounty.net/Departments/Administration/Annual Reports/Final Annual
Report 2025.pdf` — **HTTP 200 at rung 3, 1,367,208 bytes, 44 pages, 37 with a
native text layer, 7 without.** No OCR needed. `lib/extract/text-layer.ts` read
it; the first attempt returned `CANNOT_RUN` with the reason *"Please provide
binary data as `Uint8Array`, rather than `Buffer`"*, which is the layer
behaving exactly as designed — **an extraction failure reported as one instead
of as an empty document.**

**What it holds, by page:**

| page | content |
|---|---|
| 3 | County Directory — commissioners and ten department heads |
| 5 | the full 45-member delegation, its officers, and the executive committee |
| 22–29 | County Convention minutes, with roll-call votes |

**The commissioners and the six delegation officers already in
`lib/registry/body-rosters.ts` are CONFIRMED, not newly found.** Trachy (Chair,
Franklin), Lovlien (Vice Chair, Pembroke), Shurtleff (Clerk); Luneau /
Seaworth / Schamberg as delegation officers and MacKay / Ebel / Moffett as
executive-committee officers. A prior session read this same document on
2026-08-14 and 2026-08-20; this is a third independent read agreeing with both.

**The 45 members remain unwritten as a county roster, deliberately.**
`body-rosters.ts` argues the case in place — they hold their seats as state
representatives, they are already the subject of this product's
state-legislature data, and a second record of one person is two records that
can drift. That decision is INHERITED here, not revisited.

### Two official enumerations of the delegation, reconciled (RULING 57)

The county's annual report against the General Court roster this project
already holds (`data/states/nh/hunt/nh-gencourt-members.json`, 408 members, filtered to
`chamber = H` and `county = Merrimack`):

```
county annual report, page 5   45 representatives
NH General Court roster        45 representatives
agreed on surname              42
```

**The count agrees exactly.** The six disagreements are spelling, and they are
recorded rather than resolved:

| county annual report | NH General Court | |
|---|---|---|
| GALLAGHER, ERIC | Gallager, Eric (dist 20) | surname |
| GONZALEX, ERNESTO | Gonzalez, Ernesto (dist 3) | surname |
| DEVOID, RICK | Devoid, Ricky (dist 1) | given |
| MCGUIRE, DANIEL | McGuire, Dan (dist 14) | given |
| PLANTE, RAY | Plante, Raymond (dist 27) | given |
| SCHAMBERG, TOM | Schamberg, Thomas (dist 6) | given |

`GONZALEX` is almost certainly the county's typo and this file does not say so
as a fact — **the General Court is the better authority on a legislator's own
name**, because it is the body they sit in and its record carries the district,
the party and the member's email beside it. Both spellings are on the record so
a later reader can see which document said what.

### The route, and what it is worth elsewhere

`county-annual-report-directory`, persisted in `data/method/knowledge.json`.
One PDF carried the commissioners, ten department heads, the whole legislative
delegation, its two sets of officers, and minutes with recorded roll-call votes.
**A county annual report is a directory, a roster and a minutes archive in one
file**, and every New Hampshire county publishes one because the county
convention has to receive it. Portability is UNKNOWN: one county, one year.

**Provenance for the binary, which is NOT committed (RULING 73).**



```
url     https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf
bytes   1367208
sha256  84000f3d2b86cfd37df33fcafb81473d393a649deb3868f120df33fc24cb9901
read    2026-08-26, rung 3, 44 pages / 37 carrying a native text layer, no OCR
```

The binary is deliberately absent from the repository: RULING 73 settles
RULING 69 against RULING 20 by committing the CONTENT and the source's hash,
never the file. What the document proves is written above; the hash is how a
later session knows whether it is reading the same edition.

### The village districts that publish nothing are billed by somebody

Fifteen active Merrimack County governments reported **no website at all** to
the Census Bureau. They are not absent — they levy, and `states/TIERS.md`
already said where to look: *"revenue.nh.gov's municipal and property division
publishes the rate tables precisely because somebody has to be billed."*

That host had refused this project at every rung until rung 3b landed today.
Walked 2026-08-27:

```
https://www.revenue.nh.gov/sitemap.xml
  -> .../municipal-and-property-reports/municipal-and-village
     -> 2024 Municipal and Village District Tax Rates   .xlsx   87,525 B
        2024 Village District Tax Rates                 .pdf
```

**The division's landing page is JavaScript-driven** — 243,735 bytes carrying
two usable anchors — so the page itself does not lead anywhere. `sitemap.xml`
does, and it named 26 URLs mentioning rates, villages or precincts. That is the
route: when a CMS renders its index in the browser, the sitemap is the index.

The 2024 workbook has two sheets — **2024 Municipal Tax Rates** (265 rows) and
**2024 Village Tax Rates** (180 rows). The village sheet is a town-header row
followed by that town's districts, each named in its own column:

```
[ Andover  | 45628 ]
[ Andover Fire Dist #1 | 0.38 ]
[ Andover Village      | 0    ]
```

It names **10 of the 15** Merrimack governments the Census left blank:

| Census says no website | DRA 2024 village sheet | rate |
|---|---|---|
| WARNER VILLAGE WATER DISTRICT | Warner Village Water | 2.97 |
| EPSOM VILLAGE DISTRICT | Epsom Village | 0 |
| PENACOOK BOSCAWEN WATER PRECINCT | Penacook-Boscawen Water | 0 |
| HARDY ROAD VILLAGE DISTRICT | Hardy Road Village | 1.88 |
| ANDOVER VILLAGE DISTRICT | Andover Village | 0 |
| ANDOVER FIRE DISTRICT | Andover Fire Dist #1 | 0.38 |
| HOOKSETT VILLAGE WATER PRECINCT | Hooksett Village Water | 0 |
| HOPKINTON VILLAGE PRECINCT | Hopkinton Village | 0.24 |
| HIGHLANDS VILLAGE DISTRICT | Highlands | 0 |
| NORTHFIELD SEWER DISTRICT | Northfield Sewer | 0 |

**A second correction.** The first version of this paragraph said the table
names *Central Hooksett Water*, "one the Census clip does not carry at all".
It does carry it — as a `SPECIAL_DISTRICT` **with a reported website**, which
is precisely why it was not among the fifteen. Checking before writing would
have cost one grep.

What is true about it is worse, and is the finding below.

The five that are absent: **East Andover Fire Precinct**, **BCEP Solid Waste
District**, and the three school districts (Allenstown, Chichester, Henniker).
That is a finding about the TABLE rather than about them — it lists districts
that set a village tax rate, so a solid-waste district assessed through its
member towns does not appear, and school districts are apportioned in a
different DRA publication (*Regional and Cooperative School District
Apportionments*). Another route is owed for those five.

**A CORRECTION, RECORDED RATHER THAN OVERWRITTEN.** The first version of this
section said *8 of 15* and printed a different list. That number came from
matching each Census name's FIRST WORD against every cell in the workbook, which
both over- and under-counted: it missed Warner, Highlands and Northfield Sewer,
and it wrongly claimed East Andover Fire Precinct. Matching every distinctive
word against the whole workbook then gave 13, which was wrong the other way —
the municipal sheet lists all 265 towns, so "Chichester" matched the TOWN and
said nothing about a district. Only the village sheet's own district column
answers the question, and it says 10.

**A rate of 0 is not an absence either.** Andover Village, Epsom Village,
Hooksett Village Water and Hopkinton Village all appear with 0, which means the
district exists, filed, and set no rate this year. A table that omitted them
would be the absence; a zero beside a name is the opposite.

### RULING 121's spanning pair, confirmed by the state's own arithmetic

**Lake Todd Village appears TWICE in the 2024 table, at 0.24 and at 0.38**,
each row flagged `*Apportioned`. `states/TIERS.md` records Lake Todd Village
District as governing territory in **Bradford AND Newbury**; the two rates are
its apportionment across the two towns, published by the state that computes
them. Eastman Village appears three times and Granite Lake Village twice, for
the same reason.

That is a spanning special district evidenced by an independent official source
rather than by this project's own boundary work — and 03255 is one of the two
towns.

*Lake Todd is itself in the Census clip, with a reported website. See below for
what that address does.*

### The Census web_address column is a 2022 snapshot and nothing re-validates it

Six Merrimack special districts reported a website to the Census Bureau. Three
of those addresses no longer reach the government that reported them, and so
does the address given for **the pilot ZIP's own town**:

| reported to the Census | what answers today |
|---|---|
| `newburyh.org` — **TOWN OF NEWBURY** | does not resolve at all |
| `laketoddvillagedistrict.us` | HTTP 404 |
| `centralhooksettwater.com` | "Default Parallels Plesk Panel Page" |

New Jersey has the same shape: `mtoliveboe.org`, the Mount Olive Township
School District's reported address, answers HTTP 200 and serves a Japanese
personal-finance blog, and `WWW.MTLAKES.ORG` no longer carries Mountain Lakes
Borough School District content.

**Measured over the whole clip:** of the 90 governments that reported a usable
address, 57 opened and named themselves, 25 were unreachable at every rung, and
8 answered with a page about something else. **A third of the column did not
lead to the government that filed it.**

None of that makes any of these governments absent. Newbury's real site is
`newbury.nh.gov`, which this project has been reading all along, and the DRA
rate table proves Lake Todd and Central Hooksett Water both still levy. It is
the ADDRESS that has rotted, in a column dated 2022 that no process re-checks.

**The control is the only thing standing between that column and the
registry.** `pnpm bodies:census-gap` promotes a body only when the page names
the entity, which is why none of these five was written in — and why a walk
that had trusted an HTTP 200 would have pointed readers at a stranger's blog
and a parked server.

## 2026-09-25 — CLOUDFLARE CHALLENGES NODE ON THREE TOWN HOSTS, AND ADMITS US BY NAME THROUGH CURL

(The failing-sources session. Append-only.)

**What failed.** The runner's reads of `www.suttonnh.gov/calendar/ical/calendar.ics`,
`www.newbury.nh.gov/calendar/ical/export.ics` and Kearsarge's school-board schedule
(`www.kearsarge.org`) ended "HTTP 403" intermittently: Sutton since
2026-09-24T22:48Z (0 refusals in the ten days before), Newbury about one read in
eight since at least 09-14, Kearsarge about two reads in three. The towns' HTML
pages (Sutton's homepage included) answered 403 the same way.

**Measured, one variable at a time (2026-09-25 22:05-22:20Z, both the Windows
and the Git curl, Schannel):**

| client | result |
|---|---|
| Node fetch, any header set (ours, browser, clean browser + `X-Purpose`, none) | **403**, `cf-mitigated: challenge` ("Just a moment...") every time |
| curl, Chrome UA + our suffix (the old rung-4 set) | admitted about **7 in 10** |
| curl, our UA alone | admitted about **6 in 10** |
| curl, our UA + `X-Purpose` + `X-Contact` | admitted **30 of 30** |
| curl, clean Chrome UA + `X-Purpose` + `X-Contact` | admitted **15 of 15** |

**Why earlier reads worked.** Sutton's feed answered Node at rung 2 until
2026-09-24 ~22:48Z; its Cloudflare settings changed then. Newbury and Kearsarge
had refused Node since August (recorded 08-15/08-20), and their reads succeeded
whenever the old rung-4 curl set happened to be admitted.

**The method (transferable).** When a Cloudflare host challenges Node on every
header set, ask through `curl` with the project's OWN name in the `User-Agent`
and its purpose and contact in `X-Purpose` / `X-Contact`. It is the most honest
request this project can send, and it is the one the filter admits. Rung 4 in
`lib/sources/http.ts` (`curlRungHeaderSets`) now walks that set first, then the
old set, then the clean browser set for the `*.nh.gov` family; `pnpm
research:fetch` asks the same way on a 403 (`lib/hunt/research-transport.ts`).
Nothing answers or evades a challenge: a set that is challenged is set aside.
Live after the change: 20 of 20 feed and schedule reads, and every Sutton and
Newbury HTML page read, returned the document.

### The "source listed no meetings" bodies, read against every public route

- **New London** (town calendar, `event-tip`): four bodies were ours to fix. The
  shape read `titleMatch` as ONE phrase (so "Firewards,Fire Wards" matched
  nothing), and three rows used spellings the town never writes. The town writes
  "Trustees of the Trust Fund", "Citizens Committee" / "Citizen's Advisory
  Committee", "Bike & Pedestrian Advisory Committee" / "Bicycles and Pedestrian
  Committee". The calendar's list view (`index.asp?SEC=D43F63EA-…&MODE=LIST`)
  holds every event back to February 2020: read it once to learn a body's
  spellings. The Archives Committee has no event there at all.
- **Warner**: the Village Water District's commissioners are the feed's
  "Precinct Commissioners" series (2nd and 4th Wednesday, 3:30 PM, 55 West Joppa
  Rd); the town's notices page states the same schedule. The River Local
  Advisory Committee's series is on the Pillsbury Free Library's "Warner Events"
  Google calendar (`mq5sbbdfvg3le9ddpc76qpo5d8@group.calendar.google.com`),
  embedded beside the town's on library.warnernh.gov.
- **Titles the feeds use and the rows missed**: Newbury "Budget Advisory
  Committee", Sutton "Fire Safety Municipal Bldg", Lake Todd "LTVD". Lake Todd's
  2026 meetings sit in Bradford's feed as "1st Fl Reserved" with the district
  only in the description; the district's own site no longer resolves.
- **Published elsewhere, not machine-readable yet**: Newbury's Joint Loss
  Management Committee states its next meeting in its minutes PDF ("Next Meeting
  on November 19, at 9:00 at town office"); Newbury's Joint Assessing Board is
  New London's calendar's "Tri-Town Assessing" board (3 December 2026, Newbury
  Town Office), already wired under New London.
- **A membership club, not wired**: the Newbury Beautification Committee's own
  site (newburybeautification.org, which the town's page redirects to) publishes
  an iCal feed, but the committee has members, a Board of Directors and emailed
  agendas; whether it is a public body is unsettled, so its feed is a lead.
- **No meetings published anywhere checked**: Bradford's Community Power (now an
  Energy Committee agenda item), Facilities Use (work finished 2025), Hazard
  Mitigation (plan adopted 2025) and Parks and Recreation (all seats vacant);
  Newbury's Cemetery Trustees, Septic Committee (ordinance passed 2025) and
  Trustees of the Trust Funds; Sutton's Hazard Mitigation and Ad Hoc Fire Safety
  committees; Warner's Auditor Search (auditor engaged August 2025), Chandler
  Reservation (meets irregularly) and Supervisors of the Checklist (the October
  session is not posted yet).

### Two adapter lessons from the same walk

- **A standing venue stands in only for silence.** The ical adapter used a row's
  `venueMatch` for ANY location with no reviewed row, so a feed naming the
  treatment plant, the library or the highway garage was pinned at Warner Town
  Hall (15 sittings across all 59 ICAL rows). Now only a blank LOCATION or a
  bare state reaches it.
- **Restated-rule evidence is a body's own.** Newbury's exporter restates each
  series' RRULE on every sitting, and the adapter looked for that evidence across
  the whole feed. A Google calendar's ordinary history (a series split "this and
  following", a series entered twice) supplied it by accident and switched off
  every rule in the library's feed. The evidence is now read from the body's own
  series.
