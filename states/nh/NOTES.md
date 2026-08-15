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
| Merrimack County Board of Commissioners | Revize, upcoming block + notices archive | LIVE |
| Kearsarge Regional School District Board | `kearsarge.org` agendas page | see below |

The county's own index page is **stale** — it names a former District 1
commissioner. The FY2025 annual report and the minutes are what the roster
cites.

`kearsarge.org` walls a plain client and **opened to a browser User-Agent on
2026-08-14**. Recorded as a rung that worked on that date, not as a permanent
route.

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
