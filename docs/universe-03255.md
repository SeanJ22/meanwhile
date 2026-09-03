# The 03255 universe, frozen

Written 2026-08-16 (the h session, item 1), **before any hunting began**. This
is C10's frozen object: the denominators, the field matrix, the ballot
universe and the meetings-near rule, all fixed at one moment so the session's
own progress is measurable against something that cannot move underneath it.

A genuine universe change found later is a denominator **correction** with an
audit trail appended below. M never moves silently.

---

## 0. What was frozen, and when

| Object | Where it lives | Frozen |
|---|---|---|
| Body denominators (both universes) | `data/audit/universe-03255.json` | 2026-08-16 |
| Official universe (step A) | `data/states/nh/reference/gus-2022-merrimack-sullivan-hillsborough.json` | fetched 2026-08-16 |
| Required-field matrix | `lib/evidence/field-matrix.ts` (`vH-1`) | 2026-08-16 |
| Target election and ballot universe | `data/states/nh/ballot/nh-merrimack-2026.json` | curated 2026-08-14, adopted here |
| Meetings-near rule | `lib/meetings/constants.ts` `RADIUS_LADDER_KM[0]` | standing law, 25 km |
| Ladder version | `CLAUDE.md`, `ladder vH-start` | 2026-08-16, item 0 |

Session start: **2026-08-16, 22:19 America/Phoenix** — which is already past
midnight UTC, and so is exactly the read `pnpm stamp` exists to prevent. The
UTC instant is in the evidence ledger; the day this session is dated by is the
Phoenix one.

---

## 1. Step A — the authoritative universe

**Source.** 2022 Census of Governments, Government Units Listing
(`Govt_Units_2022_Final.xlsx`), fetched 2026-08-16 from
`www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP` —
HTTP 200, 11,459,763 bytes, rung 2 (plain fetch with an identified
`User-Agent`). Extracted by `pnpm gus:extract`.

**Why three counties and not one.** 03255's twenty-five kilometre circle
crosses two county lines. Goshen, Sunapee, Washington, Springfield, Lempster,
Croydon and Newport are in **Sullivan** County; Hillsborough town is in
**Hillsborough** County. The committed extract at
`data/audit/gus-2022-clip-counties.json` holds Merrimack alone, so before this
session **the official denominator for 03255's meetings-near universe did not
exist in the repository**. Enumerating one county and calling it the
neighbourhood is the Sunnyside class of miss with a wider radius.

| County | FIPS | General purpose | Special districts | School districts | Dependent school | Total |
|---|---|---|---|---|---|---|
| Merrimack NH | 33013 | 28 | 18 | 16 | 1 | **63** |
| Sullivan NH | 33019 | 16 | 13 | 11 | 0 | **40** |
| Hillsborough NH | 33011 | 32 | 9 | 20 | 2 | **63** |
| | | | | | | **166** |

**Merrimack replicates the committed extract exactly — 63 against 63, zero
diff in either direction, by `censusId`.** That is a verification rather than
an agreement: two independent extractions of the same release landing on the
same set is what makes the denominator worth standing on.

### The parse defect that nearly became a data finding

The first run of `pnpm gus:extract` returned **six** special districts in
Merrimack County against the committed extract's eighteen. The natural
reading — that the workbook disagreed with a hand extraction — was wrong.

An empty cell in an `.xlsx` is written self-closing, `<c r="G24141" s="12"/>`,
and a naive `/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/` matches it anyway:
`[^>]*` absorbs the trailing slash and the lazy body then runs on to the NEXT
cell's `</c>`, swallowing it whole. Every column after the first empty one
reads **shifted**. Twelve Merrimack districts have an empty `ADDRESS2`, so
their `FIPS_STATE` had slid one column left into `WEB_ADDRESS` and the county
filter dropped them.

**A shifted column does not look like a parse bug. It looks like a data
difference**, and it was caught only because a whole class of government came
back suspiciously small against a number we already held. That is the count
discipline earning its keep: the extractor prints rows read, rows matched and
the per-category split on every run, so a filter that silently matched zero
cannot read as a clean one.

---

## 2. Step B — jurisdiction mapping

An official count is not a denominator. "Merrimack County contains eighteen
special districts" does not establish that eighteen special districts touch
this zip. Every enumerated unit carries an auditable row in
`data/audit/universe-03255.json`: authoritative source, vintage, name, Census
ID, government type, geography served, both scope flags, the METHOD each flag
was decided by, and the inclusion or exclusion reason.

**03255's ZCTA centroid: 43.31403, −72.02455.**

### Two universes, and the trap between them

| | Count | Method |
|---|---|---|
| **Units that GOVERN 03255** | **3** resolved true, **40 UNRESOLVED** | the ZCTA centroid inside the unit's own TIGER boundary |
| **Units that MEET within 25 km** | **47** by venue proxy, **29** by the generous territory bound, **1** UNRESOLVED | see below |

The three that govern:

| Unit | Type | OCD-ID |
|---|---|---|
| County of Merrimack | county | `…/state:nh/county:merrimack` |
| Town of Newbury | town | `…/county:merrimack/place:newbury_town` |
| Kearsarge Regional School District | school district | `…/state:nh/school_district:kearsarge_regional_school_district` |

**The trap the enumeration sets, named so nobody falls into it.** A
neighbouring town's Selectboard does NOT govern 03255 because the town shares
a regional school district or sits nearby. New London's board meets 7.6 km
away and a reader sees its pin; it governs not one inch of Newbury. The
regional district governs; the neighbour's own boards do not. Every row
carries the flags as fields rather than as prose precisely so this cannot be
inferred from proximity by a later reader.

### Why forty units are UNRESOLVED rather than false

**The Census publishes no boundary for special districts at any vintage.**
Geometry cannot answer whether a village district's territory reaches Newbury,
so those forty rows say `UNRESOLVED` and stay in the denominator as work.
Recording them as "does not govern" because we could not find a boundary would
be the render-default rule's manufactured claim, one layer upstream in the
data.

`states/nh/NOTES.md` records "no village district's boundary reaches Newbury —
the nearest is Lake Todd, in Bradford/Sutton." That was checked against
**Merrimack County only**. With Sullivan County now in scope, two more sit
inside the circle by venue proxy — **Highland Haven Special District** and
**Ashuelot Pond Dam Precinct**, both administered from Washington, 14.89 km —
and neither has ever been assessed. That is a denominator correction of the
meetings-near universe and it is recorded in §6.

### Two distances, because they answer different questions

A single number would smuggle one answer in under the other's name.

- **`boundaryKm`** — the nearest point of the unit's own territory. Generous:
  a town whose far corner reaches inside the circle counts even if it sits
  forty kilometres away. It is the upper bound on what could possibly show,
  and over-counting a denominator can only make our coverage look worse, never
  better, which is the safe direction to be wrong in.
- **`venueKm`** — the ZCTA centroid of the administrative address the Census
  itself publishes for the unit. Closer to what a reader experiences, because
  the map pins a meeting at its **venue**. It is a **PROXY**, labelled one on
  every row that uses it: a town's mailing address is usually its town hall,
  and usually is not always.

`meetingsNearZip` is decided on the venue proxy, because that is what puts a
pin on screen. Both numbers are carried so the scorecard can state the bound
as well as the estimate.

### Units are not bodies

This is the honest limit of what the Census can freeze. The Government Units
Listing counts **units** — one row for the Town of Newbury. The product's
denominator is **bodies**: Newbury's Selectboard, Planning Board, Zoning Board
of Adjustment, Conservation Commission and the rest are five bodies inside one
unit, and no external enumeration exists for them.

So the body universe is a two-layer denominator, and the layers are reported
apart:

- **Unit universe** — authoritative, external, frozen above. 166 units.
- **Body universe per unit** — derived from each unit's OWN published board
  list, which is itself a hunt. A unit whose board list has not been read is
  `BODIES_UNENUMERATED`, and that is a named gap rather than a body count of
  one.

State and federal offices are in neither: the Census enumerates governments,
not seats. Those are carried separately in §4.

---

## 3. The meetings-near rule, fixed

`RADIUS_LADDER_KM[0] = 25` km from the zip's ZCTA centroid
(`lib/meetings/constants.ts`). This is standing product law, not a value
invented for this session: the ladder widens to 60 km and then 150 km only
when nothing upcoming is in view, and `lib/map/viewport-radius.ts` floors the
viewport-driven radius at the same first rung.

**The denominator uses the first rung**, because that is the reader's default
view at a freshly entered zip.

---

## 4. Who governs 03255 — the full body and office universe

The Census tier plus the tiers it does not enumerate. This is the who-governs
denominator the product renders against; each row's body count is either read
from the unit's own publication or marked unenumerated.

| Tier | Subject | Bodies / seats | Source of the count |
|---|---|---|---|
| Federal | U.S. Senate (NH) | 2 seats | Constitution; the two seats are structural |
| Federal | U.S. House NH-2 | 1 seat | TIGER `cd119-33`, centroid inside NH-2 |
| State | Governor | 1 seat | NH Constitution |
| State | Executive Council District 2 | 1 seat | NH SoS 2022–2032 district assignment |
| State | State Senate District 7 | 1 seat | TIGER `sldu-33`, centroid inside district 7 |
| State | NH House, Merrimack District 7 | 2 seats (`voteFor 2`) | TIGER `sldl-33` = `sldl:607`; seat count from the ballot filing |
| County | Merrimack County — Board of Commissioners | 1 body, 3 districts | county's own FY2025 annual report |
| County | Merrimack County — elected row offices | Sheriff, Attorney, Treasurer, Register of Deeds, Register of Probate | the 2026 ballot's own contest list |
| Municipal | Town of Newbury | **BODIES_UNENUMERATED at freeze** — the playbook records Selectboard, Planning Board, Zoning Board of Adjustment, Conservation Commission and "the rest revealed on HOVER" | the town's own board list, unread at freeze |
| School | Kearsarge Regional School District | 1 board; member towns to be verified, never assumed | the district's own publication |

**`BODIES_UNENUMERATED` is the honest state of Newbury's board universe at
freeze.** The town's site reveals its board list on hover, so the list exists
and has not been read into an enumeration. Four bodies are known because
earlier sessions wired them; "four" is what we hold, not what the town has,
and the difference is exactly the kind of gap an internal denominator can
never surface.

---

## 5. The frozen ballot universe (item 3's denominator)

**Election:** the 2026 New Hampshire General Election, election id
`nh-2026-11-03` <!-- expected-future: the election ID embeds polling day; same source as the line below -->, polling day:

**2026-11-03** <!-- expected-future: NH general election day, from the Secretary of State's 2026-2027 political calendar as transcribed into data/states/nh/ballot/nh-merrimack-2026.json, read 2026-08-14 -->

**Official source of truth:** the New Hampshire Secretary of State's
cumulative primary filing (`cumulative-filings-7.16.26.pdf`, July 16 revision)
and the 2026–2027 political calendar, transcribed 2026-08-14 into
`data/states/nh/ballot/nh-merrimack-2026.json`.

**Does 03255 resolve to ONE ballot style or a union?** **One.** Newbury is a
single town wholly inside one of each relevant district: NH-2, State Senate 7,
NH House Merrimack 7, Executive Council 2, Merrimack County Commissioner
District 2. The zip's ZCTA does not cross a town line into a different
assignment, so there is a single named ballot style rather than a union. This
is stated rather than assumed because zip codes are not precincts, and a zip
that DID straddle two house districts would have a union denominator.

**The universe:** 12 contests, **47 candidacies**, 0 measures.

| Contest | Vote for | Candidates |
|---|---|---|
| Governor | 1 | 4 |
| United States Senator | 1 | 13 |
| Representative in Congress, District 2 | 1 | 6 |
| State Senator, District 7 | 1 | 2 |
| State Representative, Merrimack County District 7 | 2 | 3 |
| Executive Councilor, District 2 | 1 | 3 |
| Merrimack County Commissioner, Second District | 1 | 3 |
| Merrimack County Sheriff | 1 | 4 |
| Merrimack County Attorney | 1 | 4 |
| Merrimack County Treasurer | 1 | 2 |
| Merrimack County Register of Deeds | 1 | 2 |
| Merrimack County Register of Probate | 1 | 1 |

**A caveat that belongs on the denominator, not in a footnote.** These are
PRIMARY filings. The September 8, 2026 primary decides the general lineup, so
the 47 are everyone who filed, not the eventual November ballot. Equal effort
is owed across all 47 regardless — a hunt that covered only the likely
survivors would be a prediction, and predictions are the thing this product
does not do.

**Town and school offices are absent by design, not by miss.** Newbury's town
offices are decided at the March town meeting (Town Election day
2026-03-10, per the SoS political calendar), and school ballots are
non-partisan by RSA 671:20 and run on the same March cycle. The absence is
recorded with its source in the dataset's own `absences` block.

---

## 6. Denominator corrections

Appended as they are found. Nothing here is edited; a correction that is later
corrected gets its own row.

| Date | Universe | Correction | Evidence |
|---|---|---|---|
| 2026-08-16 | meetings-near | The official denominator was **Merrimack County only**. 03255's 25 km circle reaches Sullivan and Hillsborough counties; 103 further units were enumerated. | `pnpm zip:universe 03255`, boundary and venue distances per row |
| 2026-08-16 | meetings-near | `states/nh/NOTES.md` says no village district reaches Newbury, nearest Lake Todd. True of Merrimack County. **Highland Haven Special District** and **Ashuelot Pond Dam Precinct** (both Washington, Sullivan County, 14.89 km by venue proxy) sit inside the circle and had never been assessed. | `data/audit/universe-03255.json` |

## 7. Field-matrix corrections

`vH-1` frozen 2026-08-16. A field discovered mid-sweep is a schema correction
with a row here and a version bump — never a silent denominator change.

| Date | Version | Change | Why |
|---|---|---|---|
| 2026-08-16 | `vH-1` | initial freeze | before any hunting, per C10 |
