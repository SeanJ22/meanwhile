# Arizona — state notes

The state's own memory: filing systems, vendor patterns, walls, statutory
posting rules. Appended by every session that learns something about AZ.
Born 2026-08-15 (the NH/NJ depth session) — created for parity with the two
states that session went deep on, and seeded from what the repo already knew.
The method across all states is `docs/zip-playbook.md`; this file is what is
true of this one.

## Elections and filings

- **Party lives in the certified PRIMARY canvass, not the general.** Pima
  County's certified general canvass carries names and totals and no
  affiliation at all. The primary canvass heads each race by party — `DEM
  Board of Supervisors District 1`, `REP Board of Supervisors District 4`.
- **The same documents prove the negative.** School district governing board
  races appear in the general canvass with no party beside any candidate and
  appear in the party-organised primary canvass under no party heading at all.
  That is the election authority's own record saying the seats carry no party.
- **An appointed supervisor has no certified result.** Arizona requires a
  county-supervisor appointee to share the vacating member's registration and
  the county's own call for applications said so — a sound inference, and
  still not a certified result, so the card renders nothing.
- `tucsonaz.gov` **403s a general-purpose fetcher and admits this project's
  identified User-Agent.** It served every certified document requested.
- **`azleg.gov` publishes the Legislative Council's ballot-measure analyses**
  as PDFs under `/alispdfs/Council/2026BallotMeasures/`, linked from
  `azleg.gov/ballot-measures-2026-analyses/`.
- One document is named rather than skipped: the City of Tucson's certified
  Ward 3 primary **recount** PDF is a scan with no text layer. The party
  finding does not depend on it, and the recount margin itself was not read.

## Meeting notice, by statute

**A.R.S. § 38-431.02** requires the agenda on the body's own website 24 hours
ahead. Arizona is therefore the state where the *body's own site* is reliably
the primary source, and where a missing agenda is genuinely unusual.

**A.R.S. § 39-121.03** is where the commercial-purpose machinery attaches to a
formal public-records request. A formal request is the manual sibling of
ladder rung 9 and is never automated.

## Vendors and site patterns

- **Never infer the agenda vendor from the website CMS.** Tucson runs Granicus
  OpenCities and is a **Hyland OnBase Agenda Online** tenant
  (`tucsonaz.hylandcloud.com/221agendaonline`). Assuming Legistar from the CMS
  would have been wrong twice.
- **The City Clerk's boards-committees-commissions directory is the complete
  enumeration of a city's bodies** — Tucson's listed 56, read verbatim into
  `lib/registry/curated-bodies.ts`. One page is the whole density story for a
  city. The per-board pages are a server-rendered embedded frame at
  `clerksboards.tucsonaz.gov/boards/?board=<id>`.
- **Legistar** — Pima County (`pima.legistar.com`). The county board also sits
  as the Library District and Ajo Domestic Water; joint meetings appear on
  both parties' calendars, so a parent body's feed is a real rung.
- **Apptegy Thrillshare** — Vail USD, via the district site's own events API.
- **BoardBook Premier (Sparq)** — Amphitheater USD. The org page
  server-renders the whole archive with per-row venue name and street address.
  Meetings post only days ahead, so an empty upcoming window between postings
  is the portal's honest state, not a failure.
- **Diligent Community** — Pima Community College, a district with no Census
  boundary at all (`ocdId: null`, a curated body).

## Special districts

Twenty-four in Pima County per the 2022 Census of Governments — the largest
class of government and the one the boundary-derived registry structurally
lacks. Four serving the target zips are curated (RTA, Rio Nuevo, Rincon Valley
FD, Corona de Tucson FD); the other twenty are enumerated in
`data/audit/gus-2022-clip-counties.json` and are backlog, each implicitly
NOT_ATTEMPTED.


## 2026-08-26 — THE FILING OFFICER IS A STATUTE, AND THE STATE PUBLISHES ITS OWN TABLES

(The sources-and-incumbency session. Append-only.)

**A.R.S. § 16-928, read from `azleg.gov` on 2026-08-26**, routes
campaign-finance filing by which election the money influences: the **Secretary
of State** for statewide and legislative; **the county officer in charge of
elections** for county, **school district, community college district** and
special taxing district; the **city or town clerk** for city and town.

*Two corrections to how this was carried in the brief that ordered the walk:*
the county-level officer is *the county officer in charge of elections*, a
single defined role, not "recorder, elections department or board of
supervisors"; and the statute explicitly names **school and community college
districts**, which is the tier this product reaches and nobody else does.

**109 filing jurisdictions — 1 state, 15 counties, 93 cities and towns**, from
the state's own `Jurisdictions.txt`. That is the denominator any Arizona
campaign-finance coverage claim needs.

### `ftp://ftp.azsos.gov/cfsdata2/` — anonymous, live, never walked before

Named in Arizona's own *Bulk Filing Guide* (revised **28 July 2026**). Fourteen
files. **`Committees.txt` carries 8,828 committees** with type, address and
organisation/termination dates; **1,958 carry no termination date**.

**Clean Elections participation is a FILED FIELD already in bulk** — 810
participating candidate committees against 3,767 not participating. No
per-candidate hunt is needed for it.

**Bulk extract of the MONEY: no.** The guide is an UPLOAD specification. Bulk
reference tables: yes, at the path above.

### Vendors, and the route to local money at scale

**EasyVote** serves Pima County's campaign-finance portal. A vendor serving one
county serves others, so local finance portals get the agenda-platform
treatment: identify the vendor, then ask whether a tenant list exists. **Whether
an EasyVote tenant list exists is UNANSWERED as of 2026-08-26.**

### Walls, dated

`irc.az.gov` — the Independent Redistricting Commission — answers **HTTP 403 to
a plain fetch and HTTP 200 to a full browser header set on `robots.txt`**. A
rung-3 wall that falls. The site itself was still 403 at rung 3; rungs 4, 5 and 6
are unwalked. Last tested **2026-08-26**.

### Registered and set aside

`az_site_sliver` is a Drupal module **mandated on every Arizona state government
website**, which makes its presence a fingerprint for verifying a site is
genuinely official — a second signal beside `cisagov/dotgov-data`.
