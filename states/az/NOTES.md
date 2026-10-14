# Arizona — state notes

The state's own memory: filing systems, vendor patterns, walls, statutory
posting rules. Appended by every session that learns something about AZ.
Born 2026-08-15 (the NH/NJ depth session) — created for parity with the two
states that session went deep on, and seeded from what the repo already knew.
The method across all states is the field manual; this file is what is
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

**Pima's Legistar tenant was ALREADY WIRED** — `data/states/az/meetings/legistar-venues.json`
carries it as the only client, with two venues and their coordinates. The
brief's Item 4 premise that *nobody asked the county whether it had a tenant* is
wrong against the repo, and is recorded as wrong rather than worked around.

## 2026-08-27 — WHAT ARIZONA COMPELS A GOVERNMENT TO FILE

(The 85641 detective session. Append-only. The ZIP-specific findings are in
`states/az/85641.md`; these are the ones true of the state.)

### The state education agency is a MEETING source for every district

**`budgetsystem.azed.gov/reports/submissionstatusview`** is the Arizona
Department of Education's Finance Systems file-submission index, and it is the
most useful thing found in Arizona this session. A Kendo grid over a plain GET
handler — `?handler=submissionstatusreportdata`, with an antiforgery token
minted from the page — returning **every document every Arizona LEA has filed
with the state**, by fiscal year: 3,880 district filings for FY2026, 2,356 for
FY2027. Each row carries a `FileSubmissionId` and downloads at
`?handler=filedownload&submissionReferenceId=<id>`.

Eighteen document templates for FY2026. The three that matter to a hunt:

- **School District Meeting Notification** — the statutory notice required by
  **A.R.S. § 15-905(C)**, carrying the meeting DATE, TIME, VENUE, ROOM, STREET
  ADDRESS, city, state, zip, and a NAMED agenda contact with phone and email.
- **District Annual Financial Report**
- **District Expenditure Budget** — which also carries the district's primary
  and secondary TAX RATES and its M&O budget limit.

**This is how a district with no website still has a machine-readable
meeting.** Empire Elementary No. 37 operates no schools and employs no staff;
its board meeting, venue and agenda contact came out of here.

Two parsing facts, both learned the hard way. The notice workbook is a fixed
state template and its **column A holds numeric placeholders, not captions** —
a label-based read of it returns nothing and must not be reported as a district
with no meeting; read it by cell reference (C5 date, I5 time, C8 street, C9
venue, F9 room, C10/F10/I10 city/state/zip, C13/I13/C14 agenda contact). And a
bare integer in a value column is the template showing through, never a venue
or a phone number. Times arrive both as text and as Excel day-fractions.

The host serves a Cloudflare challenge to node's `fetch` and answers **curl**.
Every request goes out at rung 4.

### The transportation-only school district — a class, not an oddity

A district that **operates no schools and employs no staff**, existing to pay
tuition and transport its resident children to a neighbouring district. Pima
County has two: **Empire Elementary No. 37** (to Sonoita Elementary, Santa Cruz
County) and **Redington Elementary No. 44** (to Mammoth-San Manuel Unified).

A blank website column for one of these is **a dated measurement of what two
official enumerations hold** — Pima County GIS and the NCES CCD LEA directory
both record Empire's as blank. The transportation-only structure helps explain
it: no schools, no staff, little to publish and nobody to publish it.

**That explains the blank; it does not make it permanent.** (Corrected
2026-08-27; this passage previously said such districts would never have a
website and that the blank column was therefore a correct measurement of the
government rather than a gap in the enumeration.) No source consulted says such
a district cannot or will not publish, and treating the blank as permanent
retires the recheck on a field that can change. What is recorded is the blank,
its date, and the filing system that answered instead. The county school
superintendent's own district directory is what names the class.

### Unorganized territory is a status with an authority, not a gap

**A.R.S. § 15-825.** Territory outside the boundaries of any local education
agency, where school district property taxes are **not levied**. A child living
there seeks open enrollment or a **certificate of educational convenience**
from the **county school superintendent**, who is therefore their school
authority. Pima routes applications through `cec.pima.gov` and pays mileage
reimbursement.

Any Arizona ZIP showing "School District Not Defined" in the county GIS should
be read against this before it is called a coverage hole.

### The county school superintendent is a filing officer, and publishes like one

`www.schools.pima.gov` (ExpressionEngine — a CMS not previously in this
project's vendor taxonomy; note the bare host fails HTTPS and the `www.` host
answers). It publishes, for the whole county:

- **the numbered school-district propositions** for the cycle, which is where a
  local override or bond gets its ballot number;
- **who filed for every governing board seat**, with filing date and signature
  count, and the minimum signatures each district requires;
- the district directory, including the transportation-only annotation;
- the unorganized-territory rules above.

Arizona's fifteen counties each have one of these offices. This is a
per-county route, not a Pima one.

### AN UNCONTESTED SCHOOL BOARD ELECTION IS CANCELLED AND THE SEAT IS APPOINTED

The single most reader-facing Arizona finding of the session. The **Board of
Supervisors**, on the School Superintendent's request, cancels the uncontested
school-district governing board positions and **appoints the people who filed**.
Pima did it for the November 3, 2026 general on **2026-08-11** (Legistar matter
21690, File ID 20624, APPROVED).

Consequences a hunt must not miss:

- **A district absent from the candidate-filing list may have an election that
  was cancelled, not an election with no candidates.** Vail Unified was absent
  from the filing page and its two seats were filled by appointment.
- **The appointment record is where a new board member's name first appears** —
  Andrea Black joined Vail's board this way and appears in no roster page.
- **A district with nobody filing gets recorded VACANCIES**, which is a real
  civic fact: Empire Elementary No. 37 carries three.

The cancellation matter is a Board of Supervisors agenda item, so it is in
Legistar and in this repo's own meeting snapshots. **It was sitting in
`data/meetings-snapshot.json` and nobody had opened it** — the RULING 97 shape
again.

### THE CERTIFIED CANVASS IS NOT THE BALLOT

`states/az/NOTES.md` already records that **party lives in the certified PRIMARY
canvass**. The other half of that is now measured, and it cuts the opposite way:

**The canvass contains CONTESTED races only.** The Pima canvass says so in its
own *"Master List of All Contested Races"* — 15 races, against **34 contests
and 101 candidates** on the county's **Official Candidate List**, which is the
record of what was PRINTED and therefore includes unopposed seats.

So: **canvass for PARTY and for the RESULT; official candidate list for the
BALLOT UNIVERSE.** Building a ballot from the canvass drops every uncontested
seat silently, in the direction that looks like completeness.

The Pima list also settles seat counts a statewide filing does not state — it
is what gave Corporation Commissioner its "Vote for not more than 2".

### County officers are on the PRESIDENTIAL cycle

Pima's 2026 ballot carries Board of Supervisors **District 5 only**, Constables
in Precincts **2, 3 and 9 only**, and no Sheriff, Assessor, Recorder, Treasurer,
County Attorney or School Superintendent. Read from the official candidate list,
which prints uncontested races — so this is the schedule, not a filing drought.

### Joint districts cross county lines, and so do fire districts

Measured on **Pima County JTED No. 11**: its territory is about **73%** of Pima
County's area *and* contains sampled points in **PINAL COUNTY**. A "Pima County"
district is not a Pima County shape.

With Mescal-J6 (formed in Cochise), Sonoita-Elgin (serving Santa Cruz
communities) and Empire Elementary's students attending a Santa Cruz district,
that is **four separate classes** in which an Arizona district named for one
county reaches into another. Treat a county-named district's territory as an
open question until it is measured.

### A district with no boundary layer still has a boundary

Arizona community facilities districts are formed under **A.R.S. §§ 48-701 to
48-725** by a county resolution that must recite the land — by recorded plat
book and page, or by recorder sequence number, because the tax attaches to
parcels. The county publishes its recorded subdivision plats as GIS for
unrelated reasons. Join the two: `pnpm cfd:territory`.

The formation resolution also answers **who governs it**: for both Pima CFDs,
the members of the Board of Supervisors ex officio, with the County
Administrator, County Treasurer and Clerk of the Board as District
Administrator, Treasurer and Clerk. And **A.R.S. § 48-718 requires a copy of
every CFD formation resolution and general plan to be filed with the ARIZONA
DEPARTMENT OF REAL ESTATE** — a statewide CFD enumerator this project has never
walked.

### The districts the county board IS

Arizona counties carry several separate political taxing subdivisions whose
board is the Board of Supervisors sitting as them, each with its own budget and
its own resolution series. In Pima: the Regional Flood Control District
(A.R.S. § 48-3603), the Free Library District (§ 48-3901(C), levying countywide
under § 48-3903), the **Stadium District** (§ 48-4202 — countywide, a class this
project did not know existed), the two CFDs, and the **Ajo Domestic Water
Improvement District**, which appears on the agenda under the literal heading
*"BOARD OF SUPERVISORS SITTING AS OTHER BOARDS"*.

**They have no separate agenda calendar and that is not a gap.** The Legistar
Web API at `webapi.legistar.com/v1/pima/bodies` returns four bodies — the Board
and its addenda. The districts' business is in `/matters`, searchable by
`substringof('<district>', MatterTitle)`, carrying each district's own budget
hearings and its own resolution numbering (2026-**RK1** for Rocking K South,
WCFD1 for Wildflower).

### CivicPlus ships its document tree into the page

`content.civicplus.com/api/assets/<tenant>/<uuid>` — Pima's tenant is
`az-pimacounty`. A CivicPlus page hydrates a catalogue of its documents into the
served HTML with ids, filenames, slugs and a `parentId`. **Read the hydration
state, not the anchors**: the Rocking K CFD page displayed thirteen document
names and carried only five as anchors in the markup.

### Permission and transport, dated 2026-08-27

- **`vailschooldistrict.community.highbond.com` — `Disallow: /`.** Highbond is
  REFUSED, not merely unbuilt. Never re-walked on a clock.
- **`vailschools.novusagenda.com`** — robots.txt 404, `NO_ROBOTS`, walkable.
- **`apps.arizona.vote`** — Cloudflare challenge at rungs 2, 3, 4, 5 AND the
  live browser. `CANNOT_TELL`, not walked (RULING 182). It holds the official
  general-election Candidate Listing; the same facts were obtained from
  `apps.azsos.gov` and from the county's own publication.
- **`www.azed.gov` challenges NON-DETERMINISTICALLY** — roughly one request in
  three. A single-pass `robots:sweep` returns `CANNOT_TELL` and would refuse
  the state education agency; a retry at rung 4 reads a standard Drupal
  robots.txt allowing every content path. **Retry before believing a
  CANNOT_TELL.**
- **`apps.azsos.gov`** — ALLOWED, and it hosts every county's certified canvass
  PDF. Pima's is 4,445 pages with a text layer on 4,435: the full
  precinct-level Statement of Votes Cast.
- **`webapi.legistar.com`, `gisdata.pima.gov`** — robots.txt 404, `NO_ROBOTS`.
- **`schools.pima.gov`** fails HTTPS at the bare host; **`www.schools.pima.gov`**
  answers. A transport quirk, not a refusal — the Mescal-J6 shape again.

### CivicClerk, and the tenant slug in the page

**A meeting portal delivered as an EMBED SCRIPT has to tell the browser which
tenant to render, so the identifier is in the host page's own markup.**

The Central Arizona Water Conservation District's meetings page serves 222,565
bytes with no dated meeting link and no iCalendar feed. Beside CivicClerk's
embed bundle it carries:

```js
window.clerkEmbedProps = {"tenant": "capaz", "categoryIds": "26,27,28,29,30,34,35,37"};
```

With that slug the portal's own API answers a plain unauthenticated GET:

```
https://<tenant>.api.civicclerk.com/v1/Events
```

OData, so `$filter`, `$orderby` and `$top` all work. It returns the date, the
start time, the body, the category, the venue with a street address, and flags
for a published agenda and minutes. `NO_ROBOTS` on the API host; the portal
host allows.

`lib/sources/civicclerk/index.ts` reads it. **`CIVICCLERK` is a distinct
`AgendaSourceType` from `CIVICPLUS`** — same corporate family, different
products, and a reader following a CivicPlus agenda link would not arrive here.

Two things worth carrying to the next tenant. The **category is the body** —
"Board Meeting", "Finance, Audit and Power Committee" — and the event name is
the sitting's title, so a row with no category is dropped rather than filed
under the district at large. And the tenant **spells one room several ways**:
CAP writes its Lake Mead Conference Room two ways and its Board Room a third,
so each published spelling needs its own venue row.

### The Central Arizona Water Conservation District

A government that appears in no Pima County directory and on no boundary layer
this project has walked. It was found only in the county's levy resolution,
which is the entire argument for reading that document.

- It levies **ad valorem secondary 0.1000 and water storage secondary 0.0400 on
  the county's full valuation**, plus groundwater replenishment at $952.00 per
  acre-foot and $33.52 per lot across 15,177 lots. So it governs every Pima
  County ZIP.
- **Its board is DIRECTLY ELECTED** — the only one of the five districts added
  this day that is not the Board of Supervisors sitting as itself. Fifteen
  members, elected by county. Three confirmed Pima County from their own pages:
  **Karen Cesare, Pat Jacobs, Mark Taylor**. Four members' pages state no
  county and are NOT assigned to one.
- It covers **Maricopa, Pinal and Pima**, so it is a fourth class of
  cross-county Arizona district.
- **Its meetings are in Phoenix**, 180 km from Vail. That is not a mismatch to
  hide: it taxes every parcel in Pima County and Phoenix is where it decides.

### An uncovered government correctly makes coverage look worse

Adding this district with no adapter moved both Pima pilot ZIPs from
`NONE_SCHEDULED` to `NO_SOURCE`, because there was now a government at those
points whose calendar could not be read. **That is the system working**, and
the available shortcut — leave the district out, keep the greener state — is
the one CLAUDE.md forbids in as many words: *collection state never governs
display*, and nothing is suppressed because something else is missing.

The district went in, and then the adapter did. `tests/coverage.test.ts` now
records the arc rather than the answer.

## 2026-09-25 — DESTINY AGENDA: WHERE CHANDLER'S AGENDAS, RESULTS AND MINUTES ARE

(The failing-sources session. Append-only.)

**The route.** Chandler posts every agenda, result and minutes set on Destiny
Agenda: `https://public.destinyhosted.com/agenda_publish.cfm?id=24263&mt=<type>`,
one month per page (`&get_month=M&get_year=YYYY`). The City Council's type is
`CC`; the page's own type menu lists about forty more (Planning and Zoning `PZ`,
Board of Adjustment `BOA`, the commissions and foundations), and `CANCEL` holds
cancellation notices. Each row: the agenda link (text = the date as printed,
title attribute = "View Agenda for <meeting> (MM/DD/YYYY)"), the meeting's name,
the minutes cell ("Results" or "Minutes", a PDF under `/chanddocs/`), and other
links ("Video", on `chandleraz.new.swagit.com`). A month with nothing posted
says so: "No agendas or minutes were found for the meeting type 'City Council'
in October 2026." The hrefs are entity-encoded (`&#x3f;`, `&#x3d;`).

**Why it was never read, and what changed.** Its robots.txt is one line,
`User-agent: * Disallow: /`, so it was never requested. Since the owner's
2026-09-25 decision that robots.txt no longer blocks reading public pages, it
was checked: HTTP 200 from IIS to the project's identified client, no challenge.
The agenda page itself (`&dsp=ag&seq=N`, ~134 KB) is HTML with the whole agenda:
title, date and time, the chambers' address, and every item.

**How it is used.** `destinyAgenda` on a `schedulepage` row
(`lib/sources/schedulepage/destiny-agenda.ts`) reads the months in reach and
JOINS rows to sittings the body's own pages already dated: a sitting whose title
the city printed joins on date + name, a date-only sitting only where the list
gives that date one row. No sitting is ever made from the list (it states no
time or place). Wired for the Council on 2026-09-25; the same field serves any
Destiny tenant (search results for `destinyhosted.com agenda_publish.cfm <city>`
find the tenant id).

## 2026-09-25 — MESA'S MINUTES: THE CLERK WRITES A MOTION THREE WAYS

The minutes parser (`lib/sources/legistar-insite/minutes.ts`) read only "It was
moved by X, seconded by Y, that …". The clerk also writes "…, seconded by Y,
receipt of the above listed minutes be acknowledged." (no "that"; the 2026-06-04
study session) and "…, seconded by Y, to direct the City Attorney to pursue
litigation …" (an infinitive; the 2026-08-13 study session). Both now read; any
other continuation stays a named unread passage. A scan of all 21 documents the
promoted projection cites found no other missed motion. The 2026-05-28
strategic planning session records no motion and does not say no action was
taken; it stays a failed extraction by rule.

### A minutes document that fails by rule is not downloaded again every hour (2026-09-25)

Mesa's 2026-05-28 strategic planning minutes (18,779,714 bytes) record no motion
and do not say no action was taken, so every read is a failed extraction by
rule. Each failure refused the candidate; the contract retries a failed pass
after an hour; each retry downloaded the same 18.8 MB and failed again. Now the
failure is HELD in the projection as `ZERO_ROWS_FAILED` with the identity of the
bytes it failed on (`failedMinutesRead`: URL, label, sha256, length, type, any
ETag/Last-Modified, parser revision, read time), named on every candidate as
`MINUTES_EXTRACTION_FAILED_HELD`, and the pass promotes. Later passes send one
paced HEAD first: Mesa's portal answers it with the length and type and no
validators (measured). Unchanged: nothing is downloaded. Changed length, type
or validator, a new link or label, or a new `MINUTES_PARSER_REVISION`: read at
once. A week old: the bytes are re-read once to catch a same-length
replacement. A failed REQUEST still refuses the candidate and retries in an
hour; a failure over verified minutes keeps the verified reading. The same
HEAD-before-GET rule fits any large document route whose extraction can fail
deterministically.
