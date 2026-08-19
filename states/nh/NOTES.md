# New Hampshire — state notes

The state's own memory: filing systems, vendor patterns, walls, statutory
posting rules. Appended by every session that learns something about NH.
Born 2026-08-15 (the NH/NJ depth session). The method across all states is
`docs/zip-playbook.md`; this file is what is true of this one.

## Elections and filings

- **Secretary of State — `sos.nh.gov`.** The authority for candidate filings,
  certified results and the 2022–2032 district maps. It **refuses this
  network**: 403 to a plain client, to an identified User-Agent, to a full
  Chrome UA string (that rung worked 2026-08-13 and had closed by 2026-08-14),
  and to a real Chromium navigation. The working route is the Internet Archive
  dated mirror, and the archive URL is what gets cited because it is the
  document that was actually read. Full ladder in `docs/zip-playbook.md` §3.
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

**Corrected 2026-08-19 (H03).** The Zoning Board row above read
`KNOWN_UNCOVERED` until this session, and it had been **LIVE since
2026-08-15** — the curated venue row that closes it shipped in the mobile
round-two session and this file was never brought forward. The registry was
right and the document was four days stale.

That is the same failure H03 exists to catch, one layer up: a coverage record
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
either way. Method and measurement in `docs/zip-playbook.md`.

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

(Dates in this file are wall clock. Older records in `docs/source-ladder.md`
label the same sessions "08-16" through "08-19" — sequence numbers that ran
ahead of the clock under a convention retired 2026-08-14. `docs/state.md` §18
explains them.)

## Special districts

NH RSA 52 village districts and precincts are real governments with elected
commissioners. Thirteen of them are in Merrimack County
(`docs/coverage-audit-by-county.md`). **No village district's boundary reaches
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
`data/audit/krsd-board-2026-08-16.json`.

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
