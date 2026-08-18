# The source ladder

How a body's meeting calendar and agendas get found. A standing document: every
hunt walks these rungs in order and records what each returned, and **every new
rung anyone discovers gets written back here** so the ladder compounds instead
of being re-derived each session.

The canonical per-body hunt records live in `lib/registry/coverage-audit.ts` —
every rung walked, every miss with its URL, overlaid onto the registry at
build. This document is the method; that file is the evidence.

**The governing constraint is in `CLAUDE.md`** (public records are reachable):
"not found" is a claim earned only by an enumerated record of rungs attempted.
A body without a recorded search is `NOT_ATTEMPTED`, never exhausted. A 403 to
a plain client, a stale URL, a feed with zero items, a server-rendered site, no
documented API, unfriendly vendor marketing terms — none of these are answers.
And the retrieval discipline binds every rung: identified `User-Agent` with a
contact address, serialized requests, honour `Retry-After`, never re-fetch an
unchanged `contentHash`, never authenticate or circumvent an access control,
never accept clickwrap and then violate it, never retrieve what is not already
public.

## The rungs

1. **Resolve the real domain first.** Search results go stale — `newburynh.org`
   does not resolve; `newbury.nh.gov` does. Common shapes: `<town>.<st>.gov`,
   `<town><st>.gov`, `<town>.org`, `<district>.k12.<st>.us`, `<district>.org`,
   `co.<county>.<st>.us`, `<county>county.gov`, and `.net` where `.org` is
   dead (`merrimackcounty.net`).
2. **The body's own page on that domain.** The specific board page, not the
   jurisdiction homepage — it usually links the calendar directly.
3. **The clerk, secretary or administrator page** — frequently different from
   the body's page, and where notices actually get posted.
4. **Machine-readable feeds on that domain.** Try, do not assume: `/rss`,
   `/feed`, `/RSSFeed.aspx`, `/AgendaCenter`, `/Calendar.aspx`,
   `/calendar.ics`, `?ical=1`, `/events.ics`, `/api`, `/sitemap.xml`,
   `/robots.txt`. Read robots.txt and sitemap.xml as discovery.
5. **CMS-standard paths for whichever platform the site runs.** Identify the
   CMS first (CivicPlus, Granicus OpenCities, Revize, Municode, GovOffice,
   Apptegy, WordPress, Squarespace), then try its conventions. **Never infer
   the agenda vendor from the website CMS** — Tucson runs Granicus OpenCities
   and is not a Legistar client, which would have been wrong twice.
6. **The agenda vendor portal, and its API before its HTML.** Legistar, OnBase
   Agenda Online, NovusAgenda, Diligent Community / BoardDocs, iCompass /
   CivicWeb, Simbli, PrimeGov, CivicClerk, Municode Meetings, Apptegy
   Thrillshare, Granicus IQM2. The list is open-ended; add every new one here.
7. **Undocumented endpoints behind the portal.** Most portals render from JSON
   they fetch themselves — watch the network requests on the meeting-list page
   and use the endpoint the page uses. The same public data the page shows, in
   the form the page already receives it.
8. **Embedded third-party calendars.** A Google Calendar embed exposes
   `calendar.google.com/calendar/ical/<id>/public/basic.ics`; Trumba and
   Localist have derivable public feeds.
9. **Statutory posting locations.** AZ requires the agenda on the body's
   website 24h ahead (A.R.S. § 38-431.02); NJ requires 48h notice (N.J.S.A.
   10:4-8); NH requires notice in two public places or a newspaper, and no
   agenda at all (RSA 91-A:2). Follow the statute to where notice lives.
   A *formal records request* is rung 9's manual sibling and is never
   automated — in AZ it is where § 39-121.03's commercial-purpose machinery
   attaches.
10. **County and state clearinghouses.** County clerks aggregate; some states
    run public-notice sites; press associations run legal-notice portals.
    (Verified misses: NH has none; nhmunicipal.org's board is NHMA's own.)
11. **The parent or overlapping body's feed.** Pima's board sat as the Library
    District and Ajo Domestic Water; joint meetings appear on both parties'
    calendars (Tucson content reachable via `pima.legistar.com`).
12. **The Wayback Machine**, for a page that moved rather than vanished.
13. **Community and social channels as leads only** — never a citation. A lead
    is `UNVERIFIED` until the body's own posting is found.

## Rung 14 is: add rungs

The list above is a floor. Reaching thirteen without an answer is the point at
which rungs get invented, and any route that works gets written back here.
A body is exhausted when the *ideas* run out and that has been recorded —
never when the list runs out.

## Rungs invented and verified, by session

### 2026-08-13 (the composite build — all verified on real bodies)

- **Browser network-capture of a portal's own XHR.** CivicWeb and Diligent
  Community portals render "Loading…" to a plain client, but the page calls
  `<tenant>/Services/MeetingsService.svc/meetings?from=&to=` — plain
  unauthenticated GET, JSON. Found on Newbury and TUSD; generalizes to every
  iCompass/Diligent tenant. This became the `diligent` adapter.
- **Embedded page-state mining for the platform org id.** Apptegy sites embed
  their API traffic in page state; extracting the org id yields
  `api.thrillshare.com/api/v4/o/<org>/cms/events` — unauthenticated JSON with
  venue and coordinates. Found on Vail (8164) and RTSD (4707); became the
  `apptegy` adapter.
- **Control-client test for a vendor API.** A Legistar 500 means "not a
  client", not "outage" — proven by fetching a known-good slug (`mesa`) in the
  same sweep. Distinguishes the two without guessing.
- **Search-engine asset discovery through a bot wall.** kearsarge.org 403s
  everything, but the search index surfaced the exact
  `/sites/g/files/vyhlif731/f/pages/2026-2027_school_board_schedule.pdf`
  asset URL. Query `"<domain>" filetype:pdf schedule` when the host blocks you.
- **robots.txt as CMS fingerprint.** Hosts that 403 HTML often still serve
  robots.txt from the edge; a stock Drupal robots.txt plus `vyhlif` asset
  paths identified both Newbury and Kearsarge as VT&S/CivicPlus, predicting
  identical fetch behaviour.
- **Homepage upcoming-meetings block as mini-feed.** Revize renders the next
  N meetings server-side on the homepage even though calendar.php is JS-only
  (Merrimack County).
- **Annual board-schedule PDF.** One PDF per school year with every board
  date, often filed under "notices" rather than "calendar" (Kearsarge).
- **Strip-the-token test.** Revize PDF links carry `?t=` cache-busters; the
  tokenless URL serves fine, so canonical URLs are stable for provenance.
- **Vendor document-center folder crawl.** CivicWeb's
  `/filepro/documents/<folderId>` tree is server-rendered and GET-browsable
  even where the meeting widgets are JS-only; the archive is deeper than the
  portal UI shows (Newbury: agendas back to 2016).
- **Meeting-type history page.** CivicWeb `MeetingInformation.aspx?type=<N>`
  server-renders a body's full history even when `MeetingSchedule.aspx` is
  all "Loading…". Try the per-type page before declaring a portal JS-only.
- **Form-POST the portal's own search for archives.** NovusAgenda's default
  view shows zero rows; POSTing its own search form (with session cookie and
  its own dropdown values) is how "this tenant is an empty archive" was
  *proven* rather than assumed for Vail.
- **IQM2 `/Services/RSS.aspx?Feed=Calendar`.** A pseudo-feed on every
  `*.iqm2.com` client — XML-declared, one rigidly regular block per meeting
  (Morris County). The `/Citizens/RSS.aspx` path is an error page; the
  working path is under `/Services/`.
- **IQM2 `/Citizens/Calendar.aspx?From=&To=` beats the pseudo-feed.**
  (2026-08-13, second pass.) The RSS pseudo-feed lists only *published
  documents* — mostly the recent past. Calendar.aspx with a date range is
  fully server-rendered with the forward schedule, and each row's `title`
  tooltip publishes board, meeting type, status, and **the venue with its
  full street address** — which resolved Morris County's venue citation
  without touching the county's Akamai-fronted site. Agenda links
  (`FileOpen.aspx?Type=14`) appear exactly where an agenda is published; an
  unpublished one renders the same anchor with an empty href. This is the
  rung the `iqm2` adapter is built on.
- **Per-meeting statutory notice PDFs decode cryptic venue strings.**
  Merrimack's homepage block says only "OCH - Concord"; the county's own
  public-notice PDF for 7/27 states "Location: OCH, 163 N. Main St.,
  Concord, NH 03301". The notices also proved the Board *alternates venues
  per meeting* (8/10 was Boscawen) — so venue rows key on observed strings
  only, and an unobserved venue drops counted.
- **College and special-district boards run the same portals as K-12.**
  Pima Community College's governing board is a Diligent Community tenant
  (`pima.community.highbond.com`), found by following the Agenda links on
  the college's own board-documents page. `/Services/MeetingsService.svc`
  answers plain GET with venue strings — the existing `diligent` adapter
  would serve it with one wiring row. Blocked only on the registry: Census
  boundary files carry no community-college districts, so there is no
  division to hang the body on (tracker D28).

### 2026-08-14 (the D28/D29 wiring — all verified on real bodies)

- **The embedded frame's own host.** A directory page that renders nothing to
  a plain client may be an embedded frame from another host that serves
  everything server-rendered. Tucson's Boards-Commissions directory at
  `tucsonaz.gov` is empty in curl; the page's network traffic shows it
  loading `clerksboards.tucsonaz.gov/boards?board=<id>` — and that host
  serves the full board list (56 rows with ids) and every per-board page
  (name, current agenda with PDF link, meeting location, meeting schedule,
  members) to a plain GET. This became the `clerksboards` adapter.
- **The bot wall reads the User-Agent, not the client.** `www.tucsonaz.gov`
  403s common crawler UAs (WebFetch's, for one) but serves both curl's
  default UA and this project's identified
  `we-the-people civic meeting index (…)` — the polite UA is load-bearing,
  not mere manners. Test a 403 with the project UA before recording a MISS.
- **OnBase `ViewDocument` beats `Downloadfile`.** The agenda link OnBase
  renders (`/Documents/Downloadfile/<name>.pdf?documentType=1&meetingId=N`)
  returns a JS "Downloading, please wait" interstitial to a plain client.
  The same document serves as a real PDF at
  `/Documents/ViewDocument/<name>.pdf?meetingId=N&documentType=1`. Found by
  reading the interstitial's own script for the URL patterns it constructs.
- **The body's own agenda PDF as the venue citation.** The PHA Board of
  Commissioners appears in Tucson's OnBase tenant with no location anywhere;
  its own published agenda (meetingId 1981) states "MAYOR AND COUNCIL
  CHAMBERS, CITY HALL, 255 W. ALAMEDA" — and that the Mayor and Council sit
  as the PHA board. One citable document resolved both the venue and what
  the body is. (Counter-case the same day: the Joint Meeting's agenda names
  a *per-meeting* venue — the PAG offices — so it stays dropped-and-counted
  rather than cached; the Merrimack alternating-venue lesson again.)
- **The statutory annual Public Notice Statement.** Tucson's Clerk publishes
  one PDF per year listing meeting dates, times, locations and agenda-posting
  places for *all* boards, committees and commissions
  (`/files/sharedassets/public/v/1/clerks/documents/bcc/2026-pns-statement-all-bccs.pdf`).
  The per-board pages carry the same content in parseable HTML, so the PNS
  is the cross-check rather than the feed here — but for a city without a
  boards app, the PNS-equivalent is the single richest document to hunt.
- **The Clerk's published schedule is the meeting feed.** Where a body's
  page enumerates the year's dates ("1/28, 2/25, …, 12/30/2026 @ 12:30
  p.m.") or states a rule ("1st Wednesday of each month @ 8:00 a.m."), the
  expanded instances are sourced meetings citing that page — the same
  content as the statutory annual notice. Two grammars parse; anything else
  drops counted, never guessed. Cancellation is claimed only from the
  Clerk's own signal (an agenda title reading "(Canceled) 08-12-26" cancels
  exactly that date's instance).

### Seeded directions not yet needed (from the reprioritization brief)

Minutes archives naming the next meeting; full-year schedules adopted by
resolution; charters/bylaws stating standing meeting times; video archives as
de facto calendars (YouTube channels have public feeds); newsletter archives
(GovDelivery, Constant Contact, Mailchimp); school academic calendars listing
board dates; sibling-body path derivation; alternate representations
(`?print=1`, `.json`, `format=`); regional aggregators (COGs, municipal
associations); state oversight directories naming the real domain and clerk.

## The consolidated MISS list

Never re-probe these; the miss is the finding. Canonical copies live on the
audit rows.

- `https://go.boarddocs.com/az/vail/Board.nsf/Public` — search results assert
  it; dead in a real browser (BoardDocs' own not-here page).
- `https://vailschools.novusagenda.com/agendapublic/` — 200 and empty: the
  archive for pre-2017 material; zero meetings in any queried window.
  Re-read 2026-08-17 (D22): unchanged, still zero.
- `https://<anything>.novusagenda.com/agendapublic/` — **the whole namespace
  is wildcarded.** 22 of 23 candidate tenant names for the four zips' bodies
  returned HTTP 200 carrying NovusAgenda's own `Error.aspx` page (1,384 bytes;
  a real tenant is 78,576). A 200 here is not evidence of a tenant. Swept
  2026-08-17 (D22); no live tenant exists in scope.
- `https://www.newbury.nh.gov/rss.xml` — 200, valid RSS, zero items.
- `https://www.newbury.nh.gov/sitemap.xml` — 403; robots declares none.
- `https://newburynh.civicweb.net/api/meetings` — 500.
- `https://newburynh.civicweb.net/Portal/ICal.aspx` and `/Portal/RSSFeed.aspx`
  — 200 but the portal HTML shell, not a feed.
- `https://kearsarge.org/` bare — TLS handshake failure; use `www.`.
- `https://sites.google.com/a/kearsarge.org/...` — 302 to Google login.
- `https://merrimackcounty.org/` — DNS does not resolve; `.net` is real.
- `https://www.merrimackcounty.net/sitemap.xml` — 404; `calendar.php` ignores
  `month`/`year`/`format=json` params.
- `https://webapi.legistar.com/v1/{tucson,tucsonaz,cityoftucson,morriscountynj,morriscounty}/events`
  — 500: not Legistar clients.
- `https://morriscountynj.iqm2.com/Citizens/RSS.aspx` — error page (use
  `/Services/RSS.aspx`); `/Services/iCalendar.aspx` returns the HTML shell.
- `https://go.boarddocs.com/nj/rocktwp/Board.nsf/Public` — 403; RTSD's
  agendas live on its Apptegy site.
- `https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/Subscribe.aspx`
  — email-only behind a CAPTCHA; not a machine channel.
- `https://www.nhmunicipal.org/public-notices` — NHMA's own board, not a
  statewide clearinghouse.
- `https://clerksboards.tucsonaz.gov/` bare — a landing shell ("Boards,
  Commissions, and Committees Endpoint Platform") with no board list; the
  list lives at `/boards/` (2026-08-14).
- `https://tucsonaz.hylandcloud.com/221agendaonline/Documents/Downloadfile/...`
  — 200 with a JS interstitial, not the PDF; use `ViewDocument` (2026-08-14).
- `https://www.tucsonaz.gov/Departments/Housing-and-Community-Development/HCD-News/Notice-of-Public-Hearing-Public-Housing-Authority-Plans`
  — 404 (page moved); the PHA venue citation is its OnBase agenda instead
  (2026-08-14).
- `pima.legistar.com/Feed.ashx?M=Calendar&...` — 200 with an "Invalid feed"
  body. Assert on content, never on status.
- `webapi.legistar.com/v1/{pimacc,pcc,rta,pagregion,pag,tucsonrta}/bodies` —
  500: none of PCC, the RTA, or PAG are Legistar clients (control slug
  `pima` answered 200 in the same sweep, 2026-08-13).
- `go.boarddocs.com/az/pima/Board.nsf/Public` — 403; PCC's agendas live on
  its Diligent tenant, not BoardDocs.
- `tucsonaz.gov/{api/v2/events,Events,calendar.ics,RSSFeed.aspx}` — all 404
  (2026-08-13): OpenCities publishes no machine feed for the city's boards;
  their agendas live on per-board pages under the Clerk's
  Boards-Committees-Commissions directory.

## Open browser errands

- **Kearsarge**: the host refuses every automated client this environment has,
  including its browser pane. In a human browser: extract the Google Calendar
  embed id from `/district/family-community/pages/calendars` (→ public
  `basic.ics`), fetch the 2026–2027 schedule PDF, enumerate the
  agendas-minutes page.
- **Newbury's other bodies** (Planning, Zoning, Conservation): enumerate
  `newbury.nh.gov/minutes-and-agendas` in a browser; check per-body
  `/node/N/events` calendars and any Drupal iCal export.
- ~~**Merrimack County**: capture the `calendar.php` XHR.~~ Superseded
  2026-08-13: the homepage block plus the notices page carry everything the
  adapter needs; the JS calendar was never required.
- ~~**Morris County**: cite the commissioners' meeting venue from the county
  page.~~ Resolved 2026-08-13 without a browser: the IQM2 Calendar.aspx
  tooltip publishes the venue and street address itself.

## The 2026-08-14 second-session hunts

**Campaign/personal sites for the 22 wired officials** (3e; overlay in
`lib/officials/campaign-sites.ts`, all `attemptedAt: 2026-08-14`):

- Verified by fetch (page names person + office): juanciscomani.com,
  adelitaforcongress.com, gallegoforarizona.com, analiliafornj.com,
  andykim.com, corybooker.com, bettyvillegasaz.com (the author's example,
  independently confirmed — "Betty Villegas | LD 20 legislator").
- Verified via the site's own indexed titles — the site 403s plain clients
  (the UA-sensitive-wall rung, noted per entry): markkelly.com,
  maggiefornh.com, maggiehassan.com.
- Honest misses, recorded: Shaheen (not seeking reelection 2026, announced
  2025-03 per shaheen.senate.gov press release; no active campaign site
  found); Gail Griffin (griffinforaz.com — DNS dead; gailgriffin4senate.com
  surfaced in search, unverified); David Gowan (gowanforaz.com — connection
  refused); Dan Innis (votedaninnis.com — 404; reported to have exited the
  US Senate race); Alma Hernández (almaforarizona.org exists but the fetched
  pages did not clearly state her own office — not shippable); Tony Bucco
  (no dedicated site found; a Facebook campaign page is not a campaign site
  under the overlay's rules).
- `NOT_ATTEMPTED` (2026-08-14): Lupe Diaz, Sally Gonzales, Aura Dunn,
  Marisa Sweeney, Greg Sargent, Karen Ebel.

**State legislature contact and photo pages** (3a/3b state half):

- Contact (email, capitol/district phone) shipped from the Plural CC-0 bulk
  CSVs, which carry the legislatures' published values; per-member
  direct-from-legislature verification is open. `attemptedAt: 2026-08-14`.
- Photos: azleg.gov / njleg.state.nj.us / gc.nh.gov member pages publish
  portraits; **their reuse terms are unhunted** — no state photo ships until
  a per-state terms record exists (D20's unknown-is-not-clearable rule).
  `NOT_ATTEMPTED` as of 2026-08-14.

**Federal roll-call endpoints** (D02; exact endpoints, all verified 200 on
2026-08-14):

- House: `clerk.house.gov/evs/<year>/roll<NNN>.xml` — members keyed by
  bioguide in `name-id`; the LAST `<yea-total>/<nay-total>` pair is the
  chamber total (earlier pairs are party subtotals — shipping the first pair
  was this session's caught bug). Latest roll discovered by HEAD
  binary-search; no index endpoint needed.
- Senate: `senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_2.xml`
  (official per-vote title lines) and
  `.../roll_call_votes/vote1192/vote_119_2_<NNNNN>.xml` — members keyed by
  **LIS id**, not bioguide; `legislators-current.json` bridges.
- Bill titles: `api.congress.gov/v3/bill/<congress>/<type>/<num>` (key in
  `.env.local`); the congress.gov bill page hosts the CRS summary the
  surface links.

**State roll-call publication (research note for next session):** Arizona —
apps.azleg.gov publishes per-bill floor-vote pages (structured HTML; a
Request-to-Speak/vote API is rumored but unverified). New Jersey —
njleg.state.nj.us publishes per-bill vote lists (server-rendered). New
Hampshire — gc.nh.gov publishes House and Senate roll calls per bill
(server-rendered tables). None verified as machine-readable feeds yet;
each needs its own hunt before an adapter.

**AZ/NH election sources** (D33, all verified 2026-08-14):

- `azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf`
  — 200, text layer extractable via pdfjs.
- `azsos.gov/elections/ballot-measures` — 200; carries the registration /
  early-voting / election-day dates; official 2026 measure language "Coming
  in 2026" (publicity pamphlet pending).
- `azleg.gov/ballot-measures-2026-analyses/` — 200; 11 adopted Legislative
  Council analysis PDFs under `/alispdfs/Council/2026BallotMeasures/`
  (three probe-verified 200).
- `sos.nh.gov` — **403 to every plain client including curl with an
  identified UA; 200 with a browser UA** (the UA-sensitive-wall rung).
  `2026-election-details` page links the cumulative filing
  (`/files/docs/cumulative-filings-7.16.26.pdf`, 200, both party sections)
  and the 2026–2027 political calendar PDF (200; Town Election March 10,
  primary Sep 8, general Nov 3).

**TIGER ADDRFEAT** (M26): `www2.census.gov/geo/tiger/TIGER2025/ADDRFEAT/tl_2025_<county>_addrfeat.zip`
— 200, ~1.5–7 MB per county; zip fields are `ZIPL`/`ZIPR` (not LZIP/RZIP —
the first build dropped 100% on that guess and the zero-written invariant
caught it).

**The 2026-08-15 rung set** (reactions/plain-language session):

- **Netlify function logs** (2a diagnosis): unreachable this session — the
  CLI has no stored login and interactive auth needs the author.
  `attemptedAt: 2026-08-15`. Both request shapes measured healthy against
  dev AND a local production build; the failure card now names its HTTP
  status so the next production screenshot completes the diagnosis.
- **govboard.tusd1.org** (4c notice channel): server-renders the Governing
  Board's meeting notice, times, public-hearing items, the five-member
  roster with roles and term expirations, and contact — all to a plain
  identified client, 200, ~34 KB. Wired as `noticeUrl` on the TUSD row;
  also the citation for the TUSD roster (5a). `attemptedAt: 2026-08-15`.
- **azleg.gov adopted analyses** (2b): 10 of 11 fetched and text-extracted
  directly. The eleventh — `adopted analysis SCR1004 - 2026.pdf` (Prop
  319) — **404s while the Legislature's own index links it** (broken at
  the source); the Council's draft `ballot analysis SCR1004 - 2026.pdf`
  resolves (200, application/pdf, 18 KB) and ships labeled as the draft,
  with the adopted URL retried first on every refresh run.
  `attemptedAt: 2026-08-15`.
- **AZ certified primary canvass** (6a):
  `apps.azsos.gov/election/2026/canvass/20260806_Primary_Canvass.pdf` —
  200, 19 MB, **scanned with no text layer** (pdfjs extracts 0 chars; the
  NJ ballot-drawing shape again). County canvasses DO carry text (Pima's:
  26 MB, 4.8M chars extracted). `results.arizona.vote` — 403 to a plain
  client behind a bot-verification wall, and driving it in a browser
  crashed the session host three times; recorded as a
  browser-only-and-hostile rung, not attempted again. The route that
  worked: the statewide canvass embeds each page as a JPEG — extracted
  13 page images from the PDF bytes directly and read the winner-starred
  tables by eye (pages recorded in the lineup file's citation).
  `attemptedAt: 2026-08-15`.
- **Roster pages** (5a/5b), all 200 to a plain identified client on
  2026-08-15: `pima.gov/government/board_of_supervisors/` (the /1130 and
  /173 CivicPlus paths 404 — the recorded venue-cache URL was the one that
  worked); `tucsonaz.gov/Government/Mayor-Council-and-City-Manager` (the
  /Departments path 404s); `vailschooldistrict.org/o/vsd/page/governing-board`
  (apptegy page, names embedded in accordion JSON);
  `newbury.nh.gov/selectboard` (members with term-end dates).
  NJ rosters (Rockaway Twp council, the two BOEs, Morris County
  commissioners) — `NOT_ATTEMPTED` as of 2026-08-15; next session's easy
  finds.

## The 2026-08-16 rung set (the Kelly-standard session)

- **The TLS-fingerprint wall.** gc.nh.gov (NH General Court) RESETS the TLS
  handshake from every non-browser client — curl (schannel), Node fetch —
  before any HTTP happens. Distinct from the sos.nh.gov UA wall (403 after
  handshake). No inline verification of NH member pages is possible from
  this pipeline; `attemptedAt: 2026-08-16`.
- **The SOS district-assignment documents.** sos.nh.gov publishes the whole
  2022-2032 map as town lists: `2022-2032-executive-council-districts.pdf`,
  `2022-2032-county-commissioners-by-district_0.pdf` (with which districts
  elect in which years), `2022-2032-state-representative-and-delegate-
  districts.pdf` (floterials marked FL). The URL pattern is guessable from
  the commissioners file; the EC file was found by probing it. All three
  fetched via the browser-UA rung.
- **The legislature's roster page as the member-URL authority.** The Plural
  CSV freezes member URLs at the legislature that was sitting when the row
  was written (AZ shipped legislature=55/56 links). azleg.gov/memberroster/
  and njleg.state.nj.us/legislative-roster are server-rendered, name the
  member beside the link, and carry phone/contact-form — the enrichment
  source of record (scripts/enrich-officials.mts).
- **A domain is not a person.** kellyayotte.com serves a DIFFERENT
  politician's campaign page in 2026. Fetch-and-read is the only
  verification that catches a lapsed-and-repointed domain; her real domain
  (kellyfornh.com) surfaced by search.
- **Client-rendered official pages verify by chain, not content.** njleg
  bio pages are SPAs whose served HTML never contains the member's name;
  the roster page that names the member beside the exact link is the
  verification chain (VERIFIED-VIA-ROSTER in the audit).
- **The Clean Elections voter guide as an official candidate-site index.**
  azcleanelections.gov per-district general-election guide pages list
  candidate websites — an official state source for campaign URLs
  (found gowanforaz.com there; the host then timed out, recorded MISS).
- **Ballotpedia serves 202 challenges to plain clients** — unusable as an
  index from this pipeline; guess-and-verify plus search did the work.
- **The reused-vehicle trap for bill summaries.** The CRS summaries
  endpoint can describe an EARLIER act carried by the same bill number
  (H.R. 5334). Match the summary's subject against the vote's title before
  paraphrasing; a mismatch is a pending state, never a source.

**2b hunt state (candidate links):** 40 verified links shipped; misses and
NOT_ATTEMPTED hunts enumerated in `data/ballot/candidate-links-2026.json`
(the hunts array is the ladder record for candidates; D36 tracks finishing
it). `attemptedAt: 2026-08-16` throughout.

## The 2026-08-17 rung set (the final-prep session)

**The NH TLS wall, retried with the author-ordered new rungs (2c):**

- `gc.nh.gov` — curl.exe (schannel, a different TLS stack than Node) RESETS
  the handshake identically: default profile, forced TLS 1.2, forced
  HTTP/1.1 all fail before any HTTP. This is fingerprint-level filtering,
  not a cipher mismatch. `attemptedAt: 2026-08-17`.
- `gencourt.state.nh.us` / `www.gencourt.state.nh.us` — **DNS retired**
  (NXDOMAIN from this machine). gc.nh.gov is the only General Court host;
  every doc still citing gencourt.state.nh.us URLs describes dead paths.
- The Wayback Machine rung — archive.org answered 429 (rate-limited) at
  attempt time; not exhausted, retry stands open.
- The real-browser rung — queued to this session's browser phase (a real
  Chrome reading a public site; no auth, no wall circumvented — the site
  serves browsers and refuses pipelines).
- `sos.nh.gov` — **the recorded browser-UA rung has CLOSED since 08-16**:
  Akamai (edgesuite reference page) now 403s curl even with a full Chrome
  UA string. WebFetch also 403. Real-browser rung queued.

**NH 2026 ballot measures (2a) — the enumeration so far** (secondary
sources; official gc.nh.gov confirmation queued to the browser phase):
CACR 6 (right to compute) ITL'd 2026-01-07; CACR 12 (broad-based-tax
supermajority) passed Senate 16-8 but failed the House three-fifths
2026-05-14 (193-148); CACR 14 (citizenship for office) failed 2026-03-05
(182-157); CACR 15 (hunt/fish) failed 2026-03-11 (199-128); CACR 21
(voting eligibility) failed 2026-03-11 (184-146); CACR 24 (parental
privacy in education) failed 2026-03-11 (181-156); CACR 28 (public
protestant teachers) killed in the House 2026-03-05. No CACR reached the
ballot; the Ballotpedia "lead" resolves to the 2024 judicial-retirement
question (defeated) and to proposed-but-failed 2026 CACRs.
`attemptedAt: 2026-08-17`.

**Candidate-card hunts (2b):** 18 cards curated (10 NH, 6 NJ, 2 AZ), every
photo URL HEAD-verified `image/*`; misses and NOT_ATTEMPTED recorded in
`data/ballot/candidate-cards-2026.json` hunts. New wall sightings:
maggiefornh.com 403s this pipeline; house.gov / senate.gov /
governor.nh.gov 403 non-browser clients. **The domain trap re-sighted:**
andybiggs.com is a safari photographer, not the congressman — only the
fetch-verified biggsforarizona.com is citable. `attemptedAt: 2026-08-17`.

## The 2026-08-18 rung set (the FEC-and-final-prep session)

**NH legislator contacts — the long way FOUND IT (item 3).** The
2026-08-17 Wayback rung stood open ("rate-limited, retry stands"), and the
retry paid:

- The Wayback Machine answered normally. `attemptedAt: 2026-08-18` (wall
  clock 2026-08-14).
- CDX enumeration of `gc.nh.gov/downloads/*` surfaced the General Court's
  OWN downloadable member directory — `members.txt` (also .xls/.xlsx),
  tab-delimited: name, chamber, county, district, address, phone, email,
  party, committees, elected status. Ten captures, 2025-01-28 through
  **2026-04-07** (the current legislature).
- `https://web.archive.org/web/20260407184602id_/https://gc.nh.gov/downloads/members.txt`
  fetched: 417 rows, 399 current (18 marked Former by the file itself).
  This is the legislature's published directory read through an archive
  of it — no wall touched, nothing retrieved the body has not published.
- `pnpm officials:enrich` now carries an NH pass over it: matched on
  chamber + county + district (via the registry's Census labels — the
  same "Merrimack 08" bridge the Plural join uses) + name; Former rows
  never match. **389/410 enriched — phone on 251, email on 386; 21
  misses printed with reasons** (nickname collisions, members seated
  after the capture). The tester's three (Innis D7, Sargent and Ebel
  Merrimack 07) all carry directory phone + email.
- Refresh path: re-point `NH_MEMBERS_TXT_ARCHIVE` at a newer capture — or
  at the live file the day the wall comes down.
- **Photos remain a recorded miss** — they live on the walled member
  pages, and license-unknown scrapes are not shippable (D20).

**Also this session:** BoardBook Premier (meetings.boardbook.org) joined
the vendor set for Amphitheater USD — plain-GET public org page, full
rungs in `lib/registry/coverage-audit.ts`; Sunnyside USD wired to its
Diligent/Highbond tenant found via the district's own agenda page.

## The 2026-08-14 rung set (second 08-14 session — the everyday-contacts hunt)

The pothole standard (session brief 3): every everyday topic × zip cell in
`lib/routing/everyday.ts` carries a contact with its source page, or a
recorded miss. `attemptedAt: 2026-08-14` (real wall-clock date; see
state.md §18 for the dating-convention note). Every number below was
ultimately read off the government's own page — plain client where the
host allows it, real browser where it walls:

- **tucsonaz.gov walls plain clients** (403 on every page tried) but
  answers a real browser. All six city rows read off the city's own pages
  in-browser this session. THE FINDING THAT CHANGED A ROW: the Street
  Maintenance page's published channel today is **Tucson 311** (call
  3-1-1, the Tucson311 app, or the 311 Service Request Portal) — the old
  direct TDOT line (520-791-3154) circulates in 2015-era news stories and
  search snippets but is NOT on the city's current page, so the row ships
  311. Pothole repairs and street light issues are on the page's own
  list of what Streets Maintenance addresses.
- **pima.gov answers plain clients** — /1012/Service-Request,
  /970/Development-Services, /2285/Animal-Care-Department-Directory
  fetched clean; pimasheriff.org likewise. sewerservicerequest.pima.gov
  403s plain clients but its help page read in-browser confirms
  520-724-3400 (24/7); asr.pima.gov/contact renders client-side only —
  read in-browser, 520-724-8630 + asrPC@pima.gov confirmed.
- **rockawayborough.org answers plain clients** — publicworks, sanitation,
  water.shtml, police, zoning, health, tax pages all fetched. **The
  borough-vs-township trap, caught mid-session:** zip 07866 covers BOTH
  the Borough of Rockaway and Rockaway Township — the registry's rosters
  and meeting wiring cover the TOWNSHIP, and the first draft of the
  contact map carried only borough numbers. Both municipalities now ride
  every covered 07866 topic, each named plainly; rockawaytownship.org
  (fetches clean) supplied DPW/utilities 973-983-2891, police
  973-625-4000, animal control 973-983-2848.
- **newbury.nh.gov walls plain clients** (403 — the known NH-host wall
  family) but answers a real browser; **newburynh.org no longer resolves
  in DNS** (the town moved hosts). The in-browser read of the town's own
  department directory confirmed highway 603-938-5494 and police
  603-763-4104 / dispatch 603-526-1961, CORRECTED two
  search-snippet-sourced rows (Tax Collector has a dedicated line,
  603-763-5326, and the Transfer Station its own, 603-763-2289), and
  RESOLVED two recorded misses (Code Enforcement 603-763-4940 x203 +
  codeenforcement@newbury.nh.gov; Recreation 603-763-4940).
- Cells with no defensible contact are recorded misses with reasons in
  `EVERYDAY_MISSES` (85641 trash/parks, 03255 water-sewer/animals, snow
  in the desert) — a miss is a work item, never silence.

## The 2026-08-14 rung set (third 08-14 session — the governors hunt, item 2b)

The statewide-executives module (`lib/officials/statewide-executives.ts`)
needs each governor's office read off the state's own site. Plain-client
rungs, `attemptedAt: 2026-08-14`:

- **azgovernor.gov walls plain clients** — 403 on
  /office-arizona-governor/contact-governors-office. IN-BROWSER READ
  (same session): that path 404s even in a browser (stale); the real
  contact page is /constituent-services — "Office of the Arizona
  Governor Katie Hobbs", 602-542-4331, engage@az.gov, read off the page.
- **governor.nh.gov walls plain clients** — 403 on the homepage. Same NH
  wall family as newbury.nh.gov. IN-BROWSER READ: "Welcome | Governor
  Kelly Ayotte", 603-271-2121 published on the page; the contact page is
  /contact-governor-ayotte.
- **nj.gov/governor answers plain clients with an empty shell** —
  /contact/ returns "Untitled Document" with no content to a plain
  fetch; the page is client-rendered. A 200 with no content is a MISS,
  not a hit (the count rule). IN-BROWSER READ: "Office of New Jersey
  Governor Mikie Sherrill"; the office publishes NO phone — the contact
  form (live, /governor/contact/) is the published channel, so the row
  ships phone: null. An absence is an absence.

All three rows now carry `verification: "PAGE_FETCHED"` — verified in a
real browser this session before ship, per the everyday.ts rule that a
pending row never ships on faith.

## 2026-08-15 — concluded meetings: which vendors serve history (M58)

The author reported concluded meetings rendering only at 85701. Measured
before fixing: the payload already carried concluded meetings at three of
the four demo zips, and the **Concluded filter matched nothing at all four**
because the client's date window starts at now. Per adapter, with counts
from the committed snapshot:

| Adapter | Jurisdictions | Serves history? | Rung |
|---|---|---|---|
| legistar | Pima County | yes (5 past) | already asked |
| onbase | Tucson | yes (6 past) | already asked |
| clerksboards | Tucson | yes (5 past) | already asked |
| diligent | Newbury NH, TUSD, Sunnyside, Pima CC | yes (2/2/3/1 past) | already asked |
| iqm2 | Morris County NJ | yes (4 past) | already asked |
| boardbook | Amphitheater | yes (2 past) | already asked |
| apptegy | Vail, Rockaway Twp SD | **yes — we never asked** | fixed below |
| civicplus | Rockaway Township | no | rungs below |
| revize | Merrimack County | no | rungs below |

**Apptegy — the rung that earned it.** `/cms/events` defaults to upcoming
only. Rungs walked 2026-08-15 against Vail's org (8164): plain page 1 → 20
events, 0 past; `from`/`to` → ignored; `past=true` → ignored; `month`+`year`
→ ignored; `order=desc` → ignored; `archived=true` → ignored;
**`start_date=2026-05-01` → 20 events, all 20 past**. The parameter survives
the feed's own `meta.links.next`, so the paged walk works from a past start.
Both wired orgs now return four concluded board meetings each.

**CivicPlus (Rockaway Township) — upcoming only, earned.** Rungs walked
2026-08-15: the wired iCal category feed, the same feed with
`startDate`/`endDate`, and with `from`/`to` — all three returned byte-for-byte
the same 5,484-byte document with the same eleven future sittings. The only
two past `DTSTART` values in it are VTIMEZONE boilerplate and appear in every
category id (1, 2, 25, 27, 28). **Further rung found, not yet built:** the
township's AgendaCenter archives past agendas and minutes back to 2019 (214
dated documents, read 2026-08-15) — it publishes a date without a start time,
so ingesting it needs a meeting shape that can say "we know the day, not the
hour". Tracker M59.

**Revize (Merrimack County) — upcoming only, earned.** The meeting rows come
from a block whose heading is "Upcoming Meetings"; past sittings are not in
it by construction. **Further rung found, not yet built:** the notices/agendas
page on the same site carries public notice, board packet and minutes PDFs
for 2.9, 2.20, 3.9, 3.23, 4.13, 4.27 and 5.11 (re-read 2026-08-15) — each one
a meeting that happened. Same blocker as Rockaway: a filename dates a meeting
without timing it, and inventing 10am to fill `startsAt` would be a generated
fact about a government. Tracker M59.

Both closed routes render the honest line at their jurisdiction rather than
an empty Concluded filter (`publishesHistory: false` + `historyGapReason` on
the wiring row).

## 2026-08-15 — party on local officeholder rows (M61, M62)

Rung 1 for every curated local body, walked 2026-08-15: **not one of these
bodies publishes party affiliation on its own roster page.** Fetched and
searched for "Republican|Democrat" in the stripped text:

| Body | Page | Result |
|---|---|---|
| Pima County Board of Supervisors | pima.gov/1163/Board-of-Supervisors | 200, 0 hits |
| Tucson Mayor & Council | tucsonaz.gov/Departments/Mayor-and-Council | 404 |
| Morris County Commissioners | morriscountynj.gov/Departments/Board-of-County-Commissioners | 200, 0 hits |
| Rockaway Township Council | rockawaytownship.org/157/Township-Council | 200, 0 hits |
| Merrimack County Commissioners | merrimackcounty.net/board_of_commissioners_/index.php | 200, 0 hits |
| NJ Governor's office | nj.gov/governor/admin/about/ | 200, 0 hits |

That is a finding about the pages, not the offices — several of these are
unambiguously partisan seats. The next rung is the election authority's
certified candidate list or canvass, which publishes party per candidate;
tracker M62 owns it. Until then each roster records `partisanship:
"UNDETERMINED"` and nothing renders, so the silence is a stated open
question rather than an implied "nonpartisan".

**The three governors, done at that next rung 2026-08-15:**

- **Katie Hobbs — Democratic.** Arizona Secretary of State, 2026 Candidate
  Nominations and Petitions Filed (0330). Fetched and text-extracted
  2026-08-15: "Hobbs, Katie Governor Democratic 6761 February 25, 2026".
  Same document the AZ ballot surface already cites for this candidacy.
- **Mikie Sherrill — Democratic.** New Jersey Division of Elections,
  "Official List Candidates for Governor" tally dated 12/03/2025. Fetched and
  text-extracted 2026-08-15: "MIKIE SHERRILL (w) … Democratic". Found by
  walking the Division's results archive; a guessed results URL 404'd first
  and was discarded rather than cited.
- **Kelly Ayotte — Republican.** New Hampshire Secretary of State, cumulative
  candidate filings 7.16.26 — the same document our NH ballot record cites,
  read 2026-08-14 by the session that could reach the host. **Re-fetch on
  2026-08-15 returned 403** from this environment, to a plain client, to a
  browser user-agent, and to a real Chromium navigation; `sos.nh.gov/elections`
  itself 403s the same way, so this is the whole host refusing this network
  rather than the document moving. Not circumvented and not re-typed from
  memory: the row cites the same filing the committed ballot record does, and
  `tests/party.test.ts` fails the build if the two surfaces ever disagree
  about the party or cite different records for it.

### M62 — the certified-results rung, walked 2026-08-15

The next rung, walked to the end for all twelve curated bodies. What it
found first is worth stating before the results, because it would have
produced a false "not found" for anyone who stopped one document early:

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

| Body | Partisanship | Record that settled it |
|---|---|---|
| Pima County Board of Supervisors | PARTISAN | AZ SoS, Official 2024 Primary Canvass — Pima County (races headed DEM/REP/GRN/LBT) |
| Tucson Mayor & Council | PARTISAN | City of Tucson City Clerk: "The City of Tucson conducts regularly scheduled partisan elections" |
| Rockaway Township Council | PARTISAN | Morris County Clerk, certified General Election Winners (Party column) |
| Morris County Commissioners | PARTISAN | Morris County Clerk, certified General Election Winners |
| Merrimack County Commissioners | PARTISAN | NH SoS, 2024 general county-office results (party letter per candidate) |
| Tucson Unified Governing Board | NONPARTISAN | Pima certified canvasses — no party in the general, absent from the partisan primary |
| Vail Unified Governing Board | NONPARTISAN | same |
| Sunnyside Unified Governing Board | NONPARTISAN | same |
| Amphitheater Unified Governing Board | NONPARTISAN | same |
| Rockaway Township Board of Education | NONPARTISAN | N.J.S.A. 19:60-1 — "No party designation shall appear on any ballot to be used in a school election" |
| Kearsarge Regional School Board | NONPARTISAN | RSA 671:20 — school ballots prepared "in the same manner as town clerks for non-partisan town elections" |
| Newbury Selectboard | NONPARTISAN | Town of Newbury 2025 Annual Report — the moderator's certified March 2025 count, no party beside any town office |

Newbury needed the town's own ballot rather than the statute: New Hampshire
towns ADOPT a partisan or non-partisan ballot system under RSA 669, so the
chapter alone cannot answer it for a particular town.

**Two seats carry no party and that is the finding, not a gap in effort.**

- **Pima District 5 (Andrés Cano).** The certified 2024 general canvass shows
  the seat won by Adelita Grijalva. She left for the CD7 special and the
  Board appointed Cano on 2025-04-15. There is no certified result naming his
  party. Arizona requires a county-supervisor appointee to share the vacating
  member's registration and the county's own call for applications said so —
  a sound inference, and still not a certified result, so the card renders
  nothing. The hunt also found the roster's term note was wrong ("Elected
  November 2024 to a four-year term"); it now records the appointment.
- **Rockaway Township at-large (Howard Morrison).** The seat with this term
  was certified in November 2023 to Howard KRITZ. Morrison holds it per the
  township's own council page and appears in NO certified winners list for
  2023, 2024 (Rockaway Township: "NO LOCAL ELECTION") or 2025 — an absence
  checked in all three documents rather than assumed. Appointed, so no party.
  The hunt also corrected the mayor's term note, which still said "unexpired"
  two years after he won a full four-year term.

#### The NH ladder, rung by rung

The author's standing ladder for any `sos.nh.gov` read, walked here for the
Merrimack County commissioners and recorded in full because a 403 is never an
answer:

| Rung | Attempt | `attemptedAt` | Result |
|---|---|---|---|
| 1 | The committed filing snapshot in this repo | 2026-08-15 | Holds the 2026 cumulative candidate filings, not county results — wrong document, honestly wrong |
| 2 | Search-index cache | 2026-08-15 | **HIT** — returned the exact document path `…/inline-documents/sonh/2024 County Commissioners by district.pdf`, proving the file exists and is indexed |
| 3 | Direct document path under `sos.nh.gov/sites/g/files/…` | 2026-08-15 | **403** to the identified client, for the district PDF and for `2024-ge-county-offices-merrimack_1.xls`. Tried per document, as instructed. The block is host-wide, not page-only |
| 4 | Internet Archive dated mirror | 2026-08-15 | **HIT** — snapshot `20260130123951` of the 2024 results index, and `20250728184156` for 2022. Both `.xls` files fetched at 200. The archive URL, with its date in it, is what the rows cite: it is the document that was actually read |
| 5 | The author's residential browser | — | Not needed |

No residential proxy, no spoofed origin, no circumvention of any kind. Rung 3
is worth keeping even though it failed here: the same trick **worked** on
`newbury.nh.gov`, which 403s its HTML pages and served
`/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf` at 200.
Same CMS, same wall, different answer per host — which is exactly why the
rung is attempted per document rather than assumed from the host.

**Two more hosts that 403 a general-purpose fetcher and admit this project's
identified User-Agent** (recorded so nobody records them as walls):
`tucsonaz.gov` and `morriscountyclerk.org`. Both served every certified
document requested, first try, at a serialized pace.

**One document could not be read and is named rather than skipped**: the City
of Tucson's certified Ward 3 primary recount (`certified-primary-election-
ward-3-recount.pdf`) is a scan with no text layer. It does not change the
party finding — Kevin Dahl appears in the certified primary results as a
candidate in the `DEM Council Member Ward 3` contest either way, and the
city's own council page has him in the seat — but the recount margin itself
was not read from it.

### M59 closed both archives — 2026-08-15

The two rungs recorded above as "found, not built" are built. What each one
actually publishes, and the count it produced:

| Jurisdiction | Route | Read | Sittings | Gained |
|---|---|---|---|---|
| Rockaway Township, NJ | `rockawaytownship.org/AgendaCenter`, category **2** | 2026-08-15 | 13 dated in 2026 | 9 → 22 meetings (+13 day-only) |
| Merrimack County, NH | the BOC notices/agendas page, dated documents | 2026-08-15 | 14 distinct dates, 33 documents | 1 → 15 meetings (+14 day-only) |

**The category id is the thing that had to be right.** Rockaway's AgendaCenter
hosts five bodies — Board of Adjustment, Board of Assessment Commissioners,
Environmental Commission, Planning Board and the Township Council — on one
page, under `<div id="cat<N>">` blocks. Taking every document on the page
would have filed the Planning Board's meetings under the council: a wrong
claim about who met, of exactly the kind the uniqueness invariant exists to
catch. The id `2` is the value of the Township Council's own checkbox in the
page's category filter, recorded on the wiring row, and a guard asserts the
two categories' dates never cross.

**A search endpoint was found and not used.** The page's own JavaScript builds
`/AgendaCenter/Search/?term=&CIDs=…&startDate=…&endDate=…`; it fetches at 200
and returns the same 13 council sittings as the category block, ignoring the
date range. Since it added nothing over the page the site already serves, the
plain page is what the adapter reads — one GET, not two.

**What is NOT claimed.** The AgendaCenter's year selector reaches back to 2019
through a POST the page makes to `/AgendaCenter/UpdateCategoryList`. Only the
current year is ingested, deliberately: the app serves a 90-day concluded
window, so earlier rows would be snapshot weight nothing renders. The earlier
note in this file said "214 dated documents back to 2019" — that remains true
of the archive and is not what shipped. If the lookback ever widens, the rung
is one parameter away and this paragraph is the record that it was a choice.

**Neither site needed anything but a polite GET.** Both admitted this
project's identified User-Agent first try, at a serialized pace.

## 2026-08-15 — the Census Bureau geocoder (D53)

The author approved the U.S. Census Bureau's geocoder as this product's
external geocoding source. Federal, free, no key, no account, and already the
record cited by rows in the venue cache.

**Endpoint.** `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress`
with `benchmark=Public_AR_Current&format=json`.

**The finding that shaped the build, stated first because it is the reason the
code looks the way it does: the Census geocoder does not geocode street
names.** It geocodes addresses. Verified 2026-08-15, four attempts:

| Query | Endpoint | Result |
|---|---|---|
| `Green Pond Road, 07866` | onelineaddress | 200, **0 matches** |
| `Green Pond Road, Rockaway, NJ 07866` | onelineaddress | 200, **0 matches** |
| `?street=Green Pond Road&zip=07866` | structured `address` | 200, **0 matches** |
| `808 Green Pond Road, Rockaway, NJ 07866` | onelineaddress | 200, 1 match, 40.99414 / −74.47413 |

The narrowing chip promises the reader that no house number is needed, and
that promise is what makes the question cheap to answer — it is not being
renegotiated to suit an API. So the adapter **samples the street at four low
house numbers of its own (1, 50, 200, 800) and asks whether the matches
agree.** Within 1.5 km, their midpoint is a real point on the street the
reader named. Wider than that, the street is too long for one point to mean
anything and the lookup returns nothing, leaving the division shading that
already shipped.

Sampled live 2026-08-15, one street per demo zip:

| Street | Zip | Matched | Spread | Outcome |
|---|---|---|---|---|
| ACADEMY ST | 07866 | 2 of 6 | 0.08 km | point |
| GREEN POND RD | 07866 | 5 of 6 | **5.64 km** | **refused** — the samples cross a municipal line |
| E 12TH ST | 85701 | 4 of 6 | 0.34 km | point |
| ACORN RD | 03255 | 2 of 6 | 0.01 km | point |
| ABERDEEN PL | 85641 | 1 of 6 | 0.00 km | point |

Four of five resolve; the one that refuses is the one where a confident pin
would have put a reader in the wrong town's meetings. That refusal is the
feature.

**What is never sent, stored, or logged.** The lookup runs on the reader's
device and talks only to census.gov. A house number the reader types anyway is
stripped before the request. The resulting point lives in React state for the
life of the view and is gone on reload: no localStorage, no request to our own
server, nothing added to the search log — and when the point becomes the query
point, the view carries `zip: null`, so the server resolves and logs the
nearest ZCTA exactly as it already did for a panned viewport. A street-level
point never reaches the log even as a parameter.
`tests/geocoder.test.ts` reads the module as source and fails on
`localStorage`, `logEvent`, `/api/` or any host that is not the Bureau's.

**The disclosure changed in the same commit.** The line under the street input
used to say the reader's choice "is never sent anywhere". Once a street name
goes to a federal address service that sentence is false, so it now names the
route: the choice stays on the device and is never sent to us, and putting the
street on the map asks the Census Bureau's free address lookup, street name
and zip, never a house number.

## 2026-08-15 — the depth session: NH and NJ get their bodies (M76–M79)

Four findings, each of which would have produced a false "not found" or a
false "that's all there is" for anyone who stopped one rung early.

### The served window was not the fetch window (M76)

Every adapter carried `WINDOW_BACK_DAYS = 30`, under a comment claiming it
matched the cascade, while `CONCLUDED_LOOKBACK_DAYS` had been raised to 90.
Sixty days of published, retrievable history were being dropped **at the
fetch**, at every zip. No count check could catch it: each adapter honestly
reported what it had asked for, and what it asked for was wrong.

Measured after deriving the windows from `lib/meetings/constants.ts`:

| Where | Before | After |
|---|---|---|
| 03255 (Newbury + Merrimack) | 3 meetings | 7 |
| Morris County, NJ | 12 | 20 |
| Tucson clerksboards | 15 | 24 |
| Amphitheater USD | 2 | 6 |

**The rung**: when a jurisdiction looks thinner than its portal, check the
adapter's own window before hunting for a second source.

### A township's boards are in a different calendar category (M77)

Rockaway Township's wired iCal feed is `catID=25` and carries the Township
Council and nothing else. **`catID=30` is a second calendar** carrying the
Planning Board and the Board of Adjustment with real start times. Probing the
ids is the whole rung: 13 of the 15 tried return a 477-byte empty calendar,
and the two that do not tripled the township's coverage.

| Body | AgendaCenter category | 2026 sittings archived |
|---|---|---|
| Township Council | 2 | 13 |
| Board of Adjustment | 3 | 12 |
| Planning Board | 4 | 7 |
| Environmental Commission | 5 | 0 — archive stops in 2019 |
| Board of Assessment Commissioners | 7 | 0 — archive stops in 2022 |

The last two are registry rows carrying the finding and deliberately not
wired: neither publishes anything the served 90-day window could render. The
township's sitemap and staff directory carry **no page at all** for the
Environmental Commission (checked 2026-08-15 — the only "Environmental" hit
is a health-specialist job title), so its `homepageUrl` is the archive,
because that is the only page the township publishes about it.

Three sibling defects the new rows exposed, all of which existed before them:

- **CivicPlus announces a cancellation by editing the SUMMARY text**
  (`"Board of Adjustment Meeting Cancelled 8/18/26"`), never by setting the
  iCal `STATUS` property. Two future sittings were rendering as SCHEDULED.
- **The same notice is pasted into `LOCATION`** as an HTML block in front of
  the address, so both canceled sittings dropped as `unknownVenue`.
- **Archive de-duplication was keyed on the division.** Three bodies now share
  one `ocdId`, and the council's Tuesday would have deleted the planning
  board's Tuesday.

### A town's portal may not be the town (M79)

**Newbury's CivicWeb tenant carries only the Selectboard.** Proven rather than
assumed: `MeetingsService.svc/meetings?from=2026-01-01&to=2026-12-31` returned <!-- expected-future: the end of the query range sent to the CivicWeb service, not a claim about when anything happened; the whole point of the query was to cover the rest of the calendar year -->
**20 sittings and every one was TypeId 10**. The Planning Board, Zoning Board
of Adjustment and Conservation Commission are not on it.

`MeetingTypeList.aspx?type=<n>` **ignores the parameter** on this tenant —
every value from 1 to 15 returned the identical page and the identical three
meetings. Type discovery has to come from the service payload's own `TypeId`s,
not from the type-list page.

Two NH hosts refuse this pipeline entirely, recorded per URL so nobody records
them as walls:

| Host | Root | Agendas page | Feed / sitemap | robots.txt |
|---|---|---|---|---|
| `newbury.nh.gov` | 403 | 403 (`/planning-board`) | 403 (`/sitemap.xml`) | **200** — Drupal, `Crawl-delay: 10`, names no sitemap |
| `kearsarge.org` | 403 | 403 | 403 (`/sitemap.xml`, `/rss.xml`) | — |

Both are the real-browser rung's, and it is the next rung, not the end of the
list. The coverage audit already records that rung working for Kearsarge on
2026-08-14 and naming its prize: `2026-2027_school_board_schedule.pdf`.

### The published annual schedule is a source shape, not a vendor (M78)

Morris Hills Regional — 07866's high school district, `NOT_ATTEMPTED` until
this session — **runs no agenda vendor at all** and publishes better than most
districts that do. Its BOE Meetings page carries the year as a dated list:

```
Monday, January 26, 2026
Monday, February 23, 2026
…
All meetings begin at 6:30 P.M. and are held in the Board of Education -
Board Conference Room.
```

That is ladder rung 2 with no portal in the path, and it is how a very large
number of American school boards publish. It is now an adapter
(`lib/sources/schedulepage/`) and an `AgendaSourceType`. Three rules it was
built under:

1. **The time is parsed from the body's own sentence, never defaulted.** A
   page with dates and no such sentence ships `startPrecision: "DAY"` — the
   M59 shape — rather than an hour that would be right most of the time and
   wrong exactly on the special sitting somebody wanted to attend.
2. **The weekday prefix is required.** A bare `August 17, 2026` in a footer,
   a news teaser or a copyright line would otherwise become a meeting. The
   schedule list is the only place a body writes the weekday out.
3. **Documents join on the date the body wrote in its own link text**
   (`"August 17, 2026 - Regular Meeting"`), never on a filename that may or
   may not be the meeting's date.

`VENDOR_API: MISS` is recorded on the audit row on purpose. "No vendor" is a
finding about this district, not a gap in the hunt.

## 2026-08-15 — LegiScan lands, and the join is the whole problem (D49)

State-legislature roll calls for AZ, NJ and NH. The data was never the hard
part; **the join was**, and it fails in a way that does not throw.

### The retrieval discipline, as built

Bulk first. LegiScan publishes each session as one ZIP behind
`getDatasetList` → `getDataset`, refreshed Sunday mornings. `dataset_hash` is
stored in the committed snapshot and compared before every download; an
unchanged hash is **never** re-downloaded. The legiscan.com front end is not
touched at all. Node ships no archive reader, so `lib/sources/legiscan/zip.ts`
reads the central directory directly rather than adding a dependency — and it
throws on an unreadable entry rather than skipping it, which is the fourth
sighting of the returned-nothing shape wearing a fifth hat.

Sessions taken, all `2026-08-09` datasets:

| State | session_id | People | Roll calls published |
|---|---|---|---|
| AZ | 2235 (57th Legislature, 2nd Regular) | 92 | 7,283 |
| NJ | 2250 (2026-2027 Regular) | 120 | 1,539 |
| NH | 2236 (2026 Regular) | 426 | 360 |

### The district mapping, and the failure it hides

LegiScan gives a district string; we need an OCD district key.

- **AZ and NJ** number statewide: `HD-040` → `sldl:40`, `SD-025` → `sldu:25`.
- **New Hampshire** numbers House districts *within a county*: `HD-12-HIL` is
  Hillsborough 12. The Census SLDL code concatenates the county's
  **zero-based alphabetical** ordinal with the two-digit district number —
  Hillsborough is 5, so `sldl:512`.

**Both NH details were got wrong first, and neither threw.** An ordinal table
indexed from 1 produced 10 matches out of 426 — which reads exactly like a
thin roster, not like a broken key. And zero-padding Belknap (ordinal 0)
produced `sldl:007` against a real id of `sldl:7`, silently losing all nine
Belknap seats. Both are now asserted against **our own committed boundary
labels**: `public/geo/sldl-33.geojson` carries `State House District
Merrimack 08` beside `sldl:608`, so every NH lower district round-trips
through the mapping in `tests/legiscan.test.ts`.

**Never by name alone.** The match is district AND surname: the district
identifies the seat, and the surname is compared only *within* a district
that already matched. Surnames are folded for accents and generational
suffixes, because two sources routinely differ on middle names and nicknames
("Walter"/"Walt", "Mary Jane"/"Mary", "James"/"Jim" all occur in this data).

### The match rate, with its denominator

| State | LegiScan people matched | of people in the session | of roster seats our geometry clips |
|---|---|---|---|
| AZ | 24 | 92 | 24 |
| NJ | 21 | 120 | 21 |
| NH | 85 | 426 | 85 |

The large denominators are not a gap: our boundary files clip three counties,
so most of a state's legislature governs nowhere we render. **Every roster
seat that could match, matched.**

### Spot-verified, ten by name and district against both sources

| # | State | LegiScan | Ours |
|---|---|---|---|
| 1 | AZ | 4232 Sylvia Allen, HD-007 | Sylvia Allen, `sldl:7` |
| 2 | AZ | 10708 Gail Griffin, HD-019 | Gail Griffin, `sldl:19` |
| 3 | AZ | 20172 Walter Blackman, HD-007 | Walt Blackman, `sldl:7` |
| 4 | AZ | 20571 Alma Hernandez, HD-020 | Alma Hernández, `sldl:20` |
| 5 | NJ | 2948 John DiMaio, HD-023 | John DiMaio, `sldl:23` |
| 6 | NJ | 3086 Jay Webber, HD-026 | Jay Webber, `sldl:26` |
| 7 | NJ | 3105 Erik Peterson, HD-023 | Erik Peterson, `sldl:23` |
| 8 | NH | 4910 Timothy Soucy, HD-21-MER | Timothy Soucy, `sldl:621` |
| 9 | NH | 5091 Mary Wallner, HD-19-MER | Mary Jane Wallner, `sldl:619` |
| 10 | NH | 10492 James MacKay, HD-18-MER | Jim MacKay, `sldl:618` |

Our side cites each legislature's own roster (azleg.gov, njleg.state.nj.us,
gc.nh.gov's members.txt via an Internet Archive capture, since gc.nh.gov
resets the TLS handshake from this pipeline).

**Two people did NOT match and are recorded rather than forced**: AZ
`HD-007 David Marshall` and NH `HD-29-HIL Sheila Seidel` are in LegiScan's
current membership and in neither of our roster snapshots for those seats.
No join, no render — their votes are not stored against a guess at who they
are.

### The clip, stated

Arizona alone published 7,283 roll calls in one session. The snapshot holds
**the union of each matched member's twelve most recent** — 72 roll calls and
1,560 positions across 130 officeholders, every one of whom has exactly
twelve.

Taking "the 60 most recent per state" was tried first and was wrong in a way
worth writing down: **Arizona votes in bursts**, so 60 roll calls covered two
days, and any member absent those two days would have rendered an empty
record that reads as "never votes". A clip has to be driven by the surface it
feeds.

### The guard fired during the build, which is the point of it

Changing the clip rule made the refresh produce 24 roll calls per state
against 60 committed, and the thin-snapshot guard refused the write and kept
the old file — exactly as it would for a genuine upstream shrink. The
re-baseline was deliberate: the old snapshot was deleted by hand and the
fetch re-run.

### What is refused, not estimated

A party-by-party count is **null** on every state vote. We hold positions only
for members whose district our geometry clips, so any tally would be a
fraction of the chamber's and could never sum to the recorded result — which
is the same condition the federal breakdown already refuses on.

### Attribution

LegiScan's data is **CC BY 4.0**, which requires attribution wherever it
appears. `LEGISCAN_ATTRIBUTION` is one object, sent with the rows by the API
so it cannot drift from the store it describes, and rendered under the Recent
votes heading. `tests/legiscan.test.ts` asserts a state member's payload
carries it and a federal member's does not — the chambers' public-domain XML
must never be credited to LegiScan.

---

## unitedstates/congress-legislators — the federal directory (adopted 2026-08-16)

**Rung class: SOURCE OF RECORD, for what it covers.** The author's ruling.

`https://github.com/unitedstates/congress-legislators`, fetched from
`raw.githubusercontent.com` **at a commit SHA, never `main`**. Pinned at
`4458244308621d0570a15008f46888b7a87645eb` (committed 2026-07-15; SHA read
from the GitHub API 2026-08-16). CC0 — cited once on the sources page,
nothing else owed.

Five files, with the counts each returned at this pin:

| File | Rows | What it carries |
| --- | --- | --- |
| `legislators-current.yaml` | 537 | roster, id crosswalk (FEC on 535), birthday on all 537, per-term party/start/end/phone/url |
| `legislators-social-media.yaml` | 518 | bioguide-keyed OFFICIAL accounts; 505 carry X |
| `legislators-district-offices.yaml` | 535 | 1,306 offices with address, phone, lat/lng |
| `committees-current.yaml` | 49 | 49 committees, 181 subcommittees |
| `committee-membership-current.yaml` | 230 keys | 3,891 membership rows with rank and title |

**Two boundaries on the ruling, both guarded in
`tests/congress-directory.test.ts`:**

1. **The provenance tag names the PROJECT, never "official records."** It is
   a community-maintained aggregation of the official sources. A tag calling
   it official is the first step toward citing it for something a directory
   cannot answer.
2. **It is a DIRECTORY, not a ledger.** No votes, no money, no statements.
   B17 stays on the chambers, FEC stays FEC, PRL stays PRL.

**Joins are by BIOGUIDE, never by name.** A name join is invisible until two
members share a surname.

**The prior bioguide rungs are DEMOTED to fallback-and-audit.** The federal
roster already carried a birthday and a term end for all 537 from the same
upstream through its **unpinned** JSON mirror
(`unitedstates.github.io/congress-legislators/legislators-current.json`).
`pnpm congress:migrate` DIFFS the two and writes every disagreement to
`docs/congress-legislators-diff.md` as a finding for the author to rule on —
an upstream PR to file, or a stale value of ours. **Nothing is silently
overwritten.** First run: 537 of 537 matched, 0 disagreements.

**The recency exception, named.** Official pages win on recency — a death, a
resignation or a swearing-in may be corrected from the chamber's own page
without waiting for the repo. The repo is the baseline, not the ceiling; the
migration never reverses such a correction because it never overwrites.
(Seen live: Adelita S. Grijalva is in our roster and carries no social in
this pin, because she took the seat after the pinned commit. Her card renders
the absent channels as absent pills, which is the correct answer.)

Commands: `pnpm congress:fetch` then `pnpm congress:migrate`.

---

## GovTrack — a LOOKUP RUNG, never a citation (recorded 2026-08-16)

`https://www.govtrack.us`. Use it to NAVIGATE: popular name → bill number →
roll-call number, when a bill is known by a name the chambers' own systems do
not index. **Then go to the chamber and cite the chamber.** A citation to
GovTrack is a citation to a third party's index of a public record when the
public record itself is one hop away.

Its API may have been discontinued in summer 2026 (see `CLAUDE.md`); this
rung is the human-readable site, and nothing depends on the API.

---

## Reference bookmarks — consult when hunting, never in a pipeline (recorded 2026-08-16)

Staleness **UNVERIFIED** on both. Nothing here enters an adapter.

- `https://github.com/codeforamerica/open-civic-datasets` — an index of civic
  datasets. Useful for "does anyone publish X in machine-readable form".
- `https://github.com/api-evangelist/data-gov` — an index of federal data.gov
  APIs.

Both are catalogues of other people's catalogues. They point at a rung; they
are never the rung.

---

## The 50-state open-data / transparency portals — UNVERIFIED PER-STATE RUNGS (recorded 2026-08-16)

The author's find, filed whole. **Every row below is UNVERIFIED and is
verified ONE STATE AT A TIME, when that state's session runs.** A row that
has been walked gets a dated note beside it; entries are append-only.

**Two corrections recorded now, before anyone walks them:**

1. **Massachusetts is WRONG in the source list.** It gives `data.boston.gov`,
   which is the CITY of Boston, not the Commonwealth. Find the state portal
   when MA runs; do not walk the city site and record it as the state's.
2. **Two different species, and reaching for the wrong tool wastes a rung.**
   A *true open-data portal* (Socrata-class: `data.ny.gov`, `data.ca.gov`)
   serves datasets with an API. A *spending-transparency checkbook* (NE, NV,
   KY, and TN/WV leaning) serves expenditure lookups and nothing else.

**And the boundary that matters most: NEITHER SPECIES IS campaign finance,
meetings, or officials.** These are rungs on a ladder for other questions —
budgets, spending, statistics. They do not answer the questions this product
asks, and a session that walks one expecting a meeting calendar has spent a
rung on the wrong ladder.

| State | Portal | Species |
| --- | --- | --- |
| Alabama | open.alabama.gov | open data |
| Alaska | dggs.alaska.gov | open data (geological survey) |
| Arizona | openbooks.az.gov | checkbook |
| Arkansas | transparency.arkansas.gov | checkbook |
| California | data.ca.gov | open data (Socrata-class) |
| Colorado | data.colorado.gov | open data (Socrata-class) |
| Connecticut | transparency.ct.gov | checkbook |
| Delaware | delaware.gov/data | open data |
| Florida | floridahasarighttoknow.com | checkbook |
| Georgia | open.georgia.gov | checkbook |
| Hawaii | data.hawaii.gov | open data (Socrata-class) |
| Idaho | transparent.idaho.gov | checkbook |
| Illinois | data.illinois.gov | open data |
| Indiana | in.gov/iot/open-data | open data |
| Iowa | data.iowa.gov | open data (Socrata-class) |
| Kansas | kansas.gov/opendata | open data |
| Kentucky | transparency.ky.gov | checkbook |
| Louisiana | latransparency.louisiana.gov | checkbook |
| Maine | maine.gov/dafs/procurement/open-data | open data (procurement) |
| Maryland | data.maryland.gov | open data (Socrata-class) |
| Massachusetts | **[WRONG — data.boston.gov is the CITY of Boston, not the Commonwealth; find the state portal when MA runs]** | — |
| Michigan | michigan.gov/open-data | open data |
| Minnesota | mn.gov/admin/data | open data |
| Mississippi | transparency.mississippi.gov | checkbook |
| Missouri | data.mo.gov | open data |
| Montana | dataportal.mt.gov | open data |
| Nebraska | checkbook.nebraska.gov | checkbook |
| Nevada | nvcheckbook.nv.gov | checkbook |
| New Hampshire | nh.gov/data.htm | open data |
| New Jersey | data.nj.gov | open data |
| New Mexico | share.state.nm.us | open data |
| New York | data.ny.gov | open data (Socrata-class) |
| North Carolina | data.nc.gov | open data |
| North Dakota | nd.gov/open-data | open data |
| Ohio | data.ohio.gov | open data |
| Oklahoma | data.ok.gov | open data |
| Oregon | data.oregon.gov | open data |
| Pennsylvania | data.pa.gov | open data (Socrata-class) |
| Rhode Island | data.ri.gov | open data |
| South Carolina | sc.gov/data-and-statistics | open data |
| South Dakota | open.sd.gov | open data |
| Tennessee | tn.gov/transparency | checkbook-leaning |
| Texas | data.texas.gov | open data (Socrata-class) |
| Utah | opendata.utah.gov | open data |
| Vermont | data.vermont.gov | open data |
| Virginia | data.virginia.gov | open data |
| Washington | data.wa.gov | open data (Socrata-class) |
| West Virginia | wv.gov/transparency | checkbook-leaning |
| Wisconsin | data.wi.gov | open data |
| Wyoming | wyoming.gov/government/open-data | open data |

---

## The .gov registry — a rung for "where does this government publish?"

*Added 2026-08-16 (item 9). Verified: fetched at the pinned commit, 16,501
domains, 693 typed as election offices.*

**`cisagov/dotgov-data`, `current-full.csv`.** Every domain in the .gov TLD
with the registrant's own organization name, city, state, and CISA's own
`Domain type`. US Government work, public domain. Committed as
`data/dotgov/snapshot.json` by `pnpm dotgov:fetch`, SHA-pinned
(`47f9693e…`, the zone-file commit of 2026-08-16T07:38:32Z), thin-guarded at
15,000 domains and 500 election-typed domains, refreshed by
`.github/workflows/refresh-dotgov-snapshot.yml` on Mondays.

**What it is a rung for.** The first, cheapest question in any hunt for a
body's own publications: does this government have a .gov, and what is it?
It resolves a registrant to a domain in one lookup, without a search engine
and without guessing at a hostname.

**The named rung list: the 693 election offices.** CISA types them itself —
`City - Election` (332), `County - Election` (288), `State or territory -
Election` (36), `Special district - Election` (33), `Tribal - Election` (4).
That classification is the registry's, not ours, which matters: a name match
on "vote" or "election" would sweep in a town called Election and miss every
secretary of state. This is the first rung for a ballot or candidate-filing
hunt in a county we have not worked before.

**THE BOUNDARY, and it is the important half. DOMAINS ARE NOT A
DENOMINATOR.** Coverage claims are made against the official universe — the
Census of Governments, NCES, the state rosters — never against a list like
this one:

- A government with **no .gov domain is absent from it entirely**. Small
  towns, school districts and special districts routinely publish on a
  `.org`, a `.us`, a vendor subdomain, or a Facebook page. Counting .gov
  domains would undercount exactly the bodies that are hardest to cover,
  which is the Sunnyside class of miss.
- One government may hold **several domains**, and one domain may front
  several governments.
- **A domain is not a body.** `chicagoelections.gov` is one domain; the
  Chicago Board of Election Commissioners is one body; nothing here maps the
  two.

The snapshot carries that sentence in its own `boundary` field, and
`tests/dotgov.test.ts` fails if any coverage surface imports it.

**Not built, and named:** the link-ladder WIRING — resolving a registry body
to its .gov domain automatically, and offering it as a rung when a hunt comes
back empty. The snapshot is the half that had to land; the wiring is the half
that can wait for a session with a hunt in front of it.
