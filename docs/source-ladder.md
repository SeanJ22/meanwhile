# The source ladder

**WHAT THIS FILE IS** (header corrected 2026-08-20, Prompt C item 6.3): it is
the **EVIDENCE**. Roughly 1,900 lines of per-body hunt records — every rung
walked, every miss with its URL and its date, every wall named and every wall
that fell. It is not "the method"; the header said that for a week and it was
wrong, and a reader who believed it went looking for the evidence somewhere
else.

`lib/registry/coverage-audit.ts` carries the machine-readable per-body records
that overlay onto the registry at build. **Both are evidence.** This one is
where a human reads what actually happened; that one is where the product does.
Neither is a summary of the other, and this document is not being migrated into
it — **this is not a final structure and it is expected to keep adjusting.**

**THE NUMBERED LIST OF THIRTEEN THAT USED TO BE HERE IS RETIRED IN PLACE**
(2026-08-20, RULING 16 in `docs/rulings.md`).

Two ladders existed in this repo and both were numbered:

- **`CLAUDE.md`'s fourteen rungs** — the RETRIEVAL-MECHANICS ladder. How to get
  bytes past a wall. Its numbering is the one that reaches the database as
  `walledAtRung`, and it is **canonical**.
- **The thirteen that lived here** — a DISCOVERY ladder. Where a document
  lives. A different question entirely.

So "rung 7" in a throw site and "rung 7" in this document were different rungs,
and nothing in either file said so. The thirteen now live in
`docs/zip-playbook.md` §2 as a **lettered** ladder, A through M — lettered
precisely so the collision cannot come back. Nothing was lost: every rung moved
with its examples intact.

Rung values recorded in this file's hunt records BEFORE F22 (2026-08-20) are
**provenance-unknown** and are marked as such rather than reinterpreted, per
RULING 17. F22 is the session that made throw sites name their rung in the
canonical numbering; guessing which ladder an older number meant would
manufacture a retrieval history nobody walked.

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

## Where the rungs are now

- **Retrieval mechanics, numbered 1–14:** `CLAUDE.md`, "THE LADDER,
  EXHAUSTIVELY". Canonical. The only numbered ladder.
- **Discovery, lettered A–M:** `docs/zip-playbook.md` §2.
- **Per-jurisdiction-type first moves:** `docs/zip-playbook.md` §2, same
  section.
- **Rungs invented and verified, by session:** below in this file, unchanged.

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
  portraits. The shared portrait verifier checks the native person binding,
  saved source evidence and decoded image under rulings §3, then publishes
  the immutable image through the existing portrait endpoint.

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

### M62 — the certified-results rung, walked 2026-08-15 — the evidence

**The RECIPE is `docs/zip-playbook.md` §3, "The party recipe (M62, 2026-08-15) — verbatim from the session that found it", and it is not
restated here.** This section is the EVIDENCE behind it: which body, which
URL, which date, which numbers came back. Two copies of one rule can drift
apart, and one pair already had.


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

### The served window is the fetch window (M76) — the evidence

**The RECIPE is `docs/zip-playbook.md` §3, "The served window is the fetch window (M76, 2026-08-15)", and it is not
restated here.** This section is the EVIDENCE behind it: which body, which
URL, which date, which numbers came back. Two copies of one rule can drift
apart, and one pair already had.

> **The two copies disagreed, and this is the resolution** (2026-08-20,
> Prompt C item 7.3). This section was titled *"The served window was NOT the
> fetch window"* — the defect, in the past tense — while the playbook titled the
> same finding *"The served window IS the fetch window"* — the rule, in the
> present. Same body text, opposite headings, and only this copy carried the
> measurement table. **The playbook's title survives** as the finding's name,
> because the playbook's job is the standing rule a later session applies. This
> heading now names what this section actually is: the evidence behind it.


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


### A township's boards are in a different calendar category (M77) — the evidence

**The RECIPE is `docs/zip-playbook.md` §3, "CivicPlus: the boards live in a different calendar category (2026-08-15)", and it is not
restated here.** This section is the EVIDENCE behind it: which body, which
URL, which date, which numbers came back. Two copies of one rule can drift
apart, and one pair already had.


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

### A town's portal may not be the town (M79) — the evidence

**The RECIPE is `docs/zip-playbook.md` §3, "A town's portal may not be the town (2026-08-15)", and it is not
restated here.** This section is the EVIDENCE behind it: which body, which
URL, which date, which numbers came back. Two copies of one rule can drift
apart, and one pair already had.


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

### The published annual schedule is a source shape, not a vendor (M78) — the evidence

**The RECIPE is `docs/zip-playbook.md` §3, "The published annual schedule (2026-08-15)", and it is not
restated here.** This section is the EVIDENCE behind it: which body, which
URL, which date, which numbers came back. Two copies of one rule can drift
apart, and one pair already had.


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

### The district mapping, and the failure it hides — the evidence

**The RECIPE is `docs/zip-playbook.md` §3, "State roll calls: LegiScan, and the join that fails silently (2026-08-15)", and it is not
restated here.** This section is the EVIDENCE behind it: which body, which
URL, which date, which numbers came back. Two copies of one rule can drift
apart, and one pair already had.


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
labels**: `data/states/nh/geo/sldl-33.geojson` carries `State House District
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

### The clip, stated — the evidence

**The RECIPE is `docs/zip-playbook.md` §3, "Let the surface drive the clip (2026-08-15)", and it is not
restated here.** This section is the EVIDENCE behind it: which body, which
URL, which date, which numbers came back. Two copies of one rule can drift
apart, and one pair already had.


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

The recorded comparison at this pin matched all 537 members to the
previously held JSON export, with zero disagreements.

The standing source contract runs the Congress directory script with
`node --experimental-strip-types scripts/fetch-congress-legislators.mts --promote`.
It resolves the current upstream commit, reuses immutable source
captures and publishes through the routine civic data pipeline. Optional
contact, office, social, committee and portrait facts publish independently;
a failed update retains the last verified value and its source date.

The counts above describe the recorded source revision. Current membership
comes from the promoted directory and its explicit as-of date. Official
sources take precedence under rulings §3.

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
`Domain type`. US Government work, public domain. The standing runner now owns
the monthly canonical `dotgov` production-data contract: it resolves the
publisher's current commit, fetches `current-full.csv` at that exact SHA,
thin-guards at 15,000 domains and 500 election-typed domains, and durably
receipts and promotes the candidate with LKG retained on refusal. The tracked
`data/dotgov/snapshot.json` preserves the SHA-pinned 2026-08-16 acquisition
(`47f9693e…`) as bundled first-bootstrap evidence only. The former
`pnpm dotgov:fetch` tracked writer and
`.github/workflows/refresh-dotgov-snapshot.yml` clock are retired and deleted.

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

---

## 2026-08-19 (g20) — the Polarization Research Lab, D62

**The subject.** America's Political Pulse, the Polarization Research Lab at
Dartmouth. D62 owed three things before a byte was fetched: the licence read
verbatim off the data page through the ladder, a coverage table, and both
join rates with denominators. All three are below.

**What the walk had to get past.** The data pages are a JavaScript-rendered
single-page app. Reading a plain fetch of them as "nothing published" would
be a FALSE MISS, not a wall — the rung that clears it is the page's own
bundle, and the bundle turned out to be better than the rendered page anyway,
because it carries the file list and both citation strings as literals.

| Rung | Attempt | `attemptedAt` | Result |
|---|---|---|---|
| 2 | Plain fetch, identified UA — `https://americaspoliticalpulse.com/data/` | 2026-08-19 | **200, 2,977 bytes.** A shell: `<div id="root">` and nothing in it. No licence text, no file list. A false miss if believed. |
| 2 | Plain fetch — `https://polarization-research-lab.github.io/americas-pulse-dashboard/tabs/download.html` (the URL a search engine still indexes) | 2026-08-19 | **404.** A stale path, recorded so it is not re-walked. |
| 7 | **The page's own JS bundle** — `/assets/index-BAigJC-u.js`, then the lazily-loaded route chunks it names | 2026-08-19 | **HIT.** 245,842 bytes; it lists 40 route chunks by name, including `Data-*` and `ElitesData-*`. |
| 7 | `/assets/Data-DDCbAhag.js` | 2026-08-19 | **HIT.** Carries the Open Data page's licence sentence and citation as string literals. |
| 7 | `/assets/ElitesData-CjtVgNhS.js` | 2026-08-19 | **HIT.** Carries the congressional-rhetoric licence sentence, its own citation, and all four dataset URLs with their sizes. |
| 7 | `/assets/PrimaryCandidate-CiA2qO-T.js` | 2026-08-19 | **HIT.** Names the API the primary pages call: `GET https://7brsvfk435.execute-api.us-east-1.amazonaws.com/primary/statements/{fecCandidateId}`. |
| 9 | The data file itself — `/data/elite/profiles-all-national.zip` | 2026-08-19 | **HIT.** 321,911 bytes, one deflate member, 1,974,648 bytes of CSV. |

**The licence, verbatim, from the page's own code.**

- Open Data page: *"All data is provided under a"* → link to
  `https://creativecommons.org/licenses/by/4.0/` → *"Creative Commons
  Attribution 4.0"* → *"license."*
- Congressional rhetoric page: *"All data is provided under a Creative
  Commons Attribution license."* — **no version named on this page.** Recorded
  as read rather than upgraded to 4.0 from the other page's wording.

**Two citation strings, and they are not interchangeable.** D62's row
recorded one; the files this build uses want the other.

- Survey / Open Data: `Westwood, S. J., & Lelkes, Y. (2024). America's
  Political Pulse [Data set]. https://americaspoliticalpulse.com/data`
- Congressional rhetoric: `America's Political Pulse. (2024). Congressional
  Rhetoric Dataset. Available at: https://americaspoliticalpulse.com/elites/data`

Both are in `lib/sources/prl/types.ts`, so the difference is a fact in the
code rather than something a later session rediscovers by shipping the wrong
one under a licence whose only condition is attribution.

**The files, as the page lists them today** (D62's row recorded different
sizes from 2026-08-15 — these are the ones read on 2026-08-19):

| File | Size | Taken? |
|---|---|---|
| `/data/elite/profiles-all-national.zip` | 317 KB | **yes** — the v1 build |
| `/data/elite/profiles.zip` | ~5 MB | no |
| `/data/elite/rhetoric-all.zip` | ~100 MB | no |
| `/data/elite/rhetoric-all-national.zip` | 461 MB | no |

Taking the small one is deliberate: v1 renders aggregates, and pulling half a
gigabyte to recompute numbers the lab has already computed would be rude to a
source that gives its work away.

**Coverage, from the file itself.**

- 906 rows, 51 columns.
- **536 of 906** carry at least one classified statement.
- Statement counts across those 536: min 4 · median 8,116 · max 61,624.
- `communication_last_update` is **2026-08-16** on every row — one distinct
  value, three days before this read.
- 543 of 906 carry a `date_of_birth`, which is D62's named rung for the age
  line.
- **17 columns are ranks, percentiles or an ideology score.** None crosses
  the boundary; the adapter reads an allowlist and refuses on any of them.

**Join rate 1 — our roster → PRL, by bioguide.** **537 of 537, 100%.** Every
federal officeholder we hold has a PRL row. One of the 537 (`V000139`) has a
row with nothing classified, so 536 profiles are kept and that one is named
in `rosterMisses` rather than dropped.

**Join rate 2 — our funding rows → PRL, by FEC candidate id.** **5 of 24.**
The profiles file is current and former MEMBERS; our funding snapshot is
mostly 2026 ballot candidates, most of whom have never sat. This is the
expected shape and not a defect — it is also exactly why the primary
endpoint matters, since challengers are the thin-candidate problem.

**The primary endpoint, probed.** `GET /primary/statements/{fecCandidateId}`
on the API named in the bundle, five of our own ballot candidates:

| FEC id | HTTP | Rows |
|---|---|---|
| `H2NH02260` Lily Tang Williams | 200 | 20 |
| `S6NH00166` Scott P. Brown | 200 | 20 |
| `H6AZ06099` JoAnna Mendoza | 200 | 20 |
| `H6AZ07121` Adelita S. Grijalva | 200 | **0** |
| `S6NH00141` Chris Pappas | 200 | **0** |

**Two things recorded rather than assumed.** A 200 carrying zero rows is the
empty-success shape and is NOT a hit — three of five is the honest reading,
and the two zeros are unexplained rather than "no statements". And the
response carries **no total**: 20 is what came back and there is no field
saying whether 20 is all of them. D62's "Posts tracked: N as the DENOMINATOR"
adoption therefore has no source on this endpoint, which is a real blocker
for rendering any share off it and is why v1 renders the profiles file only.

---

## Voting locations, per covered jurisdiction — g21, 2026-08-19 (B19 / B16)

Every retrieval below is the JURISDICTION'S OWN election authority. No
aggregator supplied a location; Vote411 and the secretary-of-state portals
were used only to find what the authority publishes, which is what the
author's ruling permits them for.

**306 sites across 44 jurisdictions — 41 with sites, 3 recorded as refusals
with their rungs in the retained bootstrap evidence.** `pnpm
voting-sites:fetch` now submits an owner-invoked candidate to the permanent
civic-data plane. Each authority scope either advances from current official
bytes or retains its prior GOOD rows with a durable refusal; it never rewrites
the tracked bootstrap file or triggers a software release.

### Arizona — Pima County: HIT at rung 8 → 12 → 7

| Rung | Attempt | Result | Attempted |
|---|---|---|---|
| 2 | `recorder.pima.gov` | 302 → 200; `EarlyVotingSites.aspx` carries no site list between elections, `PollingLocationSearch.aspx` is an address→district form | 2026-08-19 |
| 10 | `gisopendata.pima.gov` DCAT + item search, 190 datasets | Voter Precincts and Justice Precincts as boundaries; **no location dataset** | 2026-08-19 |
| 8 | `www.pima.gov/3199/Pima-Votes` embedded CivicPlus widget JSON | HIT — a `Voting Locations` button naming an ArcGIS Experience Builder app | 2026-08-19 |
| 12 | `arcgis.com/sharing/rest/content/items/21445fb1…/data` | HIT — the app config, owner `julia.jones@pima.gov_Pima`, org `UTBp78iglGpbqp1B` | 2026-08-19 |
| 7 | `services2.arcgis.com/UTBp78iglGpbqp1B/.../Primary_2024_Vote_Centers/FeatureServer/0/query` | **HIT — 148 election-day vote centers with coordinates, addresses, rooms and election labels** | 2026-08-19 |

**Model: VOTE CENTERS.** Confirmed against the authority's own words, not
assumed: `pima.gov/3199/Pima-Votes` says the site is where you "find polling
and vote center locations", and the county's own locator app is titled
"Election Day Vote Center Locator".

**What was excluded and why.** The early-voting and mobile layers carry PAST
elections beside the current one — `CD7 General`, `CoT General`, `RTA`,
`2026 Mid Term Primary`. 49 rows excluded; shipping them as places a reader
can vote now would be a false claim about a date. 21 election-day rows the
county left UNLABELED are kept and render as a named gap.

### New Jersey — Morris County: HIT at rung 2

| Rung | Attempt | Result | Attempted |
|---|---|---|---|
| 2 | `morriscountynj.gov/Government/Voting-and-Elections/Election-Day-Polling-Places` | HTTP 200, links one page per municipality | 2026-08-19 |
| 2 | 39 municipality pages | HTTP 200 each; ward/district → location tables, "2026 General Election, Tuesday, November 3, 2026" | 2026-08-19 |

**157 locations across 39 of 39 municipalities.** Model: ASSIGNED BY VOTING
DISTRICT. 25 addresses did not geocode and are LISTED WITHOUT A PIN with the
address the county published.

### New Jersey — precinct geometry for B16: FOUND, and REFUSED on its date

| Rung | Attempt | Result | Attempted |
|---|---|---|---|
| 12 | NJOGIS on ArcGIS Online | HIT — `Election Districts for New Jersey`, `Ward Boundaries for New Jersey`, statewide | 2026-08-19 |
| 7 | The layer's own `editingInfo` | `dataLastEditDate` **2021-11-24**; title prefixed `MATURE SUPPORT` | 2026-08-19 |
| 12 | Morris County's own GIS for a current layer | No published election-district layer found under the county | 2026-08-19 |
| 13 | The county Board of Elections' records request path | NOT YET WALKED — named as the next session's start | 2026-08-19 |

Five years older than the election it would be used to answer about, and
districts get redrawn. B16 refuses with the date named rather than computing
an assignment from it.

### New Hampshire — the statewide list: WALLED, 11 rungs recorded

`app.sos.nh.gov/statelistclerkandpolling` — the Department of State's own
State List of Clerks & Polling Places.

| Rung | Attempt | Result | Attempted |
|---|---|---|---|
| 2 | `www.sos.nh.gov/elections/voters` | HTTP 403, Akamai edge denial | 2026-08-19 |
| 3 | Full browser header set on `app.sos.nh.gov` | HTTP 403 | 2026-08-19 |
| 4 | curl's TLS fingerprint, both hosts | HTTP 403 | 2026-08-19 |
| 5 | A hosted fetcher on a different network | HTTP 403 — not this egress alone | 2026-08-19 |
| 6 | Live headless Chromium, JS executed, content awaited | HTTP 403, "Access Denied", `errors.edgesuite.net` | 2026-08-19 |
| 7 | The tool's own call, `ClerkandPolling/GetClerkandPollingList` | **FOUND and DELIBERATELY NOT CALLED — reCAPTCHA-gated; we do not circumvent bot detection** | 2026-08-19 |
| 9 | The Department's own PDFs on `sos.nh.gov` | HTTP 403 and 503 — the wall covers documents | 2026-08-19 |
| 10 | Search index | Named the tool; no machine-readable copy on an authority host | 2026-08-19 |
| 11 | Internet Archive, `app.sos.nh.gov` | **HIT** — the archived Angular bundle, which is what gave rung 7 its endpoint name | 2026-08-19 |
| 12 | The platform (Angular SPA behind Akamai) | Identified; no unguarded interface | 2026-08-19 |
| 13 | The Department's public-records request path | NOT YET WALKED | 2026-08-19 |

**A third-party mirror of this PDF exists on an advocacy organisation's site
and was deliberately not used.** `CLAUDE.md` sends us to the underlying
government publication, and a mirror is not the authority.

### New Hampshire — towns, walked individually

In New Hampshire the TOWN runs the election, so the town's own page is the
authority rather than a fallback.

| Town | Rung | Result | Attempted |
|---|---|---|---|
| New London | 2 | **HIT** — `newlondon.nh.gov` ELECTIONS & VOTING names Whipple Memorial Town Hall, 25 Seamans Rd, for both the 2026 State Primary and the 2026 State General | 2026-08-19 |
| Newbury | 2 | Town clerk page 200 — points readers at `app.sos.nh.gov` rather than naming the place | 2026-08-19 |
| Newbury | 2 | Voter Information page 200 — ballots and results, no polling place | 2026-08-19 |
| Newbury | 10 | Sitemap 403 / 404 | 2026-08-19 |
| Newbury | 9 | The town's own election PDFs (warrant results, election results) — retrieved, 200 | They report outcomes, not the venue | 2026-08-19 |
| Wilmot | 2 | Town clerk page 200 — registration and absentee ballots, no polling place stated | 2026-08-19 |
| Warner | 2 | `warnernh.gov/town-clerk` 404 | 2026-08-19 |
| Sutton | 2 | `sutton-nh.gov` does not resolve — the host in our notes is wrong and the right one is not yet found | 2026-08-19 |
| Bradford | 2 | `bradfordnh.org` 301 → `bradfordnh.gov`; not yet followed | 2026-08-19 |
| Springfield | — | NOT ATTEMPTED | — |

**50 New Hampshire towns sit in the registry and 10 were walked here.** That
is stated as 1 of 50 landed rather than left to read as coverage; the
remaining 40 are `NOT_ATTEMPTED`, which is a work item and never a finding.

---

## The six Kearsarge towns, walked to page level — g21, 2026-08-19 (M123)

**2 of 6 wired and live.** None is `NOT_ATTEMPTED`, and none is claimed to
publish nothing.

| Town | Rung | Result | Attempted |
|---|---|---|---|
| **Wilmot** | 2 | `/calendar` 200, WordPress | 2026-08-19 |
| Wilmot | 7 | `/wp-json/tribe/events/v1/events` → **200, `total: 23`** | 2026-08-19 |
| Wilmot | 8 | `/events/?ical=1` → 200 with **4** events (the month view) | 2026-08-19 |
| Wilmot | 8 | `/events/list/?ical=1` → **200 with all 23** — WIRED | 2026-08-19 |
| Wilmot | 8 | `/events/list/?tribe_event_display=past&ical=1` → **30 past sittings** — WIRED | 2026-08-19 |
| Wilmot | 2 | `/board/board-of-selectmen/` states the meeting place in the board's own words | 2026-08-19 |
| **New London** | 2 | `/calendar` 200, GovOffice month grid, 24 events with per-event dates and times — WIRED | 2026-08-19 |
| New London | 2 | `?Type=B_EV&SEC=…&month=&year=` month navigation — WIRED, 2 months ahead | 2026-08-19 |
| **Bradford** | 2 | `/calendar` **404** (as previously recorded) | 2026-08-19 |
| Bradford | 12 | The home page's own markup names **TownCloud** — `towncloud.io/go/bradford-nh/agendas/NNN` plus `.../PDF/get_agenda_document_link`, twelve of them. A vendor this repo has not met. | 2026-08-19 |
| Bradford | 6 | The SvelteKit front end renders its agendas client-side — NOT YET WALKED, and it is the next rung | — |
| **Springfield** | 8 | `/events/?ical=1` → 200 with **50 events, latest 2024**. STALE, not empty. | 2026-08-19 |
| Springfield | 7 | `/wp-json/tribe/events/v1/events` → **404**; the plugin is not The Events Calendar | 2026-08-19 |
| Springfield | 2 | `/events/` lists **2026** sittings (`select-board-meeting-2026-08-24` <!-- expected-future: the town own event slug, read 2026-08-19 -->, `cemetery-trustees-meeting-2026-08-11`) with `?pagination=&event_archetype=event` — the live listing, NOT YET PARSED | 2026-08-19 |
| **Warner** | 2 | `/calendar` 200 with **zero dates in the HTML** | 2026-08-19 |
| Warner | 2 | The town's own nav names `/meeting-schedules/` and `/agenda/` — both 200, content not in the served HTML | 2026-08-19 |
| Warner | 7 | `/wp-json/tribe/events/v1/events` → 404 | 2026-08-19 |
| Warner | 6 | The live browser — NOT YET WALKED, and it is the next rung | — |
| **Sutton** | 2 | `www.suttonnh.gov` and `suttonnh.gov` → **403** | 2026-08-19 |
| Sutton | 3 | Full browser header set → **403** | 2026-08-19 |
| Sutton | 5 | A different egress — NOT YET WALKED. The playbook's standing entry says the browser rung clears this host; it did not today, and that is recorded as a dated note beside the entry rather than a deletion. | — |

---

## HUNT03 — the re-walk cohort, 03255 scope, g21 2026-08-19

**C6 accounting: this is a SEPARATE COHORT and does not blend into fresh-sweep
acquisition cost.** A re-walk carries prior knowledge, prior URLs and a
narrower target, and its incremental cost is a fraction of a first hunt: 17
requests plus one geocode, against a fresh sweep's per-body discovery.

### M, enumerated first — 13

Every 03255-scope record in this repo that says "not published", "not
machine-readable" or "could not reach". Ten are consolidated-MISS entries, two
are bodies with a recorded coverage gap, one is a named open browser errand.
There are **no `KNOWN_UNCOVERED` bodies in 03255 scope at all**: all 31 in the
registry are Tucson (29) and Rockaway Township NJ (2).

### Recovered: 1 of 13

| # | Record | Rung that recovered it | What it buys |
|---|---|---|---|
| 12 | **Kearsarge's KRMS deliberative session** — "held at KRMS rather than 114 Main Street and drops counted until that address is curated" (g3, 2026-08-16) | **Rung 4.** Rungs 2 and 3 take a 403 from `kearsarge.org` and so does a second egress; **curl sending browser headers is served**, and `www.kearsarge.org/middle-school` states it in the district's own words — "Kearsarge Regional Middle School (KRMS) / 32 Gile Pond Road • North Sutton, NH 03260" | The wiring row has carried `otherVenueMarkers: "KRMS"` since August waiting on exactly one venue row. It is curated now and `resolveVenue` returns it. The sitting is in JANUARY, outside the 60-day serving window, so nothing renders differently today — the gap is closed in the data and will show when the date arrives. Stated rather than claimed as a visible win. |

### Already recovered, and the DOCUMENT was wrong: 1 of 13

**Newbury Zoning Board of Adjustment.** `states/nh/NOTES.md` recorded it
`KNOWN_UNCOVERED` — "schedule found, venue not published" — and the registry
has had it **LIVE since 2026-08-15**. The curated venue row shipped in the
mobile round-two session; this file was never brought forward.

**This is the fifth time in three sessions that a document has described built
work as unbuilt**, and it is worse here than elsewhere: a re-walk cohort read
off a stale document walks the wrong bodies. Corrected in place, with the
correction named rather than quietly applied.

### Confirmed misses, re-dated: 10 of 13

Re-walked 2026-08-19 against rungs 2 and 3, and the verdicts hold. Two changed
SHAPE, which is itself the argument for re-walking:

| Record | Was | Now | Verdict |
|---|---|---|---|
| `newbury.nh.gov/rss.xml` | 200, valid RSS, zero items | **403** | Miss holds; the host TIGHTENED. A recorded miss is not a frozen fact. |
| `newbury.nh.gov/sitemap.xml` | 403 | 403; `robots.txt` retrieved at 200 and declares no sitemap | Holds, now with the robots read behind it |
| `newburynh.civicweb.net/api/meetings` | 500 | 500 | Holds |
| `newburynh.civicweb.net/Portal/ICal.aspx` | "200 but the portal HTML shell" | **302 to `/`** | Holds, and the old wording was generous — it never served a feed at all |
| `newburynh.civicweb.net/Portal/RSSFeed.aspx` | as above | **302 to `/`** | Holds |
| `kearsarge.org` bare | TLS handshake failure | connection failure; `www.` is the host | Holds |
| `merrimackcounty.org` | DNS does not resolve | DNS does not resolve | Holds |
| `merrimackcounty.net/sitemap.xml` | 404 | 404; `robots.txt` 404 too | Holds |
| `merrimackcounty.net/calendar.php` | ignores `month`/`year`/`format=json` | 200, 41 KB, no dates in the served HTML | Holds; the calendar is client-rendered and rung 6 is its next step |
| `nhmunicipal.org/public-notices` | NHMA's own board, not a clearinghouse | 200, unchanged | Holds — the finding is about WHOSE board it is, and that does not expire |

### Deliberately not walked: 1 of 13

`sites.google.com/a/kearsarge.org/...` → **302 to a Google login**. That is an
access control, and `CLAUDE.md`'s four prohibitions include never
authenticating past one. Recorded as walked-and-refused, not as a wall.

### A rung this re-walk added

**A CivicWeb tenant enumerates its own meeting types**, at
`/Portal/MeetingTypeList.aspx`. Newbury's returns exactly one — `Selectboard`,
`type=10`. The prior record inferred the same thing from a whole-year query
whose every row came back TypeId 10; this is the portal SAYING it. Where a
record rests on an inference, ask whether the platform will state it instead.

### Still open, with its next rung named

**The Kearsarge Google Calendar embed** at
`/district/family-community/pages/calendars` was not pursued, and the reason
stands: the district's own schedule page is already wired through the
`month-table` shape and carries more than an `.ics` would — the board's own
words beside many sittings, the meeting time, and the venue with its entrance.
An ics here would be a second, thinner source for a body that already has a
good one. Recorded as a decision, not an omission.

## Congressional committee JURISDICTION text — F01 4.2, 2026-08-19

**The question.** F01 4.2 requires "what this committee handles" on every
committee row of a member's card. The card renders it on 42 rows and on nothing
else, and the author read that as an omission. It is not: it is where this
source's coverage ends.

**What the current source holds, counted rather than assumed.**
`data/congress-legislators/directory.json` (unitedstates/congress-legislators,
SHA `4458244308621d0570a15008f46888b7a87645eb`, collected 2026-08-16) carries 230
committees — 49 parents, 181 subcommittees.

| | with `jurisdiction` | without |
|---|---|---|
| Parents | 42 | **7** |
| Subcommittees | 0 | **181** |

Every one of the 49 parents and 179 of the 181 subcommittees actually render,
because we hold all 537 sitting members. So the gap a reader can hit is **186
rows**.

### Rung 1 — committed snapshot: PARTIAL (42 of 230), attemptedAt 2026-08-19

The numbers above. Recorded rather than inferred from the render.

### Rung 2 — plain fetch of the LIVE source: SAME GAP, attemptedAt 2026-08-19

`https://unitedstates.github.io/congress-legislators/committees-current.json`
→ **200**, 74,732 bytes. Parsed: 49 parents (42 with `jurisdiction`), 181
subcommittees (**0** with `jurisdiction`). The subcommittee records carry
`name`, `thomas_id`, `address`, `phone`, `wikipedia` — and no jurisdiction
field at all. **The snapshot is not stale; the field does not exist upstream.**
This is the finding that matters: no refresh of the existing source closes this.

### Rung 2 — the seven parents, at their own committees' pages: MIXED

| Committee | URL | Result |
|---|---|---|
| Joint Committee on Taxation | `https://www.jct.gov/about-us/overview/` | 403 plain |
| Joint Economic Committee | `https://www.jec.senate.gov/public/index.cfm/about-the-jec` | 403 plain |
| Commission on Security and Cooperation in Europe | `https://www.csce.gov/about-csce/` | 404 — path is wrong, not walled |
| Joint Committee on Printing | `https://www.congress.gov/committee/joint-committee-on-printing/jspr00` | 403 plain |

### Rung 3 — full browser header set: ONE WALL FELL, attemptedAt 2026-08-19

Same URLs, with a complete browser header set (`User-Agent`, `Accept`,
`Accept-Language`), serialized, one request every two seconds.

* **Joint Committee on Taxation → 200**, 22,803 bytes. The wall was a
  header filter, not an access control. **This is a rung: `jct.gov` refuses a
  bare client and serves a full header set.**
* Joint Economic Committee → still **403**. Next rung is 4 (a different client
  whose TLS fingerprint passes — curl beat this class in the f session) and then
  5 (a different egress).
* CSCE → still 404 on that path; the path is the problem. Next rung is 10
  (the site's own sitemap) or 12 (identify the platform).

### State: OPEN, with the next rungs named

Not exhausted and not reported as a finding. The render says so in the gap's own
register — "We haven't sourced what this subcommittee handles yet" — which is a
fact about us, and never silence, which would have read as a fact about the
subcommittee.

**The next rungs, in order, for the 181 subcommittees:** rung 9 (linked
documents — the House and Senate publish committee rules as PDFs, and a standing
committee's rules state its subcommittees' jurisdictions), then rung 12 (the
chamber platforms: `docs.house.gov`, `congress.gov`'s committee API), then rung
7 (the committee sites' own JSON endpoints where they have them). For the 7
parents: rungs 4, 5 and 10 as named per row above.

**Deliberately not walked this session** (F01 carried 50 items — see RULING 5 — and this one is a
186-body hunt across ~40 hosts): the subcommittee sweep. Tracked, specced, and
its first three rungs recorded above so the next session starts on rung 4 rather
than on rung 1.

## Top office holders per body — F01 1.2 / 2.2 / item 0b, 2026-08-19

**Item 0b, answered before anything was built.** *"Do we hold the top-office-holder
data at all?"* — **Partly.** Every curated roster holds the ELECTED head under
the body's own published title (Governing Board President, Chairman of the
Board of Supervisors, Commissioner Director, Mayor, Selectboard Chair). None
held the APPOINTED executive — the superintendent, the county administrator,
the town manager — because the rosters are of people who SIT on the body and
that person does not.

So 1.2/2.2 was a render change for one half and a source hunt for the other,
and it is recorded as both. `lib/officials/top-offices.ts` carries the
precedence and `tests/top-offices.test.ts` asserts all **12** shipped rosters
resolve at least a presiding officer, so the render half is complete for every
covered body today.

### The hunt: appointed executives, 1 of 12 landed

| Body | Rung | Result |
|---|---|---|
| Tucson Unified School District | 2 — plain fetch | **HIT.** `https://www.tusd1.org/superintendent` → 200, 46,854 bytes. Names "Dr. Gabriel Trujillo, Superintendent, Tucson Unified School District" in the district's own words, three times on the page. **Shipped.** |
| Vail Unified School District | 2 → 6, then **2 again** | **CLOSED 2026-08-19 (F01-continued item 10b): John Carruth**, read off `https://www.vailschooldistrict.org/page/superintendent` — HTTP 200, 1,401,781 bytes, **rung 2, a plain fetch.** F01 reached this person at rung 6 and got "Superintendent Carruth", a surname alone, and correctly refused to ship it; the author ruled the full name and the re-hunt found where the miss came from. **The measured root cause is none of the likely ones.** The home page's STATIC HTML already links `/page/superintendent`, so link discovery was never blind; that page answers 200 to a plain fetch, so no browser was needed; and its HTML contains "John Carruth" six times, including `<strong>John Carruth<br>Superintendent</strong>`. The fetch and the discovery both worked and **the EXTRACTION failed**: the district runs on **Apptegy**, which ships page content as an escaped JSON payload embedded in the HTML, so reading the RENDERED prose finds the news blurb ("Superintendent Carruth shares a message with the community") and never the byline, which sits in the embedded data with its quotes escaped and a `<br>` between name and title. This is rung 7 in miniature — the page's own data was right there and better than its prose. Two smaller findings ride along: F01's rung-2 404 was against a GUESSED path (`/superintendent`) rather than the site's own, and the platform is Apptegy rather than the Finalsite family. **Class size: 2.** Exactly two bodies in the database sit on Apptegy (2 of 19 wiring rows, `"APPTEGY"`; 2 of 12 curated rosters carry the `/o/{org}/page/{slug}` shape) — this one and Rockaway Township's. The consequence is bounded to person hunts, because `lib/sources/apptegy/index.ts` already reads the site's own `/api/v4/o/<org>/cms/events` JSON for meetings. Next rung for the remaining body: 7, the same endpoint the meetings adapter already walks. |
| Sunnyside Unified School District | 2 | `https://www.susd12.org/superintendent` → 200, 228,581 bytes. The page is the superintendent's PERFORMANCE GOALS and names the office throughout without naming the person. Next rung: 8 (structured markup) or 9 (board minutes). |
| Amphitheater Unified School District | 2 → 6 | `/domain/62` and `/domain/8` → 404. The home page's own links reach the Governing Board but no administration page. Next rung: 10 (sitemap) or 12 (identify the CMS — the `/domain/NNN` path is Blackboard/Finalsite and its directory module has a predictable path). |
| Kearsarge Regional School District | 2 → 6 | Home page → 200 but no superintendent mention; the only link found is a board press release at `/district/files/interim-superintendent`, which suggests the post is INTERIM and is exactly the case where a stale name would be worst. Rung 6 on `/district/superintendent` → **403** (the same host that refused the calendar refresh). Next rung: 4 (a different client), then 11 (the Internet Archive). |
| Rockaway Township Board of Education | 2 → 6 | `rocktwp.net` is the TOWNSHIP, not the school district — the wrong host, which is a finding about our own note rather than a wall. Next rung: 2 against the district's own domain, which is not recorded in the registry yet. |
| Pima County · Morris County · Merrimack County | — | NOT ATTEMPTED. County administrators/managers. |
| Tucson · Newbury · Rockaway Township (council) | — | NOT ATTEMPTED. City/town managers. |

### State: OPEN, 2 of 12, with every next rung named

Not exhausted and not reported as one. The render does not depend on it: every
body resolves its ELECTED head today, so no card is blank, and a body with no
appointed executive on record shows one row rather than two — which is the
honest answer, not a gap.

**2 of 12 as of 2026-08-19** (F01-continued item 10b closed Vail; TUSD closed in F01).

**Why it stopped here.** F01 carried 50 items across 13 surfaces (corrected from 55, RULING 5). This is a
12-body hunt across 12 different content-management systems, three of which are
JS-rendered and one of which returns 403 to a live browser. The rungs above are
recorded so the next session starts on rung 4 or 9 per body rather than on
rung 1, and so the two REAL findings — Kearsarge's post may be interim, and the
Rockaway BOE domain is not in the registry — are not rediscovered.


---

## A 200 that is not the page, and the extraction blind spot behind it — F01-continued session 2 item 0C, 2026-08-19

**SIZING ONLY.** RULING 12: no extractor is built here. The count is the work;
the build is `F11`, homed to H.

### The rung this adds, and it belongs to rung 4

Rung 4 of the ladder is *a different CLIENT whose TLS fingerprint passes*. It
was walked, until now, only when a host **refused** — the browser profile
escalates to `curl` on a 403. **Apptegy's edge does not refuse.** It answers an
unfamiliar HTTP client with `200 OK` and a 3,036-byte document titled
**"Client Challenge"**, and every layer above then behaves perfectly and
produces a lie: the fetch succeeds, the parse succeeds, the extraction finds no
content because there is none, and a school district that publishes its
superintendent's name six times on that page is recorded as publishing nothing.

Measured, both clients, same URL, same headers, 2026-08-19:

| Client | Status | Bytes | What came back |
|---|---|---|---|
| Node `fetch` (undici) | **200** | 3,036 | `<title>Client Challenge</title>` |
| `curl` | **200** | 259,887 | the Governing Board page |

**Nothing here defeats a challenge.** No challenge is solved, no token is
obtained, nothing is authenticated: the host serves the real document to the
second client with no challenge at all. This is rung 4 as written — a different
client, on the same public page.

**The rung, as an enrichment of rung 4 rather than a new number** (the ladder's
own rule: only a genuinely new retrieval class increments it): *a `200` is not
proof of retrieval. A short body carrying a challenge signature is a WALL, and
it is named as one.* Implemented in `lib/sources/http.ts` — `challengeIn()`
plus escalation — so it holds for **every adapter in the product**, not for the
one that found it. If the second client is challenged too, `politeGetText`
throws naming the wall rather than returning an empty document, because a
challenge page recorded as a page that says nothing is the "failed operation
rendering as empty success" defect at its source. Guarded in
`tests/challenge-at-200.test.ts`, including the negative: a long document that
merely quotes the phrase is still a document.

This was the fifth sighting of that shape and the first inside the shared HTTP
client. It is worth stating plainly that **every retrieval this product has
ever made through `politeGetText` against a challenge-fronted host was recorded
as a successful read of an empty page.**

### The sizing — method first, so the count is checkable

`pnpm census:embedded-json` (`scripts/embedded-json-census.mts`). One polite
serialized browser-profile GET per body homepage, our own `User-Agent` with a
contact address, `Retry-After` honoured. Signatures looked for, per response:

| Platform | Signature |
|---|---|
| Apptegy | `apptegy` / `thrillshare` in markup or asset hosts |
| Next.js | a `__NEXT_DATA__` script tag, or `self.__next_f.push` |
| Nuxt | `window.__NUXT__` or `__NUXT_DATA__` |
| Gatsby | `window.___gatsby`, or a `page-data.json` fetch |
| Generic | a `<script type="application/json">` block over 2 KB, JSON-LD excluded |

JSON-LD is excluded deliberately: it is structured markup we already read at
rung 8, not a payload hiding the content.

**The detectors carry a positive AND a negative control**, because a sweep that
cannot find anything and a sweep that found nothing print the same thing. Vail
and Rockaway Township school both trip three signatures; `newlondon.nh.gov` and
`rockawaytownship.org` trip none, with 0 bytes of `application/json` between
them. The first run of this census reported **0 of 95** — every site clean —
and that number was produced entirely by the challenge defect above. It is
recorded here because it is the exact shape of a false all-clear.

### The counts, 2026-08-19

| | Count |
|---|---|
| bodies held in the registry | **347** |
| — carrying a homepage URL this census can ask | **95** |
| — with no homepage URL, so **not asked** | **252** |
| fetched | 95 |
| — reached (2xx, real document) | **95** |
| — refused or failed | **0** |
| of the 95 reached, serving primary content as embedded JSON | **2** |

Per platform, counting each body once under its first match:

| Platform | Bodies |
|---|---|
| APPTEGY | **2** |
| NEXT | 0 |
| NUXT | 0 |
| GATSBY | 0 |
| GENERIC_JSON_BLOCK | 0 |
| no signature | 93 |

A body can trip several, and saying so is the difference between "two
platforms" and "two bodies" — both Apptegy sites also trip NUXT (Apptegy is
built on Nuxt) and GENERIC_JSON_BLOCK. Every signature, counted across bodies:
APPTEGY 2, NUXT 2, GENERIC_JSON_BLOCK 2.

The two payloads, measured:

| Body | Embedded JSON | Page | Share |
|---|---|---|---|
| `vailschooldistrict.org/page/governing-board` | 173,842 B | 1,443,894 B | 12.0% |
| `rocktwp.net` | 117,948 B | 1,226,649 B | 9.6% |

**The 252 bodies with no homepage URL are not a clean result.** They are bodies
this census could not ask, and they are reported separately for exactly that
reason. Sizing them means giving them a homepage URL first, which is its own
work item and not this one.

**Apptegy as an AGENDA WIRING is a different question and a different number:**
2 bodies wired via `APPTEGY` out of 85 wired via anything. That is the number
session 1 reported as "2 of 19"; the wiring denominator is 85 today. It counts
where we FETCH AGENDAS from, not what platform a site runs, and the two
questions happen to give the same numerator here.

### Bodies whose extraction has been verified against rendered page content

**0 of 347.**

Nothing in this repository records such a verification for any body — no field,
no file, no run, and no script that would produce one. That is the finding, and
it is larger than the platform count: **the blind spot is not N bodies wide, it
is the whole registry**, because the question has never been asked of any of
them. The single-token-name census (`pnpm names:census`, 0 of 1,369) is not
this check and cannot become it — it finds names that LOOK wrong, and a
silently failed extraction's whole signature is that it leaves a plausible
value behind. "Carruth" passed every check this product had.

### State: SIZED, not fixed

The extractor build is `F11`, homed to **H**, sized by these counts. Not started
here, per RULING 12. The rung-4 enrichment above **did** ship, because it is a
retrieval-honesty defect in the shared client rather than an extractor.

## The 2026-08-20 rung set (F22 — the refresh-is-red session)

**No new retrieval class, so the ladder does not renumber.** What changed is
that a wall now RECORDS the rung it stopped at, automatically, on every
scheduled run — which is the operational half of "every wall that falls
becomes a rung, so it never costs a second session," read from the other side.

* **`SourceHttpError` carries `rung`.** The shared client already escalated
  (plain profile → browser header set → a different TLS client via `curl`); it
  simply never said how far it had got. Every throw site now names its rung in
  the numbering `CLAUDE.md` uses: **2** plain fetch, **3** fetch with the full
  browser header set, **4** a different CLIENT whose TLS fingerprint passes.
  A challenge answered at HTTP 200 on BOTH clients records rung 4; a refusal
  the plain profile met records rung 2.
* **It reaches the snapshot.** `lib/sources/composite/index.ts` forwards it as
  `walledAtRung` and `lib/meetings/snapshot.ts` stores it, so a walled source
  in a committed snapshot says where the next attempt should start rather than
  making a later session re-walk rungs already known to fail.
* **Absent stays absent.** A whole-child timeout from `withTimeout` knows no
  rung, records none, and prints as `unrecorded`. A plausible rung is not a
  rung — same law as a plausible date.
* **Rungs 5 through 14 are unwalked by this client, not exhausted.** The record
  says where we stopped, never that there was nowhere further to go, and there
  is still no `SOURCE_BLOCKED` and no terminal state anywhere in the schema.

**A wall found and NOT defeated, recorded as such:** `civicplus` answered
nothing within twenty seconds on 2026-08-20 (run #30 of the meetings refresh).
It turned out not to be a wall at all — the scheduled job was using the live
map's 20-second per-source budget, and the source answers fine with a batch
budget. Recorded here because "a vendor is refusing us" was the plausible
reading and it was wrong: **before naming a wall, check whose stopwatch ran
out.**

**`go.boarddocs.com` continues to answer HTTP 403** to the agenda fetch for
`apptegy:vail` on every run (seen again 2026-08-20). Rung 3 reached; unchanged
since 2026-08-18 and still open.

---

## RULING 166 — THE BODY'S OWN PUBLICATION IS RUNG ONE, AND ITS BULK DOWNLOAD IS RUNG ZERO

(Adopted 2026-08-26, Sean's ruling, the sources-and-incumbency session.
`docs/rulings.md` carries it in full. **It amends RULING 84 and it changes how
every rung below is REACHED**, so it sits here at the top of the evidence rather
than at the end of it.)

**Before any aggregator, any third party, and any per-entity search, the
governing body that holds the office is walked first. Where that body offers a
bulk download, the bulk file is taken before any page-by-page retrieval.**

### Tier A splits, and the split is the whole amendment

| Tier | What is in it | Walked |
|---|---|---|
| **A0** | The body's own publication, and the tier above it in government (RULING 93). Bulk download first, then the body's own pages. | FIRST, always |
| **A1** | Third-party compilations that answer many entities at once — Wikipedia, LegiScan, Citizens Count, Open States, GovTrack. | after A0 |
| **B** | The entity's own official source, per entity. | unchanged |
| **C** | Per-entity search. | unchanged |

**A bulk file is rung ZERO because it is not a retrieval problem at all.** The
fourteen rungs are about getting bytes past a wall. A published `.txt` of a
whole roster has no wall in front of it, and a session that walks rungs 2
through 6 against a body's individual member pages while that file sits one
directory away has not been defeated by anything — it never asked.

### The evidence this was adopted on, walked 2026-08-26

**`gc.nh.gov/downloads/` — the New Hampshire General Court's own downloads
page.** `www.gencourt.state.nh.us/downloads/` redirects (HTTP 301) to it, so
**`gc.nh.gov` is canonical** and both hostnames serve the same body. The page
carries, all at HTTP 200 to a plain rung-2 fetch with an identified User-Agent:

| File | Bytes | What it is |
|---|---|---|
| `/downloads/Members.txt` | 82,694 | **408 rows**, tab-delimited, 28 columns |
| `/downloads/Members.xls`, `/downloads/Members.xlsx` | — | the same roster, spreadsheet form |
| `/downloads/ODBC and Data Table Structure.pdf` | 189,320 | the public SQL Server's connection details and schema |
| `/dynamicdatadump` | 21,659 | a further bulk surface, not yet parsed |

`Members.txt`'s columns: `LastName`, `FirstName`, `MiddleName`,
`LegislativeBody`, `seatno`, `County`, `District`, **`electedStatus`**,
`Address`, `address2`, `city`, `Zipcode`, `State`, `Phone`, `WorkEmail`,
`party`, `GenderCode`, `PersonTitle`, and `Committee1`-`Committee5` each with a
phone number.

**Measured on the file itself, 2026-08-26:** 408 rows — **384 House, 24
Senate**. `electedStatus` reads ` Incumbent` for 279 (note the LEADING SPACE — a
naive equality comparison against `"Incumbent"` fails on every one of them),
`new` for 109, `Former` for 18, and empty for 2. **406 of 408 carry a work
email; 266 of 408 carry a phone.**

*The pair, stated rather than blended (the two-numbers rule).* The brief that
ordered this work said **424 seats — 400 representatives and 24 senators**. The
body's own file carries **408 rows, 384 of them House**. Those are different
measurements of different things: 400 is the constitutional size of the House,
and the file is the roster of PEOPLE, which carries vacancies as absences and
carries 18 `Former` members as rows. Neither number is wrong and they are not
interchangeable.

**The public SQL Server is LIVE, and the address in the brief was wrong.**

| Host | Source of the address | TCP 1433, probed 2026-08-26 |
|---|---|---|
| `66.211.150.69\sqlexpress` | **the body's own PDF at `gc.nh.gov`** | **OPEN** |
| `216.177.20.245\sqlexpress` | the session brief | `ECONNREFUSED` |

Credentials as published by the body: `publicuser` / `PublicAccess`, default
database `NHLegislatureDB`. **These are published by the General Court for
public read access and are not an access control being circumvented** — the
public-records rule's prohibition is on authenticating PAST a control, and this
is a credential the body prints in a public PDF for exactly this use.

The PDF's own table names are **`legislators`** and **`rollcallhistory`**, not
`tbllegislators` and `tblrollcallhistory` as the brief had them. Its schema, as
published:

- `legislators` — `PersonID` int, **`EmployeeNo` varchar**, `LastName`,
  `FirstName`, `MiddleName`, `LegislativeBody`, `SeatNo`, `CountyCode`,
  `District`, `Party`, `Street`, `Address2`, `City`, `State`, `ZipCode`,
  `EMailAddress1`
- `rollcallhistory` — `sessionYear`, `legislativeBody`, `voteSequenceNumber`,
  **`employeeNumber` varchar**, `condensedBillNo`, `vote`
- `rollcallsummary`, `sponsors` (`employeeNo`, `PersonID`), `docket`,
  `committees`, `county`, `subject`
- **`housedistricts` and `senatedistricts`** — `countycode`, `districtcode`,
  `ward`, `town`. That is a town-to-district resolver published by the body.

**`EmployeeNo` is the stable key** joining a legislator to their roll calls with
no name matching whatsoever, and the body documents it as such.

**What the member-page id is NOT.** Karen Ebel's member page is
`gc.nh.gov/house/members/member.aspx?member=377093`. Her `seatno` in
`Members.txt` is **4005**. They are different identifiers, and no roster page
this session walked exposes the `member=` id:
`house/members/memberlookup.aspx` gives 404, `house/members/wml.aspx` 404,
`house/members/memberlisting.aspx` 404, and `house/members/` answers HTTP 200 at
122,319 bytes carrying **zero** `member.aspx?member=` links — it points at the
three download files instead, which is the page telling you to take the bulk
file. Recorded as an honest gap with its rungs, not as an absence.

**`ftp://ftp.azsos.gov/cfsdata2/` — Arizona's campaign-finance reference
tables.** Named in the state's own *Bulk Filing Guide* (revised **28 July
2026**, so current), anonymous, and answering. Fourteen files listed. Pulled
2026-08-26:

| File | Rows | What it is |
|---|---|---|
| `Committees.txt` | **8,828** | every registered AZ committee: id, name, address, **committee type**, organization date, termination date. **1,958 carry no termination date.** |
| `Jurisdictions.txt` | **109** | **1 State, 15 County, 93 City/Town** — the A.R.S. section 16-928 filing-officer universe, published by the state |
| `Counties.txt` | 15 | |
| `Elections.txt` | 37 | |
| `ConsolidatedElectionDates.txt` | 33 | |

Also on the FTP: `TransactionTypes.txt`, `AllowedInitialTransactions.txt`,
`AllowedOffsetTransactions.txt`, `TransactionTypesAllowedByCommittee.txt`,
`AdvertisingModes.txt`, `BallotMeasures.txt`, `ReportingPeriods.txt`,
`SampleDatafile.txt`, `BulkFilingGuide.doc`.

**The answer to "does AZ expose bulk data or only a search UI", plainly, both
halves.** Bulk EXTRACT of transactions — **no**; the Bulk Filing Guide is an
UPLOAD specification for committees filing INTO the system, not a download
format. Bulk REFERENCE TABLES including the complete committee register —
**yes**, at the anonymous FTP path above, which the state publishes in its own
guide and which nobody in this project had ever walked.

**Committee types, as filed** (the top of 8,828): 3,767 Candidate (not
participating in Clean Elections), 988 PAC, **810 Candidate (participating in
Clean Elections)**, 492 Support/Oppose (Ballot Measure), 464 PAC (Standing),
328 Independent Expenditures (Corp/LLC/Labor Org). *Clean Elections
participation is therefore already a filed, bulk-available, binary fact about
every Arizona candidate committee — the field the brief asked for, in a file.*

## THE SECRETARY OF STATE IS A BODY, AND IT IS A NAMED RUNG

(Adopted 2026-08-26, Item 4 of the sources-and-incumbency brief. It is
RULING 166's A0 applied to the office that publishes more distinct civic
datasets per fetch than anywhere else in a state.)

**Every state runs a Secretary of State or equivalent that publishes several
DISTINCT civic datasets under one roof, and no session in this project had ever
walked it as a body.** It is walked division by division, and each division is
its own registry row.

The divisions, enumerated so a session in a new state knows what to look for:

1. **Elections division** — candidate filings, ballot certification, polling
   places, the election calendar.
2. **Campaign finance system** — receipts, expenditures, filing entities, and
   (where it exists) the bulk reference tables.
3. **Lobbyist registry** — who is retained, by whom, on what subject.
4. **Clerk directory** — municipal clerks with contact detail.
5. **Business / entity registry** — where relevant to committees and PACs.

Walked 2026-08-26 for the three pilot states. Per-state detail is in
`states/<state>/sources.md`; the reachability summary is here because it is
retrieval evidence:

| Division | NH | AZ | NJ |
|---|---|---|---|
| Elections | `sos.nh.gov` — **rung 2 and rung 3 both HTTP 403** | `azsos.gov/elections/...` — HTTP 200 | `elec.nj.gov` — HTTP 200 but a **212-byte shell**; the data is on `njelecefilesearch.com` |
| Campaign finance | `cfs.sos.nh.gov` — **HTTP 403 at rungs 2 and 3** | `azsos.gov/elections/campaign-finance-reporting` 275 KB, plus the FTP above | `njelecefilesearch.com` — already WIRED |
| Lobbyist registry | `sos.nh.gov/lobbyists` — **HTTP 403** | `azsos.gov/elections/lobbying` — **HTTP 200, 285 KB** | not located this session |
| Clerk directory | not located this session | `azsos.gov/elections/about-elections/county-election-contact-info` — **HTTP 200, all 15 counties named** | `nj.gov/nj/gov/county/localgov.shtml` — **HTTP 200, 618 outbound links, all 21 counties, Rockaway Township present** |
| Election calendar | — | `azsos.gov/elections/calendar-dates` — HTTP 200 | — |

**`sos.nh.gov` and `cfs.sos.nh.gov` are WALLED, not disallowed, and the
distinction is load-bearing.** Their `robots.txt` answers **HTTP 403** to both a
plain client and a full browser header set, which means the permission question
is UNANSWERED rather than answered no. Under RULING 148 an unanswered permission
question refuses the walk; under RULING 53 a wall carries a date and is
re-walked on a 14-day clock. Both are true at once and neither cancels the
other: **the next rung to try is 4 (a different client), then 5 (a different
egress), then 6 (the live browser)** — not a cleverer request to the same door.
Last tested **2026-08-26**.

**`irc.az.gov` — the Arizona Independent Redistricting Commission — answers
HTTP 403 to a plain fetch and HTTP 200 to a full browser header set on
`robots.txt`.** A rung-3 wall that falls, recorded as a rung.

## `pnpm robots:sweep` — THE PERMISSION QUESTION, ASKED AT SCALE

(Added 2026-08-26.) `scripts/robots-sweep.mts`. RULING 148 says the may-we-walk
verdict is enforced by the fetcher and never remembered by a session; today it
is enforced for exactly one population, the general search indexes in
`lib/hunt/search-pool.ts`. This makes the question cheap to ask about many hosts
at once, so a session enumerating a state's sources answers the permission
column for every one of them **before** it walks any of them.

Four verdicts: `ALLOWED`, `DISALLOWED`, `NO_ROBOTS`, `CANNOT_TELL`. Run
2026-08-26 over 21 hosts from this brief: **17 walkable, 4 refused** —
`sos.nh.gov`, `cfs.sos.nh.gov`, `irc.az.gov` and `govtrack.us`, the last two of
which then answered at rung 3.

**Since the owner decision of 2026-09-25 no verdict refuses a walk.** "Robots.txt
alone must not block acquisition." The sweep still reads and records every
host's rules first, and `Crawl-delay` is still honoured as spacing; a
`DISALLOWED` or `CANNOT_TELL` is evidence on the record, never a closed door.
What does close a route is an access control on the page itself — a login, a
403 or bot challenge, a 429 — and that is never bypassed
(`lib/hunt/access-control.ts`).

## THE DESCENT — RULING 169, AND WHAT IT ADDS TO THIS FILE

(Added 2026-08-26, the descent session, Item 3.)

**RULING 169 — a walk is COUNTED or it did not happen.** Coverage is built by
DESCENDING the tiers of government in order, because each tier publishes the
tier beneath it. A tier is not complete until the tier above has been asked what
is in it, and a body found only by per-entity search when the tier above
publishes a list containing it is a **defect in the walk** rather than a find.

Every level's site is walked as a tree and reported as counts — **links found ·
followed · yielded · declined with reason · catalogued · bodies discovered that
were not already in the registry** — plus the **pass count** and the **final
pass's new-link count**. If the final pass found anything new, the walk was not
finished and the session says so.

The tiers, in descent order, and the list does not stop at its own bottom — a
state with a layer not named here gets that layer added, and the addition is a
finding:

1. **State** — the state itself, its Secretary of State by division, its
   legislature, its redistricting body, its courts, its education agency, its
   open-data and transparency portals, its comptroller or auditor, its division
   of local government.
2. **Statewide and multi-county districts** — congressional, legislative,
   judicial, education service agencies, regional authorities, councils of
   government, transportation authorities.
3. **County** (or parish, or borough) — the county itself, its clerk, recorder,
   elections department, assessor, treasurer, board of supervisors or
   commissioners, and every board, commission and authority it publishes.
4. **Local and special districts** — school, fire, water, sanitation, library,
   hospital, irrigation, transportation, community college, improvement,
   taxing. **The layer most likely to be missing and the one a reader most
   needs**, because these levy on a household's bill and appear on almost
   nobody's list.
5. **City** — the city, its clerk, its council, its boards and commissions.
6. **Town, township, borough, village, plantation, unincorporated place** —
   whatever this state actually calls them. The vocabulary is enumerated from
   the state's own publications and a national one is never imposed.
7. **Everything else the state names** — authorities, commissions, tribal
   governments as their own sovereign category (RULING 119), and anything that
   does not fit above.

The machinery is `lib/hunt/descent.ts` and `pnpm descent --state <code>`.

## RUNG 4 ON `robots.txt` ITSELF — THE PERMISSION QUESTION IS WALKED

(Added 2026-08-26, the descent session. A wall that fell, recorded as a rung.)

**`pnpm robots:sweep` asked rung 2 and read a rung-2 refusal as *the permission
question is unanswerable*.** `CANNOT_TELL` refuses under RULING 148, correctly —
so a host refusing this project's User-Agent became a host we may not walk, and
the refusal looked like a rule rather than like a wall.

**Measured 2026-08-26, and this is the cost:**

| Host | Rung 2 | After escalation | What it is |
|---|---|---|---|
| `az.gov` | 403 | **ALLOWED**, rung 4 | **the top of the Arizona descent** |
| `azed.gov` | 403 | **ALLOWED**, rung 4 | the state education agency — every school district |
| `irc.az.gov` | 403 | **ALLOWED**, rung 4 | redistricting |
| `nh.gov` | 403 | **ALLOWED**, rung 4 | **the top of the New Hampshire descent** |
| `courts.nh.gov` | 403 | **ALLOWED**, rung 4 | the judiciary |
| `education.nh.gov` | 403 | **ALLOWED**, rung 4 | every NH school district |
| `revenue.nh.gov` | 403 | **ALLOWED**, rung 4 | the tax rate tables — the special-district layer |
| `nhsba.org` | 403 | **ALLOWED**, rung 4 | the school boards association |

**Arizona went from 12 walkable hosts to 15; New Hampshire and New Jersey
together from 12 to 17. 39 hosts judged, 24 walkable before, 32 after.**

**The wall is a TLS FINGERPRINT, not a header.** Node's `fetch` is refused with
HTTP 403 under this project's User-Agent AND under a full Chrome header set;
`curl` carrying that identical Chrome header set is admitted at HTTP 200.
Headers are the same across those two and the client is not. That is rung 4 in
as many words, and it is the **second** time this project has met it — the f
session recorded it, and this session met it again in the instrument built to
ask permission.

*Recorded as a RULING 97 shape rather than smoothed:* the session of 2026-08-26
that built the sweep had already written into this file that `irc.az.gov`
*"answers HTTP 403 to a plain fetch and HTTP 200 to a full browser header set"*.
The wall was recorded and never built into the instrument beside it, so the
instrument went on refusing the host its own documentation said was reachable.
**A wall that falls becomes a rung** — and a rung recorded in prose beside a
tool that does not walk it is a discovery spent and kept only on paper.

**This is a harder read of the rules, never a softer one.** Every rung asks the
same host for the same file and obeys whatever comes back; a blanket
`Disallow: /` read at rung 4 refuses exactly as it would at rung 2. What changed
is only whether we managed to READ the host's rules before deciding we could
not. The rung that answered is carried on the verdict, because a permission read
that needed rung 4 is a weaker fact than one that did not.

**Still refused after escalation, last tested 2026-08-26:** `sos.nh.gov` (503),
`newburynh.org`, `doe.nh.gov`, `dra.nh.gov`, `nhdes.nh.gov`, `data.az.gov`
(Cloudflare challenge or unresolved), and `ftp.azsos.gov` — which is **not a
wall at all**: FTP has no `robots.txt`, so the sweep's question does not apply
to it and a `CANNOT_TELL` there is the instrument being asked the wrong
question rather than the host refusing.

## EXPANSION — routes that did not exist at session start (RULING 88)

**2026-08-26, the descent session, Items 8 and 9.** Every route below was
conceived this session, walked with the literal URL recorded, and its yield
reported **including zero**. RULING 88: *a newly conceived route that returns
nothing is a REPORTED SUCCESS, not a defect. The invention is the deliverable,
not the yield.*

The organising question was RULING 170's, not *where would this be published*
but **WHO WAS COMPELLED TO WRITE THIS DOWN?**

### 1. The permission read, walked up the ladder — GENERALISES TO EVERY HOST

**How conceived.** `pnpm robots:sweep` reported `CANNOT_TELL` for `az.gov`, and
`CANNOT_TELL` refuses the walk under RULING 148. The question asked was *does
this host permit us* and the question that should have been asked was *did we
manage to READ this host's rules*.

**Literal probe.** `curl -sL -A '<Chrome UA>' https://az.gov/robots.txt`

**Returned.** HTTP 200, 2,189 bytes, an ordinary permissive Drupal `robots.txt`
— where Node's `fetch` carrying the identical Chrome header set gets HTTP 403.

**Yield.** **Arizona 12 walkable hosts → 15. New Hampshire and New Jersey 12 →
17. Across 39 hosts judged: 24 walkable → 32.** Recovered: `az.gov` and
`nh.gov` (the tops of two descents), `azed.gov` (every AZ school district),
`irc.az.gov`, `courts.nh.gov`, `education.nh.gov`, `revenue.nh.gov` (the tax
rate tables), `nhsba.org`.

**Generalises?** **To every host this project will ever ask about.** Built into
`scripts/robots-sweep.mts` rather than left as a note — which is the RULING 97
point, because the prior session had ALREADY WRITTEN into `docs/source-ladder.md`
that `irc.az.gov` falls at rung 3 and did not build it into the instrument
beside it.

### 2. Municode's own JSON API — RUNG 7, and it generalises to ~3,000 municipalities

**How conceived.** RULING 170's question. **The municipal code is where every
board, commission and authority is ESTABLISHED BY ORDINANCE** — the
administration chapter enumerates them with legal force, including bodies that
publish nothing of their own. So: who hosts municipal codes? Municode and
eCode360 host thousands.

`library.municode.com/nj` answers **HTTP 200 with 6,095 bytes and the control
string ABSENT** — a JavaScript shell, which a status check alone reads as
success (RULING 93). That is rung 7 in as many words: *the page's own network
calls — the JSON endpoint feeding the widget is usually right there, and it is
better data than the HTML.*

**Literal URL.** `https://api.municode.com/Clients/stateAbbr?stateAbbr=NJ`

**Returned.** HTTP 200, JSON, at **rung 2** — no wall at all once the right door
was asked.

| State | Municipalities with a hosted code | With phone | With website |
|---|---|---|---|
| **NJ** | **22** | 19 | 21 |
| **AZ** | **30** | — | — |
| **NH** | **6** | — | — |

Each record carries `ClientName`, `Address`, `City`, `ZipCode`, `Phone`,
`Website` and `Meetings`.

**The honest zero:** **`Meetings` is `null` on every one of the 22 NJ records.**
The field exists and is empty. Reported as a success under RULING 88 — the route
is real and that particular field is not populated.

**And a data-quality caveat rather than a silent ship:** the phone arrives as
`5470711` — **seven digits, no area code**. That is not a phone number a reader
can dial, and shipping it into the Kelly phone field would be manufacturing a
contact. It needs the area code resolved from the address before it is worth
anything.

**Generalises?** **Yes, nationally.** One parser reads every state's list, and
`api.municode.com/States/` enumerates them.

### 3. eCode360 — HIT at the index, and the deep link was a WRONG GUESS

**Literal URLs and what each returned:**

- `https://ecode360.com/` — **HIT, rung 4**, HTTP 200, 23,002 bytes.
- `https://ecode360.com/RO1256` — **rungs 2 and 3 HTTP 403, rung 4 HTTP 404.**
- `https://ecode360.com/api/search/customers?state=NJ` — **rung 4 HTTP 404.**

**Both of the last two are WRONG GUESSES, not walls, and the distinction is the
finding.** A 404 says *there is no document at this path* — the response is to
find the real path. A 403 says *we are refused* — the response is another rung.
Recording a guessed URL's 404 as a wall would manufacture a retrieval history
nobody walked, and it is what the first version of this session's own probe
script did until it was fixed mid-run.

**Not resolved this session.** eCode360's real per-municipality identifiers and
its actual API shape are owed.

### 4. The NH tax rate tables — FOLLOWED rather than guessed

**How conceived.** RULING 170 again: **somebody has to be billed**, so every
levying district must appear on a rate table. That is the special-district layer
itemised by statute — the layer RULING 57 says a reader most needs and almost
nobody lists.

**The guess failed and the follow succeeded, which is the lesson:**

- **Guessed:** `revenue.nh.gov/mun-prop/municipal/documents/2024-tax-rates.pdf`
  — rung 2 HTTP 403, rung 4 HTTP 403.
- **Guessed:** `revenue.nh.gov/property-tax/municipal-and-property-division` —
  refused.
- **FOLLOWED from the index this session actually fetched:**
  `https://www.revenue.nh.gov/property-tax-rates-related-data` — **HIT, rung 3,
  HTTP 200, 241,456 bytes.**

The index at `revenue.nh.gov/mun-prop/municipal/index.htm` (HTTP 200, rung 3,
241,419 bytes) yielded **78 links**, of which 2 matched the compelled-publication
shapes — one of them a **Village District** document, which is exactly the NH
twig layer.

**A defect in this session's own instrument, recorded rather than smoothed:**
the Village District href came back TRUNCATED by the scratch extraction regex
(`.../municipal-ad`), and the truncated URL then returned 403 — which the probe
labelled a wall. **It is not a wall; it is our own broken link extraction.**
Naming it as a wall would have been a false claim about a government, which is
the one failure this product cannot survive.

### 5. NJ statutory legal notices

**How conceived.** Statutory publication in a newspaper of record — meetings,
budget hearings, bond ordinances, sample ballots — each naming the body and the
date. Many states run a statewide aggregator.

**Literal URL.** `https://www.njpublicnotices.com/`

**Returned.** **HIT, rung 2, HTTP 200, 238,886 bytes**, control present.

**Not walked further this session.** Its search interface, its coverage and its
terms are unexamined, and it is a commercial aggregator rather than a `.gov`
publication — so the RULING 70 licensing question applies before anything is
taken from it.

### 6. Platform tenancy, asked as the INVERSE question — GENERALISES

**How conceived.** Nine adapters, each wired one tenant at a time for a body
somebody had already decided to cover. **Nothing had ever asked the inverse:
given a body, is it already on a platform we can read?**

**Literal instrument.** `pnpm tenancy --state <code>`, reading the descent's own
candidate hosts.

**Returned.** 518 hosts known across three states, 135 probed, **14 reachable
now** by an adapter this project already runs, 17 on a platform we recognise and
cannot read, 87 with nothing machine-readable detected.

**The find that matters:** **`morriscountynj.gov` → `morriscountynj.iqm2.com/Citizens/LegalNotice.aspx`.**
Morris County is the county containing **07866** and this project has an IQM2
adapter. **New Hampshire returned ZERO**, which is its own finding about how
NH's small towns publish.

**Generalises?** To every state and every platform, and the platform list is
data rather than code.

---

### The routes NAMED in the brief and NOT walked this session

Named individually rather than counted, because RULING 170 says reaching the end
of a list is not completion — and this session did not even reach the end of the
list.

- **The tax rate table for NJ and AZ** — only NH was walked.
- **Budget and audit documents** — NJ's Division of Local Government Services
  *user-friendly budget* per municipality, which lists officials outright; state
  comptroller and auditor per-entity audits. The AZ Auditor General URL tried
  was a wrong guess (404) and the real one was not found.
- **Minutes of the tier above** — a county board's minutes recording
  appointments to the boards beneath it.
- **Annual reports** — a town's annual report carrying every board's membership
  and the moderator's certified results.
- **State oversight directories** — the education agency's district and
  superintendent directory, the fire marshal's fire-district directory, the
  library commission's library-board directory. `education.nh.gov` and
  `azed.gov` were made WALKABLE this session and their directories were not
  walked.
- **Public records requests**, named per RULING 94 and not made.
- **AZ and NH legal notices**, and the statewide aggregators for both.

**This session stopped short of the end of the brief's own list, and says so in
those words.** Under RULING 170 that list was a floor and not a ceiling, so
stopping before its end is stopping early twice over.

---

## 2026-09-17 — the Polarization Research Lab re-walked, full inventory (PRL ingestion)

The g20 entry above read four elite files on 2026-08-19. The site has grown: the
Open Data page now publishes **fifteen** files across a federal and a state tab.
The full inventory was read off the rendered SPA (its download links are in the
DOM once the two elite tabs are clicked), and `robots.txt` was read directly.

- **`robots.txt`** — `User-agent: * / Allow: / / Disallow: /admin/`. Every
  `/data/elite/*` path is permitted; only `/admin/` is refused. Permission is
  settled by that plus the CC BY 4.0 licence plus the explicit author directive.
- **The fifteen files**, all under `https://americaspoliticalpulse.com/data/elite/`:
  five dictionaries (`communication-meta.csv`, `profiles-meta.csv`,
  `primary-meta.csv`, `state-meta.csv`, `state-profiles-meta.csv`); three
  aggregate profiles (`profiles.zip`, `profiles-all-national.zip`,
  `state-profiles.zip`); and seven large sets (`rhetoric-all.zip`,
  `rhetoric-all-national.zip`, `primary-rhetoric.zip`, `state-rhetoric-all.zip`,
  `newsletters-fulltext.zip`, `statements-fulltext.zip`, `floor-fulltext.zip`).
  The typed registry is `lib/sources/prl/inventory.ts`.
- **Read off the files, not the labels.** The classified-statement and state
  rhetoric sets carry a `last_updated` distinct from the publication `date` and
  years later than it — PRL reclassifies old statements — so their incremental
  cursor is `last_updated`, not `date`. State legislators key by `openstates_id`,
  primary candidates by FEC `candidate_id`, federal by `bioguide_id`. The site's
  "262K rows" label for `primary-rhetoric.zip` is stale; the file parses to
  572,451 — which is exactly why the ingestion counts the file, never the label.
  The full account is `docs/prl-ingestion.md`.
