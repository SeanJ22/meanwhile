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

## 2026-08-26 — RULING 97 ANSWERED FOR SEAN'S PIMA FINDS

He supplied eight Pima and Vail URLs in the descent brief:
`pima.gov/394/Elections`, `pima.gov/810/Upcoming-Elections-and-Events`,
`pima.gov/2619/Administration`, `pima.gov/2317/Board-of-Supervisors`,
`pima.gov/2312/Clerk-of-the-Board`, `pima.legistar.com/Calendar.aspx`,
`vailschooldistrict.org/page/override-reauthorization-2026` and
`vailschooldistrict.org/page/governing-board`.

**RULING 97 says a founder find is a defect in the discovery process, and that
absorbing it as a new manifest entry and moving on is NOT an adequate
response.** Three questions, answered.

### 1. What procedure would have found these without him?

**Descending the county's own site as a tree.** Every one of the eight is
reachable from `pima.gov` by following links — `2619/Administration` names the
departments, `2490/Departments-Offices` names 71 more, and the Board of
Supervisors page names the five district pages. Nothing exotic was required:
the county publishes an index of itself and nobody had opened it.

`vailschooldistrict.org/page/governing-board` is one link from the district's
own front page, and the override page is one link from that.

### 2. Why did that procedure not run?

**Because it did not exist.** This project had:

- a LADDER (fourteen rungs) — how to get bytes past a wall,
- a TREE (RULING 52) — where else a fact might live,
- a MANIFEST (RULING 61) — the named routes to a field,
- TIERS (RULING 84) — which routes to walk first,
- and RULING 93 — ask what the tier above publishes about the tier below.

**Not one of them walks a site.** Every instrument in the list starts from a
FIELD that is already owed about an entity that is already named, and asks
where to get it. None of them starts from a GOVERNMENT and asks what is in it.
So a county publishing an index of its own departments was invisible to the
whole apparatus, because no instrument's input was ever *a county*.

That is why RULING 93 changed no behaviour despite being law since
2026-08-22: it is a principle with no output, and a session could satisfy it in
its own belief while walking one page.

### 3. What changed so it runs next time?

**`pnpm descent --state <code>`** — `scripts/descent.mts`, `lib/hunt/descent.ts`,
`lib/hunt/descent-seeds.ts`, `lib/hunt/descent-walk.ts`. It takes a STATE, walks
the seven tiers in descent order, follows what each level names, and reports
per level: **links found · followed · yielded · barren · declined with reason ·
catalogued · candidate bodies not already matched in the registry**, plus the
pass count and the final pass's new-link count.

**RULING 169 makes the count mandatory** — *a walk is counted or it did not
happen* — so a session cannot report a walk it did not take, and a walk still
producing links at its final pass reports STOPPED rather than FINISHED.

**`lib/hunt/descent-gate.ts` refuses a hunt for a state nobody has descended**,
the way `state-registry-gate.ts` refuses one for a state nobody has enumerated.

*And it worked on the first run, against his own finds:* the Arizona descent
reached `pima.gov/2490/Departments-Offices` (71 candidates), `pima.gov/District1`,
`District2` and `District4`, none of which he named, by following the pages he
did. **The procedure now finds more than the founder did**, which is the only
adequate answer to RULING 97.

### What is still owed on the eight

`pima.gov/810/Upcoming-Elections-and-Events` and
`vailschooldistrict.org/page/override-reauthorization-2026` were **NOT walked
this session** — they are ballot-measure sources and Item 5 was not reached.
Named here rather than left implicit.

## 2026-08-26 — THE TIER VOCABULARY, AND ARIZONA'S MISSING LAYER

Written in full at `states/TIERS.md`. The Arizona headline:

**Arizona has NO minor-civil-division tier.** The 2022 Census of Governments
records **0 townships** in Arizona against 239 in New Jersey and 223 in New
Hampshire. Territory outside an incorporated city or town is **unincorporated**
and the COUNTY is its municipal government — there is no town clerk to ask.

So the Arizona descent walking no tier-6 level is a **correct measurement of the
state rather than a gap in the walk**, and it is written down so no later
session reads it as one. This is RULING 60's warning arriving as a measurement:
every branch this project built before Arizona was built against New England
town government.

## 2026-08-26 — PLATFORM TENANCY, THE INVERSE QUESTION

`pnpm tenancy --state az` — 85 hosts known from the descent, 45 probed, 13
refused on permission. **5 reachable now** by an adapter this project already
runs, **3 on a platform we recognise and cannot read**, 24 with nothing
machine-readable detected.

The five, none of them connected: **`gilacountyaz.gov` (Revize)**,
**`navajocountyaz.gov`**, **`pinalcountyaz.gov`** and
**`santacruzcountyaz.gov`** (CivicPlus). Table at `states/az/tenancy.md`.

**Pima's Legistar tenant was ALREADY WIRED** — `lib/sources/legistar/clients.ts`
carries it as the only client, with two venues and their coordinates. The
brief's Item 4 premise that *nobody asked the county whether it had a tenant* is
wrong against the repo, and is recorded as wrong rather than worked around.
