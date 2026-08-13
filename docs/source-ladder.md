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
