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
