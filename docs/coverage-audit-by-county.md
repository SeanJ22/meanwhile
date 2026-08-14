# Coverage audit by county — the official universe vs. the registry vs. the wiring

Written 2026-08-17 (session brief item 3). Two layers, per clip county:

- **Layer 1** — the registry measured against the OFFICIAL universe: the
  2022 Census of Governments government-units listing
  (`data/audit/gus-2022-clip-counties.json`, extracted from
  `www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP`,
  fetched 2026-08-17), cross-checked against the registry's Census boundary
  derivation. The denominator is theirs, never ours — a registry that
  defines its own denominator cannot be caught missing anything (CLAUDE.md,
  adopted 2026-08-17).
- **Layer 2** — the registry measured against the wiring: how many known
  bodies have a live calendar source, and which have curated rosters.

The Sunnyside catch resolves as follows: **Sunnyside Unified and
Amphitheater Unified have been registry divisions with derived boards since
the school layer was built** — the author's five-minute miss was a surface
gap (their boards render as coverage-notice rows, not pins, because no
agenda source is wired), not an existence gap. The real Layer 1 finding is
the category the registry structurally lacked: **special districts** — the
largest class of government in the country — and the no-boundary school
tier (community college, JTED, county vocational). Ten of those now exist
as curated bodies (see 3c below).

## Layer 1 — the official universe

### Pima County, AZ — 50 governments in the official universe

| Category | Official (GUS 2022) | In registry | Verdict |
|---|---|---|---|
| County | 1 | 1 | ✔ complete |
| Municipal | 5 (Tucson, South Tucson, Marana, Oro Valley, Sahuarita) | 5 | ✔ complete — pinned per county in `tests/coverage.test.ts` |
| Independent school districts | 18 | 16 boundary-derived + 2 curated | ✔ complete. The 16 with Census boundaries (incl. **Sunnyside 12** and **Amphitheater 10**) are divisions with derived boards. The 2 without Census boundaries — **Pima Community College District** (D28, LIVE) and **Pima County JTED 11** (curated 2026-08-17, NOT_ATTEMPTED) — are curated bodies. |
| Dependent school units | 2 | 0 — explained | Pima County Special Education Program 99 and Pima Accommodation District are programs of the elected County School Superintendent, not independently governed units (Census classes them dependent). The Superintendent's office is the reachable body; a registry row would double-count. |
| Special districts | 24 | 4 curated (2026-08-17) | **The measured gap.** RTA, Rio Nuevo, Rincon Valley FD, Corona de Tucson FD added (they serve 85701/85641 — see 3c). The other 20 (12 more fire districts, 4 irrigation/drainage, Ajo-Lukeville health services, Tucson Country Club Estates FD, Sabino Vista FD, Mt Lemmon FD…) are enumerated in the committed GUS extract and are backlog, each implicitly NOT_ATTEMPTED. |

### Morris County, NJ — 98 governments in the official universe

| Category | Official (GUS 2022) | In registry | Verdict |
|---|---|---|---|
| County | 1 | 1 | ✔ complete |
| Municipal | 39 (19 boroughs+towns, 20 townships) | 39 | ✔ complete — pinned per county; Rockaway borough AND township both survive (the M17 direction test) |
| Independent school districts | 38 | 38 | ✔ complete — checked name-by-name against the GUS list 2026-08-17: every district including Rockaway Township SD, Morris Hills Regional, Hanover Park Regional, West Morris Regional, East Hanover, both Mendhams, both Boontons is a registry division with a derived board. |
| Dependent school units | 2 | 2 curated (2026-08-17) | County College of Morris and Morris County Vocational School District — county-dependent but really-governed; curated bodies, NOT_ATTEMPTED. |
| Special districts | 18 | 2 curated (2026-08-17) | RVRSA (member municipalities include Rockaway Township) and the Soil Conservation District added. Backlog: 12 fire districts (Montville ×3, Hanover ×2, Parsippany-Troy Hills ×6, one more), 4 sewerage/utilities authorities (SMCMUA, Pequannock River Basin, Two Bridges, Musconetcong), NJ Public Power Authority. None of the fire districts covers Rockaway Township (its fire service is municipal). |

### Merrimack County, NH — 63 governments in the official universe

| Category | Official (GUS 2022) | In registry | Verdict |
|---|---|---|---|
| County | 1 | 1 | ✔ complete |
| Municipal | 27 (2 cities, 25 towns) | 27 | ✔ complete — pinned per county; Concord keeps its FUNCSTAT=A row |
| Independent school districts | 16 | 16 | ✔ complete — checked name-by-name 2026-08-17 (incl. Kearsarge Regional, John Stark Regional, Merrimack Valley, Hill). NH's SAU layer hides nothing here: SAUs are administrative service units over districts, and every GUS-listed *district* is present. |
| Dependent school units | 1 | 1 — explained | Franklin School District is city-dependent (Census). It appears in the registry as a boundary-derived division (Franklin School District) — governed via the city; no double-count. |
| Special districts | 18 | 1 curated (2026-08-17) | The County Conservation District (county-wide, so it serves 03255) added. Backlog: 13 village districts/precincts (NH RSA 52 governments — Warner Village Water, Contoocook Village, Hopkinton Village, Hooksett ×2, Andover ×2 + East Andover, Epsom, Hardy Road, Highlands, Lake Todd, New London-Springfield Water), Northfield Sewer District, BCEP Solid Waste District, Concord Housing Authority. **No village district's boundary reaches Newbury** — the nearest is Lake Todd (Bradford/Sutton). |

## Layer 2 — the registry vs. the wiring

Counts are for bodies keyed to each state's clip geometry (school layers
reach past the county line by construction; the county row scopes them).
Status meanings: LIVE = an adapter reads the calendar today;
KNOWN_UNCOVERED = a usable source is located, no adapter yet;
NOT_ATTEMPTED = nobody has hunted yet (a real state, never a euphemism for
"blocked" — there is deliberately no blocked status).

| County (state clip) | LIVE | KNOWN_UNCOVERED | NOT_ATTEMPTED | Rosters curated |
|---|---|---|---|---|
| Pima AZ | 10 (+PCC) | 51 | 37 + 5 new curated | Tucson M&C ✔ · Pima BoS ✔ · TUSD ✔ · Vail USD ✔ |
| Morris NJ | 3 | 0 | 134 + 4 new curated | Rockaway Twp council + mayor ✔ (per-member phone+email) · County commissioners ✔ · **Rockaway Twp BOE: surnames only** — the district publishes members by surname in agendas; the Apptegy site's members page defeated the pipeline (browser-phase pickup, hunt recorded) |
| Merrimack NH | 2 | 1 | 84 + 1 new curated | Newbury Selectboard ✔ · County commissioners ✔ (FY2025 annual report; the county site's index page is STALE — names a former D1 commissioner; minutes confirm the report) · Kearsarge board ✔ (9 members — the kearsarge.org wall opened to a browser-UA fetch 2026-08-17) |

Roster key: "✔carded" = every member renders a full card (photo rules per
CLAUDE.md; honest placeholders where the body publishes none). The roster
column's gaps are the 6e worklist, updated as rosters land.

## 3c — what was fixed this session, and the backlog rule

Fixed (curated bodies, homepages fetch-verified 2026-08-17): Pima RTA, Rio
Nuevo District, Rincon Valley FD, Corona de Tucson FD, Pima JTED, RVRSA,
County College of Morris, Morris County Vocational SD, Morris County Soil
Conservation District, Merrimack County Conservation District — every
special district or no-boundary school unit that serves one of the four
zips, plus the county-wide ones. Each is `NOT_ATTEMPTED` for coverage:
the agenda hunt is owed and recorded as owed.

The remaining 45 special districts across the three counties are the
committed backlog — enumerated with Census IDs and web addresses in
`data/audit/gus-2022-clip-counties.json`, absent from the registry, each
one findable by the next audit run. Absence explained ≠ absence excused:
they stay on this list until they are rows.

## Sources

- 2022 Census of Governments, Government Units Listing (Jan 2022 release),
  fetched 2026-08-17 — the general-purpose, special-district, and school
  tabs, filtered to FIPS 04019 / 34027 / 33013.
- Registry: `lib/registry/registry.json` @ 940 divisions / 333 bodies
  (regenerated 2026-08-17 after the curated additions).
- Municipal counts independently pinned against the Census of Governments
  in `tests/coverage.test.ts` (74 = 74 across six counties, per county).
