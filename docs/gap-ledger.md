# The gap ledger

Generated 2026-09-23 (America/Phoenix, `corepack pnpm stamp`).
Rebuild with `corepack pnpm ledger:build`.

**This is what the digging sessions work, front to back.** Every entry names
a specific thing that is missing. A count tells you work exists; a name tells
you what to go and get.

Sources, all committed in this repo and read from nowhere else:

| Input | What it establishes |
|---|---|
| `data/reference/census_govt_units_2022.csv` | the universe — 90,837 governments |
| `data/reference/nces_ccd_lea_directory_2025_26.csv` | 19,711 school LEAs |
| `data/derived/zip-governments.json` | territory — which governments cover which zip |
| `data/derived/census-nces-crosswalk.csv` | the school-district bridge between the two |
| `data/derived/zip-coverage-tiers.json` | the stamped coverage tier per zip |
| `lib/registry/registry.json` | which governments have their bodies enumerated |

## The national figures

### Zips at each tier

| Tier | Zips | Share of 33,791 ZCTAs |
|---|---:|---:|
| TIER_0 | 33,075 | 97.88% |
| TIER_1 | 716 | 2.12% |
| TIER_2 | 0 | 0.00% |
| TIER_3 | 0 | 0.00% |

**RULING 10 applies to every row above.** These are ZCTAs, not ZIP codes. A
USPS ZIP is a delivery route with no areal geometry; a ZCTA is the Census
Bureau's areal approximation of one. 1,599 of the 26,195 USPS ZIPs observable
in the Census unit file (6.10%) have no ZCTA at all and cannot be answered
geographically by this method.

### Census units resolved to at least one zip

**47,834 of 90,837** (52.66%).

| Type | Resolved | Total | % |
|---|---:|---:|---:|
| COUNTY | 3,031 | 3,031 | 100.00% |
| MUNICIPAL | 19,471 | 19,491 | 99.90% |
| TOWNSHIP | 16,205 | 16,214 | 99.94% |
| SCHOOL DISTRICT | 9,127 | 12,546 | 72.75% |
| SPECIAL DISTRICT | 0 | 39,555 | 0.00% |

### Special districts unresolved — the ceiling

**39,555 of 39,555 (100.00%).**

TIGER publishes boundaries for none of them at any vintage. Not a subset —
none. They are 43.55% of every government in the country, and this number
caps Tier 1 nationally. It is the single largest gap in this product.

Next rungs, named and not walked in this session:

1. County assessor / auditor special-district tax-levy layers, which carry
   district boundaries because they have to bill them.
2. State special-district registries — many states require a district to file
   its territory with the secretary of state or a local-government commission.
3. Per-state GIS open-data portals, which publish fire, water and library
   district layers county by county.
4. The district's own published service-area map, per district.

A district office's mailing zip is **not** territory and is never counted as
resolution. A county water authority head-quartered downtown serves the county.

## The four pilot zips

### 85701 — downtown Tucson, Arizona

**We have some of the governments that cover this ZIP code, and we are still working out the rest.**

We know this government exists. We have not confirmed what it covers. (Coverage tier `TIER_0`, stamped 2026-08-21.)

| Denominator | Count |
|---|---:|
| Governments in the universe touching this zip | 27 |
| — territory-resolved | 3 |
| — of those, bodies enumerated (Tier 2) | 3 |
| — UNRESOLVED (special districts, named below) | 24 |

#### Territory-resolved governments

| Government | Layer | Tier | Evidence |
|---|---|---|---|
| Pima County | county | TIER_2 | 3 sample points |
| Tucson city | place | TIER_2 | 3 sample points |
| Tucson Unified District | unsd | TIER_2 | 3 sample points |

#### Governments we can locate, whose boards we have not listed

We know these governments cover this zip. What we do not have is the list of boards, councils and commissions inside them — so a reader here could be governed by a body this product has never named.

None. Every government resolved to this zip has at least one enumerated body.

#### Not governments, and never rendered as one

These are Census STATISTICAL entities — a CDP is a name the Census gives a populated area so it can publish statistics for it, and a CCD is a statistical subdivision drawn in states with no minor civil divisions. Neither has a council, a budget, a meeting or an elected official.

- Tucson CCD — STATISTICAL (LSAD 22)

#### The 24 districts we cannot yet say you live in

Each of these is a real government — a fire district, a water district, an irrigation or library district — that the federal Census counts, in a county over this zip. Nobody publishes a map of where any of them starts and stops, so we cannot say whether it reaches this zip. **That is a work item and never a no**: recording one as "does not govern here" because we could not find its boundary would be inventing an answer.

**The last thing tried, and when.** The national boundary join of 2026-09-23, run against every published boundary vintage. It resolved 47,834 of the country's 90,837 governments and **not one special district** — the boundaries are not published anywhere in that data at all. Nothing has been tried on these districts individually yet; the four routes that have not been walked are listed at the top of this file.

| District | Where its office is | State | Census id |
|---|---|---|---|
| AJO-LUKEVILLE HEALTH SERVICES DISTRICT | AJO | AZ | 205795 |
| ARIVACA FIRE DISTRICT | ARIVACA | AZ | 239921 |
| AVRA VALLEY FIRE DISTRICT | MARANA | AZ | 141421 |
| AVRA VALLEY IRRIGATION AND DRAINAGE DISTRICT | MARANA | AZ | 141420 |
| CORONA DE TUCSON FIRE DISTRICT | CORONA | AZ | 205798 |
| CORTARO-MARANA IRRIGATION DISTRICT | MARANA | AZ | 100288 |
| DREXEL HEIGHTS FIRE DISTRICT | TUCSON | AZ | 141423 |
| FLOWING WELLS IRRIGATION DISTRICT | TUCSON | AZ | 141416 |
| GOLDER RANCH FIRE DISTRICT | TUCSON | AZ | 201336 |
| GREEN VALLEY FIRE DISTRICT | GREEN VALLEY | AZ | 122791 |
| HIDDEN VALLEY FIRE DISTRICT | TUCSON | AZ | 195317 |
| MT LEMMON FIRE DISTRICT | MOUNT LEMMON | AZ | 205799 |
| NORTHWEST FIRE DISTRICT | TUCSON | AZ | 141419 |
| PICTURE ROCKS FIRE DISTRICT | TUCSON | AZ | 141424 |
| PIMA COUNTY REGIONAL TRANSPORTATION AUTHORITY | TUCSON | AZ | 214891 |
| RINCON VALLEY FIRE DISTRICT | VAIL | AZ | 203941 |
| RIO NUEVO MULTIPURPOSE FACILITIES DISTRICT | TUCSON | AZ | 251411 |
| SABINO VISTA FIRE DISTRICT | TUCSON | AZ | 122792 |
| SILVERBELL IRRIGATION DISTRICT | ARIZONA CITY | AZ | 141425 |
| SONOITA-ELGIN FIRE DISTRICT | SONOITA | AZ | 220681 |
| TANQUE VERDE VALLEY FIRE DISTRICT | TUCSON | AZ | 220664 |
| THREE POINTS FIRE DISTRICT | TUCSON | AZ | 205796 |
| TUCSON COUNTRY CLUB ESTATES FIRE DISTRICT | TUCSON | AZ | 100289 |
| WHY FIRE DISTRICT | AJO | AZ | 205797 |

#### What stands between this zip and the next tier

Work out which of the remaining governments reach this ZIP code.

Concretely: 24 named special districts above have no published boundary, and until their territory is resolved this zip cannot leave Tier 0 — because a tier is the floor across the governments touching it, and an unresolved government is exactly the one a reader might live under and hear nothing about.

### 85641 — Vail, Arizona (unincorporated)

**We have some of the governments that cover this ZIP code, and we are still working out the rest.**

We know this government exists. We have not confirmed what it covers. (Coverage tier `TIER_0`, stamped 2026-08-21.)

| Denominator | Count |
|---|---:|
| Governments in the universe touching this zip | 28 |
| — territory-resolved | 4 |
| — of those, bodies enumerated (Tier 2) | 4 |
| — UNRESOLVED (special districts, named below) | 24 |

#### Territory-resolved governments

| Government | Layer | Tier | Evidence |
|---|---|---|---|
| Pima County | county | TIER_2 | 857 sample points |
| Vail Unified District | unsd | TIER_2 | 650 sample points |
| Empire Elementary District | elsd | TIER_2 | 59 sample points |
| Tucson city | place | TIER_2 | 17 sample points |

#### Governments we can locate, whose boards we have not listed

We know these governments cover this zip. What we do not have is the list of boards, councils and commissions inside them — so a reader here could be governed by a body this product has never named.

None. Every government resolved to this zip has at least one enumerated body.

#### Not governments, and never rendered as one

These are Census STATISTICAL entities — a CDP is a name the Census gives a populated area so it can publish statistics for it, and a CCD is a statistical subdivision drawn in states with no minor civil divisions. Neither has a council, a budget, a meeting or an elected official.

- Corona de Tucson CDP — STATISTICAL (LSAD 57)
- Vail CDP — STATISTICAL (LSAD 57)
- Rincon Valley CDP — STATISTICAL (LSAD 57)
- Tucson CCD — STATISTICAL (LSAD 22)

#### The 24 districts we cannot yet say you live in

Each of these is a real government — a fire district, a water district, an irrigation or library district — that the federal Census counts, in a county over this zip. Nobody publishes a map of where any of them starts and stops, so we cannot say whether it reaches this zip. **That is a work item and never a no**: recording one as "does not govern here" because we could not find its boundary would be inventing an answer.

**The last thing tried, and when.** The national boundary join of 2026-09-23, run against every published boundary vintage. It resolved 47,834 of the country's 90,837 governments and **not one special district** — the boundaries are not published anywhere in that data at all. Nothing has been tried on these districts individually yet; the four routes that have not been walked are listed at the top of this file.

| District | Where its office is | State | Census id |
|---|---|---|---|
| AJO-LUKEVILLE HEALTH SERVICES DISTRICT | AJO | AZ | 205795 |
| ARIVACA FIRE DISTRICT | ARIVACA | AZ | 239921 |
| AVRA VALLEY FIRE DISTRICT | MARANA | AZ | 141421 |
| AVRA VALLEY IRRIGATION AND DRAINAGE DISTRICT | MARANA | AZ | 141420 |
| CORONA DE TUCSON FIRE DISTRICT | CORONA | AZ | 205798 |
| CORTARO-MARANA IRRIGATION DISTRICT | MARANA | AZ | 100288 |
| DREXEL HEIGHTS FIRE DISTRICT | TUCSON | AZ | 141423 |
| FLOWING WELLS IRRIGATION DISTRICT | TUCSON | AZ | 141416 |
| GOLDER RANCH FIRE DISTRICT | TUCSON | AZ | 201336 |
| GREEN VALLEY FIRE DISTRICT | GREEN VALLEY | AZ | 122791 |
| HIDDEN VALLEY FIRE DISTRICT | TUCSON | AZ | 195317 |
| MT LEMMON FIRE DISTRICT | MOUNT LEMMON | AZ | 205799 |
| NORTHWEST FIRE DISTRICT | TUCSON | AZ | 141419 |
| PICTURE ROCKS FIRE DISTRICT | TUCSON | AZ | 141424 |
| PIMA COUNTY REGIONAL TRANSPORTATION AUTHORITY | TUCSON | AZ | 214891 |
| RINCON VALLEY FIRE DISTRICT | VAIL | AZ | 203941 |
| RIO NUEVO MULTIPURPOSE FACILITIES DISTRICT | TUCSON | AZ | 251411 |
| SABINO VISTA FIRE DISTRICT | TUCSON | AZ | 122792 |
| SILVERBELL IRRIGATION DISTRICT | ARIZONA CITY | AZ | 141425 |
| SONOITA-ELGIN FIRE DISTRICT | SONOITA | AZ | 220681 |
| TANQUE VERDE VALLEY FIRE DISTRICT | TUCSON | AZ | 220664 |
| THREE POINTS FIRE DISTRICT | TUCSON | AZ | 205796 |
| TUCSON COUNTRY CLUB ESTATES FIRE DISTRICT | TUCSON | AZ | 100289 |
| WHY FIRE DISTRICT | AJO | AZ | 205797 |

#### What stands between this zip and the next tier

Work out which of the remaining governments reach this ZIP code.

Concretely: 24 named special districts above have no published boundary, and until their territory is resolved this zip cannot leave Tier 0 — because a tier is the floor across the governments touching it, and an unresolved government is exactly the one a reader might live under and hear nothing about.

### 07866 — Rockaway Township, New Jersey

**We have some of the governments that cover this ZIP code, and we are still working out the rest.**

We know this government exists. We have not confirmed what it covers. (Coverage tier `TIER_0`, stamped 2026-08-21.)

| Denominator | Count |
|---|---:|
| Governments in the universe touching this zip | 27 |
| — territory-resolved | 9 |
| — of those, bodies enumerated (Tier 2) | 8 |
| — UNRESOLVED (special districts, named below) | 18 |

#### Territory-resolved governments

| Government | Layer | Tier | Evidence |
|---|---|---|---|
| Morris County | county | TIER_2 | 64 sample points |
| Morris Hills Regional School District | scsd | TIER_2 | 64 sample points |
| Rockaway township | cousub | TIER_2 | 55 sample points |
| Rockaway Township School District | elsd | TIER_2 | 55 sample points |
| Rockaway borough | place | TIER_2 | 6 sample points |
| Rockaway borough | cousub | TIER_1 | 6 sample points |
| Rockaway Borough School District | elsd | TIER_2 | 6 sample points |
| Denville township | cousub | TIER_2 | 3 sample points |
| Denville Township School District | elsd | TIER_2 | 3 sample points |

#### Governments we can locate, whose boards we have not listed

We know these governments cover this zip. What we do not have is the list of boards, councils and commissions inside them — so a reader here could be governed by a body this product has never named.

- **Rockaway borough** — last thing tried: the boundary join of 2026-08-21, which placed it over this zip and does not enumerate what is inside it. Nobody has read its own roster page. (cousub 3402764050)

#### Not governments, and never rendered as one

These are Census STATISTICAL entities — a CDP is a name the Census gives a populated area so it can publish statistics for it, and a CCD is a statistical subdivision drawn in states with no minor civil divisions. Neither has a council, a budget, a meeting or an elected official.

- White Meadow Lake CDP — STATISTICAL (LSAD 57)
- Hibernia CDP — STATISTICAL (LSAD 57)
- Lake Telemark CDP — STATISTICAL (LSAD 57)

#### The 18 districts we cannot yet say you live in

Each of these is a real government — a fire district, a water district, an irrigation or library district — that the federal Census counts, in a county over this zip. Nobody publishes a map of where any of them starts and stops, so we cannot say whether it reaches this zip. **That is a work item and never a no**: recording one as "does not govern here" because we could not find its boundary would be inventing an answer.

**The last thing tried, and when.** The national boundary join of 2026-09-23, run against every published boundary vintage. It resolved 47,834 of the country's 90,837 governments and **not one special district** — the boundaries are not published anywhere in that data at all. Nothing has been tried on these districts individually yet; the four routes that have not been walked are listed at the top of this file.

| District | Where its office is | State | Census id |
|---|---|---|---|
| HANOVER TOWNSHIP FIRE DISTRICT 2 | WHIPPANY | NJ | 109232 |
| HANOVER TOWNSHIP FIRE DISTRICT 3 | CEDAR KNOLLS | NJ | 152436 |
| MONTVILLE TOWNSHIP FIRE DISTRICT 1 | MONTVILLE | NJ | 109231 |
| MONTVILLE TOWNSHIP FIRE DISTRICT 2 | TOWACO | NJ | 206836 |
| MONTVILLE TOWNSHIP FIRE DISTRICT 3 | PINE BROOK | NJ | 130980 |
| MORRIS COUNTY SOIL CONSERVATION DISTRICT | MORRISTOWN | NJ | 152430 |
| MUSCONETCONG SEWERAGE AUTHORITY | BUDD LAKE | NJ | 202164 |
| NEW JERSEY PUBLIC POWER AUTHORITY | BUTLER | NJ | 248663 |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 1 | MOUNT TABOR | NJ | 130981 |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 2 | DENVILLE | NJ | 206837 |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 3 | PARSIPPANY | NJ | 152433 |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 4 | LAKE HIAWATHA | NJ | 130982 |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 5 | PARSIPPANY | NJ | 211392 |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 6 | PARSIPPANY | NJ | 206838 |
| PEQUANNOCK RIVER BASIN REGIONAL SEWERAGE AUTHORITY | BUTLER | NJ | 152439 |
| PEQUANNOCK-LINCOLN PARK-FAIRFIELD SEWERAGE AUTH (TWO BRIDGES) | LINCOLN PARK | NJ | 152443 |
| ROCKAWAY VALLEY REGIONAL SEWAGE AUTHORITY | BOONTON | NJ | 152435 |
| SOUTHEAST MORRIS COUNTY MUNICIPAL UTILITIES AUTHORITY | CEDAR KNOLLS | NJ | 152438 |

#### What stands between this zip and the next tier

Work out which of the remaining governments reach this ZIP code.

Concretely: 18 named special districts above have no published boundary, and until their territory is resolved this zip cannot leave Tier 0 — because a tier is the floor across the governments touching it, and an unresolved government is exactly the one a reader might live under and hear nothing about.

### 03255 — Newbury, New Hampshire

**We have some of the governments that cover this ZIP code, and we are still working out the rest.**

We know this government exists. We have not confirmed what it covers. (Coverage tier `TIER_0`, stamped 2026-08-21.)

| Denominator | Count |
|---|---:|
| Governments in the universe touching this zip | 5 |
| — territory-resolved | 5 |
| — of those, bodies enumerated (Tier 2) | 3 |
| — UNRESOLVED (special districts, named below) | 0 |

#### Territory-resolved governments

| Government | Layer | Tier | Evidence |
|---|---|---|---|
| Merrimack County | county | TIER_2 | 109 sample points |
| Newbury town | cousub | TIER_2 | 109 sample points |
| Kearsarge Regional School District | unsd | TIER_2 | 109 sample points |

#### Governments we can locate, whose boards we have not listed

We know these governments cover this zip. What we do not have is the list of boards, councils and commissions inside them — so a reader here could be governed by a body this product has never named.

None. Every government resolved to this zip has at least one enumerated body.

#### Not governments, and never rendered as one

These are Census STATISTICAL entities — a CDP is a name the Census gives a populated area so it can publish statistics for it, and a CCD is a statistical subdivision drawn in states with no minor civil divisions. Neither has a council, a budget, a meeting or an elected official.

- Blodgett Landing CDP — STATISTICAL (LSAD 57)

#### Special districts, resolved by document rather than by map

TIGER publishes no boundary for a special district, so geometry cannot answer these and never will. These were settled by reading something — a statute, a state tax table, a district describing its own territory. The evidence for each is in `docs/evidence/nhhunt2-hunt05-special-districts.md`.

| District | Reaches this zip | Settled by |
|---|---|---|
| **MERRIMACK COUNTY CONSERVATION DISTRICT** | **YES** | STATUTE |
| **LAKE TODD VILLAGE DISTRICT** | **YES** | THE DISTRICT'S OWN WORDS, TWICE |
| WARNER VILLAGE WATER DISTRICT | no | DRA VILLAGE DISTRICT TAX RATES |
| EPSOM VILLAGE DISTRICT | no | DRA VILLAGE DISTRICT TAX RATES |
| CENTRAL HOOKSETT WATER PRECINCT | no | DRA VILLAGE DISTRICT TAX RATES |
| PENACOOK BOSCAWEN WATER PRECINCT | no | DRA VILLAGE DISTRICT TAX RATES |
| HARDY ROAD VILLAGE DISTRICT | no | DRA VILLAGE DISTRICT TAX RATES |
| ANDOVER VILLAGE DISTRICT | no | DRA VILLAGE DISTRICT TAX RATES |
| ANDOVER FIRE DISTRICT | no | DRA VILLAGE DISTRICT TAX RATES |
| EAST ANDOVER FIRE PRECINCT | no | DRA VILLAGE DISTRICT TAX RATES |
| HOOKSETT VILLAGE WATER PRECINCT | no | DRA VILLAGE DISTRICT TAX RATES |
| HOPKINTON VILLAGE PRECINCT | no | DRA VILLAGE DISTRICT TAX RATES |
| NEW LONDON SPRINGFIELD WATER SYSTEM PRECINCT | no | DRA VILLAGE DISTRICT TAX RATES, AND ITS OWN NAME |
| B C E P SOLID WASTE DISTRICT | no | ENABLING STATUTE AND ITS OWN NAME |
| CONCORD HOUSING AUTHORITY | no | ENABLING STATUTE |
| CONTOOCOOK VILLAGE PRECINCT | no | DRA VILLAGE DISTRICT TAX RATES |
| HIGHLANDS VILLAGE DISTRICT | no | DRA VILLAGE DISTRICT TAX RATES |
| NORTHFIELD SEWER DISTRICT | no | DRA VILLAGE DISTRICT TAX RATES |

**2 of these govern part of this zip.** 2 are in the registry and 0 are not. 2 + 0 = 2.

- IN THE REGISTRY: MERRIMACK COUNTY CONSERVATION DISTRICT · LAKE TODD VILLAGE DISTRICT

#### The 0 districts we cannot yet say you live in

Each of these is a real government — a fire district, a water district, an irrigation or library district — that the federal Census counts, in a county over this zip. Nobody publishes a map of where any of them starts and stops, so we cannot say whether it reaches this zip. **That is a work item and never a no**: recording one as "does not govern here" because we could not find its boundary would be inventing an answer.

**The last thing tried, and when.** The national boundary join of 2026-09-23, run against every published boundary vintage. It resolved 47,834 of the country's 90,837 governments and **not one special district** — the boundaries are not published anywhere in that data at all. Nothing has been tried on these districts individually yet; the four routes that have not been walked are listed at the top of this file.

None. No county over this zip holds a special district.

#### What stands between this zip and the next tier

Work out which of the remaining governments reach this ZIP code.

Concretely: 0 named special districts above have no published boundary, and until their territory is resolved this zip cannot leave Tier 0 — because a tier is the floor across the governments touching it, and an unresolved government is exactly the one a reader might live under and hear nothing about.

## 03255 against `HUNT05`

`HUNT05` records **40 UNRESOLVED special districts at 03255**, found by the h session on 2026-08-16 by building the denominator.

**This session resolves 0 of the 40.** The method that resolved every other government type cannot reach a single special district, because TIGER publishes no boundary for any of them. What this session adds is the NAMES: 0 districts in Merrimack County are listed above with their Census PID6 and office city, so the next session can start dialling instead of enumerating.

The two counts differ because they are counts of different things: `HUNT05` counted the districts inside 03255's own 166-unit enumerated universe, and this counts every special district in the counties whose territory overlaps the ZCTA. Neither is wrong; the second is the wider bound and the one a coverage claim has to clear.

## `AUD-06`

`AUD-06` assigns a coverage manifest gated by `tests/coverage-manifest.test.ts`. Item 1d confirmed that test now allowlists correctly on Linux — the separator bug that put `lib/coverage/states.ts` in its own offender list is fixed at the shared code path and guarded by `tests/path-separator.test.ts`. That is the part of `AUD-06` this session can close.

## Meetings discovery owed, by jurisdiction

Measured from the committed jurisdiction registries: `data/states/az/jurisdictions/az.json` (generated 2026-09-01), `data/states/nh/jurisdictions/nh.json` (generated 2026-09-01), `data/states/nj/jurisdictions/nj.json` (generated 2026-09-01).

Of **2641** enumerated governments:

- **1975** have their own website on record and owe a walk of it for their meeting notices, agendas, minutes and roster. This is the registry's own-site MEETINGS source, state `DISCOVERY_OWED`.
- **666** have no MEETINGS source recorded, because no website was recorded. For these, the first step is finding the site.

**No scheduler turns an entry here into work.** Since `902f5c50` (2026-09-10), `local-jurisdictions` schedules no MEETINGS route. The routine meeting-partition contracts (`lib/civic-data/meeting-partitions.ts`) are the only production meeting clock, and they are keyed by the bodies wired in SOURCE_WIRING, not by these jurisdictions. The one executor that walks a government's site for its meeting pages is the Scout lane, which is paid research. Which executor works this list, and at what spend, is the owner's decision.

**Not subtracted:** jurisdictions a meeting partition already covers. The partitions reach about 22 governments, but no reviewed jurisdiction→body crosswalk exists, and `lib/control-plane/zip-gap-resolution.ts` refuses to infer one from names. This list therefore names at most that many jurisdictions whose meetings are already acquired.

The standing runner retires an old `freshness:jurisdiction:<id>#meetings-N` row only when `<id>` is listed in `data/derived/gap-ledger.json` → `meetingsDiscovery.needs`. The retirement reason names this ledger.

### AZ: 688 of 688

| Jurisdiction | Class | Website | Basis |
| --- | --- | --- | --- |
| CITY OF APACHE JUNCTION (`az:city:city-of-apache-junction`) | CITY_OR_TOWN | http://www.ajcity.net | SOURCE_DISCOVERY_OWED |
| CITY OF AVONDALE (`az:city:city-of-avondale`) | CITY_OR_TOWN | http://www.avondale.org | SOURCE_DISCOVERY_OWED |
| CITY OF BENSON (`az:city:city-of-benson`) | CITY_OR_TOWN | http://www.cityofbenson.com | SOURCE_DISCOVERY_OWED |
| CITY OF BISBEE (`az:city:city-of-bisbee`) | CITY_OR_TOWN | http://www.cityofbisbee.com | SOURCE_DISCOVERY_OWED |
| CITY OF BULLHEAD CITY (`az:city:city-of-bullhead-city`) | CITY_OR_TOWN | http://www.bullheadcity.com | SOURCE_DISCOVERY_OWED |
| CITY OF CASA GRANDE (`az:city:city-of-casa-grande`) | CITY_OR_TOWN | http://www.casagrandeaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF CHANDLER (`az:city:city-of-chandler`) | CITY_OR_TOWN | http://www.chandleraz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF COOLIDGE (`az:city:city-of-coolidge`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CITY OF COTTONWOOD (`az:city:city-of-cottonwood`) | CITY_OR_TOWN | http://www.ci.cottonwood.az.us | SOURCE_DISCOVERY_OWED |
| CITY OF DOUGLAS (`az:city:city-of-douglas`) | CITY_OR_TOWN | http://www.douglasaz.org | SOURCE_DISCOVERY_OWED |
| CITY OF EL MIRAGE (`az:city:city-of-el-mirage`) | CITY_OR_TOWN | http://www.cityofelmirage.org | SOURCE_DISCOVERY_OWED |
| CITY OF ELOY (`az:city:city-of-eloy`) | CITY_OR_TOWN | http://www.ci.eloy.az.us | SOURCE_DISCOVERY_OWED |
| CITY OF FLAGSTAFF (`az:city:city-of-flagstaff`) | CITY_OR_TOWN | http://www.flagstaffaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF GLENDALE (`az:city:city-of-glendale`) | CITY_OR_TOWN | http://www.glendaleaz.com | SOURCE_DISCOVERY_OWED |
| CITY OF GLOBE (`az:city:city-of-globe`) | CITY_OR_TOWN | http://www.globeaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF GOODYEAR (`az:city:city-of-goodyear`) | CITY_OR_TOWN | http://www.goodyearaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF HOLBROOK (`az:city:city-of-holbrook`) | CITY_OR_TOWN | http://www.ci.holbrook.az.us/ | SOURCE_DISCOVERY_OWED |
| CITY OF KINGMAN (`az:city:city-of-kingman`) | CITY_OR_TOWN | http://www.cityofkingman.gov | SOURCE_DISCOVERY_OWED |
| CITY OF LAKE HAVASU CITY (`az:city:city-of-lake-havasu-city`) | CITY_OR_TOWN | http://www.lhcaz.gov/ | SOURCE_DISCOVERY_OWED |
| CITY OF LITCHFIELD PARK (`az:city:city-of-litchfield-park`) | CITY_OR_TOWN | http://www.litchfield-park.org | SOURCE_DISCOVERY_OWED |
| CITY OF MARICOPA (`az:city:city-of-maricopa`) | CITY_OR_TOWN | http://www.maricopaaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF MESA (`az:city:city-of-mesa`) | CITY_OR_TOWN | http://www.mesaaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF NOGALES (`az:city:city-of-nogales`) | CITY_OR_TOWN | http://www.nogalesaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF PAGE (`az:city:city-of-page`) | CITY_OR_TOWN | http://www.cityofpage.org | SOURCE_DISCOVERY_OWED |
| CITY OF PEORIA (`az:city:city-of-peoria`) | CITY_OR_TOWN | http://www.peoriaaz.com | SOURCE_DISCOVERY_OWED |
| CITY OF PHOENIX (`az:city:city-of-phoenix`) | CITY_OR_TOWN | http://www.phoenix.gov | SOURCE_DISCOVERY_OWED |
| CITY OF PRESCOTT (`az:city:city-of-prescott`) | CITY_OR_TOWN | http://www.cityofprescott.net | SOURCE_DISCOVERY_OWED |
| CITY OF SAFFORD (`az:city:city-of-safford`) | CITY_OR_TOWN | http://www.cityofsafford.us | SOURCE_DISCOVERY_OWED |
| CITY OF SAN LUIS (`az:city:city-of-san-luis`) | CITY_OR_TOWN | http://www.cityofsanluis.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF SCOTTSDALE (`az:city:city-of-scottsdale`) | CITY_OR_TOWN | http://www.scottsdaleaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF SEDONA (`az:city:city-of-sedona`) | CITY_OR_TOWN | http://www.sedonaaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF SHOW LOW (`az:city:city-of-show-low`) | CITY_OR_TOWN | http://www.showlowaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF SIERRA VISTA (`az:city:city-of-sierra-vista`) | CITY_OR_TOWN | http://www.sierravistaaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF SOMERTON (`az:city:city-of-somerton`) | CITY_OR_TOWN | http://www.cityofsomerton.com | SOURCE_DISCOVERY_OWED |
| CITY OF SOUTH TUCSON (`az:city:city-of-south-tucson`) | CITY_OR_TOWN | http://WWW.SOUTHTUCSON.ORG | SOURCE_DISCOVERY_OWED |
| CITY OF ST JOHNS (`az:city:city-of-st-johns`) | CITY_OR_TOWN | http://www.sjaz.us | SOURCE_DISCOVERY_OWED |
| CITY OF SURPRISE (`az:city:city-of-surprise`) | CITY_OR_TOWN | http://www.surpriseaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF TEMPE (`az:city:city-of-tempe`) | CITY_OR_TOWN | http://www.tempe.gov | SOURCE_DISCOVERY_OWED |
| CITY OF TOLLESON (`az:city:city-of-tolleson`) | CITY_OR_TOWN | http://www.tollesonaz.org | SOURCE_DISCOVERY_OWED |
| CITY OF TOMBSTONE (`az:city:city-of-tombstone`) | CITY_OR_TOWN | http://www.cityoftombstone.com | SOURCE_DISCOVERY_OWED |
| CITY OF TUCSON (`az:city:city-of-tucson`) | CITY_OR_TOWN | http://www.tucsonaz.gov/ | SOURCE_DISCOVERY_OWED |
| CITY OF WILLCOX (`az:city:city-of-willcox`) | CITY_OR_TOWN | http://www.cityofwillcox.org | SOURCE_DISCOVERY_OWED |
| CITY OF WILLIAMS (`az:city:city-of-williams`) | CITY_OR_TOWN | http://www.williamsaz.gov | SOURCE_DISCOVERY_OWED |
| CITY OF WINSLOW (`az:city:city-of-winslow`) | CITY_OR_TOWN | http://www.ci.winslow.az.us | SOURCE_DISCOVERY_OWED |
| CITY OF YUMA (`az:city:city-of-yuma`) | CITY_OR_TOWN | http://www.yumaaz.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF BUCKEYE (`az:city:town-of-buckeye`) | CITY_OR_TOWN | http://www.buckeyeaz.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF CAMP VERDE (`az:city:town-of-camp-verde`) | CITY_OR_TOWN | http://www.campverde.az.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF CAREFREE (`az:city:town-of-carefree`) | CITY_OR_TOWN | http://www.carefree.org | SOURCE_DISCOVERY_OWED |
| TOWN OF CAVE CREEK (`az:city:town-of-cave-creek`) | CITY_OR_TOWN | http://www.cavecreek.org | SOURCE_DISCOVERY_OWED |
| TOWN OF CHINO VALLEY (`az:city:town-of-chino-valley`) | CITY_OR_TOWN | http://www.chinoaz.net | SOURCE_DISCOVERY_OWED |
| TOWN OF CLARKDALE (`az:city:town-of-clarkdale`) | CITY_OR_TOWN | http://www.clarkdale.az.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF CLIFTON (`az:city:town-of-clifton`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF COLORADO CITY (`az:city:town-of-colorado-city`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF DEWEY-HUMBOLDT (`az:city:town-of-dewey-humboldt`) | CITY_OR_TOWN | http://www.dhaz.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF DUNCAN (`az:city:town-of-duncan`) | CITY_OR_TOWN | http://www.townofduncan.com | SOURCE_DISCOVERY_OWED |
| TOWN OF EAGAR (`az:city:town-of-eagar`) | CITY_OR_TOWN | http://eagaraz.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF FLORENCE (`az:city:town-of-florence`) | CITY_OR_TOWN | http://www.florenceaz.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF FOUNTAIN HILLS (`az:city:town-of-fountain-hills`) | CITY_OR_TOWN | http://www.fh.az.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF FREDONIA (`az:city:town-of-fredonia`) | CITY_OR_TOWN | http://www.fredoniaaz.net | SOURCE_DISCOVERY_OWED |
| TOWN OF GILA BEND (`az:city:town-of-gila-bend`) | CITY_OR_TOWN | http://www.gilabendaz.org | SOURCE_DISCOVERY_OWED |
| TOWN OF GILBERT (`az:city:town-of-gilbert`) | CITY_OR_TOWN | http://www.gilbertaz.gov/ | SOURCE_DISCOVERY_OWED |
| TOWN OF GUADALUPE (`az:city:town-of-guadalupe`) | CITY_OR_TOWN | http://www.guadalupeaz.org | SOURCE_DISCOVERY_OWED |
| TOWN OF HAYDEN (`az:city:town-of-hayden`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF HUACHUCA CITY (`az:city:town-of-huachuca-city`) | CITY_OR_TOWN | http://WWW.HUACHUCACITY.ORG | SOURCE_DISCOVERY_OWED |
| TOWN OF JEROME (`az:city:town-of-jerome`) | CITY_OR_TOWN | http://www.azjerome.com | SOURCE_DISCOVERY_OWED |
| TOWN OF KEARNY (`az:city:town-of-kearny`) | CITY_OR_TOWN | http://www.townof.kearny.com | SOURCE_DISCOVERY_OWED |
| TOWN OF MAMMOTH (`az:city:town-of-mammoth`) | CITY_OR_TOWN | http://www.townofmammoth.com | SOURCE_DISCOVERY_OWED |
| TOWN OF MARANA (`az:city:town-of-marana`) | CITY_OR_TOWN | http://www.marana.com | SOURCE_DISCOVERY_OWED |
| TOWN OF MIAMI (`az:city:town-of-miami`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF ORO VALLEY (`az:city:town-of-oro-valley`) | CITY_OR_TOWN | http://www.orovalleyaz.gov/ | SOURCE_DISCOVERY_OWED |
| TOWN OF PARADISE VALLEY (`az:city:town-of-paradise-valley`) | CITY_OR_TOWN | http://www.paradisevalleyaz.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF PARKER (`az:city:town-of-parker`) | CITY_OR_TOWN | http://www.ci.parker.az.us | SOURCE_DISCOVERY_OWED |
| TOWN OF PATAGONIA (`az:city:town-of-patagonia`) | CITY_OR_TOWN | http://www.townofpatagonia.com | SOURCE_DISCOVERY_OWED |
| TOWN OF PAYSON (`az:city:town-of-payson`) | CITY_OR_TOWN | http://www.paysonaz.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF PIMA (`az:city:town-of-pima`) | CITY_OR_TOWN | http://www.pimatown.az.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF PINETOP-LAKESIDE (`az:city:town-of-pinetop-lakeside`) | CITY_OR_TOWN | http://www.ci.pinetop-lakeside.az.us | SOURCE_DISCOVERY_OWED |
| TOWN OF PRESCOTT VALLEY (`az:city:town-of-prescott-valley`) | CITY_OR_TOWN | http://www.pvaz.net | SOURCE_DISCOVERY_OWED |
| TOWN OF QUARTZSITE (`az:city:town-of-quartzsite`) | CITY_OR_TOWN | http://www.ci.quartzsite.az.us | SOURCE_DISCOVERY_OWED |
| TOWN OF QUEEN CREEK (`az:city:town-of-queen-creek`) | CITY_OR_TOWN | http://www.queencreek.org | SOURCE_DISCOVERY_OWED |
| TOWN OF SAHUARITA (`az:city:town-of-sahuarita`) | CITY_OR_TOWN | http://www.ci.sahuarita.az.us | SOURCE_DISCOVERY_OWED |
| TOWN OF SNOWFLAKE (`az:city:town-of-snowflake`) | CITY_OR_TOWN | http://www.ci.snowflake.az.us | SOURCE_DISCOVERY_OWED |
| TOWN OF SPRINGERVILLE (`az:city:town-of-springerville`) | CITY_OR_TOWN | http://www.springervilleaz.gov/ | SOURCE_DISCOVERY_OWED |
| TOWN OF STAR VALLEY (`az:city:town-of-star-valley`) | CITY_OR_TOWN | http://www.ci.star-valley.az.us | SOURCE_DISCOVERY_OWED |
| TOWN OF SUPERIOR (`az:city:town-of-superior`) | CITY_OR_TOWN | http://www.superiorarizona.com | SOURCE_DISCOVERY_OWED |
| TOWN OF TAYLOR (`az:city:town-of-taylor`) | CITY_OR_TOWN | http://www.tayloraz.org | SOURCE_DISCOVERY_OWED |
| TOWN OF THATCHER (`az:city:town-of-thatcher`) | CITY_OR_TOWN | http://www.thatcher.az.gov/ | SOURCE_DISCOVERY_OWED |
| TOWN OF TUSAYAN (`az:city:town-of-tusayan`) | CITY_OR_TOWN | http://www.tusayanas.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF WELLTON (`az:city:town-of-wellton`) | CITY_OR_TOWN | http://www.town.wellton.az.us | SOURCE_DISCOVERY_OWED |
| TOWN OF WICKENBURG (`az:city:town-of-wickenburg`) | CITY_OR_TOWN | http://www.ci.wickenburg.az.us | SOURCE_DISCOVERY_OWED |
| TOWN OF WINKELMAN (`az:city:town-of-winkelman`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF YOUNGTOWN (`az:city:town-of-youngtown`) | CITY_OR_TOWN | http://www.youngtownaz.org | SOURCE_DISCOVERY_OWED |
| COUNTY OF APACHE (`az:county:county-of-apache`) | COUNTY | http://www.co.apache.az.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF COCHISE (`az:county:county-of-cochise`) | COUNTY | http://cochise.az.gov | SOURCE_DISCOVERY_OWED |
| COUNTY OF COCONINO (`az:county:county-of-coconino`) | COUNTY | http://www.coconino.az.gov/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF GILA (`az:county:county-of-gila`) | COUNTY | http://www.gilacountyaz.gov | SOURCE_DISCOVERY_OWED |
| COUNTY OF GRAHAM (`az:county:county-of-graham`) | COUNTY | http://www.graham.az.gov/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF GREENLEE (`az:county:county-of-greenlee`) | COUNTY | http://www.co.greenlee.az.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF LA PAZ (`az:county:county-of-la-paz`) | COUNTY | http://www.co.lapaz.az.us | SOURCE_DISCOVERY_OWED |
| COUNTY OF MARICOPA (`az:county:county-of-maricopa`) | COUNTY | http://www.maricopa.gov/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF MOHAVE (`az:county:county-of-mohave`) | COUNTY | http://www.co.mohave.az.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF NAVAJO (`az:county:county-of-navajo`) | COUNTY | http://www.co.navajo.az.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF PIMA (`az:county:county-of-pima`) | COUNTY | http://www.pima.gov/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF PINAL (`az:county:county-of-pinal`) | COUNTY | http://www.pinalcountyaz.gov | SOURCE_DISCOVERY_OWED |
| COUNTY OF SANTA CRUZ (`az:county:county-of-santa-cruz`) | COUNTY | http://www.co.santacruz.az.us | SOURCE_DISCOVERY_OWED |
| COUNTY OF YAVAPAI (`az:county:county-of-yavapai`) | COUNTY | http://www.co.yavapai.az.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF YUMA (`az:county:county-of-yuma`) | COUNTY | http://www.yumacountyaz.gov | SOURCE_DISCOVERY_OWED |
| COCONINO COUNTY REGIONAL ACCOMMODATION DISTRICT (`az:depschool:coconino-county-regional-accommodation-district`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FORT HUACHUCA ACCOMMODATION SCHOOL (`az:depschool:fort-huachuca-accommodation-school`) | DEPENDENT_SCHOOL_SYSTEM | http://fthuachuca.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| GILA COUNTY REGIONAL SCHOOL DISTRICT (`az:depschool:gila-county-regional-school-district`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GRAHAM COUNTY SPECIAL SERVICES (`az:depschool:graham-county-special-services`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GREENLEE COUNTY ACCOMMODATION SCHOOL (`az:depschool:greenlee-county-accommodation-school`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARICOPA COUNTY REGIONAL SCHOOL DISTRICT (`az:depschool:maricopa-county-regional-school-district`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARICOPA COUNTY REGIONAL SPECIAL SERVICES DISTRICT (`az:depschool:maricopa-county-regional-special-services-district`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARY C OBRIEN ACCOMMODATION DISTRICT (`az:depschool:mary-c-obrien-accommodation-district`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NAVAJO COUNTY ACCOMMODATION DISTRICT #99 (`az:depschool:navajo-county-accommodation-district-99`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PIMA ACCOMMODATION DISTRICT (`az:depschool:pima-accommodation-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.schools.pima.gov/ | SOURCE_DISCOVERY_OWED |
| PIMA COUNTY SPECIAL EDUCATION PROGRAM 99 (`az:depschool:pima-county-special-education-program-99`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.SCHOOLS.CO.PIMA.AZ.US | SOURCE_DISCOVERY_OWED |
| YAVAPAI ACCOMMODATION SCHOOL DISTRICT (`az:depschool:yavapai-accommodation-school-district`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| AGUA FRIA UNION HIGH SCHOOL DISTRICT 216 (`az:school:agua-fria-union-high-school-district-216`) | SCHOOL_DISTRICT | http://www.aguafria.org | SOURCE_DISCOVERY_OWED |
| AGUILA SCHOOL DISTRICT 63 (`az:school:aguila-school-district-63`) | SCHOOL_DISTRICT | HTTP://WWW.AGUILASCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| AJO UNIFIED SCHOOL DISTRICT 15 (`az:school:ajo-unified-school-district-15`) | SCHOOL_DISTRICT | HTTP://WWW.AJOSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| ALHAMBRA ELEM SCHOOL DISTRICT 68 (`az:school:alhambra-elem-school-district-68`) | SCHOOL_DISTRICT | http://www.alhambraesd.org/ | SOURCE_DISCOVERY_OWED |
| ALPINE ELEM SCHOOL DISTRICT 7 (`az:school:alpine-elem-school-district-7`) | SCHOOL_DISTRICT | https://www.alpine.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| ALTAR VALLEY SCHOOL DISTRICT 51 (`az:school:altar-valley-school-district-51`) | SCHOOL_DISTRICT | HTTPS://WWW.ALTARVALLEYSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| AMPHITHEATER SCHOOL DISTRICT 10 (`az:school:amphitheater-school-district-10`) | SCHOOL_DISTRICT | http://www.amphi.com | SOURCE_DISCOVERY_OWED |
| ANTELOPE UNION HIGH SCHOOL DISTRICT 50 (`az:school:antelope-union-high-school-district-50`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| APACHE JUNCTION UNIFIED SCHOOL DISTRICT 43 (`az:school:apache-junction-unified-school-district-43`) | SCHOOL_DISTRICT | http://WWW.AJUSD.ORG | SOURCE_DISCOVERY_OWED |
| APACHE SCHOOL DISTRICT 42 (`az:school:apache-school-district-42`) | SCHOOL_DISTRICT | HTTP://WWW.APACHEELEMENTARY.ORG/ | SOURCE_DISCOVERY_OWED |
| ARIZONA WESTERN COLLEGE (`az:school:arizona-western-college`) | SCHOOL_DISTRICT | http://www.azwestern.edu | SOURCE_DISCOVERY_OWED |
| ARLINGTON SCHOOL DISTRICT 47 (`az:school:arlington-school-district-47`) | SCHOOL_DISTRICT | HTTPS://ARLINGTONELEM.ORG/ | SOURCE_DISCOVERY_OWED |
| ASH CREEK SCHOOL DISTRICT 53 (`az:school:ash-creek-school-district-53`) | SCHOOL_DISTRICT | HTTPS://ASHCREEKSCHOOL.WORDPRESS.COM/ | SOURCE_DISCOVERY_OWED |
| ASH FORK UNIFIED SCHOOL DISTRICT 31 (`az:school:ash-fork-unified-school-district-31`) | SCHOOL_DISTRICT | HTTP://WWW.AFJUSD.ORG | SOURCE_DISCOVERY_OWED |
| AVONDALE SCHOOL DISTRICT 44 (`az:school:avondale-school-district-44`) | SCHOOL_DISTRICT | http://www.avondale.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| BAGDAD UNIFIED SCHOOL DISTRICT 20 (`az:school:bagdad-unified-school-district-20`) | SCHOOL_DISTRICT | HTTPS://WWW.BAGDADSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| BALSZ SCHOOL DISTRICT 31 (`az:school:balsz-school-district-31`) | SCHOOL_DISTRICT | http://www.balsz.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| BEAVER CREEK SCHOOL DISTRICT 26 (`az:school:beaver-creek-school-district-26`) | SCHOOL_DISTRICT | HTTPS://WWW.BCS.K12.AZ.US/ | SOURCE_DISCOVERY_OWED |
| BENSON UNIFIED SCHOOL DISTRICT (`az:school:benson-unified-school-district`) | SCHOOL_DISTRICT | HTTP://WWW.BENSONSD.K12.AZ.US/ | SOURCE_DISCOVERY_OWED |
| BICENTENNIAL UNION HIGH SCHOOL DISTRICT 76 (`az:school:bicentennial-union-high-school-district-76`) | SCHOOL_DISTRICT | HTTP://WWW.SALOMEHS.ORG/ | SOURCE_DISCOVERY_OWED |
| BISBEE UNIFIED SCHOOL DISTRICT 2 (`az:school:bisbee-unified-school-district-2`) | SCHOOL_DISTRICT | HTTPS://WWW.BUSD.K12.AZ.US/ | SOURCE_DISCOVERY_OWED |
| BLUE RIDGE UNIFIED SCHOOL DISTRICT 32 (`az:school:blue-ridge-unified-school-district-32`) | SCHOOL_DISTRICT | http://WWW.BRUSD.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| BLUE SCHOOL DISTRICT 22 (`az:school:blue-school-district-22`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BONITA SCHOOL DISTRICT 16 (`az:school:bonita-school-district-16`) | SCHOOL_DISTRICT | HTTPS://WWW.BONITAESD.COM/ | SOURCE_DISCOVERY_OWED |
| BOUSE SCHOOL DISTRICT 26 (`az:school:bouse-school-district-26`) | SCHOOL_DISTRICT | HTTP://WWW.BOUSESCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| BOWIE SCHOOL DISTRICT 14 (`az:school:bowie-school-district-14`) | SCHOOL_DISTRICT | HTTPS://WWW.BOWIESCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| BUCKEYE SCHOOL DISTRICT 33 (`az:school:buckeye-school-district-33`) | SCHOOL_DISTRICT | HTTP://WWW.BESD33.ORG | SOURCE_DISCOVERY_OWED |
| BUCKEYE UNION HIGH SCHOOL DISTRICT 201 (`az:school:buckeye-union-high-school-district-201`) | SCHOOL_DISTRICT | HTTPS://WWW.BUHSD.ORG/ | SOURCE_DISCOVERY_OWED |
| BULLHEAD CITY SCHOOL DISTRICT 15 (`az:school:bullhead-city-school-district-15`) | SCHOOL_DISTRICT | http://www.bullheadschools.com | SOURCE_DISCOVERY_OWED |
| CAMP VERDE UNIFIED SCHOOL DISTRICT 28 (`az:school:camp-verde-unified-school-district-28`) | SCHOOL_DISTRICT | http://www.campverdeschools.org/ | SOURCE_DISCOVERY_OWED |
| CANON ELEMENTARY SCHOOL DISTRICT 50 (`az:school:canon-elementary-school-district-50`) | SCHOOL_DISTRICT | http://WWW.CANON50.COM | SOURCE_DISCOVERY_OWED |
| CARTWRIGHT SCHOOL DISTRICT 83 (`az:school:cartwright-school-district-83`) | SCHOOL_DISTRICT | http://www.cartwright.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| CASA GRANDE SCHOOL DISTRICT 4 (`az:school:casa-grande-school-district-4`) | SCHOOL_DISTRICT | http://WWW.CGELEM.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| CASA GRANDE UNION HIGH SCHOOL DISTRICT 82 (`az:school:casa-grande-union-high-school-district-82`) | SCHOOL_DISTRICT | http://CGUHS.ORG | SOURCE_DISCOVERY_OWED |
| CATALINA FOOTHILLS SCHOOL DISTRICT 16 (`az:school:catalina-foothills-school-district-16`) | SCHOOL_DISTRICT | http://www.cfsd16.org/ | SOURCE_DISCOVERY_OWED |
| CAVE CREEK UNIFIED SCHOOL DISTRICT 93 (`az:school:cave-creek-unified-school-district-93`) | SCHOOL_DISTRICT | http://www.ccusd93.org/ | SOURCE_DISCOVERY_OWED |
| CEDAR UNIFIED SCHOOL DISTRICT 25 (`az:school:cedar-unified-school-district-25`) | SCHOOL_DISTRICT | HTTPS://WWW.CEDARUSD.ORG/ | SOURCE_DISCOVERY_OWED |
| CENTRAL ARIZONA COLLEGE (`az:school:central-arizona-college`) | SCHOOL_DISTRICT | http://www.centralaz.edu | SOURCE_DISCOVERY_OWED |
| CENTRAL ARIZONA VALLEY INSTITUTE OF TECHNOLOGY (`az:school:central-arizona-valley-institute-of-technology`) | SCHOOL_DISTRICT | HTTP://WWW.CAVITSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| CHANDLER UNIFIED SCHOOL DISTRICT 80 (`az:school:chandler-unified-school-district-80`) | SCHOOL_DISTRICT | http://ww2.chandler.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| CHEVELON BUTTE SCHOOL DISTRICT 5 (`az:school:chevelon-butte-school-district-5`) | SCHOOL_DISTRICT | HTTPS://WWW.CHEVELONBUTTE.ORG/ | SOURCE_DISCOVERY_OWED |
| CHINLE UNIFIED SCHOOL DISTRICT 24 (`az:school:chinle-unified-school-district-24`) | SCHOOL_DISTRICT | http://www.chinleusd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| CHINO VALLEY UNIFIED SCHOOL DISTRICT 51 (`az:school:chino-valley-unified-school-district-51`) | SCHOOL_DISTRICT | http://www.cvsd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| CLARKSDALE-JEROME ELEMENTARY SCHOOL DISTRICT 3 (`az:school:clarksdale-jerome-elementary-school-district-3`) | SCHOOL_DISTRICT | HTTP://WWW.CJSD.K12.AZ.US/ | SOURCE_DISCOVERY_OWED |
| COBRE VALLEY INSTITUTE OF TECHNOLOGY DISTRICT (`az:school:cobre-valley-institute-of-technology-district`) | SCHOOL_DISTRICT | HTTP://WWW.CVIT81.ORG/ | SOURCE_DISCOVERY_OWED |
| COCHISE COUNTY COMMUNITY COLLEGE DISTRICT (`az:school:cochise-county-community-college-district`) | SCHOOL_DISTRICT | http://www.cochise.edu | SOURCE_DISCOVERY_OWED |
| COCHISE ELEMENTARY SCH DISTRICT 26 (`az:school:cochise-elementary-sch-district-26`) | SCHOOL_DISTRICT | https://www.cochiseschool.org/ | SOURCE_DISCOVERY_OWED |
| COCHISE TECHNOLOGY DISTRICT (`az:school:cochise-technology-district`) | SCHOOL_DISTRICT | HTTP://WWW.COCHISEJTED.ORG/ | SOURCE_DISCOVERY_OWED |
| COCONINO ASSOCIATION FOR VOCATION INDUSTRY & TECHNOLOGY(CAVIAT) (`az:school:coconino-association-for-vocation-industry-and-technology-caviat`) | SCHOOL_DISTRICT | HTTP://WWW.CAVIAT.ORG/ | SOURCE_DISCOVERY_OWED |
| COCONINO COMMUNITY COLLEGE DISTRICT (`az:school:coconino-community-college-district`) | SCHOOL_DISTRICT | http://www.coconino.edu | SOURCE_DISCOVERY_OWED |
| COLORADO CITY UNIFIED SCHOOL DISTRICT 14 (`az:school:colorado-city-unified-school-district-14`) | SCHOOL_DISTRICT | HTTP://WWW.CCSCHOOLS.US | SOURCE_DISCOVERY_OWED |
| COLORADO R UNION HIGH SCHOOL DISTRICT 2 (`az:school:colorado-r-union-high-school-district-2`) | SCHOOL_DISTRICT | http://coloradoriverschools.org/ | SOURCE_DISCOVERY_OWED |
| CONCHO SCHOOL DISTRICT 6 (`az:school:concho-school-district-6`) | SCHOOL_DISTRICT | http://www.conchoschool.net/ | SOURCE_DISCOVERY_OWED |
| CONGRESS SCHOOL DISTRICT 17 (`az:school:congress-school-district-17`) | SCHOOL_DISTRICT | HTTP://WWW.CONGRESSDISTRICT.ORG/ | SOURCE_DISCOVERY_OWED |
| CONTINENTAL SCHOOL DISTRICT 39 (`az:school:continental-school-district-39`) | SCHOOL_DISTRICT | http://continentalesd.org/ | SOURCE_DISCOVERY_OWED |
| COOLIDGE SCHOOL DISTRICT 21 (`az:school:coolidge-school-district-21`) | SCHOOL_DISTRICT | http://www.coolidgeschools.org/ | SOURCE_DISCOVERY_OWED |
| COTTONWOOD-OAK CREEK ELEMENTARY SCHOOL DISTRICT 6 (`az:school:cottonwood-oak-creek-elementary-school-district-6`) | SCHOOL_DISTRICT | http://WWW.COCSD.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| CRANE SCHOOL DISTRICT 13 (`az:school:crane-school-district-13`) | SCHOOL_DISTRICT | HTTPS://WWW.CRANESCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| CREIGHTON ELEMENTARY SCHOOL DISTRICT 14 (`az:school:creighton-elementary-school-district-14`) | SCHOOL_DISTRICT | http://www.creighton.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| CROWN KING SCHOOL DISTRICT 41 (`az:school:crown-king-school-district-41`) | SCHOOL_DISTRICT | HTTP://CROWNKINGESD.COM | SOURCE_DISCOVERY_OWED |
| DEER VALLEY UNIFIED SCHOOL DISTRICT (`az:school:deer-valley-unified-school-district`) | SCHOOL_DISTRICT | http://www.dvusd.org/dvusd | SOURCE_DISCOVERY_OWED |
| DOUBLE ADOBE SCHOOL DISTRICT 45 (`az:school:double-adobe-school-district-45`) | SCHOOL_DISTRICT | HTTP://WWW.DOUBLEADOBESCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| DOUGLAS UNIFIED SCHOOL DISTRICT 27 (`az:school:douglas-unified-school-district-27`) | SCHOOL_DISTRICT | HTTPS://WWW.DUSD.US/ | SOURCE_DISCOVERY_OWED |
| DUNCAN UNIFIED SCHOOL DISTRICT 2 (`az:school:duncan-unified-school-district-2`) | SCHOOL_DISTRICT | http://WWW.DUNCAN.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| DYSART SCHOOL DISTRICT 89 (`az:school:dysart-school-district-89`) | SCHOOL_DISTRICT | HTTP://WWW.DYSART.ORG/ | SOURCE_DISCOVERY_OWED |
| EAGLE ELEMENTARY DISTRICT 45 (`az:school:eagle-elementary-district-45`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EAST VALLEY INSTITUTE OF TECHNOLOGY DISTRICT (`az:school:east-valley-institute-of-technology-district`) | SCHOOL_DISTRICT | http://www.evit.com | SOURCE_DISCOVERY_OWED |
| ELFRIDA SCHOOL DISTRICT 12 (`az:school:elfrida-school-district-12`) | SCHOOL_DISTRICT | HTTPS://WWW.ELFRIDASCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| ELOY SCHOOL DISTRICT 11 (`az:school:eloy-school-district-11`) | SCHOOL_DISTRICT | http://WWW.ADE.STATE.AZ.US | SOURCE_DISCOVERY_OWED |
| EMPIRE SCHOOL DISTRICT 37 (`az:school:empire-school-district-37`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FLAGSTAFF SCHOOL DISTRICT 1 (`az:school:flagstaff-school-district-1`) | SCHOOL_DISTRICT | http://WWW.FLAGSTAFF.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| FLORENCE UNIFIED SCHOOL DISTRICT 1 (`az:school:florence-unified-school-district-1`) | SCHOOL_DISTRICT | HTTPS://WWW.FUSDAZ.COM/ | SOURCE_DISCOVERY_OWED |
| FLOWING WELLS SCHOOL DISTRICT 8 (`az:school:flowing-wells-school-district-8`) | SCHOOL_DISTRICT | http://WWW.FLOWINGWELLS.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| FORREST SCHOOL DISTRICT 81 (`az:school:forrest-school-district-81`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FOUNTAIN HILLS SCHOOL DISTRICT 98 (`az:school:fountain-hills-school-district-98`) | SCHOOL_DISTRICT | HTTPS://WWW.FOUNTAINHILLSSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| FOWLER SCHOOL DISTRICT 45 (`az:school:fowler-school-district-45`) | SCHOOL_DISTRICT | http://www.fesd.org/ | SOURCE_DISCOVERY_OWED |
| FREDONIA-MOCCASIN BI-COUNTY SCHOOL DISTRICT 6 (`az:school:fredonia-moccasin-bi-county-school-district-6`) | SCHOOL_DISTRICT | HTTP://FREDONIA.ORG | SOURCE_DISCOVERY_OWED |
| FT THOMAS SCHOOL DISTRICT 7 (`az:school:ft-thomas-school-district-7`) | SCHOOL_DISTRICT | HTTP://WWW.FTUSD.ORG | SOURCE_DISCOVERY_OWED |
| GADSDEN SCHOOL DISTRICT 32 (`az:school:gadsden-school-district-32`) | SCHOOL_DISTRICT | http://www.gesd32.org/ | SOURCE_DISCOVERY_OWED |
| GANADO UNIFIED SCHOOL DISTRICT 20 (`az:school:ganado-unified-school-district-20`) | SCHOOL_DISTRICT | http://www.ganado.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| GILA BEND UNIFIED SCHOOL DISTRICT 24 (`az:school:gila-bend-unified-school-district-24`) | SCHOOL_DISTRICT | http://www.gilabendusd.org/ | SOURCE_DISCOVERY_OWED |
| GILA COMMUNITY COLLEGE DISTRICT (`az:school:gila-community-college-district`) | SCHOOL_DISTRICT | http://www.gilaccc.org/ | SOURCE_DISCOVERY_OWED |
| GILA INSITUTE FOR TECHNOLOGY (`az:school:gila-insitute-for-technology`) | SCHOOL_DISTRICT | HTTP://WWW.GIFT-TECH.ORG | SOURCE_DISCOVERY_OWED |
| GILBERT SCHOOL DISTRICT 41 (`az:school:gilbert-school-district-41`) | SCHOOL_DISTRICT | http://www.gilbert.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| GLENDALE ELEMENTARY SCHOOL DISTRICT 40 (`az:school:glendale-elementary-school-district-40`) | SCHOOL_DISTRICT | http://www.gesd40.org/ | SOURCE_DISCOVERY_OWED |
| GLENDALE UNION HIGH SCHOOL DISTRICT 205 (`az:school:glendale-union-high-school-district-205`) | SCHOOL_DISTRICT | http://www.guhsdaz.org/ | SOURCE_DISCOVERY_OWED |
| GLOBE SCHOOL DISTRICT 1 (`az:school:globe-school-district-1`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GRAHAM COUNTY COMMUNITY COLLEGE DIST (EASTERN ARIZONA COLLEGE) (`az:school:graham-county-community-college-dist-eastern-arizona-college`) | SCHOOL_DISTRICT | http://www.eac.edu | SOURCE_DISCOVERY_OWED |
| GRAND CANYON SCHOOL DISTRICT 4 (`az:school:grand-canyon-school-district-4`) | SCHOOL_DISTRICT | http://WWW.GRANDCANYONSCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| GREENLEE ALTERNATIVE SCHOOL DISTRICT (`az:school:greenlee-alternative-school-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HACKBERRY SCHOOL DISTRICT 3 (`az:school:hackberry-school-district-3`) | SCHOOL_DISTRICT | HTTP://WWW.MYCEDARHILLS.INFO/ | SOURCE_DISCOVERY_OWED |
| HAYDEN-WINKELMAN SCHOOL DISTRICT 41 (`az:school:hayden-winkelman-school-district-41`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HEBER OVERGAARD SCHOOL DISTRICT (`az:school:heber-overgaard-school-district`) | SCHOOL_DISTRICT | HTTPS://WWW.HEBEROVERGAARDSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| HIGLEY UNIFIED SCHOOL DISTRICT (`az:school:higley-unified-school-district`) | SCHOOL_DISTRICT | http://www.husd.org/ | SOURCE_DISCOVERY_OWED |
| HILLSIDE SCHOOL DISTRICT 35 (`az:school:hillside-school-district-35`) | SCHOOL_DISTRICT | HTTP://HILLSIDEESD.COM/ | SOURCE_DISCOVERY_OWED |
| HOLBROOK UNIFIED SCHOOL DISTRICT 3 (`az:school:holbrook-unified-school-district-3`) | SCHOOL_DISTRICT | HTTP://WWW.HOLBROOK.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| HUMBOLDT UNIFIED SCHOOL DISTRICT 22 (`az:school:humboldt-unified-school-district-22`) | SCHOOL_DISTRICT | http://www.humboldtunified.com/ | SOURCE_DISCOVERY_OWED |
| HYDER SCHOOL DISTRICT 16 (`az:school:hyder-school-district-16`) | SCHOOL_DISTRICT | HTTPS://WWW.HYDERSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| INDIAN OASIS-BABOQUIVARA UNIFIED SCHOOL DISTRICT 40 (`az:school:indian-oasis-baboquivara-unified-school-district-40`) | SCHOOL_DISTRICT | HTTP://WWW.BUSD40.ORG | SOURCE_DISCOVERY_OWED |
| ISAAC SCHOOL DISTRICT 5 (`az:school:isaac-school-district-5`) | SCHOOL_DISTRICT | http://ISAACELD.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| J O COMBS UNIFIED SCHOOL DISTRICT 44 (`az:school:j-o-combs-unified-school-district-44`) | SCHOOL_DISTRICT | HTTPS://WWW.JOCOMBS.ORG/ | SOURCE_DISCOVERY_OWED |
| JOSEPH CITY SCHOOL DISTRICT 2 (`az:school:joseph-city-school-district-2`) | SCHOOL_DISTRICT | http://www.josephcity.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| KAYENTA UNIFIED SCHOOL DISTRICT 27 (`az:school:kayenta-unified-school-district-27`) | SCHOOL_DISTRICT | HTTP://WWW.KAYENTA.K12.AZ.US/ | SOURCE_DISCOVERY_OWED |
| KINGMAN UNIFIED SCHOOL DISTRICT 20 (`az:school:kingman-unified-school-district-20`) | SCHOOL_DISTRICT | http://www.kusd.org/ | SOURCE_DISCOVERY_OWED |
| KIRKLAND SCHOOL DISTRICT 23 (`az:school:kirkland-school-district-23`) | SCHOOL_DISTRICT | HTTP://WWW.KIRKLANDAZ.ORG/ | SOURCE_DISCOVERY_OWED |
| KLONDYKE SCHOOL DISTRICT 9 (`az:school:klondyke-school-district-9`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| KYRENE SCHOOL DISTRICT 28 (`az:school:kyrene-school-district-28`) | SCHOOL_DISTRICT | http://WWW.KYRENE.ORG | SOURCE_DISCOVERY_OWED |
| LAKE HAVASU UNIFIED SCHOOL DISTRICT 1 (`az:school:lake-havasu-unified-school-district-1`) | SCHOOL_DISTRICT | http://www.havasu.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| LAVEEN SCHOOL DISTRICT 59 (`az:school:laveen-school-district-59`) | SCHOOL_DISTRICT | http://www.laveenesd.org/ | SOURCE_DISCOVERY_OWED |
| LIBERTY SCHOOL DISTRICT 25 (`az:school:liberty-school-district-25`) | SCHOOL_DISTRICT | http://WWW.LIBERTY.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| LITCHFIELD ELEMENTARY SCHOOL DISTRICT 79 (`az:school:litchfield-elementary-school-district-79`) | SCHOOL_DISTRICT | http://www.lesd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| LITTLEFIELD SCHOOL DISTRICT 9 (`az:school:littlefield-school-district-9`) | SCHOOL_DISTRICT | HTTP://WWW.LUSD9.COM | SOURCE_DISCOVERY_OWED |
| LITTLETON ELEMENTARY SCHOOL DISTRICT 65 (`az:school:littleton-elementary-school-district-65`) | SCHOOL_DISTRICT | HTTPS://WWW.LITTLETONAZ.ORG/ | SOURCE_DISCOVERY_OWED |
| MADISON ELEMENTARY SCHOOL DISTRICT 38 (`az:school:madison-elementary-school-district-38`) | SCHOOL_DISTRICT | http://www.msd38.org/ | SOURCE_DISCOVERY_OWED |
| MAINE CONSOLIDATED SCHOOL DISTRICT 10 (`az:school:maine-consolidated-school-district-10`) | SCHOOL_DISTRICT | http://WWW.MAINE.APSCC.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| MAMMOTH-SAN MANUEL UNIFIED SCHOOL DISTRICT 8 (`az:school:mammoth-san-manuel-unified-school-district-8`) | SCHOOL_DISTRICT | HTTP://MSMUSD.ORG | SOURCE_DISCOVERY_OWED |
| MARANA UNIFIED SCHOOL DISTRICT 6 (`az:school:marana-unified-school-district-6`) | SCHOOL_DISTRICT | HTTP://WWW.MARANAUSD.ORG/ | SOURCE_DISCOVERY_OWED |
| MARICOPA COUNTY COMMUNITY COLLEGE DISTRICT (`az:school:maricopa-county-community-college-district`) | SCHOOL_DISTRICT | http://www.maricopa.edu/ | SOURCE_DISCOVERY_OWED |
| MARICOPA SCHOOL DISTRICT 20 (`az:school:maricopa-school-district-20`) | SCHOOL_DISTRICT | http://WWW.MUSD20.ORG | SOURCE_DISCOVERY_OWED |
| MAYER UNIFIED SCHOOL DISTRICT 43 (`az:school:mayer-unified-school-district-43`) | SCHOOL_DISTRICT | http://www.mayerschools.org/ | SOURCE_DISCOVERY_OWED |
| MCNARY SCHOOL DISTRICT 23 (`az:school:mcnary-school-district-23`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MCNEAL SCHOOL DISTRICT 55 (`az:school:mcneal-school-district-55`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MESA UNIFIED SCHOOL DISTRICT (`az:school:mesa-unified-school-district`) | SCHOOL_DISTRICT | HTTP://WWW.MPSAZ.ORG/ | SOURCE_DISCOVERY_OWED |
| MIAMI UNIFIED SCHOOL DISTRICT 40 (`az:school:miami-unified-school-district-40`) | SCHOOL_DISTRICT | HTTP://WWW.MIAMIUSD40.ORG | SOURCE_DISCOVERY_OWED |
| MINGUS UNION HIGH SCHOOL DISTRICT 4 (`az:school:mingus-union-high-school-district-4`) | SCHOOL_DISTRICT | http://WWW.MUHS.COM | SOURCE_DISCOVERY_OWED |
| MOBILE ELEMENTARY SCHOOL DISTRICT 86 (`az:school:mobile-elementary-school-district-86`) | SCHOOL_DISTRICT | HTTPS://WWW.MOBILEESD.ORG/ | SOURCE_DISCOVERY_OWED |
| MOHAVE COMMUNITY COLLEGE (`az:school:mohave-community-college`) | SCHOOL_DISTRICT | http://www.mohave.edu | SOURCE_DISCOVERY_OWED |
| MOHAVE VALLEY SCHOOL DISTRICT 16 (`az:school:mohave-valley-school-district-16`) | SCHOOL_DISTRICT | http://WWW.MVESD16.ORG | SOURCE_DISCOVERY_OWED |
| MOHAWK VALLEY SCHOOL DISTRICT 17 (`az:school:mohawk-valley-school-district-17`) | SCHOOL_DISTRICT | http://WWW.MOHAWK.APSCC.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| MORENCI UNIFIED DISTRICT (`az:school:morenci-unified-district`) | SCHOOL_DISTRICT | https://morenci.org/ | SOURCE_DISCOVERY_OWED |
| MORRISTOWN SCHOOL DISTRICT 75 (`az:school:morristown-school-district-75`) | SCHOOL_DISTRICT | http://WWW.FAMILYEDUCATION.COM/AZ/MORRISTOWN | SOURCE_DISCOVERY_OWED |
| MOUNTAIN INSTITUTE JOINT TECHNOLOGY EDUCATION DISTRICT (`az:school:mountain-institute-joint-technology-education-district`) | SCHOOL_DISTRICT | http://www.micted.net/ | SOURCE_DISCOVERY_OWED |
| MURPHY SCHOOL DISTRICT 21 (`az:school:murphy-school-district-21`) | SCHOOL_DISTRICT | http://WWW.MSDAZ.ORG | SOURCE_DISCOVERY_OWED |
| NACO SCHOOL DISTRICT 23 (`az:school:naco-school-district-23`) | SCHOOL_DISTRICT | http://www.naco.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| NADABURG SCHOOL DISTRICT 81 (`az:school:nadaburg-school-district-81`) | SCHOOL_DISTRICT | HTTPS://WWW.NADABURGSD.ORG/ | SOURCE_DISCOVERY_OWED |
| NE AZ TECHNOLOGICAL INSTITUTE OF VOCATIONAL EDUCATION (`az:school:ne-az-technological-institute-of-vocational-education`) | SCHOOL_DISTRICT | HTTP://NATIVEDISTRICT.ORG/ | SOURCE_DISCOVERY_OWED |
| NOGALES UNIFIED SCHOOL DISTRICT 1 (`az:school:nogales-unified-school-district-1`) | SCHOOL_DISTRICT | http://www.nusd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| NORTHERN ARIZONA VOCATIONAL INSTITUTE OF TECHNOLOGY (`az:school:northern-arizona-vocational-institute-of-technology`) | SCHOOL_DISTRICT | http://www.navit.k12.az.us/phone_addresses.htm | SOURCE_DISCOVERY_OWED |
| NORTHLAND PIONEER COLLEGE (`az:school:northland-pioneer-college`) | SCHOOL_DISTRICT | http://www.npc.edu | SOURCE_DISCOVERY_OWED |
| ORACLE SCHOOL DISTRICT 2 (`az:school:oracle-school-district-2`) | SCHOOL_DISTRICT | http://www.oracle.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| OSBORN SCHOOL DISTRICT 8 (`az:school:osborn-school-district-8`) | SCHOOL_DISTRICT | http://WWW.OSBORNNET.ORG | SOURCE_DISCOVERY_OWED |
| OWENS WHITNEY SCHOOL DISTRICT 6 (`az:school:owens-whitney-school-district-6`) | SCHOOL_DISTRICT | HTTPS://WWW.OWENS-WHITNEY.ORG/ | SOURCE_DISCOVERY_OWED |
| PAGE SCHOOL DISTRICT 8 (`az:school:page-school-district-8`) | SCHOOL_DISTRICT | http://www.pageud.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| PALO VERDE SCHOOL DISTRICT 49 (`az:school:palo-verde-school-district-49`) | SCHOOL_DISTRICT | HTTP://WWW.PVESD.ORG | SOURCE_DISCOVERY_OWED |
| PALOMA SCHOOL DISTRICT 94 (`az:school:paloma-school-district-94`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PALOMINAS SCHOOL DISTRICT 49 (`az:school:palominas-school-district-49`) | SCHOOL_DISTRICT | HTTP://WWW.PSD49.NET/ | SOURCE_DISCOVERY_OWED |
| PARADISE VALLEY SCHOOL DISTRICT 69 AND 217 (`az:school:paradise-valley-school-district-69-and-217`) | SCHOOL_DISTRICT | http://cmweb.pvschools.net/siteweb/index.html | SOURCE_DISCOVERY_OWED |
| PARKER SCHOOL DISTRICT 27 (`az:school:parker-school-district-27`) | SCHOOL_DISTRICT | http://www.parkerusd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| PATAGONIA ELEMENTARY SCHOOL DISTRICT 6 (`az:school:patagonia-elementary-school-district-6`) | SCHOOL_DISTRICT | HTTP://WWW.PATAGONIA.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| PATAGONIA UNION HIGH SCHOOL DISTRICT 20 (`az:school:patagonia-union-high-school-district-20`) | SCHOOL_DISTRICT | HTTP://WWW.PATAGONIA.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| PAYSON UNIFIED SCHOOL DISTRICT 10 (`az:school:payson-unified-school-district-10`) | SCHOOL_DISTRICT | http://WWW.PUSD.COM | SOURCE_DISCOVERY_OWED |
| PEACH SPRINGS UNIFIED SCHOOL DISTRICT (`az:school:peach-springs-unified-school-district`) | SCHOOL_DISTRICT | HTTPS://WWW.PSUSD8.ORG/ | SOURCE_DISCOVERY_OWED |
| PEARCE SCHOOL DISTRICT 22 (`az:school:pearce-school-district-22`) | SCHOOL_DISTRICT | HTTP://WWW.PEARCESCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| PENDERGAST SCHOOL DISTRICT 92 (`az:school:pendergast-school-district-92`) | SCHOOL_DISTRICT | http://www.pesd92.org/ | SOURCE_DISCOVERY_OWED |
| PEORIA UNIFIED SCHOOL DISTRICT 11 (`az:school:peoria-unified-school-district-11`) | SCHOOL_DISTRICT | http://WWW.PEORIAUD.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| PHOENIX ELEMENTARY SCHOOL DISTRICT 1 (`az:school:phoenix-elementary-school-district-1`) | SCHOOL_DISTRICT | http://www.phxelem.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| PHOENIX UNION HIGH SCHOOL DISTRICT 210 (`az:school:phoenix-union-high-school-district-210`) | SCHOOL_DISTRICT | http://WWW.PHXHS.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| PICACHO SCHOOL DISTRICT 33 (`az:school:picacho-school-district-33`) | SCHOOL_DISTRICT | HTTP://WWW.PICACHO.K12.AZ.US/ | SOURCE_DISCOVERY_OWED |
| PIMA COUNTY COMMUNITY COLLEGE DISTRICT (`az:school:pima-county-community-college-district`) | SCHOOL_DISTRICT | http://www.pima.edu | SOURCE_DISCOVERY_OWED |
| PIMA COUNTY JOINT TECHNOLOGICAL EDUCATION DISTRICT NUMBER 11 (`az:school:pima-county-joint-technological-education-district-number-11`) | SCHOOL_DISTRICT | HTTP://WWW.PIMAJTED.ORG | SOURCE_DISCOVERY_OWED |
| PIMA UNIFIED SCHOOL DISTRICT 6 (`az:school:pima-unified-school-district-6`) | SCHOOL_DISTRICT | HTTPS://WWW.PIMASCHOOLS.COM/ | SOURCE_DISCOVERY_OWED |
| PINE-STRAWBERRY SCHOOL DISTRICT 12 (`az:school:pine-strawberry-school-district-12`) | SCHOOL_DISTRICT | HTTP://WWW.PINEESD.ORG | SOURCE_DISCOVERY_OWED |
| PINON SCHOOL UNIFIED SCHOOL DISTRICT 4 (`az:school:pinon-school-unified-school-district-4`) | SCHOOL_DISTRICT | HTTP://WWW.PUSDATSA.ORG | SOURCE_DISCOVERY_OWED |
| POMERENE SCHOOL DISTRICT 64 (`az:school:pomerene-school-district-64`) | SCHOOL_DISTRICT | HTTP://WWW.POMERENESCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| PRESCOTT UNIFIED SCHOOL DISTRICT 1 (`az:school:prescott-unified-school-district-1`) | SCHOOL_DISTRICT | HTTP://WWW.PRESCOTTSCHOOLS.COM/ | SOURCE_DISCOVERY_OWED |
| QUARTZSITE ELEMENTARY DISTRICT (`az:school:quartzsite-elementary-district`) | SCHOOL_DISTRICT | http://mail.qsd4.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| QUEEN CREEK SCHOOL DISTRICT 95 (`az:school:queen-creek-school-district-95`) | SCHOOL_DISTRICT | HTTPS://WWW.QCUSD.ORG/ | SOURCE_DISCOVERY_OWED |
| RAY SCHOOL DISTRICT 3 (`az:school:ray-school-district-3`) | SCHOOL_DISTRICT | HTTP://WWW.RAYUSD.ORG | SOURCE_DISCOVERY_OWED |
| RED MESA UNIFIED SCHOOL DISTRICT 27 (`az:school:red-mesa-unified-school-district-27`) | SCHOOL_DISTRICT | http://www.rmusd.net/ | SOURCE_DISCOVERY_OWED |
| RED ROCK SCHOOL DISTRICT 5 (`az:school:red-rock-school-district-5`) | SCHOOL_DISTRICT | HTTP://WWW.REDROCKSCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| REDINGTON SCHOOL DISTRICT 44 (`az:school:redington-school-district-44`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RIVERSIDE SCHOOL DISTRICT 2 (`az:school:riverside-school-district-2`) | SCHOOL_DISTRICT | HTTPS://WWW.RESDONLINE.ORG/ | SOURCE_DISCOVERY_OWED |
| ROOSEVELT SCHOOL DISTRICT 66 (`az:school:roosevelt-school-district-66`) | SCHOOL_DISTRICT | http://www.rsd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| ROUND VALLEY UNIFIED SCHOOL DISRICT 10 (`az:school:round-valley-unified-school-disrict-10`) | SCHOOL_DISTRICT | http://www.elks.net/ | SOURCE_DISCOVERY_OWED |
| SACATON SCHOOL DISTRICT 18 (`az:school:sacaton-school-district-18`) | SCHOOL_DISTRICT | HTTPS://WWW.SACATONSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| SADDLE MOUNTAIN UNIFIED SCHOOL DISTRICT (`az:school:saddle-mountain-unified-school-district`) | SCHOOL_DISTRICT | HTTPS://WWW.SMUSD90.ORG/ | SOURCE_DISCOVERY_OWED |
| SAFFORD SCHOOL DISTRICT 1 (`az:school:safford-school-district-1`) | SCHOOL_DISTRICT | HTTPS://WWW.SAFFORDUSD.COM/ | SOURCE_DISCOVERY_OWED |
| SAHUARITA SCHOOL DISTRICT 30 (`az:school:sahuarita-school-district-30`) | SCHOOL_DISTRICT | http://WWW.SAHUARITA.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| SALOME SCHOOL DISTRICT 30 (`az:school:salome-school-district-30`) | SCHOOL_DISTRICT | HTTP://WWW.SALOMEK8.ORG | SOURCE_DISCOVERY_OWED |
| SAN CARLOS UNIFIED SCHOOL DISTRICT 20 (`az:school:san-carlos-unified-school-district-20`) | SCHOOL_DISTRICT | HTTPS://WWW.SCBRAVES.NET/ | SOURCE_DISCOVERY_OWED |
| SAN FERNANDO SCHOOL DISTRICT 35 (`az:school:san-fernando-school-district-35`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SAN SIMON SCHOOL DISTRICT 18 (`az:school:san-simon-school-district-18`) | SCHOOL_DISTRICT | http://www.sansimon.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| SANDERS UNIFIED SCHOOL DISTRICT 18 (`az:school:sanders-unified-school-district-18`) | SCHOOL_DISTRICT | http://www.susd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| SANTA CRUZ CO PROVISIONAL COMMUNITY COLLEGE DISTRICT (NOGALES) (`az:school:santa-cruz-co-provisional-community-college-district-nogales`) | SCHOOL_DISTRICT | https://santacruzcenter.org/ | SOURCE_DISCOVERY_OWED |
| SANTA CRUZ ELEMENTARY SCHOOL DISTRICT 28 (`az:school:santa-cruz-elementary-school-district-28`) | SCHOOL_DISTRICT | HTTP://WWW.SCED28.COM/ | SOURCE_DISCOVERY_OWED |
| SANTA CRUZ VALLEY SCHOOL DISTRICT 35 (`az:school:santa-cruz-valley-school-district-35`) | SCHOOL_DISTRICT | http://www.santacruz.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| SANTA CRUZ VALLEY UNION HIGH SCHOOL DISTRICT 840 (`az:school:santa-cruz-valley-union-high-school-district-840`) | SCHOOL_DISTRICT | HTTP://WWW.SCVUHS.ORG | SOURCE_DISCOVERY_OWED |
| SCOTTSDALE UNIFIED SCHOOL DISTRICT 48 (`az:school:scottsdale-unified-school-district-48`) | SCHOOL_DISTRICT | http://www.susd.org/ | SOURCE_DISCOVERY_OWED |
| SEDONA-OAK CREEK JOINT UNIFIED SCHOOL DISTRICT (`az:school:sedona-oak-creek-joint-unified-school-district`) | SCHOOL_DISTRICT | http://www.sedona.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| SELIGMAN UNIFIED SCHOOL DISTRICT 40 (`az:school:seligman-unified-school-district-40`) | SCHOOL_DISTRICT | HTTPS://WWW.SELIGMANSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| SENTINEL SCHOOL DISTRICT 71 (`az:school:sentinel-school-district-71`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SHOW LOW UNIFIED SCHOOL DISTRICT 10 (`az:school:show-low-unified-school-district-10`) | SCHOOL_DISTRICT | http://WWW.SHOW-LOW.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| SIERRA VISTA UNIFIED SCHOOL DISTRICT 68 (`az:school:sierra-vista-unified-school-district-68`) | SCHOOL_DISTRICT | http://sierravistapublicschools.com/ | SOURCE_DISCOVERY_OWED |
| SKULL VALLEY SCHOOL DISTRICT 15 (`az:school:skull-valley-school-district-15`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SNOWFLAKE UNIFIED SCHOOL DISTRICT 5 (`az:school:snowflake-unified-school-district-5`) | SCHOOL_DISTRICT | http://WWW.SNOWFLAKE.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| SOLOMONVILLE SCHOOL DISTRICT 5 (`az:school:solomonville-school-district-5`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SOMERTON SCHOOL DISTRICT 11 (`az:school:somerton-school-district-11`) | SCHOOL_DISTRICT | http://SOMERTON.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| SONOITA SCHOOL DISTRICT 25 (`az:school:sonoita-school-district-25`) | SCHOOL_DISTRICT | HTTPS://WWW.ELGINK12.COM/ | SOURCE_DISCOVERY_OWED |
| SOUTHWEST TECHNICAL EDUCATION DISTRICT OF YUMA (STEDY) (`az:school:southwest-technical-education-district-of-yuma-stedy`) | SCHOOL_DISTRICT | HTTP://WWW.STEDYCTE.ORG/ | SOURCE_DISCOVERY_OWED |
| ST DAVID SCHOOL DISTRICT 21 (`az:school:st-david-school-district-21`) | SCHOOL_DISTRICT | HTTP://WWW.STDAVIDSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| ST JOHNS UNIFIED SCHOOL DISTRICT 1 (`az:school:st-johns-unified-school-district-1`) | SCHOOL_DISTRICT | http://www.sjusd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| STANFIELD SCHOOL DISTRICT 24 (`az:school:stanfield-school-district-24`) | SCHOOL_DISTRICT | HTTP://WWW.ROADRUNNERS24.NET | SOURCE_DISCOVERY_OWED |
| SUNNYSIDE SCHOOL DISTRICT 12 (`az:school:sunnyside-school-district-12`) | SCHOOL_DISTRICT | http://WWW.SUNNYSIDEUD.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| SUPERIOR SCHOOL DISTRICT 15 (`az:school:superior-school-district-15`) | SCHOOL_DISTRICT | HTTP://WWW.SUPERIORUSD.ORG | SOURCE_DISCOVERY_OWED |
| TANQUE VERDE UNIFIED SCHOOL DISTRICT 13 (`az:school:tanque-verde-unified-school-district-13`) | SCHOOL_DISTRICT | http://WWW.TANQ.ORG | SOURCE_DISCOVERY_OWED |
| TEMPE ELEMENTARY SCHOOL DISTRICT 3 (`az:school:tempe-elementary-school-district-3`) | SCHOOL_DISTRICT | HTTP://WWW.TEMPESCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| TEMPE UNION HIGH SCHOOL DISTRICT 213 (`az:school:tempe-union-high-school-district-213`) | SCHOOL_DISTRICT | http://www.tuhsd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| THATCHER SCHOOL DISTRICT 4 (`az:school:thatcher-school-district-4`) | SCHOOL_DISTRICT | http://WWW.THATCHERUD.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| TOLLESON ELEMENTARY SCHOOL DISTRICT 17 (`az:school:tolleson-elementary-school-district-17`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOLLESON UNION HIGH SCHOOL DISTRICT 214 (`az:school:tolleson-union-high-school-district-214`) | SCHOOL_DISTRICT | http://www.tuhsd.org/ | SOURCE_DISCOVERY_OWED |
| TOLTEC SCHOOL DISTRICT 22 (`az:school:toltec-school-district-22`) | SCHOOL_DISTRICT | HTTPS://WWW.TOLTECSD.ORG/ | SOURCE_DISCOVERY_OWED |
| TOMBSTONE SCHOOL DISTRICT 1 (`az:school:tombstone-school-district-1`) | SCHOOL_DISTRICT | HTTP://WWW.TOMBSTONESCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| TONTO SCHOOL DISTRICT 33 (`az:school:tonto-school-district-33`) | SCHOOL_DISTRICT | HTTP://TONTOBASINSCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| TOPOCK SCHOOL DISTRICT 12 (`az:school:topock-school-district-12`) | SCHOOL_DISTRICT | HTTPS://TOPOCKAZSCHOOL.COM/ | SOURCE_DISCOVERY_OWED |
| TUBA CITY UNIFIED SCHOOL DISTRICT 15 (`az:school:tuba-city-unified-school-district-15`) | SCHOOL_DISTRICT | HTTP://WWW.TCUSD.ORG/ | SOURCE_DISCOVERY_OWED |
| TUCSON UNIFIED SCHOOL DISTRICT 1 (`az:school:tucson-unified-school-district-1`) | SCHOOL_DISTRICT | http://www.tusd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| UNION SCHOOL DISTRICT 62 (`az:school:union-school-district-62`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| VAIL UNIFIED SCHOOL DISTRICT (`az:school:vail-unified-school-district`) | SCHOOL_DISTRICT | http://WWW.VAIL.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| VALENTINE SCHOOL DISTRICT 22 (`az:school:valentine-school-district-22`) | SCHOOL_DISTRICT | HTTPS://WWW.VALENTINEAZ.NET/ | SOURCE_DISCOVERY_OWED |
| VALLEY ACADEMY FOR CAREER AND TECH ED DISTRICT (`az:school:valley-academy-for-career-and-tech-ed-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| VALLEY UNION HIGH SCHOOL DISTRICT 22 (`az:school:valley-union-high-school-district-22`) | SCHOOL_DISTRICT | HTTP://WWW.VUHS.NET | SOURCE_DISCOVERY_OWED |
| VERNON ELEMENTARY SCHOOL DISTRICT 9 (`az:school:vernon-elementary-school-district-9`) | SCHOOL_DISTRICT | HTTP://WWW.VERNON.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| WALNUT GROVE ELEMENTARY DISTRICT (`az:school:walnut-grove-elementary-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WASHINGTON SCHOOL DISTRICT 6 (`az:school:washington-school-district-6`) | SCHOOL_DISTRICT | http://www.wesdschools.org/ | SOURCE_DISCOVERY_OWED |
| WELLTON SCHOOL DISTRICT 24 (`az:school:wellton-school-district-24`) | SCHOOL_DISTRICT | HTTPS://WWW.WELLTONSCHOOL.ORG/ | SOURCE_DISCOVERY_OWED |
| WENDEN SCHOOL DISTRICT 19 (`az:school:wenden-school-district-19`) | SCHOOL_DISTRICT | HTTPS://WWW.WENDENK8.ORG/ | SOURCE_DISCOVERY_OWED |
| WESTERN ARIZONA VOCATIONAL DISTRICT #50 (`az:school:western-arizona-vocational-district-50`) | SCHOOL_DISTRICT | HTTP://WWW.WAVEJTED.ORG/ | SOURCE_DISCOVERY_OWED |
| WESTERN MARICOPA EDUCATION CENTER (`az:school:western-maricopa-education-center`) | SCHOOL_DISTRICT | HTTP://WWW.WEST-MEC.ORG | SOURCE_DISCOVERY_OWED |
| WHITERIVER UNIFIED SCHOOL DISTRICT 20 (`az:school:whiteriver-unified-school-district-20`) | SCHOOL_DISTRICT | http://www.wusd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| WICKENBURG UNIFIED SCHOOL DISTRICT 9 (`az:school:wickenburg-unified-school-district-9`) | SCHOOL_DISTRICT | HTTP://WWW.WICKENBURGSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| WILLCOX SCHOOL DISTRICT 13 (`az:school:willcox-school-district-13`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WILLIAMS SCHOOL DISTRICT 2 (`az:school:williams-school-district-2`) | SCHOOL_DISTRICT | HTTP://WWW.WUSD2.ORG | SOURCE_DISCOVERY_OWED |
| WILLIAMSON VALLEY SCHOOL DISTRICT 2 (`az:school:williamson-valley-school-district-2`) | SCHOOL_DISTRICT | HTTPS://WILLIAMSONVALLEYESD.COM/ | SOURCE_DISCOVERY_OWED |
| WILSON SCHOOL DISTRICT 7 (`az:school:wilson-school-district-7`) | SCHOOL_DISTRICT | http://WWW.WSD.K12.AZ.US | SOURCE_DISCOVERY_OWED |
| WINDOW ROCK CONSOLIDATED SCHOOL DISTRICT 8 (`az:school:window-rock-consolidated-school-district-8`) | SCHOOL_DISTRICT | HTTP://WWW.WRSCHOOL.NET/ | SOURCE_DISCOVERY_OWED |
| WINSLOW UNIFIED SCHOOL DISTRICT 1 (`az:school:winslow-unified-school-district-1`) | SCHOOL_DISTRICT | http://www.winslowsd.k12.az.us/ | SOURCE_DISCOVERY_OWED |
| YARNELL SCHOOL DISTRICT 52 (`az:school:yarnell-school-district-52`) | SCHOOL_DISTRICT | HTTP://MODELCREEKSCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| YAVAPAI COLLEGE (`az:school:yavapai-college`) | SCHOOL_DISTRICT | http://www.YC.EDU | SOURCE_DISCOVERY_OWED |
| YOUNG SCHOOL DISTRICT 5 (`az:school:young-school-district-5`) | SCHOOL_DISTRICT | HTTPS://WWW.YOUNGSCHOOL.ORG/ | SOURCE_DISCOVERY_OWED |
| YUCCA SCHOOL DISTRICT 13 (`az:school:yucca-school-district-13`) | SCHOOL_DISTRICT | HTTPS://WWW.YUCCASCHOOL.COM | SOURCE_DISCOVERY_OWED |
| YUMA ELEMENTARY SCHOOL DISTRICT 1 (`az:school:yuma-elementary-school-district-1`) | SCHOOL_DISTRICT | http://www.yuma.org/ | SOURCE_DISCOVERY_OWED |
| YUMA UNION HIGH SCHOOL DISTRICT 70 (`az:school:yuma-union-high-school-district-70`) | SCHOOL_DISTRICT | http://yumaunion.org/ | SOURCE_DISCOVERY_OWED |
| ADAMAN IRRIGATION WATER DELIVERY DISTRICT 36 (`az:special:adaman-irrigation-water-delivery-district-36`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| AGUILA IRRIGATION DISTRICT (`az:special:aguila-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| AGUILA RURAL FIRE DISTRICT (`az:special:aguila-rural-fire-district`) | SPECIAL_DISTRICT | http://www.aguilafiredepartment.wceldy.com | SOURCE_DISCOVERY_OWED |
| AJO-LUKEVILLE HEALTH SERVICES DISTRICT (`az:special:ajo-lukeville-health-services-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ALPINE FIRE DISTRICT (`az:special:alpine-fire-district`) | SPECIAL_DISTRICT | http://www.alpinefire.net | SOURCE_DISCOVERY_OWED |
| ALPINE SANITARY DISTRICT (`az:special:alpine-sanitary-district`) | SPECIAL_DISTRICT | http://www.frontiernet.net/~asd1/ | SOURCE_DISCOVERY_OWED |
| ARDEN ESTATES IRRIGATION WATER DELIVERY DISTRICT 74 (`az:special:arden-estates-irrigation-water-delivery-district-74`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ARIVACA FIRE DISTRICT (`az:special:arivaca-fire-district`) | SPECIAL_DISTRICT | http://www.arivacafiredistrict.org/ | SOURCE_DISCOVERY_OWED |
| ARIZONA CITY FIRE DISTRICT (`az:special:arizona-city-fire-district`) | SPECIAL_DISTRICT | http://www.fire-ems.net/firedept/view/ArizonaCityAZ | SOURCE_DISCOVERY_OWED |
| ARIZONA CITY SANITARY DISTRICT (`az:special:arizona-city-sanitary-district`) | SPECIAL_DISTRICT | http://www.azcitysewer.com | SOURCE_DISCOVERY_OWED |
| ARIZONA FIRE & MEDICAL AUTHORITY (`az:special:arizona-fire-and-medical-authority`) | SPECIAL_DISTRICT | https://www.afma.az.gov/ | SOURCE_DISCOVERY_OWED |
| ASH FORK FIRE DISTRICT (`az:special:ash-fork-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ASH FORK SANITARY DISTRICT (`az:special:ash-fork-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| AVRA VALLEY FIRE DISTRICT (`az:special:avra-valley-fire-district`) | SPECIAL_DISTRICT | http://www.avfire.org | SOURCE_DISCOVERY_OWED |
| AVRA VALLEY IRRIGATION AND DRAINAGE DISTRICT (`az:special:avra-valley-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BEAVER DAM-LITTLEFIELD FIRE DISTRICT (`az:special:beaver-dam-littlefield-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BERRIDGE MANOR IRRIGATION WATER DELIVERY DISTRICT 38 (`az:special:berridge-manor-irrigation-water-delivery-district-38`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BLUE RIDGE FIRE DISTRICT (`az:special:blue-ridge-fire-district`) | SPECIAL_DISTRICT | http://www.blueridgefiredist.org | SOURCE_DISCOVERY_OWED |
| BOUSE VOLUNTEER FIRE DISTRICT (`az:special:bouse-volunteer-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOWIE FIRE DISTRICT (`az:special:bowie-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BROADLAND RANCHES GREENFIELD IRRIGATION WATER DELIVERY DIST 39 (`az:special:broadland-ranches-greenfield-irrigation-water-delivery-dist-39`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BUCKEYE VALLEY RURAL FIRE DISTRICT (`az:special:buckeye-valley-rural-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BUCKEYE WATER CONSERVATION AND DRAINAGE DISTRICT (`az:special:buckeye-water-conservation-and-drainage-district`) | SPECIAL_DISTRICT | http://www.bwcdd.com | SOURCE_DISCOVERY_OWED |
| BUCKSKIN FIRE DISTRICT (`az:special:buckskin-fire-district`) | SPECIAL_DISTRICT | http://www.buckskinfiredepartment.com | SOURCE_DISCOVERY_OWED |
| BUCKSKIN SANITARY DISTRICT (`az:special:buckskin-sanitary-district`) | SPECIAL_DISTRICT | http://www.bsdsewer.org | SOURCE_DISCOVERY_OWED |
| BULLHEAD CITY FIRE DISTRICT (`az:special:bullhead-city-fire-district`) | SPECIAL_DISTRICT | http://www.bullheadfire.org | SOURCE_DISCOVERY_OWED |
| BULLHEAD PEST ABATEMENT DISTRICT (`az:special:bullhead-pest-abatement-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CAHAVA SPRINGS REVITALIZATION DISTRICT (`az:special:cahava-springs-revitalization-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CAMELVIEW IRRIGATION WATER DISTRICT 44 (`az:special:camelview-irrigation-water-district-44`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CENTRAL ARIZONA FIRE AND MEDICAL AUTHORITY (`az:special:central-arizona-fire-and-medical-authority`) | SPECIAL_DISTRICT | http://www.centralyavapaifire.org/index.cfm?section=1 | SOURCE_DISCOVERY_OWED |
| CENTRAL ARIZONA IRRIGATION AND DRAINAGE DISTRICT (`az:special:central-arizona-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | http://www.caidd.com/ | SOURCE_DISCOVERY_OWED |
| CENTRAL ARIZONA WATER CONSERVATION DISTRICT (`az:special:central-arizona-water-conservation-district`) | SPECIAL_DISTRICT | http://www.cap-az.com/ | SOURCE_DISCOVERY_OWED |
| CENTRAL JACKSON HEIGHTS FIRE DISTRICT (`az:special:central-jackson-heights-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CENTRAL YAVAPAI FIRE DISTRICT (`az:special:central-yavapai-fire-district`) | SPECIAL_DISTRICT | http://www.centralyavapaifire.org/ | SOURCE_DISCOVERY_OWED |
| CENTRAL YAVAPAI HOSPITAL DISTRICT (`az:special:central-yavapai-hospital-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CHANDLER HEIGHTS CITRUS IRRIGATION DISTRICT (`az:special:chandler-heights-citrus-irrigation-district`) | SPECIAL_DISTRICT | http://www.chcid.org | SOURCE_DISCOVERY_OWED |
| CHANDLER (MARICOPA) COUNTY ISLAND FIRE DISTRICT (`az:special:chandler-maricopa-county-island-fire-district`) | SPECIAL_DISTRICT | http://www.ccifd.com/ | SOURCE_DISCOVERY_OWED |
| CHINO VALLEY FIRE DISTRICT (`az:special:chino-valley-fire-district`) | SPECIAL_DISTRICT | http://www.chinoazfire.com | SOURCE_DISCOVERY_OWED |
| CHINO VALLEY IRRIGATION DISTRICT (`az:special:chino-valley-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CHRISTOPHER-KOHLS FIRE DISTRICT (`az:special:christopher-kohls-fire-district`) | SPECIAL_DISTRICT | http://www.ckfire.org/ | SOURCE_DISCOVERY_OWED |
| CIBOLA VALLEY IRRIGATION AND DRAINAGE DISTRICT (`az:special:cibola-valley-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CIRCLE CITY-MORRISTOWN FIRE DISTRICT (`az:special:circle-city-morristown-fire-district`) | SPECIAL_DISTRICT | http://www.ccmfd.org | SOURCE_DISCOVERY_OWED |
| CIRCLE G #47 IWDD (`az:special:circle-g-47-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CITRUS GARDENS IRRIGATION WATER DELIVERY DISTRICT 33 (`az:special:citrus-gardens-irrigation-water-delivery-district-33`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CLAY SPRINGS-PINEDALE FIRE DISTRICT (`az:special:clay-springs-pinedale-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CLEARWATER HILLS FIRE DISTRICT (`az:special:clearwater-hills-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COLLEGE PARK #53 IWDD (`az:special:college-park-53-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COLLEGE PARK WEST IWDD 68 (`az:special:college-park-west-iwdd-68`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COLORADO CITY FIRE DISTRICT (`az:special:colorado-city-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CONCHO FIRE DISTRICT (`az:special:concho-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CONGRESS FIRE DISTRICT (`az:special:congress-fire-district`) | SPECIAL_DISTRICT | http://www.fire-ems.net/firedept/view/CongressAZ/ | SOURCE_DISCOVERY_OWED |
| COPPER CANYON FIRE AND MEDICAL DISTRICT (`az:special:copper-canyon-fire-and-medical-district`) | SPECIAL_DISTRICT | http://www.campverdefire.org | SOURCE_DISCOVERY_OWED |
| CORONA DE TUCSON FIRE DISTRICT (`az:special:corona-de-tucson-fire-district`) | SPECIAL_DISTRICT | http://www.coronafire.org | SOURCE_DISCOVERY_OWED |
| CORTARO-MARANA IRRIGATION DISTRICT (`az:special:cortaro-marana-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COUNTRY CLUB ESTATES IWDD 72 (`az:special:country-club-estates-iwdd-72`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CREEKSIDE SANITARY DISTRICT (`az:special:creekside-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CROWN KING FIRE DISTRICT (`az:special:crown-king-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CRYSTAL BEACH WATER CONSERVATION DISTRICT (`az:special:crystal-beach-water-conservation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CUATRO PALMAS IRRIGATION WATER DELIVERY DISTRICT 26 (`az:special:cuatro-palmas-irrigation-water-delivery-district-26`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DAISY MOUNTAIN FIRE DISTRICT (`az:special:daisy-mountain-fire-district`) | SPECIAL_DISTRICT | http://www.daisymountainfire.org | SOURCE_DISCOVERY_OWED |
| DESERT HILLS FIRE DISTRICT (`az:special:desert-hills-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DESERT VISTA SANITARY DISTRICT (`az:special:desert-vista-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DREXEL HEIGHTS FIRE DISTRICT (`az:special:drexel-heights-fire-district`) | SPECIAL_DISTRICT | http://www.drexelfire.net/ | SOURCE_DISCOVERY_OWED |
| DUDLEYVILLE FIRE DISTRICT (`az:special:dudleyville-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DUKE MANOR IRRIGATION WATER DELIVERY DISTRICT 61 (`az:special:duke-manor-irrigation-water-delivery-district-61`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DUNCAN VALLEY RURAL FIRE DISTRICT (`az:special:duncan-valley-rural-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EAST COUNTRY CLUB DR IWDD 66 (`az:special:east-country-club-dr-iwdd-66`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EAST MORNINGSIDE IRRIGATION WATER DELIVERY DISTRICT 8 (`az:special:east-morningside-irrigation-water-delivery-district-8`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EAST VERDE PARK FIRE DISTRICT (`az:special:east-verde-park-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EHRENBERG FIRE DISTRICT (`az:special:ehrenberg-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ELECTRICAL DISTRICT 8 (`az:special:electrical-district-8`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ELFRIDA FIRE DISTRICT (`az:special:elfrida-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ELOY FIRE DISTRICT (`az:special:eloy-fire-district`) | SPECIAL_DISTRICT | http://www.eloyfire.org | SOURCE_DISCOVERY_OWED |
| EVERGREEN IWDD 78 (`az:special:evergreen-iwdd-78`) | SPECIAL_DISTRICT | http://WWW.EVERGREENMESA.COM | SOURCE_DISCOVERY_OWED |
| FLAGSTAFF RANCH FIRE DISTRICT (`az:special:flagstaff-ranch-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FLORENCE AREA FLOOD CONTROL DISTRICT (`az:special:florence-area-flood-control-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FLOWING WELLS IRRIGATION DISTRICT (`az:special:flowing-wells-irrigation-district`) | SPECIAL_DISTRICT | http://www.fwid.org | SOURCE_DISCOVERY_OWED |
| FOREST LAKES FIRE DISTRICT (`az:special:forest-lakes-fire-district`) | SPECIAL_DISTRICT | http://www.flfdaz.com | SOURCE_DISCOVERY_OWED |
| FORT MOJAVE-MESA FIRE DISTRICT (`az:special:fort-mojave-mesa-fire-district`) | SPECIAL_DISTRICT | http://www.fmmfd.org | SOURCE_DISCOVERY_OWED |
| FORT THOMAS FIRE DISTRICT (`az:special:fort-thomas-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FOUNTAIN HILLS SANITARY DISTRICT (`az:special:fountain-hills-sanitary-district`) | SPECIAL_DISTRICT | http://www.azfhsd.gov | SOURCE_DISCOVERY_OWED |
| FRANKLIN IRRIGATION DISTRICT (`az:special:franklin-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRASER FIELDS IWDD 76 (`az:special:fraser-fields-iwdd-76`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRY FIRE DISTRICT (`az:special:fry-fire-district`) | SPECIAL_DISTRICT | http://www.fryfiredistrict.com | SOURCE_DISCOVERY_OWED |
| GANADO FIRE DISTRICT (`az:special:ganado-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GILA VALLEY IRRIGATION DISTRICT (`az:special:gila-valley-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GILBERT (MARICOPA) COUNTY ISLAND FIRE DISTRICT (`az:special:gilbert-maricopa-county-island-fire-district`) | SPECIAL_DISTRICT | http://gcifd.com/ | SOURCE_DISCOVERY_OWED |
| GISELA VALLEY FIRE DISTRICT (`az:special:gisela-valley-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GOLDEN SHORES FIRE DISTRICT (`az:special:golden-shores-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GOLDEN SHORES WATER CONSERVATION DISTRICT (`az:special:golden-shores-water-conservation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GOLDEN VALLEY FIRE DISTRICT (`az:special:golden-valley-fire-district`) | SPECIAL_DISTRICT | http://www.gvfdaz.com | SOURCE_DISCOVERY_OWED |
| GOLDER RANCH FIRE DISTRICT (`az:special:golder-ranch-fire-district`) | SPECIAL_DISTRICT | http://www.golderranchfire.org/ | SOURCE_DISCOVERY_OWED |
| GOLDFIELD RANCH FIRE DISTRICT (`az:special:goldfield-ranch-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GREEN VALLEY FIRE DISTRICT (`az:special:green-valley-fire-district`) | SPECIAL_DISTRICT | http://www.gvfire.org | SOURCE_DISCOVERY_OWED |
| GREEN VALLEY WATER (`az:special:green-valley-water`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GREENE RESERVOIR FLOOD CONTROL DISTRICT (`az:special:greene-reservoir-flood-control-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GREENHAVEN FIRE DISTRICT (`az:special:greenhaven-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GREER FIRE DISTRICT (`az:special:greer-fire-district`) | SPECIAL_DISTRICT | http://www.greerfiredistrict.com | SOURCE_DISCOVERY_OWED |
| GROOM CREEK FIRE DISTRICT (`az:special:groom-creek-fire-district`) | SPECIAL_DISTRICT | http://www.groomcreek.org | SOURCE_DISCOVERY_OWED |
| HACIENDA GRANADA IWDD 71 (`az:special:hacienda-granada-iwdd-71`) | SPECIAL_DISTRICT | HTTPS://WWW.HACIENDAGRANADAIRRIGATION.COM/ | SOURCE_DISCOVERY_OWED |
| HARQUAHALA VALLEY FIRE DISTRICT (`az:special:harquahala-valley-fire-district`) | SPECIAL_DISTRICT | http://www.hfdaz.org | SOURCE_DISCOVERY_OWED |
| HARQUAHALA VALLEY IRRIGATION DISTRICT (`az:special:harquahala-valley-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HARQUAHALA VALLEY POWER DISTRICT (`az:special:harquahala-valley-power-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HEBER-OVERGAARD FIRE DISTRICT (`az:special:heber-overgaard-fire-district`) | SPECIAL_DISTRICT | http://www.hofdaz.com/ | SOURCE_DISCOVERY_OWED |
| HEBER-OVERGAARD SANITARY DISTRICT (`az:special:heber-overgaard-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HELLSGATE FIRE DISTRICT (`az:special:hellsgate-fire-district`) | SPECIAL_DISTRICT | http://www.hellsgatefive.org | SOURCE_DISCOVERY_OWED |
| HIDDEN VALLEY FIRE DISTRICT (`az:special:hidden-valley-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HIGHLANDS FIRE DISTRICT (`az:special:highlands-fire-district`) | SPECIAL_DISTRICT | http://www.highlandsfire.org | SOURCE_DISCOVERY_OWED |
| HILLANDER "C" IRRIGATION DISTRICT (`az:special:hillander-c-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOFFMAN TERRACE IRRIGATION AND WATER DELIVERY DISTRICT 3 (`az:special:hoffman-terrace-irrigation-and-water-delivery-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOFFMANTOWN I & II IRRIGATION WATER DELIVERY DISTRICT 62 (`az:special:hoffmantown-i-and-ii-irrigation-water-delivery-district-62`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOHOKAM IRRIGATION AND DRAINAGE DISTRICT (`az:special:hohokam-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOUSTON MESA FIRE DISTRICT (`az:special:houston-mesa-fire-district`) | SPECIAL_DISTRICT | http://www.houstonmesafire.org | SOURCE_DISCOVERY_OWED |
| ICR SANITARY DISTRICT (`az:special:icr-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| JOSEPH CITY FIRE DISTRICT (`az:special:joseph-city-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| JOSEPH CITY SANITARY DISTRICT (`az:special:joseph-city-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| JUNIPINE FIRE DISTRICT (`az:special:junipine-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| KAIBAB ESTATES WEST FIRE DISTRICT (`az:special:kaibab-estates-west-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LA MAR IRRIGATION WATER DELIVERY DISTRICT 30 (`az:special:la-mar-irrigation-water-delivery-district-30`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LA PAZ COUNTY HOSPITAL DISTRICT (`az:special:la-paz-county-hospital-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LACELESTA IWDD 73 (`az:special:lacelesta-iwdd-73`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LAKE MOHAVE RANCHOS FIRE DISTRICT (`az:special:lake-mohave-ranchos-fire-district`) | SPECIAL_DISTRICT | http://www.lmrfd.org | SOURCE_DISCOVERY_OWED |
| LAVEEN FIRE DISTRICT (`az:special:laveen-fire-district`) | SPECIAL_DISTRICT | http://www.laveenfiredistrict.org | SOURCE_DISCOVERY_OWED |
| LE ROY VISTA IRRIGATION WATER DELIVERY DISTRICT 12 (`az:special:le-roy-vista-irrigation-water-delivery-district-12`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LITTLE COLORADO FLOOD CONTROL DISTRICT (`az:special:little-colorado-flood-control-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LITTLE COLORADO SANITARY DISTRICT (`az:special:little-colorado-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LOCKETT RANCHES FIRE DISTRICT (`az:special:lockett-ranches-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LONG MANOR #52 IWDD (`az:special:long-manor-52-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LONGHORN RANCH #51 IWDD (`az:special:longhorn-ranch-51-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LOS OLIVOS IRRIGATION WATER DELIVERY DISTRICT 1 (`az:special:los-olivos-irrigation-water-delivery-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MADISON GROVES IWDD 63 (`az:special:madison-groves-iwdd-63`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MADISON PARK IRRIGATION WATER DELIVERY DISTRICT 22 (`az:special:madison-park-irrigation-water-delivery-district-22`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MAGMA FLOOD CONTROL DISTRICT (`az:special:magma-flood-control-district`) | SPECIAL_DISTRICT | http://azmfcd.org | SOURCE_DISCOVERY_OWED |
| MAMMOTH FIRE DISTRICT (`az:special:mammoth-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARICOPA COUNTY ELECTRICAL DISTRICT 7 (`az:special:maricopa-county-electrical-district-7`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARICOPA COUNTY MUNICIPAL WATER CONSERVATION DISTRICT 1 (`az:special:maricopa-county-municipal-water-conservation-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARICOPA COUNTY SPECIAL HEALTH CARE DISTRICT (`az:special:maricopa-county-special-health-care-district`) | SPECIAL_DISTRICT | http://www.mihs.org/ | SOURCE_DISCOVERY_OWED |
| MARICOPA STANFIELD IRRIGATION AND DRAINAGE DISTRICT (`az:special:maricopa-stanfield-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARKHAM IRRIGATION DISTRICT (`az:special:markham-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MAYER FIRE DISTRICT (`az:special:mayer-fire-district`) | SPECIAL_DISTRICT | http://www.mayerfire.com | SOURCE_DISCOVERY_OWED |
| MAYFAIR MANOR IRRIGATION WATER DELIVERY DISTRICT 64 (`az:special:mayfair-manor-irrigation-water-delivery-district-64`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MCDOWELL HOMES #7 IWDD (`az:special:mcdowell-homes-7-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MCLAWS ROAD FIRE DISTRICT (`az:special:mclaws-road-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MCMICKEN IRRIGATION DISTRICT (`az:special:mcmicken-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MCMULLEN VALLEY FIRE DISTRICT (`az:special:mcmullen-valley-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MCMULLEN VALLEY WATER CONSERVATION AND DRAINAGE DISTRICT (`az:special:mcmullen-valley-water-conservation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MESA LINDA IWDD 79 (`az:special:mesa-linda-iwdd-79`) | SPECIAL_DISTRICT | http://WWW.MESALINDA.ORG | SOURCE_DISCOVERY_OWED |
| MESCAL-J6 FIRE DISTRICT (`az:special:mescal-j6-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MIDWAY FLOOD CONTROL DISTRICT (`az:special:midway-flood-control-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MOHAVE COUNTY HOSPITAL DISTRICT 1 (`az:special:mohave-county-hospital-district-1`) | SPECIAL_DISTRICT | http://www.azkrmc.com | SOURCE_DISCOVERY_OWED |
| MOHAVE COUNTY WATER AUTHORITY (`az:special:mohave-county-water-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MOHAVE VALLEY FIRE DISTRICT (`az:special:mohave-valley-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MOHAVE VALLEY IRRIGATION AND DRAINAGE DISTRICT (`az:special:mohave-valley-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | http://MVIDD.NET | SOURCE_DISCOVERY_OWED |
| MOHAVE WATER CONSERVATION DISTRICT (`az:special:mohave-water-conservation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MORMON LAKE FIRE DISTRICT (`az:special:mormon-lake-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MORRISON RANCH #49 IWDD (`az:special:morrison-ranch-49-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MT GRAHAM HOSPITAL DISTRICT (`az:special:mt-graham-hospital-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MT LEMMON FIRE DISTRICT (`az:special:mt-lemmon-fire-district`) | SPECIAL_DISTRICT | http://www.mtlemmonfire.org | SOURCE_DISCOVERY_OWED |
| MYRTLE PARK IRRIGATION WATER DELIVERY DISTRICT 10 (`az:special:myrtle-park-irrigation-water-delivery-district-10`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NACO FIRE DISTRICT (`az:special:naco-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NACO SANITARY DISTRICT (`az:special:naco-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NANCY KAY IWDD 77 (`az:special:nancy-kay-iwdd-77`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NAVAPACHE HOSPITAL DISTRICT (`az:special:navapache-hospital-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEW MAGMA IRRIGATION AND DRAINAGE DISTRICT (`az:special:new-magma-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEW MODEL CANAL COMMUNITY DITCH ASSOCIATION (`az:special:new-model-canal-community-ditch-association`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEW STATE IRRIGATION AND DRAINAGE DISTRICT (`az:special:new-state-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NOGALES SUBURBAN FIRE DISTRICT (`az:special:nogales-suburban-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTH COUNTY FIRE & MEDICAL DISTRICT (`az:special:north-county-fire-and-medical-district`) | SPECIAL_DISTRICT | http://WWW.SCWFIRE.ORG | SOURCE_DISCOVERY_OWED |
| NORTH GILA VALLEY IRRIGATION DISTRICT (`az:special:north-gila-valley-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTHERN APACHE COUNTY SPECIAL HEALTH CARE DISTRICT (`az:special:northern-apache-county-special-health-care-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTHERN ARIZONA CONSOLIDATED FIRE DISTRICT (`az:special:northern-arizona-consolidated-fire-district`) | SPECIAL_DISTRICT | http://northernazfire.com/ | SOURCE_DISCOVERY_OWED |
| NORTHERN ARIZONA INTERGOVERNMENTAL PUBLIC TRANSPORTATION AUTHORITY (`az:special:northern-arizona-intergovernmental-public-transportation-authority`) | SPECIAL_DISTRICT | http://www.naipta.az.gov | SOURCE_DISCOVERY_OWED |
| NORTHERN COCHISE HOSPITAL DISTRICT (`az:special:northern-cochise-hospital-district`) | SPECIAL_DISTRICT | http://www.ncch.com | SOURCE_DISCOVERY_OWED |
| NORTHWEST FIRE DISTRICT (`az:special:northwest-fire-district`) | SPECIAL_DISTRICT | http://www.northwestfire.org | SOURCE_DISCOVERY_OWED |
| OATMAN VOLUNTEER FIRE DISTRICT (`az:special:oatman-volunteer-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| OCOTILLO ESTATES IWDD  80 (`az:special:ocotillo-estates-iwdd-80`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| OCOTILLO WATER CONSERVATION DISTRICT (`az:special:ocotillo-water-conservation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| OLIVEWOOD ESTATES WATER DELIVERY DISTRICT 29 (`az:special:olivewood-estates-water-delivery-district-29`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ORACLE FIRE DISTRICT (`az:special:oracle-fire-district`) | SPECIAL_DISTRICT | http://www.oraclefire.org | SOURCE_DISCOVERY_OWED |
| ORACLE SANITARY DISTRICT (`az:special:oracle-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ORANGE VALLEY ESTATES IWDD 67 (`az:special:orange-valley-estates-iwdd-67`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ORCHID PARK IWDD 69 (`az:special:orchid-park-iwdd-69`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PAGE HOSPITAL DISTRICT (`az:special:page-hospital-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PALOMA IRRIGATION AND DRAINAGE DISTRICT (`az:special:paloma-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PALOMINAS FIRE DISTRICT (`az:special:palominas-fire-district`) | SPECIAL_DISTRICT | http://www.palominasfireboard.com | SOURCE_DISCOVERY_OWED |
| PAPAGO BUTTE IRRIGATION WATER DELIVERY DISTRICT 4 (`az:special:papago-butte-irrigation-water-delivery-district-4`) | SPECIAL_DISTRICT | http://www.papagobutteirrigation.com | SOURCE_DISCOVERY_OWED |
| PARKER FIRE DISTRICT (`az:special:parker-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PEEPLES VALLEY FIRE DISTRICT (`az:special:peeples-valley-fire-district`) | SPECIAL_DISTRICT | http://www.peeplesvalleyfire.net | SOURCE_DISCOVERY_OWED |
| PHOENIX-MESA GATEWAY AIRPORT AUTHORITY (`az:special:phoenix-mesa-gateway-airport-authority`) | SPECIAL_DISTRICT | http://www.phxmesagateway.org | SOURCE_DISCOVERY_OWED |
| PICTURE ROCKS FIRE DISTRICT (`az:special:picture-rocks-fire-district`) | SPECIAL_DISTRICT | http://www.picturerocksfire.org | SOURCE_DISCOVERY_OWED |
| PIMA COUNTY REGIONAL TRANSPORTATION AUTHORITY (`az:special:pima-county-regional-transportation-authority`) | SPECIAL_DISTRICT | http://www.rtamobility.com/ | SOURCE_DISCOVERY_OWED |
| PIMA RURAL FIRE DISTRICT (`az:special:pima-rural-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PINAL COUNTY ELECTRICAL DISTRICT 2 (`az:special:pinal-county-electrical-district-2`) | SPECIAL_DISTRICT | http://www.ed2.com/ | SOURCE_DISCOVERY_OWED |
| PINAL COUNTY ELECTRICAL DISTRICT 3 (`az:special:pinal-county-electrical-district-3`) | SPECIAL_DISTRICT | http://www.ed3online.org | SOURCE_DISCOVERY_OWED |
| PINAL COUNTY ELECTRICAL DISTRICT 4 (`az:special:pinal-county-electrical-district-4`) | SPECIAL_DISTRICT | http://www.ed4.com | SOURCE_DISCOVERY_OWED |
| PINAL COUNTY WATER AUGMENTATION AUTHORITY (`az:special:pinal-county-water-augmentation-authority`) | SPECIAL_DISTRICT | http://www.pcwaaaz.org | SOURCE_DISCOVERY_OWED |
| PINAL ELECTRIC DISTRICT 6 (`az:special:pinal-electric-district-6`) | SPECIAL_DISTRICT | http://ed-6pinalcounty.com | SOURCE_DISCOVERY_OWED |
| PINAL RURAL FIRE/RESCUE AND MEDICAL DISTRICT (`az:special:pinal-rural-fire-rescue-and-medical-district`) | SPECIAL_DISTRICT | http://www.pinalruralfirerescue.com/contact-us | SOURCE_DISCOVERY_OWED |
| PINE LAKE FIRE DISTRICT (`az:special:pine-lake-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PINE-STRAWBERRY FIRE DISTRICT (`az:special:pine-strawberry-fire-district`) | SPECIAL_DISTRICT | http://www.pinestrawberryfire.com | SOURCE_DISCOVERY_OWED |
| PINETOP FIRE DISTRICT (`az:special:pinetop-fire-district`) | SPECIAL_DISTRICT | http://www.pinetopfire.com/ | SOURCE_DISCOVERY_OWED |
| PINETOP-LAKESIDE SANITARY DISTRICT (`az:special:pinetop-lakeside-sanitary-district`) | SPECIAL_DISTRICT | http://www.plsd.com/ | SOURCE_DISCOVERY_OWED |
| PINEWOOD FIRE DISTRICT (`az:special:pinewood-fire-district`) | SPECIAL_DISTRICT | http://www.pinewoodfire.org | SOURCE_DISCOVERY_OWED |
| PINEWOOD SANITARY DISTRICT (`az:special:pinewood-sanitary-district`) | SPECIAL_DISTRICT | http://www.pinewoodsanitary.com/ | SOURCE_DISCOVERY_OWED |
| PINION PINE FIRE DISTRICT (`az:special:pinion-pine-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PIRTLEVILLE FIRE DISTRICT (`az:special:pirtleville-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PISTACHIO PASS IRRIGATION DISTRICT (`az:special:pistachio-pass-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PLEASANT VALLEY FIRE DISTRICT (`az:special:pleasant-valley-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| POMELO PARK IRRIGATION WATER DELIVERY DISTRICT 59 (`az:special:pomelo-park-irrigation-water-delivery-district-59`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| POMERENE FIRE DISTRICT (`az:special:pomerene-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PONDEROSA FIRE DISTRICT (`az:special:ponderosa-fire-district`) | SPECIAL_DISTRICT | http://www.ponderosafire.org | SOURCE_DISCOVERY_OWED |
| PUERCO VALLEY FIRE DISTRICT (`az:special:puerco-valley-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PUERTO CUATRO #46 IWDD (`az:special:puerto-cuatro-46-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| QUARTZSITE FIRE DISTRICT (`az:special:quartzsite-fire-district`) | SPECIAL_DISTRICT | http://www.ci.quartzsite.az.us/about/ | SOURCE_DISCOVERY_OWED |
| QUEEN CREEK COUNTY ISLAND FIRE DISTRICT (`az:special:queen-creek-county-island-fire-district`) | SPECIAL_DISTRICT | http://queencreekcifd.org/ | SOURCE_DISCOVERY_OWED |
| QUEEN CREEK IRRIGATION AND DRAINAGE DISTRICT (`az:special:queen-creek-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| QUEEN CREEK IRRIGATION WATER DELIVERY DISTRICT 32 (`az:special:queen-creek-irrigation-water-delivery-district-32`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| QUEEN VALLEY FIRE DISTRICT (`az:special:queen-valley-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| QUEEN VALLEY SANITARY DISTRICT (`az:special:queen-valley-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RANCHO DEL MONTE #58 IWDD (`az:special:rancho-del-monte-58-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RANCHO-GRANDE-LANDERWOOD IRRIGATION WATER DELIVERY DISTRICT 24 (`az:special:rancho-grande-landerwood-irrigation-water-delivery-district-24`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RANCHO VENTURA 12 IWDD 81 (`az:special:rancho-ventura-12-iwdd-81`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RANCHO VENTURA IWDD 65 (`az:special:rancho-ventura-iwdd-65`) | SPECIAL_DISTRICT | HTTPS://WWW.RVIWDD.COM/ | SOURCE_DISCOVERY_OWED |
| RANCHOS JARDINES IRRIGATION WATER DELIVERY DISTRICT 34 (`az:special:ranchos-jardines-irrigation-water-delivery-district-34`) | SPECIAL_DISTRICT | http://www.rjirrigation.com | SOURCE_DISCOVERY_OWED |
| REGIONAL INTERGOVERNMENTAL PUBLIC TRANSPORTATION AUTHORITY (`az:special:regional-intergovernmental-public-transportation-authority`) | SPECIAL_DISTRICT | http://www.valleymetro.org | SOURCE_DISCOVERY_OWED |
| RINCON VALLEY FIRE DISTRICT (`az:special:rincon-valley-fire-district`) | SPECIAL_DISTRICT | http://www.rinconvalleyfd.org | SOURCE_DISCOVERY_OWED |
| RIO NUEVO MULTIPURPOSE FACILITIES DISTRICT (`az:special:rio-nuevo-multipurpose-facilities-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RIO RICO FIRE DISTRICT (`az:special:rio-rico-fire-district`) | SPECIAL_DISTRICT | http://www.rioricofire.org | SOURCE_DISCOVERY_OWED |
| RIO VERDE FIRE DISTRICT (`az:special:rio-verde-fire-district`) | SPECIAL_DISTRICT | http://www.rioverdefire.org | SOURCE_DISCOVERY_OWED |
| ROOSEVELT IRRIGATION DISTRICT (`az:special:roosevelt-irrigation-district`) | SPECIAL_DISTRICT | http://www.rooseveltirrigation.org | SOURCE_DISCOVERY_OWED |
| ROOSEVELT WATER CONSERVATION DISTRICT (`az:special:roosevelt-water-conservation-district`) | SPECIAL_DISTRICT | http://www.rwcd.net | SOURCE_DISCOVERY_OWED |
| ROSE LANE IRRIGATION WATER DELIVERY DISTRICT 28 (`az:special:rose-lane-irrigation-water-delivery-district-28`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ROUND VALLEY-OXBOW ESTATES FIRE DISTRICT (`az:special:round-valley-oxbow-estates-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SABINO VISTA FIRE DISTRICT (`az:special:sabino-vista-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SAFFORD RURAL FIRE DISTRICT (`az:special:safford-rural-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SALT RIVER PROJECT AGRICULTURAL IMPROVEMENT & POWER DISTRICT (`az:special:salt-river-project-agricultural-improvement-and-power-district`) | SPECIAL_DISTRICT | http://www.srpnet.com/ | SOURCE_DISCOVERY_OWED |
| SAN CARLOS IRRIGATION DISTRICT (`az:special:san-carlos-irrigation-district`) | SPECIAL_DISTRICT | http://www.scidd.com | SOURCE_DISCOVERY_OWED |
| SAN JOSE FIRE DISTRICT (`az:special:san-jose-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SAN MANUEL FIRE DISTRICT (`az:special:san-manuel-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SAN PEDRO VALLEY HOSPITAL DISTRICT (`az:special:san-pedro-valley-hospital-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SAN SIMON FIRE DISTRICT (`az:special:san-simon-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SAN TAN IRRIGATION DISTRICT (`az:special:san-tan-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SCOTTSDALE (MARICOPA) COUNTY ISLAND FIRE DISTRICT (`az:special:scottsdale-maricopa-county-island-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SEDONA FIRE DISTRICT (`az:special:sedona-fire-district`) | SPECIAL_DISTRICT | http://www.sedonafire.org | SOURCE_DISCOVERY_OWED |
| SELIGMAN FIRE DISTRICT (`az:special:seligman-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SELIGMAN SANITARY DISTRICT (`az:special:seligman-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SHERWOOD FOREST ESTATES FIRE DISTRICT (`az:special:sherwood-forest-estates-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SILVER CREEK FLOOD CONTROL DISTRICT (`az:special:silver-creek-flood-control-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SILVERBELL IRRIGATION DISTRICT (`az:special:silverbell-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SONOITA-ELGIN FIRE DISTRICT (`az:special:sonoita-elgin-fire-district`) | SPECIAL_DISTRICT | http://www.sefd911.org | SOURCE_DISCOVERY_OWED |
| SOUTH COUNTY FIRE & MEDICAL DISTRICT (`az:special:south-county-fire-and-medical-district`) | SPECIAL_DISTRICT | https://www.afma.az.gov/profiles | SOURCE_DISCOVERY_OWED |
| SOUTHWEST PUBLIC POWER AGENCY (`az:special:southwest-public-power-agency`) | SPECIAL_DISTRICT | http://www.sppa.biz/ | SOURCE_DISCOVERY_OWED |
| SPECTRUM IRRIGATION WATER DELIVERY DISTRICT #48 (`az:special:spectrum-irrigation-water-delivery-district-48`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ST DAVID FIRE DISTRICT (`az:special:st-david-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ST DAVID FLOOD CONTROL DISTRICT (`az:special:st-david-flood-control-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ST DAVID IRRIGATION DISTRICT (`az:special:st-david-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ST JOHNS IRRIGATION DISTRICT (`az:special:st-johns-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| STANFIELD FIRE DISTRICT (`az:special:stanfield-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| STANFIELD FLOOD CONTROL DISTRICT (`az:special:stanfield-flood-control-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SUMMER MESA IWDD #50 IWDD (`az:special:summer-mesa-iwdd-50-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SUMMIT FIRE DISTRICT (`az:special:summit-fire-district`) | SPECIAL_DISTRICT | http://www.summitfiredepartment.org | SOURCE_DISCOVERY_OWED |
| SUN CITY FIRE DISTRICT (`az:special:sun-city-fire-district`) | SPECIAL_DISTRICT | http://www.ww.suncityfire.com | SOURCE_DISCOVERY_OWED |
| SUN VALLEY FIRE DISTRICT (`az:special:sun-valley-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SUN VIEW ESTATES I #55 IWDD (`az:special:sun-view-estates-i-55-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SUN VIEW ESTATES II #54 IWDD (`az:special:sun-view-estates-ii-54-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SUNBURST FARMS IRRIGATION DISTRICT (`az:special:sunburst-farms-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SUNNYSIDE FIRE DISTRICT (`az:special:sunnyside-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SUNSITE-PEARCE FIRE DISTRICT (`az:special:sunsite-pearce-fire-district`) | SPECIAL_DISTRICT | http://www.sunsitesfiredept.com | SOURCE_DISCOVERY_OWED |
| SUPERSTITION FIRE & MEDICAL DISTRICT (`az:special:superstition-fire-and-medical-district`) | SPECIAL_DISTRICT | http://sfmd.az.gov/ | SOURCE_DISCOVERY_OWED |
| TANNER GROVES IRRIGATION WATER DELIVERY DISTRICT 37 (`az:special:tanner-groves-irrigation-water-delivery-district-37`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TANQUE VERDE VALLEY FIRE DISTRICT (`az:special:tanque-verde-valley-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TEMPE (MARICOPA) COUNTY ISLAND FIRE DISTRICT (`az:special:tempe-maricopa-county-island-fire-district`) | SPECIAL_DISTRICT | http://www.tempecountyislandfiredistrict.org | SOURCE_DISCOVERY_OWED |
| THE GROVES AT SUPERSTITION RANCH IRRIGATION WATER DELIV DIST 40 (`az:special:the-groves-at-superstition-ranch-irrigation-water-deliv-dist-40`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| THE GROVES OF HERMOSA VISTA IRRIGATION WATER DELIVERY DIST 41 (`az:special:the-groves-of-hermosa-vista-irrigation-water-delivery-dist-41`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| THOROUGHBRED FARMS #43 IWDD (`az:special:thoroughbred-farms-43-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| THREE POINTS FIRE DISTRICT (`az:special:three-points-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| THUNDERBIRD FIRE DISTRICT (`az:special:thunderbird-fire-district`) | SPECIAL_DISTRICT | http://www.tbirdfire.com/ | SOURCE_DISCOVERY_OWED |
| THUNDERBIRD IRRIGATION WATER DELIVERY DISTRICT 1 (`az:special:thunderbird-irrigation-water-delivery-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| THUNDERBIRD IRRIGATION WATER DELIVERY DISTRICT 2 (`az:special:thunderbird-irrigation-water-delivery-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| THUNDERBIRD IRRIGATION WATER DELIVERY DISTRICT 3 (`az:special:thunderbird-irrigation-water-delivery-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TIMBER MESA FIRE AND MEDICAL DISTRICT (`az:special:timber-mesa-fire-and-medical-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TIMBERLAND SPECIAL ROAD DISTRICT 1 (`az:special:timberland-special-road-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TONOPAH IRRIGATION DISTRICT (`az:special:tonopah-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TONTO BASIN FIRE DISTRICT (`az:special:tonto-basin-fire-district`) | SPECIAL_DISTRICT | http://www.tontofire.com/ | SOURCE_DISCOVERY_OWED |
| TOPOCK-GOLDEN SHORES SANITARY DISTRICT (`az:special:topock-golden-shores-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TRES PALMAS IRRIGATION WATER DELIVERY DISTRICT 6 (`az:special:tres-palmas-irrigation-water-delivery-district-6`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TRI-CITY FIRE DISTRICT (`az:special:tri-city-fire-district`) | SPECIAL_DISTRICT | http://www.w.w.wtricityfiredistrict.com | SOURCE_DISCOVERY_OWED |
| TRI-CITY REGIONAL SANITARY DISTRICT (`az:special:tri-city-regional-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TUBAC FIRE DISTRICT (`az:special:tubac-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TUCSON COUNTRY CLUB ESTATES FIRE DISTRICT (`az:special:tucson-country-club-estates-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TURNEY TRACT IRRIGATION WATER DELIVERY DISTRICT 15 (`az:special:turney-tract-irrigation-water-delivery-district-15`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TUSAYAN FIRE DISTRICT (`az:special:tusayan-fire-district`) | SPECIAL_DISTRICT | http://www.tusayanfire.org | SOURCE_DISCOVERY_OWED |
| TUSAYAN SANITARY DISTRICT (`az:special:tusayan-sanitary-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| UNIT B IRRIGATION DRAINAGE DISTRICT (`az:special:unit-b-irrigation-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| UPPER MAESTAS DITCH (`az:special:upper-maestas-ditch`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| VALLEY METRO RAIL INC. (`az:special:valley-metro-rail-inc`) | SPECIAL_DISTRICT | http://www.valleymetro.org/metrolightrail/ | SOURCE_DISCOVERY_OWED |
| VANAR FLOOD CONTROL DISTRICT (`az:special:vanar-flood-control-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| VENTURA MANOR IWDD 70 (`az:special:ventura-manor-iwdd-70`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| VERDE VALLEY FIRE DISTRICT (`az:special:verde-valley-fire-district`) | SPECIAL_DISTRICT | http://www.verdevalleyfire.org | SOURCE_DISCOVERY_OWED |
| VERNON FIRE DISTRICT (`az:special:vernon-fire-district`) | SPECIAL_DISTRICT | http://www.vernonfiredistrict.com | SOURCE_DISCOVERY_OWED |
| WATER WHEEL FIRE & MEDICAL DISTRICT (`az:special:water-wheel-fire-and-medical-district`) | SPECIAL_DISTRICT | http://www.wpfd.us | SOURCE_DISCOVERY_OWED |
| WELLTON MOHAWK IRRIGATION DRAINAGE DISTRICT (`az:special:wellton-mohawk-irrigation-drainage-district`) | SPECIAL_DISTRICT | http://www.welltonmohawk.org/index.html | SOURCE_DISCOVERY_OWED |
| WESTERN MEADOWS IRRIGATION DISTRICT (`az:special:western-meadows-irrigation-district`) | SPECIAL_DISTRICT | http://www.wmid.org/ | SOURCE_DISCOVERY_OWED |
| WESTWOOD ESTATES FIRE DISTRICT (`az:special:westwood-estates-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WHETSTONE FIRE DISTRICT (`az:special:whetstone-fire-district`) | SPECIAL_DISTRICT | http://www.whetstonefire.org | SOURCE_DISCOVERY_OWED |
| WHITCOMB'S ROUNDUP RANCHOS #42 IWDD (`az:special:whitcomb-s-roundup-ranchos-42-iwdd`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WHITE FENCE FARMS I IRRIGATION WATER DELIVERY DISTRICT 60 (`az:special:white-fence-farms-i-irrigation-water-delivery-district-60`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WHITE MOUNTAIN COMMUNITIES SPECIAL HEALTH CARE DISTRICT (`az:special:white-mountain-communities-special-health-care-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WHITE MOUNTAIN LAKES SPECIAL ROAD DISTRICT 2 (`az:special:white-mountain-lakes-special-road-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WHY FIRE DISTRICT (`az:special:why-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WICKENBURG RURAL FIRE DISTRICT (`az:special:wickenburg-rural-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WILLIAMS HOSPITAL DISTRICT (`az:special:williams-hospital-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WILLIAMSON VALLEY FIRE DISTRICT (`az:special:williamson-valley-fire-district`) | SPECIAL_DISTRICT | http://www.wvfd.net | SOURCE_DISCOVERY_OWED |
| WINDSOR SQUARE IRRIGATION WATER DELIVERY DISTRICT 27 (`az:special:windsor-square-irrigation-water-delivery-district-27`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODLEA IRRIGATION WATER DELIVERY DISTRICT 2 (`az:special:woodlea-irrigation-water-delivery-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODRUFF FIRE DISTRICT (`az:special:woodruff-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODRUFF IRRIGATION DISTRICT (`az:special:woodruff-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODS FIRE DISTRICT (`az:special:woods-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOOLSEY FLOOD PROTECTION DISTRICT (`az:special:woolsey-flood-protection-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| YAPLE PARK IRRIGATION WATER DELIVERY DISTRICT #56 (`az:special:yaple-park-irrigation-water-delivery-district-56`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| YARNELL FIRE DISTRICT (`az:special:yarnell-fire-district`) | SPECIAL_DISTRICT | http://USERS.W3AZ.NET/YFD | SOURCE_DISCOVERY_OWED |
| YUCCA FIRE DISTRICT (`az:special:yucca-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| YUMA COUNTY CITRUS PEST CONTROL DISTRICT (`az:special:yuma-county-citrus-pest-control-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| YUMA COUNTY HOSPITAL DISTRICT 1 (`az:special:yuma-county-hospital-district-1`) | SPECIAL_DISTRICT | http://www.yumaregional.org | SOURCE_DISCOVERY_OWED |
| YUMA COUNTY PEST ABATEMENT DISTRICT (`az:special:yuma-county-pest-abatement-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| YUMA IRRIGATION DISTRICT (`az:special:yuma-irrigation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| YUMA MESA IRRIGATION AND DRAINAGE DISTRICT (`az:special:yuma-mesa-irrigation-and-drainage-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| Arizona (`az:state:arizona`) | STATE | none recorded | NO_MEETINGS_SOURCE_RECORDED |

### NH: 552 of 552

| Jurisdiction | Class | Website | Basis |
| --- | --- | --- | --- |
| CITY OF BERLIN (`nh:city:city-of-berlin`) | CITY_OR_TOWN | http://www.berlinnh.gov/ | SOURCE_DISCOVERY_OWED |
| CITY OF CLAREMONT (`nh:city:city-of-claremont`) | CITY_OR_TOWN | http://www.claremontnh.com/ | SOURCE_DISCOVERY_OWED |
| CITY OF CONCORD (`nh:city:city-of-concord`) | CITY_OR_TOWN | http://www.concordnh.gov | SOURCE_DISCOVERY_OWED |
| CITY OF DOVER (`nh:city:city-of-dover`) | CITY_OR_TOWN | http://www.dover.nh.gov | SOURCE_DISCOVERY_OWED |
| CITY OF FRANKLIN (`nh:city:city-of-franklin`) | CITY_OR_TOWN | http://www.franklinnh.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF KEENE (`nh:city:city-of-keene`) | CITY_OR_TOWN | http://www.ci.keene.nh.us/ | SOURCE_DISCOVERY_OWED |
| CITY OF LACONIA (`nh:city:city-of-laconia`) | CITY_OR_TOWN | http://www.city.laconia.nh.us/ | SOURCE_DISCOVERY_OWED |
| CITY OF LEBANON (`nh:city:city-of-lebanon`) | CITY_OR_TOWN | http://www.lebcity.com/ | SOURCE_DISCOVERY_OWED |
| CITY OF MANCHESTER (`nh:city:city-of-manchester`) | CITY_OR_TOWN | http://www.manchesternh.gov | SOURCE_DISCOVERY_OWED |
| CITY OF NASHUA (`nh:city:city-of-nashua`) | CITY_OR_TOWN | http://www.gonashua.com/ | SOURCE_DISCOVERY_OWED |
| CITY OF PORTSMOUTH (`nh:city:city-of-portsmouth`) | CITY_OR_TOWN | http://www.cityofportsmouth.com/ | SOURCE_DISCOVERY_OWED |
| CITY OF ROCHESTER (`nh:city:city-of-rochester`) | CITY_OR_TOWN | http://www.rochesternh.net/ | SOURCE_DISCOVERY_OWED |
| CITY OF SOMERSWORTH (`nh:city:city-of-somersworth`) | CITY_OR_TOWN | http://www.somersworth.com/ | SOURCE_DISCOVERY_OWED |
| PLANTATION OF LINCOLN (`nh:city:plantation-of-lincoln`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF ACWORTH (`nh:city:town-of-acworth`) | CITY_OR_TOWN | http://www.acworth.cc | SOURCE_DISCOVERY_OWED |
| TOWN OF ALBANY (`nh:city:town-of-albany`) | CITY_OR_TOWN | http://www.albanynh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF ALEXANDRIA (`nh:city:town-of-alexandria`) | CITY_OR_TOWN | http://www.alexandrianh.com/ | SOURCE_DISCOVERY_OWED |
| TOWN OF ALLENSTOWN (`nh:city:town-of-allenstown`) | CITY_OR_TOWN | http://www.allenstown.org | SOURCE_DISCOVERY_OWED |
| TOWN OF ALSTEAD (`nh:city:town-of-alstead`) | CITY_OR_TOWN | http://www.alsteadnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF ALTON (`nh:city:town-of-alton`) | CITY_OR_TOWN | http://www.alton.nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF AMHERST (`nh:city:town-of-amherst`) | CITY_OR_TOWN | http://www.amherstnh.gov/ | SOURCE_DISCOVERY_OWED |
| TOWN OF ANDOVER (`nh:city:town-of-andover`) | CITY_OR_TOWN | http://www.andovernh.us.com | SOURCE_DISCOVERY_OWED |
| TOWN OF ANTRIM (`nh:city:town-of-antrim`) | CITY_OR_TOWN | http://www.antrimnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF ASHLAND (`nh:city:town-of-ashland`) | CITY_OR_TOWN | http://www.ashland.nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF ATKINSON (`nh:city:town-of-atkinson`) | CITY_OR_TOWN | http://www.townatkinson.com | SOURCE_DISCOVERY_OWED |
| TOWN OF AUBURN (`nh:city:town-of-auburn`) | CITY_OR_TOWN | http://www.auburnnh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF BARNSTEAD (`nh:city:town-of-barnstead`) | CITY_OR_TOWN | http://www.barnstead.org | SOURCE_DISCOVERY_OWED |
| TOWN OF BARRINGTON (`nh:city:town-of-barrington`) | CITY_OR_TOWN | http://www.barrington.nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF BARTLETT (`nh:city:town-of-bartlett`) | CITY_OR_TOWN | http://www.bartlettnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF BATH (`nh:city:town-of-bath`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF BEDFORD (`nh:city:town-of-bedford`) | CITY_OR_TOWN | http://www.ci.bedford.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF BELMONT (`nh:city:town-of-belmont`) | CITY_OR_TOWN | http://WWW.BELMONTNH.ORG | SOURCE_DISCOVERY_OWED |
| TOWN OF BENNINGTON (`nh:city:town-of-bennington`) | CITY_OR_TOWN | http://www.townofbennington.com | SOURCE_DISCOVERY_OWED |
| TOWN OF BENTON (`nh:city:town-of-benton`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF BETHLEHEM (`nh:city:town-of-bethlehem`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF BLOOMFIELD (`nh:city:town-of-bloomfield`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF BOSCAWEN (`nh:city:town-of-boscawen`) | CITY_OR_TOWN | http://www.town.of.boscawen.org | SOURCE_DISCOVERY_OWED |
| TOWN OF BOW (`nh:city:town-of-bow`) | CITY_OR_TOWN | http://www.bownh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF BRADFORD (`nh:city:town-of-bradford`) | CITY_OR_TOWN | http://www.bradfordnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF BRENTWOOD (`nh:city:town-of-brentwood`) | CITY_OR_TOWN | http://www.brentwoodnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF BRIDGEWATER (`nh:city:town-of-bridgewater`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF BRISTOL (`nh:city:town-of-bristol`) | CITY_OR_TOWN | http://www.townofbristolnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF BROOKFIELD (`nh:city:town-of-brookfield`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF BROOKLINE (`nh:city:town-of-brookline`) | CITY_OR_TOWN | http://www.brookline.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF CAMPTON (`nh:city:town-of-campton`) | CITY_OR_TOWN | http://www.camptonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF CANAAN (`nh:city:town-of-canaan`) | CITY_OR_TOWN | http://www.canaannh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF CANDIA (`nh:city:town-of-candia`) | CITY_OR_TOWN | http://www.candianh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF CANTERBURY (`nh:city:town-of-canterbury`) | CITY_OR_TOWN | http://www.canterburynh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF CARROLL (`nh:city:town-of-carroll`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF CENTER HARBOR (`nh:city:town-of-center-harbor`) | CITY_OR_TOWN | http://www.centerharbornh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF CHARLESTOWN (`nh:city:town-of-charlestown`) | CITY_OR_TOWN | http://www.charlestown-nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF CHATHAM (`nh:city:town-of-chatham`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF CHESTER (`nh:city:town-of-chester`) | CITY_OR_TOWN | http://www.chesternh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF CHESTERFIELD (`nh:city:town-of-chesterfield`) | CITY_OR_TOWN | http://WWW.NHCHESTERFIELD.COM | SOURCE_DISCOVERY_OWED |
| TOWN OF CHICHESTER (`nh:city:town-of-chichester`) | CITY_OR_TOWN | http://www.chichesternh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF CLARKSVILLE (`nh:city:town-of-clarksville`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF COLEBROOK (`nh:city:town-of-colebrook`) | CITY_OR_TOWN | http://www.colebrooknh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF COLUMBIA (`nh:city:town-of-columbia`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF CONWAY (`nh:city:town-of-conway`) | CITY_OR_TOWN | http://www.conwaynh.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF CORNISH (`nh:city:town-of-cornish`) | CITY_OR_TOWN | http://www.cornishnh.net | SOURCE_DISCOVERY_OWED |
| TOWN OF CROYDON (`nh:city:town-of-croydon`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF DALTON (`nh:city:town-of-dalton`) | CITY_OR_TOWN | http://www.townofdalton.com | SOURCE_DISCOVERY_OWED |
| TOWN OF DANBURY (`nh:city:town-of-danbury`) | CITY_OR_TOWN | http://www.townofdanburynh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF DANVILLE (`nh:city:town-of-danville`) | CITY_OR_TOWN | http://www.townofdanville.org | SOURCE_DISCOVERY_OWED |
| TOWN OF DEERFIELD (`nh:city:town-of-deerfield`) | CITY_OR_TOWN | http://www.townofdeerfieldnh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF DEERING (`nh:city:town-of-deering`) | CITY_OR_TOWN | http://www.deering.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF DERRY (`nh:city:town-of-derry`) | CITY_OR_TOWN | http://www.derry-nh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF DORCHESTER (`nh:city:town-of-dorchester`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF DUBLIN (`nh:city:town-of-dublin`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF DUMMER (`nh:city:town-of-dummer`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF DUNBARTON (`nh:city:town-of-dunbarton`) | CITY_OR_TOWN | http://www.dunbartonnh.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF DURHAM (`nh:city:town-of-durham`) | CITY_OR_TOWN | http://www.ci.durham.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF EAST KINGSTON (`nh:city:town-of-east-kingston`) | CITY_OR_TOWN | http://www.eknh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF EASTON (`nh:city:town-of-easton`) | CITY_OR_TOWN | http://www.townofeastonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF EATON (`nh:city:town-of-eaton`) | CITY_OR_TOWN | http://www.eatonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF EFFINGHAM (`nh:city:town-of-effingham`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF ELLSWORTH (`nh:city:town-of-ellsworth`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF ENFIELD (`nh:city:town-of-enfield`) | CITY_OR_TOWN | http://www.enfield.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF EPPING (`nh:city:town-of-epping`) | CITY_OR_TOWN | http://www.townofepping.com | SOURCE_DISCOVERY_OWED |
| TOWN OF EPSOM (`nh:city:town-of-epsom`) | CITY_OR_TOWN | http://www.epsomnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF ERROL (`nh:city:town-of-errol`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF EXETER (`nh:city:town-of-exeter`) | CITY_OR_TOWN | http://www.town.exeter.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF FARMINGTON (`nh:city:town-of-farmington`) | CITY_OR_TOWN | http://www.farmington.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF FITZWILLIAM (`nh:city:town-of-fitzwilliam`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF FRANCESTOWN (`nh:city:town-of-francestown`) | CITY_OR_TOWN | http://www.francesboun-nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF FRANCONIA (`nh:city:town-of-franconia`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF FREEDOM (`nh:city:town-of-freedom`) | CITY_OR_TOWN | http://www.officeetownoffreedom.net | SOURCE_DISCOVERY_OWED |
| TOWN OF FREMONT (`nh:city:town-of-fremont`) | CITY_OR_TOWN | http://www.fremont.nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF GILFORD (`nh:city:town-of-gilford`) | CITY_OR_TOWN | http://www.gilfordnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF GILMANTON (`nh:city:town-of-gilmanton`) | CITY_OR_TOWN | http://www.gilmantonnh.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF GILSUM (`nh:city:town-of-gilsum`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF GOFFSTOWN (`nh:city:town-of-goffstown`) | CITY_OR_TOWN | http://www.goffstown.com | SOURCE_DISCOVERY_OWED |
| TOWN OF GORHAM (`nh:city:town-of-gorham`) | CITY_OR_TOWN | http://www.gorhamnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF GOSHEN (`nh:city:town-of-goshen`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF GRAFTON (`nh:city:town-of-grafton`) | CITY_OR_TOWN | http://www.townofgraftonnh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF GRANTHAM (`nh:city:town-of-grantham`) | CITY_OR_TOWN | http://www.granthamnh.net | SOURCE_DISCOVERY_OWED |
| TOWN OF GREENFIELD (`nh:city:town-of-greenfield`) | CITY_OR_TOWN | http://www.greenfield-nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF GREENLAND (`nh:city:town-of-greenland`) | CITY_OR_TOWN | http://www.greenland-nh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF GREENVILLE (`nh:city:town-of-greenville`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF GROTON (`nh:city:town-of-groton`) | CITY_OR_TOWN | http://www.townofgroton.com | SOURCE_DISCOVERY_OWED |
| TOWN OF HAMPSTEAD (`nh:city:town-of-hampstead`) | CITY_OR_TOWN | http://www.hampsteadnh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF HAMPTON (`nh:city:town-of-hampton`) | CITY_OR_TOWN | http://www.town.hampton.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF HAMPTON FALLS (`nh:city:town-of-hampton-falls`) | CITY_OR_TOWN | http://www.hamptonfalls.org | SOURCE_DISCOVERY_OWED |
| TOWN OF HANCOCK (`nh:city:town-of-hancock`) | CITY_OR_TOWN | http://www.hancocknh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF HANOVER (`nh:city:town-of-hanover`) | CITY_OR_TOWN | http://www.hanovernh.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF HARRISVILLE (`nh:city:town-of-harrisville`) | CITY_OR_TOWN | http://www.hannisvillenh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF HARTS LOCATION (`nh:city:town-of-harts-location`) | CITY_OR_TOWN | http://www.hartslocation.com | SOURCE_DISCOVERY_OWED |
| TOWN OF HAVERHILL (`nh:city:town-of-haverhill`) | CITY_OR_TOWN | http://www.haverhillnh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF HEBRON (`nh:city:town-of-hebron`) | CITY_OR_TOWN | http://www.hebronnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF HENNIKER (`nh:city:town-of-henniker`) | CITY_OR_TOWN | http://www.henniker.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF HILL (`nh:city:town-of-hill`) | CITY_OR_TOWN | http://www.townofhillnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF HILLSBOROUGH (`nh:city:town-of-hillsborough`) | CITY_OR_TOWN | http://www.town.hillsborough.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF HINSDALE (`nh:city:town-of-hinsdale`) | CITY_OR_TOWN | http://www.town.hinsdale.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF HOLDERNESS (`nh:city:town-of-holderness`) | CITY_OR_TOWN | http://www.holdernessnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF HOLLIS (`nh:city:town-of-hollis`) | CITY_OR_TOWN | http://www.hollis.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF HOOKSETT (`nh:city:town-of-hooksett`) | CITY_OR_TOWN | http://www.hooksett.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF HOPKINTON (`nh:city:town-of-hopkinton`) | CITY_OR_TOWN | http://www.hopkintonnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF HUDSON (`nh:city:town-of-hudson`) | CITY_OR_TOWN | http://www.hudsonnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF JACKSON (`nh:city:town-of-jackson`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF JAFFREY (`nh:city:town-of-jaffrey`) | CITY_OR_TOWN | http://www.town.of.jaffrey.com | SOURCE_DISCOVERY_OWED |
| TOWN OF JEFFERSON (`nh:city:town-of-jefferson`) | CITY_OR_TOWN | http://www.jeffersonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF KENSINGTON (`nh:city:town-of-kensington`) | CITY_OR_TOWN | http://WWW.TOWN.KENSINGTON.NH.US | SOURCE_DISCOVERY_OWED |
| TOWN OF KINGSTON (`nh:city:town-of-kingston`) | CITY_OR_TOWN | http://www.kinstonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF LANCASTER (`nh:city:town-of-lancaster`) | CITY_OR_TOWN | http://www.lancasternh.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF LANDAFF (`nh:city:town-of-landaff`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF LANGDON (`nh:city:town-of-langdon`) | CITY_OR_TOWN | http://www.langdonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF LEE (`nh:city:town-of-lee`) | CITY_OR_TOWN | http://WWW.LEENH.ORG | SOURCE_DISCOVERY_OWED |
| TOWN OF LEMPSTER (`nh:city:town-of-lempster`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF LINCOLN (`nh:city:town-of-lincoln`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF LISBON (`nh:city:town-of-lisbon`) | CITY_OR_TOWN | http://www.lisbonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF LITCHFIELD (`nh:city:town-of-litchfield`) | CITY_OR_TOWN | http://www.litchfieldnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF LITTLETON (`nh:city:town-of-littleton`) | CITY_OR_TOWN | http://www.townoflittleton.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF LONDONDERRY (`nh:city:town-of-londonderry`) | CITY_OR_TOWN | http://www.londonderrynh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF LOUDON (`nh:city:town-of-loudon`) | CITY_OR_TOWN | http://www.loudonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF LYMAN (`nh:city:town-of-lyman`) | CITY_OR_TOWN | http://www.lymannh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF LYME (`nh:city:town-of-lyme`) | CITY_OR_TOWN | http://www.lymenhlibrary.org | SOURCE_DISCOVERY_OWED |
| TOWN OF LYNDEBOROUGH (`nh:city:town-of-lyndeborough`) | CITY_OR_TOWN | http://www.lyndeboroughnh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF MADBURY (`nh:city:town-of-madbury`) | CITY_OR_TOWN | http://www.townofmadbury.com | SOURCE_DISCOVERY_OWED |
| TOWN OF MADISON (`nh:city:town-of-madison`) | CITY_OR_TOWN | http://www.madison.nh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF MARLBOROUGH (`nh:city:town-of-marlborough`) | CITY_OR_TOWN | http://www.marlboroughnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF MARLOW (`nh:city:town-of-marlow`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF MASON (`nh:city:town-of-mason`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF MEREDITH (`nh:city:town-of-meredith`) | CITY_OR_TOWN | http://www.meredithnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF MERRIMACK (`nh:city:town-of-merrimack`) | CITY_OR_TOWN | http://www.merrimacknh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF MIDDLETON (`nh:city:town-of-middleton`) | CITY_OR_TOWN | http://www.middletonnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF MILAN (`nh:city:town-of-milan`) | CITY_OR_TOWN | http://www.townofmilan.org | SOURCE_DISCOVERY_OWED |
| TOWN OF MILFORD (`nh:city:town-of-milford`) | CITY_OR_TOWN | http://www.milford.nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF MILTON (`nh:city:town-of-milton`) | CITY_OR_TOWN | http://www.miltonnh-us.com | SOURCE_DISCOVERY_OWED |
| TOWN OF MONROE (`nh:city:town-of-monroe`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF MONT VERNON (`nh:city:town-of-mont-vernon`) | CITY_OR_TOWN | http://www.mont-vernon.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF MOULTONBOROUGH (`nh:city:town-of-moultonborough`) | CITY_OR_TOWN | http://www.moultonborouoghnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF NELSON (`nh:city:town-of-nelson`) | CITY_OR_TOWN | http://www.minutes.townofnelson.com | SOURCE_DISCOVERY_OWED |
| TOWN OF NEW BOSTON (`nh:city:town-of-new-boston`) | CITY_OR_TOWN | http://www.newbostonnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF NEW CASTLE (`nh:city:town-of-new-castle`) | CITY_OR_TOWN | http://www.newcastlenh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF NEW DURHAM (`nh:city:town-of-new-durham`) | CITY_OR_TOWN | http://www.newdurhamnh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF NEW HAMPTON (`nh:city:town-of-new-hampton`) | CITY_OR_TOWN | http://www.newhampton.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF NEW IPSWICH (`nh:city:town-of-new-ipswich`) | CITY_OR_TOWN | http://www.townofnewipswich.org | SOURCE_DISCOVERY_OWED |
| TOWN OF NEW LONDON (`nh:city:town-of-new-london`) | CITY_OR_TOWN | http://www.nl-nh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF NEWBURY (`nh:city:town-of-newbury`) | CITY_OR_TOWN | http://www.newburyh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF NEWFIELDS (`nh:city:town-of-newfields`) | CITY_OR_TOWN | http://www.newfieldsnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF NEWINGTON (`nh:city:town-of-newington`) | CITY_OR_TOWN | http://www.newington.nh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF NEWMARKET (`nh:city:town-of-newmarket`) | CITY_OR_TOWN | http://www.newmarketnh.gov/ | SOURCE_DISCOVERY_OWED |
| TOWN OF NEWPORT (`nh:city:town-of-newport`) | CITY_OR_TOWN | http://WWW.NEWPORTNH.NET | SOURCE_DISCOVERY_OWED |
| TOWN OF NEWTON (`nh:city:town-of-newton`) | CITY_OR_TOWN | http://www.newtonnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF NORTH HAMPTON (`nh:city:town-of-north-hampton`) | CITY_OR_TOWN | http://www.northhampton-nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF NORTHFIELD (`nh:city:town-of-northfield`) | CITY_OR_TOWN | http://www.northfieldnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF NORTHUMBERLAND (`nh:city:town-of-northumberland`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF NORTHWOOD (`nh:city:town-of-northwood`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF NOTTINGHAM (`nh:city:town-of-nottingham`) | CITY_OR_TOWN | http://www.nottingham-nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF ORANGE (`nh:city:town-of-orange`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF ORFORD (`nh:city:town-of-orford`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF OSSIPEE (`nh:city:town-of-ossipee`) | CITY_OR_TOWN | http://www.ossipee.org | SOURCE_DISCOVERY_OWED |
| TOWN OF PELHAM (`nh:city:town-of-pelham`) | CITY_OR_TOWN | http://www.pelhamweb.com | SOURCE_DISCOVERY_OWED |
| TOWN OF PEMBROKE (`nh:city:town-of-pembroke`) | CITY_OR_TOWN | http://www.pembrokenh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF PETERBOROUGH (`nh:city:town-of-peterborough`) | CITY_OR_TOWN | http://townofpeterborough.com/ | SOURCE_DISCOVERY_OWED |
| TOWN OF PIERMONT (`nh:city:town-of-piermont`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF PITTSBURG (`nh:city:town-of-pittsburg`) | CITY_OR_TOWN | http://www.pittsburg-nh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF PITTSFIELD (`nh:city:town-of-pittsfield`) | CITY_OR_TOWN | http://www.pittsfieldnh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF PLAINFIELD (`nh:city:town-of-plainfield`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF PLAISTOW (`nh:city:town-of-plaistow`) | CITY_OR_TOWN | http://www.plaistow.com/ | SOURCE_DISCOVERY_OWED |
| TOWN OF PLYMOUTH (`nh:city:town-of-plymouth`) | CITY_OR_TOWN | http://www.plymouthnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF RANDOLPH (`nh:city:town-of-randolph`) | CITY_OR_TOWN | http://www.randolph.nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF RAYMOND (`nh:city:town-of-raymond`) | CITY_OR_TOWN | http://www.raymondnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF RICHMOND (`nh:city:town-of-richmond`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF RINDGE (`nh:city:town-of-rindge`) | CITY_OR_TOWN | http://www.town.rindge.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF ROLLINSFORD (`nh:city:town-of-rollinsford`) | CITY_OR_TOWN | http://www.rollinsford.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF ROXBURY (`nh:city:town-of-roxbury`) | CITY_OR_TOWN | http://www.roxburynh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF RUMNEY (`nh:city:town-of-rumney`) | CITY_OR_TOWN | http://www.rumneynh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF RYE (`nh:city:town-of-rye`) | CITY_OR_TOWN | http://www.town.rye.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF SALEM (`nh:city:town-of-salem`) | CITY_OR_TOWN | http://www.ci.salem.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF SALISBURY (`nh:city:town-of-salisbury`) | CITY_OR_TOWN | http://www.salisburynh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF SANBORNTON (`nh:city:town-of-sanbornton`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF SANDOWN (`nh:city:town-of-sandown`) | CITY_OR_TOWN | http://www.sandown.us | SOURCE_DISCOVERY_OWED |
| TOWN OF SANDWICH (`nh:city:town-of-sandwich`) | CITY_OR_TOWN | http://www.town.sandwich.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF SEABROOK (`nh:city:town-of-seabrook`) | CITY_OR_TOWN | http://www.seabrooknh.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF SHARON (`nh:city:town-of-sharon`) | CITY_OR_TOWN | http://www.sharonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF SHELBURNE (`nh:city:town-of-shelburne`) | CITY_OR_TOWN | http://www.shelburnenh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF SOUTH HAMPTON (`nh:city:town-of-south-hampton`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF SPRINGFIELD (`nh:city:town-of-springfield`) | CITY_OR_TOWN | http://www.springfieldnh.net | SOURCE_DISCOVERY_OWED |
| TOWN OF STARK (`nh:city:town-of-stark`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF STEWARTSTOWN (`nh:city:town-of-stewartstown`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF STODDARD (`nh:city:town-of-stoddard`) | CITY_OR_TOWN | http://WWW.STODDARDNH.ORG | SOURCE_DISCOVERY_OWED |
| TOWN OF STRAFFORD (`nh:city:town-of-strafford`) | CITY_OR_TOWN | http://www.strafford.nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF STRATFORD (`nh:city:town-of-stratford`) | CITY_OR_TOWN | http://www.stratfordnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF STRATHAM (`nh:city:town-of-stratham`) | CITY_OR_TOWN | http://www.strathamnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF SUGAR HILL (`nh:city:town-of-sugar-hill`) | CITY_OR_TOWN | http://www.sugarhillnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF SULLIVAN (`nh:city:town-of-sullivan`) | CITY_OR_TOWN | http://www.ci.sullivan.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF SUNAPEE (`nh:city:town-of-sunapee`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF SURRY (`nh:city:town-of-surry`) | CITY_OR_TOWN | http://www.townofsurry.org | SOURCE_DISCOVERY_OWED |
| TOWN OF SUTTON (`nh:city:town-of-sutton`) | CITY_OR_TOWN | http://www.sutton-nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF SWANZEY (`nh:city:town-of-swanzey`) | CITY_OR_TOWN | http://WWW.TOWN.SWANZEY.NH.US | SOURCE_DISCOVERY_OWED |
| TOWN OF TAMWORTH (`nh:city:town-of-tamworth`) | CITY_OR_TOWN | http://www.tamworthnh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF TEMPLE (`nh:city:town-of-temple`) | CITY_OR_TOWN | http://www.templenh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF THORNTON (`nh:city:town-of-thornton`) | CITY_OR_TOWN | http://www.thorntonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF TILTON (`nh:city:town-of-tilton`) | CITY_OR_TOWN | http://www.tiltonnh.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF TROY (`nh:city:town-of-troy`) | CITY_OR_TOWN | http://www.troy.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF TUFTONBORO (`nh:city:town-of-tuftonboro`) | CITY_OR_TOWN | http://www.tuftonboro.org | SOURCE_DISCOVERY_OWED |
| TOWN OF UNITY (`nh:city:town-of-unity`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF WAKEFIELD (`nh:city:town-of-wakefield`) | CITY_OR_TOWN | http://WWW.WAKEFIELDNH.COM | SOURCE_DISCOVERY_OWED |
| TOWN OF WALPOLE (`nh:city:town-of-walpole`) | CITY_OR_TOWN | http://www.walpolenh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF WARNER (`nh:city:town-of-warner`) | CITY_OR_TOWN | http://www.warner.nh.us/ | SOURCE_DISCOVERY_OWED |
| TOWN OF WARREN (`nh:city:town-of-warren`) | CITY_OR_TOWN | http://www.warrennh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF WASHINGTON (`nh:city:town-of-washington`) | CITY_OR_TOWN | http://www.washingtonnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF WATERVILLE VALLEY (`nh:city:town-of-waterville-valley`) | CITY_OR_TOWN | http://www.watervillevalley.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF WEARE (`nh:city:town-of-weare`) | CITY_OR_TOWN | http://www.weare.nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF WEBSTER (`nh:city:town-of-webster`) | CITY_OR_TOWN | http://www.websternh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF WENTWORTH (`nh:city:town-of-wentworth`) | CITY_OR_TOWN | http://www.wentworthnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF WESTMORELAND (`nh:city:town-of-westmoreland`) | CITY_OR_TOWN | http://www.westmorelandnh.com | SOURCE_DISCOVERY_OWED |
| TOWN OF WHITEFIELD (`nh:city:town-of-whitefield`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF WILMOT (`nh:city:town-of-wilmot`) | CITY_OR_TOWN | http://www.wilmotnh.org | SOURCE_DISCOVERY_OWED |
| TOWN OF WILTON (`nh:city:town-of-wilton`) | CITY_OR_TOWN | http://www.ci.wilton.nh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF WINCHESTER (`nh:city:town-of-winchester`) | CITY_OR_TOWN | http://www.winchester-nh.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF WINDHAM (`nh:city:town-of-windham`) | CITY_OR_TOWN | http://www.windhamnewhampshire.com/ | SOURCE_DISCOVERY_OWED |
| TOWN OF WINDSOR (`nh:city:town-of-windsor`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF WOLFEBORO (`nh:city:town-of-wolfeboro`) | CITY_OR_TOWN | http://www.wolfeboronh.us | SOURCE_DISCOVERY_OWED |
| TOWN OF WOODSTOCK (`nh:city:town-of-woodstock`) | CITY_OR_TOWN | http://www.woodstocknh.org | SOURCE_DISCOVERY_OWED |
| COUNTY OF BELKNAP (`nh:county:county-of-belknap`) | COUNTY | http://www.belknapcounty.org/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF CARROLL (`nh:county:county-of-carroll`) | COUNTY | http://www.carrollcountynh.net | SOURCE_DISCOVERY_OWED |
| COUNTY OF CHESHIRE (`nh:county:county-of-cheshire`) | COUNTY | http://co.cheshire.nh.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF COOS (`nh:county:county-of-coos`) | COUNTY | http://www.cooscountynh.us | SOURCE_DISCOVERY_OWED |
| COUNTY OF GRAFTON (`nh:county:county-of-grafton`) | COUNTY | http://www.graftoncountynh.us | SOURCE_DISCOVERY_OWED |
| COUNTY OF HILLSBOROUGH (`nh:county:county-of-hillsborough`) | COUNTY | http://www.hillsboroughcountynh.org/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF MERRIMACK (`nh:county:county-of-merrimack`) | COUNTY | http://www.merrimackcounty.net/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF ROCKINGHAM (`nh:county:county-of-rockingham`) | COUNTY | http://co.rockingham.nh.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF STRAFFORD (`nh:county:county-of-strafford`) | COUNTY | http://www.co.strafford.nh.us | SOURCE_DISCOVERY_OWED |
| COUNTY OF SULLIVAN (`nh:county:county-of-sullivan`) | COUNTY | http://www.sullivancountynh.gov | SOURCE_DISCOVERY_OWED |
| BERLIN CITY SCHOOL DISTRICT (`nh:depschool:berlin-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.SAU3.ORG | SOURCE_DISCOVERY_OWED |
| COOS COUNTY SCHOOL DISTRICT (`nh:depschool:coos-county-school-district`) | DEPENDENT_SCHOOL_SYSTEM | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DOVER SCHOOL DISTRICT (`nh:depschool:dover-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.DOVER.K12.NH.US | SOURCE_DISCOVERY_OWED |
| FRANKLIN SCHOOL DISTRICT (`nh:depschool:franklin-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.FRANKLIN.K12.NH.US | SOURCE_DISCOVERY_OWED |
| LACONIA CITY SCHOOL DISTRICT (`nh:depschool:laconia-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.LACONIA.K12.NH.US | SOURCE_DISCOVERY_OWED |
| MANCHESTER CITY SCHOOL DISTRICT (`nh:depschool:manchester-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.MANSD.ORG | SOURCE_DISCOVERY_OWED |
| NASHUA CITY SCHOOL DISTRICT (`nh:depschool:nashua-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.nashua.edu/ | SOURCE_DISCOVERY_OWED |
| PORTSMOUTH CITY SCHOOL DISTRICT (`nh:depschool:portsmouth-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.cityofportsmouth.com/school/index.htm | SOURCE_DISCOVERY_OWED |
| ROCHESTER CITY SCHOOL DISTRICT (`nh:depschool:rochester-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.rochesterschools.com/ | SOURCE_DISCOVERY_OWED |
| SOMERSWORTH CITY SCHOOL DISTRICT (`nh:depschool:somersworth-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.sau56.org/ | SOURCE_DISCOVERY_OWED |
| ALBANY TOWN SCH DIST (`nh:school:albany-town-sch-dist`) | SCHOOL_DISTRICT | HTTP://SAU9.ORG/ | SOURCE_DISCOVERY_OWED |
| ALLENSTOWN SCHOOL DISTRICT (`nh:school:allenstown-school-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ALTON TOWN SCH DIST (`nh:school:alton-town-sch-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.MYACS.ORG/ | SOURCE_DISCOVERY_OWED |
| AMHERST SCHOOL DISTRICT (`nh:school:amherst-school-district`) | SCHOOL_DISTRICT | http://WWW.SPRISE.COM | SOURCE_DISCOVERY_OWED |
| ANDOVER TOWN SCH DIST (`nh:school:andover-town-sch-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.AEMSEAGLES.ORG/ | SOURCE_DISCOVERY_OWED |
| ASHLAND TOWN SCH DIST (`nh:school:ashland-town-sch-dist`) | SCHOOL_DISTRICT | http://www.sau2.k12.nh.us/Ashlandweb/ashland.htm | SOURCE_DISCOVERY_OWED |
| AUBURN TOWN SCH DIST (`nh:school:auburn-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BARNSTEAD SCHOOL DISTRICT (`nh:school:barnstead-school-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BARRINGTON SCH DIST (`nh:school:barrington-sch-dist`) | SCHOOL_DISTRICT | http://www.barrington.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| BARTLETT TOWN SCH DIST (`nh:school:bartlett-town-sch-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.JBARTLETT.K12.NH.US/ | SOURCE_DISCOVERY_OWED |
| BATH TOWN SCH DIST (`nh:school:bath-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BEDFORD SCHOOL DISTRICT (`nh:school:bedford-school-district`) | SCHOOL_DISTRICT | http://WWW.SAU25.NET | SOURCE_DISCOVERY_OWED |
| BENTON TOWN SCH DIST (`nh:school:benton-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BETHLEHEM TOWN SCH DIST (`nh:school:bethlehem-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.BETHLEHEM.K12.NH.US | SOURCE_DISCOVERY_OWED |
| BOW TOWN SCHOOL DIST (`nh:school:bow-town-school-dist`) | SCHOOL_DISTRICT | http://WWW.BOWNET.ORG | SOURCE_DISCOVERY_OWED |
| BRENTWOOD TOWN SCH DIST (`nh:school:brentwood-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BROOKLINE TOWN SCH DIST (`nh:school:brookline-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SAU41.K12.NH.US | SOURCE_DISCOVERY_OWED |
| CAMPTON TOWN SCH DIST (`nh:school:campton-town-sch-dist`) | SCHOOL_DISTRICT | http://www.campton.sau48.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| CANDIA TOWN SCH DIST (`nh:school:candia-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CHATHAM TOWN SCH DIST (`nh:school:chatham-town-sch-dist`) | SCHOOL_DISTRICT | https://www.sau9.org/ | SOURCE_DISCOVERY_OWED |
| CHESTER TOWN SCH DIST (`nh:school:chester-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.CHESTERACADEMY.ORG | SOURCE_DISCOVERY_OWED |
| CHESTERFIELD SCHOOLS (`nh:school:chesterfield-schools`) | SCHOOL_DISTRICT | http://www.sau29.k12.nh.us/chesterfield/default.htm | SOURCE_DISCOVERY_OWED |
| CHICHESTER TOWN SCH DIST (`nh:school:chichester-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CLAREMONT SCHOOL DISTRICT (`nh:school:claremont-school-district`) | SCHOOL_DISTRICT | http://SAU6.K12.NH.US | SOURCE_DISCOVERY_OWED |
| CLARKSVILLE SCH DIST (`nh:school:clarksville-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COLEBROOK SCH DIST (`nh:school:colebrook-sch-dist`) | SCHOOL_DISTRICT | http://www.colebrook.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| COLUMBIA SCH DIST (`nh:school:columbia-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CONCORD CITY SCH DIST (`nh:school:concord-city-sch-dist`) | SCHOOL_DISTRICT | http://WWW.CONCORD.K12.NH.US | SOURCE_DISCOVERY_OWED |
| CONTOOCOOK VALLEY SCH DISTRICT (`nh:school:contoocook-valley-sch-district`) | SCHOOL_DISTRICT | http://WWW.CONVAL.EDU | SOURCE_DISCOVERY_OWED |
| CONWAY TOWN SCH DIST (`nh:school:conway-town-sch-dist`) | SCHOOL_DISTRICT | http://www.kennett.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| CORNISH SCHOOL DISTRICT (`nh:school:cornish-school-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CROYDON TOWN SCH DIST (`nh:school:croydon-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DEERFIELD TOWN SCH DIST (`nh:school:deerfield-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DERRY COOP SCH DIST (`nh:school:derry-coop-sch-dist`) | SCHOOL_DISTRICT | http://WWW.DERRY.K12.NH.US | SOURCE_DISCOVERY_OWED |
| DRESDEN SCHOOL DIST (`nh:school:dresden-school-dist`) | SCHOOL_DISTRICT | http://WWW.HANOVERHIGH.ORG | SOURCE_DISCOVERY_OWED |
| DUMMER TOWN SCH DIST (`nh:school:dummer-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DUNBARTON SCH DIST (`nh:school:dunbarton-sch-dist`) | SCHOOL_DISTRICT | http://www.goffstown.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| EAST KINGSTON TOWN SCH (`nh:school:east-kingston-town-sch`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EATON TOWN SCH DIST (`nh:school:eaton-town-sch-dist`) | SCHOOL_DISTRICT | HTTP://SAU9.ORG/ | SOURCE_DISCOVERY_OWED |
| ELLSWORTH SCHOOL DIST 162 (`nh:school:ellsworth-school-dist-162`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EPPING SCHOOL DISTRICT (`nh:school:epping-school-district`) | SCHOOL_DISTRICT | http://www.sau14.k12.nh.us./ | SOURCE_DISCOVERY_OWED |
| EPSOM TOWN SCH DIST (`nh:school:epsom-town-sch-dist`) | SCHOOL_DISTRICT | http://www.sau53.org/sau53/districts/epsom.htm | SOURCE_DISCOVERY_OWED |
| ERROL TOWN SCH DIST (`nh:school:errol-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EXETER REGION COOPERATIVE SCHOOL DISTRICT (`nh:school:exeter-region-cooperative-school-district`) | SCHOOL_DISTRICT | http://www.ercsd.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| EXETER SCHOOL DISTRICT (`nh:school:exeter-school-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FALL MOUNTAIN REGIONAL SCHOOL DIST (`nh:school:fall-mountain-regional-school-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FARMINGTON TOWN SCH DIST (`nh:school:farmington-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FREEDOM TOWN SCH DIST (`nh:school:freedom-town-sch-dist`) | SCHOOL_DISTRICT | http://www.sau13.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| FREMONT TOWN SCH DIST (`nh:school:fremont-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GILFORD SCHOOL DISTRICT (`nh:school:gilford-school-district`) | SCHOOL_DISTRICT | http://WWW.GILFORD.K12.NH.US | SOURCE_DISCOVERY_OWED |
| GILMANTON TOWN SCH DIST (`nh:school:gilmanton-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.GILMANTON.K12.NH.US | SOURCE_DISCOVERY_OWED |
| GOFFSTOWN SCH DIST (`nh:school:goffstown-sch-dist`) | SCHOOL_DISTRICT | http://www.goffstown.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| GORHAM RANDOLPH SHELBURNE COOP SCHOOL DISTRICT (`nh:school:gorham-randolph-shelburne-coop-school-district`) | SCHOOL_DISTRICT | http://www.sau20.org/gorham.php | SOURCE_DISCOVERY_OWED |
| GOSHEN SCHOOL DISTRICT (`nh:school:goshen-school-district`) | SCHOOL_DISTRICT | http://www.sau71.org/home/goshen | SOURCE_DISCOVERY_OWED |
| GOVERNOR WENTWORTH REG SCHOOL DIST (`nh:school:governor-wentworth-reg-school-dist`) | SCHOOL_DISTRICT | http://WWW.GOVWENTWORTH.K12.NH.US | SOURCE_DISCOVERY_OWED |
| GRANTHAM TOWN SCH DIST (`nh:school:grantham-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GREENLAND TOWN SCH DIST (`nh:school:greenland-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HAMPSTEAD SCHOOL DIST (`nh:school:hampstead-school-dist`) | SCHOOL_DISTRICT | http://www.hampstead.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| HAMPTON FALLS TOWN SCH (`nh:school:hampton-falls-town-sch`) | SCHOOL_DISTRICT | http://sau21.k12.nh.us/index.html | SOURCE_DISCOVERY_OWED |
| HAMPTON TOWN SCH DIST (`nh:school:hampton-town-sch-dist`) | SCHOOL_DISTRICT | http://sau21.k12.nh.us/index.html | SOURCE_DISCOVERY_OWED |
| HANOVER SCH DIST (`nh:school:hanover-sch-dist`) | SCHOOL_DISTRICT | http://WWW.VALLEY.NET/ RAY | SOURCE_DISCOVERY_OWED |
| HARRISVILLE SCH DIST (`nh:school:harrisville-sch-dist`) | SCHOOL_DISTRICT | http://www.sau29.k12.nh.us/harrisville/index.htm | SOURCE_DISCOVERY_OWED |
| HARTS LOCATION SCHOOL DIST 236 (`nh:school:harts-location-school-dist-236`) | SCHOOL_DISTRICT | HTTP://SAU9.ORG/ | SOURCE_DISCOVERY_OWED |
| HAVERHILL COOP SCHOOL DIST (`nh:school:haverhill-coop-school-dist`) | SCHOOL_DISTRICT | http://www.sau23.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| HENNIKER TOWN SCH DIST (`nh:school:henniker-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HILL SCHOOL DISTRICT (`nh:school:hill-school-district`) | SCHOOL_DISTRICT | http://www.franklin.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| HILLSBORO DEERING COOPERATN SCH DIST (`nh:school:hillsboro-deering-cooperatn-sch-dist`) | SCHOOL_DISTRICT | http://WWW.HILLSBORO-DEERING.ORG | SOURCE_DISCOVERY_OWED |
| HINSDALE SCH DIST (`nh:school:hinsdale-sch-dist`) | SCHOOL_DISTRICT | HTTP://WWW.HNHSD.ORG/ | SOURCE_DISCOVERY_OWED |
| HOLDERNESS TOWN SCH DIST (`nh:school:holderness-town-sch-dist`) | SCHOOL_DISTRICT | HTTPS://HCS.PEMIBAKER.ORG/ | SOURCE_DISCOVERY_OWED |
| HOLLIS-BROOKLINE COOP 260 (`nh:school:hollis-brookline-coop-260`) | SCHOOL_DISTRICT | http://WWW.SAU41.K12.NH.US | SOURCE_DISCOVERY_OWED |
| HOLLIS TOWN SCH DIST (`nh:school:hollis-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SAU41.K12.NH.US | SOURCE_DISCOVERY_OWED |
| HOOKSETT SCH DIST (`nh:school:hooksett-sch-dist`) | SCHOOL_DISTRICT | http://WWW.HOOKSETT.K12.NH.US | SOURCE_DISCOVERY_OWED |
| HOPKINTON SCH DIST (`nh:school:hopkinton-sch-dist`) | SCHOOL_DISTRICT | http://www.hopkintonschools.org/ | SOURCE_DISCOVERY_OWED |
| HUDSON TOWN SCH DIST (`nh:school:hudson-town-sch-dist`) | SCHOOL_DISTRICT | http://www.sau81.org/ | SOURCE_DISCOVERY_OWED |
| INTER LAKES COOP SCH DIST (`nh:school:inter-lakes-coop-sch-dist`) | SCHOOL_DISTRICT | http://www.inter-lakes.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| JACKSON TOWN SCH DIST (`nh:school:jackson-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| JAFFREY RINDGE SCH DIST (`nh:school:jaffrey-rindge-sch-dist`) | SCHOOL_DISTRICT | http://www.sau47.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| JOHN STARK REG SCHOOL DISTRICT (`nh:school:john-stark-reg-school-district`) | SCHOOL_DISTRICT | http://generals.john-stark.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| KEARSARGE REGIONAL SCHOOL DIST (`nh:school:kearsarge-regional-school-dist`) | SCHOOL_DISTRICT | http://www.kearsarge.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| KEENE SCHOOL DISTRICT (`nh:school:keene-school-district`) | SCHOOL_DISTRICT | http://WWW.SAU29.K12.NH.US | SOURCE_DISCOVERY_OWED |
| KENSINGTON TOWN SCH DIST (`nh:school:kensington-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LAFAYETTE REGIONAL SCH DIST (`nh:school:lafayette-regional-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LAFAYETTE.K12.NH.US | SOURCE_DISCOVERY_OWED |
| LANDAFF TOWN SCH DIST (`nh:school:landaff-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LEBANON SCH DIST (`nh:school:lebanon-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LEBANON.K12.NH.US. | SOURCE_DISCOVERY_OWED |
| LEMPSTER SCHOOL DISTRICT (`nh:school:lempster-school-district`) | SCHOOL_DISTRICT | https://sites.google.com/a/sau71.org/goshen-lempster-school/ | SOURCE_DISCOVERY_OWED |
| LINCOLN-WOODSTOCK COOP SCHOOL DIST (`nh:school:lincoln-woodstock-coop-school-dist`) | SCHOOL_DISTRICT | http://www.lin-wood.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| LISBON REGIONAL SCH DIST (`nh:school:lisbon-regional-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LISBON.K12.NH.US | SOURCE_DISCOVERY_OWED |
| LITCHFIELD SCHOOL DISTRICT (`nh:school:litchfield-school-district`) | SCHOOL_DISTRICT | https://www.litchfieldsd.org/ | SOURCE_DISCOVERY_OWED |
| LITTLETON TOWN SCH DIST (`nh:school:littleton-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LONDONDERRY SCHOOL DISTRICT (`nh:school:londonderry-school-district`) | SCHOOL_DISTRICT | http://www.londonderry.org/ | SOURCE_DISCOVERY_OWED |
| LYME SCH DIST (`nh:school:lyme-sch-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.LYMESCHOOL.ORG/ | SOURCE_DISCOVERY_OWED |
| MADISON TOWN SCH DIST (`nh:school:madison-town-sch-dist`) | SCHOOL_DISTRICT | HTTP://SITES.GOOGLE.COM/VIEW/SAU-13/HOME | SOURCE_DISCOVERY_OWED |
| MARLBOROUGH TOWN SCH DIST (`nh:school:marlborough-town-sch-dist`) | SCHOOL_DISTRICT | http://www.sau29.k12.nh.us/marlborough/ | SOURCE_DISCOVERY_OWED |
| MARLOW TOWN SCH DIST (`nh:school:marlow-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MASCENIC REGIONAL SCHOOL DISTRICT (`nh:school:mascenic-regional-school-district`) | SCHOOL_DISTRICT | http://www.mascenic.com/ | SOURCE_DISCOVERY_OWED |
| MASCOMA VALLEY REG SCHOOL DIST (`nh:school:mascoma-valley-reg-school-dist`) | SCHOOL_DISTRICT | http://www.mascoma.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| MASON SCHOOL DISTRICT (`nh:school:mason-school-district`) | SCHOOL_DISTRICT | HTTP://MASON.SAU89.ORG/ | SOURCE_DISCOVERY_OWED |
| MERRIMACK TOWN SCHOOL DISTRICT (`nh:school:merrimack-town-school-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MERRIMACK VALLEY SCHOOL DISTRICT (`nh:school:merrimack-valley-school-district`) | SCHOOL_DISTRICT | http://www.mv.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| MIDDLETON SCHOOL DISTRICT (`nh:school:middleton-school-district`) | SCHOOL_DISTRICT | HTTPS://WWW.MIDDLETONELEMENTARY.ORG/ | SOURCE_DISCOVERY_OWED |
| MILAN TOWN SCHOOL DIST (`nh:school:milan-town-school-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MILFORD SCHOOL DISTRICT (`nh:school:milford-school-district`) | SCHOOL_DISTRICT | http://www.milfordschools.net/ | SOURCE_DISCOVERY_OWED |
| MILTON TOWN SCH DIST (`nh:school:milton-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MILTON.K12.NH.US | SOURCE_DISCOVERY_OWED |
| MONADNOCK REGIONAL SCHOOL DIST (`nh:school:monadnock-regional-school-dist`) | SCHOOL_DISTRICT | http://www.mrsd.org/LinkM.htm | SOURCE_DISCOVERY_OWED |
| MONROE TOWN SCH DIST (`nh:school:monroe-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MONT VERNON SCHOOL DISTRICT (`nh:school:mont-vernon-school-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MOULTONBOROUGH SCH DIST (`nh:school:moultonborough-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MOULTONBOROUGH.K12.NH.US | SOURCE_DISCOVERY_OWED |
| NELSON TOWN SCH DIST (`nh:school:nelson-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEW BOSTON TOWN SCH DIST (`nh:school:new-boston-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.NEW-BOSTON.NH.US/NBCS/INDEX.HTML | SOURCE_DISCOVERY_OWED |
| NEW CASTLE TOWN SCH DIST (`nh:school:new-castle-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEWFIELDS TOWN SCH DIST (`nh:school:newfields-town-sch-dist`) | SCHOOL_DISTRICT | http://www.sau16.org/ | SOURCE_DISCOVERY_OWED |
| NEWFOUND AREA SCHOOL DIST (`nh:school:newfound-area-school-dist`) | SCHOOL_DISTRICT | http://WWW.NEWFOUND.K12.NH.US | SOURCE_DISCOVERY_OWED |
| NEWINGTON TOWN SCH DIST (`nh:school:newington-town-sch-dist`) | SCHOOL_DISTRICT | http://www.sau50.org/ | SOURCE_DISCOVERY_OWED |
| NEWMARKET TOWN SCH DIST (`nh:school:newmarket-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.NEWMARKET.K12.NH.US | SOURCE_DISCOVERY_OWED |
| NEWPORT TOWN SCH DIST (`nh:school:newport-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.NEWPORT.K12.NH.US | SOURCE_DISCOVERY_OWED |
| NORTH HAMPTON TOWN SCH (`nh:school:north-hampton-town-sch`) | SCHOOL_DISTRICT | http://SAU21.K12.NH.US | SOURCE_DISCOVERY_OWED |
| NORTHUMBERLAND TOWN SCH DIST (`nh:school:northumberland-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTHWOOD TOWN SCH DIST (`nh:school:northwood-town-sch-dist`) | SCHOOL_DISTRICT | http://www.northwood.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| NOTTINGHAM TOWN SCH DIST (`nh:school:nottingham-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.NOTTINGHAM.K12.NH.US | SOURCE_DISCOVERY_OWED |
| OYSTER RIVER COOP SCH DIST (`nh:school:oyster-river-coop-sch-dist`) | SCHOOL_DISTRICT | http://WWW.ORCSD.ORG | SOURCE_DISCOVERY_OWED |
| PELHAM SCH DIST (`nh:school:pelham-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PEMBROKE SCHOOL DISTRICT (`nh:school:pembroke-school-district`) | SCHOOL_DISTRICT | http://www.sau53.org/sau53/districts/pembroke.htm | SOURCE_DISCOVERY_OWED |
| PEMI-BAKER COOP SCHOOL DIST (`nh:school:pemi-baker-coop-school-dist`) | SCHOOL_DISTRICT | http://www.pemi-baker.sau48.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| PIERMONT TOWN SCH DIST (`nh:school:piermont-town-sch-dist`) | SCHOOL_DISTRICT | HTTPS://PVS.SAU23.ORG/ | SOURCE_DISCOVERY_OWED |
| PITTSBURG SCH DIST (`nh:school:pittsburg-sch-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.PITTSBURGSCHOOL.SAU7.ORG/ | SOURCE_DISCOVERY_OWED |
| PITTSFIELD TOWN SCH DIST (`nh:school:pittsfield-town-sch-dist`) | SCHOOL_DISTRICT | http://www.pittsfield.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| PLAINFIELD SCHOOL DIST (`nh:school:plainfield-school-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.PLAINFIELDSCHOOL.ORG/ | SOURCE_DISCOVERY_OWED |
| PLYMOUTH TOWN SCH DIST (`nh:school:plymouth-town-sch-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.PLYMOUTH.EDU/ | SOURCE_DISCOVERY_OWED |
| PROFILE SCH DIST (`nh:school:profile-sch-dist`) | SCHOOL_DISTRICT | http://WWW.PROFILE.K12.NH.US | SOURCE_DISCOVERY_OWED |
| RAYMOND SCHOOL DIST (`nh:school:raymond-school-dist`) | SCHOOL_DISTRICT | http://WWW.RAYMOND.K12.NH.US | SOURCE_DISCOVERY_OWED |
| RIVENDELL INTERSTATE SCHOOL DISTRICT (`nh:school:rivendell-interstate-school-district`) | SCHOOL_DISTRICT | HTTP://WWW.RIVENDELLSCHOOL.ORG/ | SOURCE_DISCOVERY_OWED |
| ROLLINSFORD TOWN SCH DIST (`nh:school:rollinsford-town-sch-dist`) | SCHOOL_DISTRICT | http://www.rollinsford.k12.nh.us/ | SOURCE_DISCOVERY_OWED |
| RUMNEY TOWN SCH DIST (`nh:school:rumney-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RYE SCHOOL DIST (`nh:school:rye-school-dist`) | SCHOOL_DISTRICT | http://www.sau50.org/ | SOURCE_DISCOVERY_OWED |
| SALEM SCHOOL DIST (`nh:school:salem-school-dist`) | SCHOOL_DISTRICT | http://www.salemschooldistrictnh.com/ | SOURCE_DISCOVERY_OWED |
| SANBORN REGIONAL SCHOOL DISTRICT (`nh:school:sanborn-regional-school-district`) | SCHOOL_DISTRICT | http://SANBORN.K12.NH.US | SOURCE_DISCOVERY_OWED |
| SEABROOK SCH DIST (`nh:school:seabrook-sch-dist`) | SCHOOL_DISTRICT | http://SAU21.K12.NH.US | SOURCE_DISCOVERY_OWED |
| SHAKER REGIONAL SCH DIST (`nh:school:shaker-regional-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SHAKER.K12.NH.US | SOURCE_DISCOVERY_OWED |
| SOUHEGAN COOP DISTRICT (`nh:school:souhegan-coop-district`) | SCHOOL_DISTRICT | http://WWW.SPRISE.COM | SOURCE_DISCOVERY_OWED |
| SOUTH HAMPTON TOWN SCH DIST (`nh:school:south-hampton-town-sch-dist`) | SCHOOL_DISTRICT | http://SAU21.K12.NH.US | SOURCE_DISCOVERY_OWED |
| STARK SCHOOL DISTRICT (`nh:school:stark-school-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| STEWARTSTOWN SCH DIST (`nh:school:stewartstown-sch-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.STEWARTSTOWN.SAU7.ORG/ | SOURCE_DISCOVERY_OWED |
| STODDARD TOWN SCH DIST (`nh:school:stoddard-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| STRAFFORD TOWN SCH DIST (`nh:school:strafford-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.STRAFFORD.K12.NH.US | SOURCE_DISCOVERY_OWED |
| STRATFORD TOWN SCH DIST (`nh:school:stratford-town-sch-dist`) | SCHOOL_DISTRICT | http://schools.ncia.net/stratford/ | SOURCE_DISCOVERY_OWED |
| STRATHAM TOWN SCH DIST (`nh:school:stratham-town-sch-dist`) | SCHOOL_DISTRICT | http://www.sau16.org/ | SOURCE_DISCOVERY_OWED |
| SULLIVAN SCHOOL DISTRICT (`nh:school:sullivan-school-district`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SUNAPEE TOWN SCH DIST (`nh:school:sunapee-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SUNAPEE.K12.NH.US | SOURCE_DISCOVERY_OWED |
| SURRY SCHOOL DISTRICT (`nh:school:surry-school-district`) | SCHOOL_DISTRICT | HTTP://WWW.SURRYVILLAGECHARTERSCHOOL.ORG/ | SOURCE_DISCOVERY_OWED |
| TAMWORTH TOWN SCH DIST (`nh:school:tamworth-town-sch-dist`) | SCHOOL_DISTRICT | HTTP://SITES.GOOGLE.COM/VIEW/SAU-13/HOME | SOURCE_DISCOVERY_OWED |
| THORNTON TOWN SCH DIST (`nh:school:thornton-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TIMBERLANE REGIONAL SCHOOL DIST (`nh:school:timberlane-regional-school-dist`) | SCHOOL_DISTRICT | http://www.timberlane.net/ | SOURCE_DISCOVERY_OWED |
| UNITY SCHOOL DIST (`nh:school:unity-school-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WAKEFIELD TOWN SCH DIST (`nh:school:wakefield-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WARREN TOWN SCH DIST (`nh:school:warren-town-sch-dist`) | SCHOOL_DISTRICT | https://www.sau23.org/ | SOURCE_DISCOVERY_OWED |
| WASHINGTON TOWN SCH DIST (`nh:school:washington-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.HILLSBORO-DEERING.ORG | SOURCE_DISCOVERY_OWED |
| WATERVILLE VALLEY SCHOOL DIST (`nh:school:waterville-valley-school-dist`) | SCHOOL_DISTRICT | HTTPS://WVES.PEMIBAKER.ORG/ | SOURCE_DISCOVERY_OWED |
| WEARE SCHOOL DISTRICT (`nh:school:weare-school-district`) | SCHOOL_DISTRICT | http://www.sau24.org/ | SOURCE_DISCOVERY_OWED |
| WENTWORTH TOWN SCH DIST (`nh:school:wentworth-town-sch-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.GWRSD.ORG/ | SOURCE_DISCOVERY_OWED |
| WESTMORELAND SCH DIST (`nh:school:westmoreland-sch-dist`) | SCHOOL_DISTRICT | http://www.sau29.k12.nh.us/westmoreland/ | SOURCE_DISCOVERY_OWED |
| WHITE MTS REGIONAL SCHOOL DIST (`nh:school:white-mts-regional-school-dist`) | SCHOOL_DISTRICT | http://sau36.org/ | SOURCE_DISCOVERY_OWED |
| WILTON-LYNDEBOROUGH COOP SCH DIST (`nh:school:wilton-lyndeborough-coop-sch-dist`) | SCHOOL_DISTRICT | https://www.sau63.org/ | SOURCE_DISCOVERY_OWED |
| WINCHESTER SCH DIST (`nh:school:winchester-sch-dist`) | SCHOOL_DISTRICT | http://www.wnhsd.org/ | SOURCE_DISCOVERY_OWED |
| WINDHAM TOWN SCH DIST (`nh:school:windham-town-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WINDSOR TOWN SCH DIST (`nh:school:windsor-town-sch-dist`) | SCHOOL_DISTRICT | HTTP://WWW.HDSD.ORG | SOURCE_DISCOVERY_OWED |
| WINNACUNNET COOP SCHOOL DIST (`nh:school:winnacunnet-coop-school-dist`) | SCHOOL_DISTRICT | http://SAU21.K12.NH.US | SOURCE_DISCOVERY_OWED |
| WINNISQUAM REGIONAL SCH DIST (`nh:school:winnisquam-regional-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WINNISQUAM.K12.NH.US | SOURCE_DISCOVERY_OWED |
| ANDOVER FIRE DISTRICT (`nh:special:andover-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ANDOVER VILLAGE DISTRICT (`nh:special:andover-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ANDROSCOGGIN VALLEY REGIONAL REFUSE DISPOSAL DISTRICT (`nh:special:androscoggin-valley-regional-refuse-disposal-district`) | SPECIAL_DISTRICT | http://www.avrrdd.org | SOURCE_DISCOVERY_OWED |
| ASHUELOT POND DAM PRECINCT (`nh:special:ashuelot-pond-dam-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| B C E P SOLID WASTE DISTRICT (`nh:special:b-c-e-p-solid-waste-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BARTLETT VILLAGE WATER PRECINCT (`nh:special:bartlett-village-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BELKNAP COUNTY CONSERVATION DISTRICT (`nh:special:belknap-county-conservation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BERLIN HOUSING AUTHORITY (`nh:special:berlin-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BETHLEHEM VILLAGE PRECINCT (`nh:special:bethlehem-village-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BREEZY GALE VILLAGE DISTRICT (`nh:special:breezy-gale-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BRIDGEWATER-HEBRON SOLID WASTE MANAGEMENT DISTRICT (`nh:special:bridgewater-hebron-solid-waste-management-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BRIDGEWATER-HEBRON VILLAGE PRECINCT (`nh:special:bridgewater-hebron-village-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CAMPTON VILLAGE PRECINCT (`nh:special:campton-village-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CARROLL COUNTY CONSERVATION DISTRICT (`nh:special:carroll-county-conservation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CENTER CONWAY FIRE PRECINCT (`nh:special:center-conway-fire-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CENTER HARBOR-MOULTONBORO BAY DISTRICT (`nh:special:center-harbor-moultonboro-bay-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CENTER OSSIPEE FIRE PRECINCT (`nh:special:center-ossipee-fire-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CENTRAL HOOKSETT WATER PRECINCT (`nh:special:central-hooksett-water-precinct`) | SPECIAL_DISTRICT | http://www.centralhooksettwater.com | SOURCE_DISCOVERY_OWED |
| CHESHIRE COUNTY CONSERVATION DISTRICT (`nh:special:cheshire-county-conservation-district`) | SPECIAL_DISTRICT | http://www.cheshireconservation.org | SOURCE_DISCOVERY_OWED |
| CHESTERFIELD FIRE DISTRICT (`nh:special:chesterfield-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CLAREMONT HOUSING AUTHORITY (`nh:special:claremont-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COBBETTS POND VILLAGE DISTRICT (`nh:special:cobbetts-pond-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COLEBROOK VILLAGE FIRE PRECINCT (`nh:special:colebrook-village-fire-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CONCORD HOUSING AUTHORITY (`nh:special:concord-housing-authority`) | SPECIAL_DISTRICT | http://www.concordha.com | SOURCE_DISCOVERY_OWED |
| CONCORD REGIONAL SOLID WASTE DISTRICT (`nh:special:concord-regional-solid-waste-district`) | SPECIAL_DISTRICT | http://www.crswrrc.org | SOURCE_DISCOVERY_OWED |
| CONTOOCOOK VILLAGE PRECINCT (`nh:special:contoocook-village-precinct`) | SPECIAL_DISTRICT | http://www.hopkintonnh.gov/pages/hopkintonnh_bcomm/cvpcommissioners | SOURCE_DISCOVERY_OWED |
| CONWAY VILLAGE FIRE DISTRICT (`nh:special:conway-village-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COOPERATIVE ALLIANCE FOR SEACOAST TRANSPORTATION (`nh:special:cooperative-alliance-for-seacoast-transportation`) | SPECIAL_DISTRICT | http://www.coastbus.org/ | SOURCE_DISCOVERY_OWED |
| COOS COUNTY CONSERVATION DISTRICT (`nh:special:coos-county-conservation-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COPPLE CROWN VILLAGE DISTRICT (`nh:special:copple-crown-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DERRY HOUSING AND REDEVELOPMENT AUTHORITY (`nh:special:derry-housing-and-redevelopment-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DOVER HOUSING AUTHORITY (`nh:special:dover-housing-authority`) | SPECIAL_DISTRICT | http://WWW.DOVERHOUSINGAUTHORITY.ORG | SOURCE_DISCOVERY_OWED |
| EAST ANDOVER FIRE PRECINCT (`nh:special:east-andover-fire-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EAST CONWAY VILLAGE FIRE DISTRICT (`nh:special:east-conway-village-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EASTMAN VILLAGE DISTRICT (`nh:special:eastman-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EIDELWEISS VILLAGE DISTRICT (`nh:special:eidelweiss-village-district`) | SPECIAL_DISTRICT | http://www.vdoe-nh.org | SOURCE_DISCOVERY_OWED |
| EMERALD LAKE VILLAGE DISTRICT (`nh:special:emerald-lake-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EPSOM VILLAGE DISTRICT (`nh:special:epsom-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EXETER HOUSING AUTHORITY (`nh:special:exeter-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FITZWILLIAM WATER DISTRICT (`nh:special:fitzwilliam-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FOX RUN VILLAGE DISTRICT (`nh:special:fox-run-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FREEDOM VILLAGE WATER PRECINCT (`nh:special:freedom-village-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GILMANTON CORNERS VILLAGE DISTRICT (`nh:special:gilmanton-corners-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GOFFSTOWN VILLAGE WATER PRECINCT (`nh:special:goffstown-village-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GRAFTON COUNTY CONSERVATION DISTRICT (`nh:special:grafton-county-conservation-district`) | SPECIAL_DISTRICT | http://www.graftonccd.org | SOURCE_DISCOVERY_OWED |
| GRANITE LAKE VILLAGE DISTRICT (`nh:special:granite-lake-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GRASMERE VILLAGE WATER PRECINCT (`nh:special:grasmere-village-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GREATER DERRY-SALEM COOPERATIVE ALLIANCE FOR REGIONAL TRANSPORTA (`nh:special:greater-derry-salem-cooperative-alliance-for-regional-transporta`) | SPECIAL_DISTRICT | http://www.cartrides.org | SOURCE_DISCOVERY_OWED |
| GREENVILLE ESTATES VILLAGE DISTRICT (`nh:special:greenville-estates-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GROVETON VILLAGE PRECINCT (`nh:special:groveton-village-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GUNSTOCK ACRES VILLAGE DISTRICT (`nh:special:gunstock-acres-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HAMPTON BEACH VILLAGE PRECINCT (`nh:special:hampton-beach-village-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HANOVER HOUSING AUTHORITY (`nh:special:hanover-housing-authority`) | SPECIAL_DISTRICT | http://www.hanovernh.org | SOURCE_DISCOVERY_OWED |
| HARDY ROAD VILLAGE DISTRICT (`nh:special:hardy-road-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HAVERHILL CORNER PRECINCT (`nh:special:haverhill-corner-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HIGHLAND HAVEN SPECIAL DISTRICT (`nh:special:highland-haven-special-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HIGHLANDS VILLAGE DISTRICT (`nh:special:highlands-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HILLSBOROUGH COUNTY CONSERVATION DISTRICT (`nh:special:hillsborough-county-conservation-district`) | SPECIAL_DISTRICT | http://www.hillsboroughccd.com | SOURCE_DISCOVERY_OWED |
| HOOKSETT VILLAGE WATER PRECINCT (`nh:special:hooksett-village-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOPKINTON VILLAGE PRECINCT (`nh:special:hopkinton-village-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| JACKSON WATER PRECINCT (`nh:special:jackson-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| JENNESS BEACH VILLAGE DISTRICT (`nh:special:jenness-beach-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| KEARSARGE LIGHTING PRECINCT (`nh:special:kearsarge-lighting-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| KEENE HOUSING AUTHORITY (`nh:special:keene-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LACONIA HOUSING AND REDEVELOPMENT AUTHORITY (`nh:special:laconia-housing-and-redevelopment-authority`) | SPECIAL_DISTRICT | http://www.laconiahousing.org | SOURCE_DISCOVERY_OWED |
| LAKE TODD VILLAGE DISTRICT (`nh:special:lake-todd-village-district`) | SPECIAL_DISTRICT | http://www.laketoddvillagedistrict.us | SOURCE_DISCOVERY_OWED |
| LANCASTER HOUSING AUTHORITY (`nh:special:lancaster-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LEBANON HOUSING AUTHORITY (`nh:special:lebanon-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LITTLE BOARS HEAD DISTRICT (`nh:special:little-boars-head-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LOCHMERE VILLAGE PRECINCT (`nh:special:lochmere-village-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LONDONDERRY HOUSING AND REDEVELOPMENT AUTHORITY (`nh:special:londonderry-housing-and-redevelopment-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LOWER BARTLETT WATER PRECINCT (`nh:special:lower-bartlett-water-precinct`) | SPECIAL_DISTRICT | http://www.lbwpnh.org | SOURCE_DISCOVERY_OWED |
| MANCHESTER HOUSING AND REDEVELOPMENT AUTHORITY (`nh:special:manchester-housing-and-redevelopment-authority`) | SPECIAL_DISTRICT | http://www.manchesterhousing.org/ | SOURCE_DISCOVERY_OWED |
| MERIDEN VILLAGE WATER DISTRICT (`nh:special:meriden-village-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MERRIMACK COUNTY CONSERVATION DISTRICT (`nh:special:merrimack-county-conservation-district`) | SPECIAL_DISTRICT | http://www.merrimackccd.org | SOURCE_DISCOVERY_OWED |
| MERRIMACK VILLAGE DISTRICT (`nh:special:merrimack-village-district`) | SPECIAL_DISTRICT | http://www.mvdwater.org | SOURCE_DISCOVERY_OWED |
| MILTON WATER DISTRICT (`nh:special:milton-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MOECKEL POND VILLAGE DISTRICT (`nh:special:moeckel-pond-village-district`) | SPECIAL_DISTRICT | http://moeckelpond.com/ | SOURCE_DISCOVERY_OWED |
| MOUNTAIN LAKES VILLAGE DISTRICT (`nh:special:mountain-lakes-village-district`) | SPECIAL_DISTRICT | http://www.mtlakesnh.net | SOURCE_DISCOVERY_OWED |
| NASHUA HOUSING AND REDEVELOPMENT AUTHORITY (`nh:special:nashua-housing-and-redevelopment-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEW HAMPTON VILLAGE PRECINCT (`nh:special:new-hampton-village-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEW LONDON SPRINGFIELD WATER SYSTEM PRECINCT (`nh:special:new-london-springfield-water-system-precinct`) | SPECIAL_DISTRICT | http://www.nlswp.com | SOURCE_DISCOVERY_OWED |
| NEWFIELDS VILLAGE WATER AND SEWER DISTRICT (`nh:special:newfields-village-water-and-sewer-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEWMARKET HOUSING AUTHORITY (`nh:special:newmarket-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTH CONWAY WATER PRECINCT (`nh:special:north-conway-water-precinct`) | SPECIAL_DISTRICT | http://www.ncwpnh.org | SOURCE_DISCOVERY_OWED |
| NORTH HAVERHILL WATER AND LIGHT DISTRICT (`nh:special:north-haverhill-water-and-light-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTH SWANZEY WATER AND FIRE PRECINCT (`nh:special:north-swanzey-water-and-fire-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTH WALPOLE VILLAGE DISTRICT (`nh:special:north-walpole-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTHFIELD SEWER DISTRICT (`nh:special:northfield-sewer-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTHUMBERLAND HOUSING AUTHORITY (`nh:special:northumberland-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTHWOOD RIDGE WATER DISTRICT (`nh:special:northwood-ridge-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ORFORD VILLAGE DISTRICT (`nh:special:orford-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| OSSIPEE CORNER LIGHT AND POWER PRECINCT (`nh:special:ossipee-corner-light-and-power-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PEMI-BAKER SOLID WASTE DISTRICT (`nh:special:pemi-baker-solid-waste-district`) | SPECIAL_DISTRICT | http://www.pbswd.herobo.com/ | SOURCE_DISCOVERY_OWED |
| PENACOOK BOSCAWEN WATER PRECINCT (`nh:special:penacook-boscawen-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PERRY LANE LIGHTING DISTRICT (`nh:special:perry-lane-lighting-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PILLSBURY LAKE VILLAGE DISTRICT (`nh:special:pillsbury-lake-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PLAINFIELD VILLAGE WATER DISTRICT (`nh:special:plainfield-village-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PLYMOUTH VILLAGE WATER AND SEWER DISTRICT (`nh:special:plymouth-village-water-and-sewer-district`) | SPECIAL_DISTRICT | http://www.pvwsd.org | SOURCE_DISCOVERY_OWED |
| PORTSMOUTH HOUSING AUTHORITY (`nh:special:portsmouth-housing-authority`) | SPECIAL_DISTRICT | http://www.porthousing.org | SOURCE_DISCOVERY_OWED |
| REDSTONE FIRE DISTRICT (`nh:special:redstone-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ROCHESTER HOUSING AUTHORITY (`nh:special:rochester-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ROCKINGHAM COUNTY CONSERVATION DISTRICT (`nh:special:rockingham-county-conservation-district`) | SPECIAL_DISTRICT | http://WWW.ROCKINGHAMCCD.ORG | SOURCE_DISCOVERY_OWED |
| ROLLINSFORD WATER AND SEWER DISTRICT (`nh:special:rollinsford-water-and-sewer-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RYE BEACH PRECINCT (`nh:special:rye-beach-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RYE WATER DISTRICT (`nh:special:rye-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SALEM HOUSING AUTHORITY (`nh:special:salem-housing-authority`) | SPECIAL_DISTRICT | http://www.salemhanh.org | SOURCE_DISCOVERY_OWED |
| SANBORNVILLE WATER PRECINCT (`nh:special:sanbornville-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SAWYER LAKE VILLAGE DISTRICT (`nh:special:sawyer-lake-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SEABROOK BEACH VILLAGE DISTRICT (`nh:special:seabrook-beach-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SEABROOK HOUSING AUTHORITY (`nh:special:seabrook-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SOMERSWORTH HOUSING AUTHORITY (`nh:special:somersworth-housing-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SOUTH MAIN STREET WATER DISTRICT (`nh:special:south-main-street-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SOUTHEAST REGIONAL REFUSE DISPOSAL DISTRICT (`nh:special:southeast-regional-refuse-disposal-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SPOFFORD FIRE DISTRICT (`nh:special:spofford-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| STAFFORD COUNTY SOIL CONSERVATION DISTRICT (`nh:special:stafford-county-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.straffordccd.org | SOURCE_DISCOVERY_OWED |
| SULLIVAN COUNTY CONSERVATION DISTRICT (`nh:special:sullivan-county-conservation-district`) | SPECIAL_DISTRICT | http://www.sullivancountynh.gov | SOURCE_DISCOVERY_OWED |
| SUNRAY SHORES WATER DISTRICT (`nh:special:sunray-shores-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SUNRISE LAKE VILLAGE DISTRICT (`nh:special:sunrise-lake-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SWAINS LAKE VILLAGE WATER DISTRICT (`nh:special:swains-lake-village-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TILTON NORTHFIELD FIRE DISTRICT (`nh:special:tilton-northfield-fire-district`) | SPECIAL_DISTRICT | http://www.tnfd.org | SOURCE_DISCOVERY_OWED |
| TILTON NORTHFIELD WATER PRECINCT (`nh:special:tilton-northfield-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WALPOLE FIRE DISTRICT (`nh:special:walpole-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WARNER VILLAGE WATER DISTRICT (`nh:special:warner-village-water-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WATERVILLE ESTATES VILLAGE DISTRICT (`nh:special:waterville-estates-village-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WEST OSSIPEE FIRE PRECINCT (`nh:special:west-ossipee-fire-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WEST STEWARTSTOWN WATER PRECINCT (`nh:special:west-stewartstown-water-precinct`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODSVILLE FIRE DISTRICT (`nh:special:woodsville-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| New Hampshire (`nh:state:new-hampshire`) | STATE | none recorded | NO_MEETINGS_SOURCE_RECORDED |

### NJ: 1401 of 1401

| Jurisdiction | Class | Website | Basis |
| --- | --- | --- | --- |
| BOROUGH OF ALLENDALE (`nj:city:borough-of-allendale`) | CITY_OR_TOWN | http://www.allendalenj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ALLENHURST (`nj:city:borough-of-allenhurst`) | CITY_OR_TOWN | http://www.allenhurstnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ALLENTOWN (`nj:city:borough-of-allentown`) | CITY_OR_TOWN | http://www.allentownnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ALPHA (`nj:city:borough-of-alpha`) | CITY_OR_TOWN | http://www.alphaboro.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ALPINE (`nj:city:borough-of-alpine`) | CITY_OR_TOWN | http://www.alpinenj0760.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ANDOVER (`nj:city:borough-of-andover`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF ATLANTIC HIGHLANDS (`nj:city:borough-of-atlantic-highlands`) | CITY_OR_TOWN | http://WWW.AHNJ.COM | SOURCE_DISCOVERY_OWED |
| BOROUGH OF AUDUBON (`nj:city:borough-of-audubon`) | CITY_OR_TOWN | http://www.boroughofauclubor.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF AUDUBON PARK (`nj:city:borough-of-audubon-park`) | CITY_OR_TOWN | http://www.audubonparknj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF AVALON (`nj:city:borough-of-avalon`) | CITY_OR_TOWN | http://WWW.AVALONBORO.ORG | SOURCE_DISCOVERY_OWED |
| BOROUGH OF AVON BY THE SEA (`nj:city:borough-of-avon-by-the-sea`) | CITY_OR_TOWN | http://www.avonbytheseanj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BARNEGAT LIGHT (`nj:city:borough-of-barnegat-light`) | CITY_OR_TOWN | http://www.barnegatlight.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BARRINGTON (`nj:city:borough-of-barrington`) | CITY_OR_TOWN | http://www.barringtonboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BAY HEAD (`nj:city:borough-of-bay-head`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF BEACH HAVEN (`nj:city:borough-of-beach-haven`) | CITY_OR_TOWN | http://www.beachhavennj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BEACHWOOD (`nj:city:borough-of-beachwood`) | CITY_OR_TOWN | http://www.beachwoodusa.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BELLMAWR (`nj:city:borough-of-bellmawr`) | CITY_OR_TOWN | http://www.bellmawr.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BELMAR (`nj:city:borough-of-belmar`) | CITY_OR_TOWN | http://www.belmar.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BERGENFIELD (`nj:city:borough-of-bergenfield`) | CITY_OR_TOWN | http://www.bergenfieldboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BERLIN (`nj:city:borough-of-berlin`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF BERNARDSVILLE (`nj:city:borough-of-bernardsville`) | CITY_OR_TOWN | http://www.bernardsvilleboro.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BLOOMINGDALE (`nj:city:borough-of-bloomingdale`) | CITY_OR_TOWN | http://www.bloomingdalenj.net | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BLOOMSBURY (`nj:city:borough-of-bloomsbury`) | CITY_OR_TOWN | http://www.bloomsburynewjersey.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BOGOTA (`nj:city:borough-of-bogota`) | CITY_OR_TOWN | http://www.bogotaonline.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BOUND BROOK (`nj:city:borough-of-bound-brook`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF BRADLEY BEACH (`nj:city:borough-of-bradley-beach`) | CITY_OR_TOWN | http://www.bradleybeachonline.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BRANCHVILLE (`nj:city:borough-of-branchville`) | CITY_OR_TOWN | http://www.use.the.state | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BRIELLE (`nj:city:borough-of-brielle`) | CITY_OR_TOWN | http://www.brielln.j.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BROOKLAWN (`nj:city:borough-of-brooklawn`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF BUENA (`nj:city:borough-of-buena`) | CITY_OR_TOWN | http://www.buenaboro.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF BUTLER (`nj:city:borough-of-butler`) | CITY_OR_TOWN | http://WWW.BUTLERBOROUGH.COM | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CALDWELL (`nj:city:borough-of-caldwell`) | CITY_OR_TOWN | http://www.caldwell-nj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CALIFON (`nj:city:borough-of-califon`) | CITY_OR_TOWN | http://www.califonboro.net | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CAPE MAY POINT (`nj:city:borough-of-cape-may-point`) | CITY_OR_TOWN | http://www.capemaypoint.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CARLSTADT (`nj:city:borough-of-carlstadt`) | CITY_OR_TOWN | http://www.carlstadtnj.us | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CARTERET (`nj:city:borough-of-carteret`) | CITY_OR_TOWN | http://www.ci.carteret.nj.us/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CHATHAM (`nj:city:borough-of-chatham`) | CITY_OR_TOWN | http://www.chathamborough.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CHESILHURST (`nj:city:borough-of-chesilhurst`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF CHESTER (`nj:city:borough-of-chester`) | CITY_OR_TOWN | http://WWW.CHESTERBOROUGH.ORG | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CLAYTON (`nj:city:borough-of-clayton`) | CITY_OR_TOWN | http://www.claytonnj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CLEMENTON (`nj:city:borough-of-clementon`) | CITY_OR_TOWN | http://www.clementonborough.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CLIFFSIDE PARK (`nj:city:borough-of-cliffside-park`) | CITY_OR_TOWN | http://www.cliffsideparknj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CLOSTER (`nj:city:borough-of-closter`) | CITY_OR_TOWN | http://www.closterboro.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF COLLINGSWOOD (`nj:city:borough-of-collingswood`) | CITY_OR_TOWN | http://WWW.COLLINGSWOOD.COM | SOURCE_DISCOVERY_OWED |
| BOROUGH OF CRESSKILL (`nj:city:borough-of-cresskill`) | CITY_OR_TOWN | http://www.cresskillboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF DEAL (`nj:city:borough-of-deal`) | CITY_OR_TOWN | http://www.dealborough.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF DEMAREST (`nj:city:borough-of-demarest`) | CITY_OR_TOWN | http://www.demarestnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF DUMONT (`nj:city:borough-of-dumont`) | CITY_OR_TOWN | http://www.dumontnj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF DUNELLEN (`nj:city:borough-of-dunellen`) | CITY_OR_TOWN | http://www.dunellenborough.net | SOURCE_DISCOVERY_OWED |
| BOROUGH OF EAST NEWARK (`nj:city:borough-of-east-newark`) | CITY_OR_TOWN | http://www.boroughofeastnewark.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF EAST RUTHERFORD (`nj:city:borough-of-east-rutherford`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF EATONTOWN (`nj:city:borough-of-eatontown`) | CITY_OR_TOWN | http://www.eatontownnj.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF EDGEWATER (`nj:city:borough-of-edgewater`) | CITY_OR_TOWN | http://www.edgewaternj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ELMER (`nj:city:borough-of-elmer`) | CITY_OR_TOWN | http://www.elmerboroughnj.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ELMWOOD PARK (`nj:city:borough-of-elmwood-park`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF EMERSON (`nj:city:borough-of-emerson`) | CITY_OR_TOWN | http://www.emersonnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ENGLEWOOD CLIFFS (`nj:city:borough-of-englewood-cliffs`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF ENGLISHTOWN (`nj:city:borough-of-englishtown`) | CITY_OR_TOWN | http://www.englishtownnj.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ESSEX FELLS (`nj:city:borough-of-essex-fells`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF FAIR HAVEN (`nj:city:borough-of-fair-haven`) | CITY_OR_TOWN | http://www.fairhavennj.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FAIR LAWN (`nj:city:borough-of-fair-lawn`) | CITY_OR_TOWN | http://www.fairlawn.edu | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FAIRVIEW (`nj:city:borough-of-fairview`) | CITY_OR_TOWN | http://www.fairviewborough.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FANWOOD (`nj:city:borough-of-fanwood`) | CITY_OR_TOWN | http://www.fanwoodnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FAR HILLS (`nj:city:borough-of-far-hills`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF FARMINGDALE (`nj:city:borough-of-farmingdale`) | CITY_OR_TOWN | http://www.farmingdaleborough.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FIELDSBORO (`nj:city:borough-of-fieldsboro`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF FLEMINGTON (`nj:city:borough-of-flemington`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF FLORHAM PARK (`nj:city:borough-of-florham-park`) | CITY_OR_TOWN | http://www.florhamparkboro.net/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FOLSOM (`nj:city:borough-of-folsom`) | CITY_OR_TOWN | http://www.folsomborough.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FORT LEE (`nj:city:borough-of-fort-lee`) | CITY_OR_TOWN | http://www.fortleenj.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FRANKLIN (`nj:city:borough-of-franklin`) | CITY_OR_TOWN | http://www.franklinboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FRANKLIN LAKES (`nj:city:borough-of-franklin-lakes`) | CITY_OR_TOWN | http://www.franklinlakes.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF FREEHOLD (`nj:city:borough-of-freehold`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF FRENCHTOWN (`nj:city:borough-of-frenchtown`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF GARWOOD (`nj:city:borough-of-garwood`) | CITY_OR_TOWN | http://garwood.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF GIBBSBORO (`nj:city:borough-of-gibbsboro`) | CITY_OR_TOWN | http://www.gibbsboro.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF GLASSBORO (`nj:city:borough-of-glassboro`) | CITY_OR_TOWN | http://www.glassboroonline.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF GLEN GARDNER (`nj:city:borough-of-glen-gardner`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF GLEN RIDGE (`nj:city:borough-of-glen-ridge`) | CITY_OR_TOWN | http://www.glenridgenj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF GLEN ROCK (`nj:city:borough-of-glen-rock`) | CITY_OR_TOWN | http://glenrocknj.net/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HADDON HEIGHTS (`nj:city:borough-of-haddon-heights`) | CITY_OR_TOWN | http://www.haddonhts.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HADDONFIELD (`nj:city:borough-of-haddonfield`) | CITY_OR_TOWN | http://www.haddonfieldnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HALEDON (`nj:city:borough-of-haledon`) | CITY_OR_TOWN | http://www.holedonboronj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HAMBURG (`nj:city:borough-of-hamburg`) | CITY_OR_TOWN | http://www.hamburgnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HAMPTON (`nj:city:borough-of-hampton`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF HARRINGTON PARK (`nj:city:borough-of-harrington-park`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF HARVEY CEDARS (`nj:city:borough-of-harvey-cedars`) | CITY_OR_TOWN | http://www.harveycedars.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HASBROUCK HEIGHTS (`nj:city:borough-of-hasbrouck-heights`) | CITY_OR_TOWN | http://WWW.HASBROUCK-HEIGHTS.NJ.US | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HAWORTH (`nj:city:borough-of-haworth`) | CITY_OR_TOWN | http://www.haworthnj.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HAWTHORNE (`nj:city:borough-of-hawthorne`) | CITY_OR_TOWN | http://www.hawthronenj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HELMETTA (`nj:city:borough-of-helmetta`) | CITY_OR_TOWN | http://www.helmettaboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HI NELLA (`nj:city:borough-of-hi-nella`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF HIGH BRIDGE (`nj:city:borough-of-high-bridge`) | CITY_OR_TOWN | http://www.highbridge.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HIGHLAND PARK (`nj:city:borough-of-highland-park`) | CITY_OR_TOWN | http://www.hpboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HIGHLANDS (`nj:city:borough-of-highlands`) | CITY_OR_TOWN | http://www.highlandsnj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HIGHTSTOWN (`nj:city:borough-of-hightstown`) | CITY_OR_TOWN | http://www.hightstownborough.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HILLSDALE (`nj:city:borough-of-hillsdale`) | CITY_OR_TOWN | http://www.hillsdalenj.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HO-HO-KUS (`nj:city:borough-of-ho-ho-kus`) | CITY_OR_TOWN | http://www.ho-ho-kusboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HOPATCONG (`nj:city:borough-of-hopatcong`) | CITY_OR_TOWN | http://www.hopatcong.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF HOPEWELL (`nj:city:borough-of-hopewell`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF INTERLAKEN (`nj:city:borough-of-interlaken`) | CITY_OR_TOWN | http://www.interlakenboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ISLAND HEIGHTS (`nj:city:borough-of-island-heights`) | CITY_OR_TOWN | http://www.islandheightsgov.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF JAMESBURG (`nj:city:borough-of-jamesburg`) | CITY_OR_TOWN | http://www.jamesburgborough.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF KEANSBURG (`nj:city:borough-of-keansburg`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF KENILWORTH (`nj:city:borough-of-kenilworth`) | CITY_OR_TOWN | http://www.kenilworthborough.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF KEYPORT (`nj:city:borough-of-keyport`) | CITY_OR_TOWN | http://www.keyportonline.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF KINNELON (`nj:city:borough-of-kinnelon`) | CITY_OR_TOWN | http://www.kinnelonboro.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LAKE COMO (`nj:city:borough-of-lake-como`) | CITY_OR_TOWN | http://lakecomonj.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LAKEHURST (`nj:city:borough-of-lakehurst`) | CITY_OR_TOWN | http://www.lakehurstnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LAUREL SPRINGS (`nj:city:borough-of-laurel-springs`) | CITY_OR_TOWN | http://www.laurelsprings-nj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LAVALLETTE (`nj:city:borough-of-lavallette`) | CITY_OR_TOWN | http://LAVALLETTEBORO.COM | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LAWNSIDE (`nj:city:borough-of-lawnside`) | CITY_OR_TOWN | http://LAWNSIDE.NET | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LEBANON (`nj:city:borough-of-lebanon`) | CITY_OR_TOWN | http://www.lebanonboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LEONIA (`nj:city:borough-of-leonia`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF LINCOLN PARK (`nj:city:borough-of-lincoln-park`) | CITY_OR_TOWN | http://www.lincolnpark.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LINDENWOLD (`nj:city:borough-of-lindenwold`) | CITY_OR_TOWN | http://www.lindenwoldnj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LITTLE FERRY (`nj:city:borough-of-little-ferry`) | CITY_OR_TOWN | http://www.littleferrynj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF LITTLE SILVER (`nj:city:borough-of-little-silver`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF LODI (`nj:city:borough-of-lodi`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF LONGPORT (`nj:city:borough-of-longport`) | CITY_OR_TOWN | http://www.longportnj.us/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MADISON (`nj:city:borough-of-madison`) | CITY_OR_TOWN | http://www.rosenet.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MAGNOLIA (`nj:city:borough-of-magnolia`) | CITY_OR_TOWN | http://WWW.MAGNOLIA-NJ.ORG. | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MANASQUAN (`nj:city:borough-of-manasquan`) | CITY_OR_TOWN | http://www.manasquannj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MANTOLOKING (`nj:city:borough-of-mantoloking`) | CITY_OR_TOWN | http://www.mantoloking.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MANVILLE (`nj:city:borough-of-manville`) | CITY_OR_TOWN | http://www.manvillenj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MATAWAN (`nj:city:borough-of-matawan`) | CITY_OR_TOWN | http://www.matawahborough.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MAYWOOD (`nj:city:borough-of-maywood`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF MEDFORD LAKES (`nj:city:borough-of-medford-lakes`) | CITY_OR_TOWN | http://www.medfordlakes.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MENDHAM (`nj:city:borough-of-mendham`) | CITY_OR_TOWN | http://WWW.MENDHAMNJ.ORG | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MERCHANTVILLE (`nj:city:borough-of-merchantville`) | CITY_OR_TOWN | http://www.merchantvillenj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF METUCHEN (`nj:city:borough-of-metuchen`) | CITY_OR_TOWN | http://www.metuchennj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MIDDLESEX (`nj:city:borough-of-middlesex`) | CITY_OR_TOWN | http://www.middlesexboronj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MIDLAND PARK (`nj:city:borough-of-midland-park`) | CITY_OR_TOWN | http://www.mpnj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MILFORD (`nj:city:borough-of-milford`) | CITY_OR_TOWN | http://www.milfordnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MILLSTONE (`nj:city:borough-of-millstone`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF MILLTOWN (`nj:city:borough-of-milltown`) | CITY_OR_TOWN | http://www.milltownnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MONMOUTH BEACH (`nj:city:borough-of-monmouth-beach`) | CITY_OR_TOWN | http://www.monmouthbeach.us | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MONTVALE (`nj:city:borough-of-montvale`) | CITY_OR_TOWN | http://www.montvale.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MOONACHIE (`nj:city:borough-of-moonachie`) | CITY_OR_TOWN | http://WWW.MOONACHIE.NET | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MORRIS PLAINS (`nj:city:borough-of-morris-plains`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF MOUNT ARLINGTON (`nj:city:borough-of-mount-arlington`) | CITY_OR_TOWN | http://www.ci.mount-arlington.nj.us/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MOUNT EPHRAIM (`nj:city:borough-of-mount-ephraim`) | CITY_OR_TOWN | http://www.mountephraim-nj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MOUNTAIN LAKES (`nj:city:borough-of-mountain-lakes`) | CITY_OR_TOWN | http://www.mtnlakes.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF MOUNTAINSIDE (`nj:city:borough-of-mountainside`) | CITY_OR_TOWN | http://www.mountainside-nj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NATIONAL PARK (`nj:city:borough-of-national-park`) | CITY_OR_TOWN | http://www.nationalparknj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NEPTUNE CITY (`nj:city:borough-of-neptune-city`) | CITY_OR_TOWN | http://www.neptunecitynj.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NETCONG (`nj:city:borough-of-netcong`) | CITY_OR_TOWN | http://www.netcong.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NEW MILFORD (`nj:city:borough-of-new-milford`) | CITY_OR_TOWN | http://www.newmilfordboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NEW PROVIDENCE (`nj:city:borough-of-new-providence`) | CITY_OR_TOWN | http://www.newprov.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NEWFIELD (`nj:city:borough-of-newfield`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF NORTH ARLINGTON (`nj:city:borough-of-north-arlington`) | CITY_OR_TOWN | http://www.northarlington.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NORTH CALDWELL (`nj:city:borough-of-north-caldwell`) | CITY_OR_TOWN | http://WWW.NORTHCALDWELL.ORG | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NORTH HALEDON (`nj:city:borough-of-north-haledon`) | CITY_OR_TOWN | http://www.northhaledon.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NORTH PLAINFIELD (`nj:city:borough-of-north-plainfield`) | CITY_OR_TOWN | http://www.northplainfield.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF NORTHVALE (`nj:city:borough-of-northvale`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF NORWOOD (`nj:city:borough-of-norwood`) | CITY_OR_TOWN | http://www.norwoodboro.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF OAKLAND (`nj:city:borough-of-oakland`) | CITY_OR_TOWN | http://OAKLAND-NJ.ORG | SOURCE_DISCOVERY_OWED |
| BOROUGH OF OAKLYN (`nj:city:borough-of-oaklyn`) | CITY_OR_TOWN | http://www.oaklyn-nj.net | SOURCE_DISCOVERY_OWED |
| BOROUGH OF OCEAN GATE (`nj:city:borough-of-ocean-gate`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF OCEANPORT (`nj:city:borough-of-oceanport`) | CITY_OR_TOWN | http://www.oceanportboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF OGDENSBURG (`nj:city:borough-of-ogdensburg`) | CITY_OR_TOWN | http://www.ogdensburgnij.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF OLD TAPPAN (`nj:city:borough-of-old-tappan`) | CITY_OR_TOWN | http://oldtappan.net/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ORADELL (`nj:city:borough-of-oradell`) | CITY_OR_TOWN | http://www.oradell.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF PALISADES PARK (`nj:city:borough-of-palisades-park`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF PALMYRA (`nj:city:borough-of-palmyra`) | CITY_OR_TOWN | http://www.boroughofpalmyra.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF PARAMUS (`nj:city:borough-of-paramus`) | CITY_OR_TOWN | http://www.paramusborough.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF PARK RIDGE (`nj:city:borough-of-park-ridge`) | CITY_OR_TOWN | http://www.parkridgeboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF PAULSBORO (`nj:city:borough-of-paulsboro`) | CITY_OR_TOWN | http://www.paulsboronj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF PEAPACK AND GLADSTONE (`nj:city:borough-of-peapack-and-gladstone`) | CITY_OR_TOWN | http://www.pgborough.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF PEMBERTON (`nj:city:borough-of-pemberton`) | CITY_OR_TOWN | http://www.pembertonborough.us | SOURCE_DISCOVERY_OWED |
| BOROUGH OF PENNINGTON (`nj:city:borough-of-pennington`) | CITY_OR_TOWN | http://WWW.PENNINGTONBORO.ORG | SOURCE_DISCOVERY_OWED |
| BOROUGH OF PENNS GROVE (`nj:city:borough-of-penns-grove`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF PINE BEACH (`nj:city:borough-of-pine-beach`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF PINE HILL (`nj:city:borough-of-pine-hill`) | CITY_OR_TOWN | http://www.pinehillboronj.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF PITMAN (`nj:city:borough-of-pitman`) | CITY_OR_TOWN | http://www.pitman.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF POINT PLEASANT (`nj:city:borough-of-point-pleasant`) | CITY_OR_TOWN | http://www.ptboro.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF POINT PLEASANT BEACH (`nj:city:borough-of-point-pleasant-beach`) | CITY_OR_TOWN | http://WWW.POINTPLEASANTBEACH.ORG | SOURCE_DISCOVERY_OWED |
| BOROUGH OF POMPTON LAKES (`nj:city:borough-of-pompton-lakes`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF PROSPECT PARK (`nj:city:borough-of-prospect-park`) | CITY_OR_TOWN | http://www.prospectpark.net | SOURCE_DISCOVERY_OWED |
| BOROUGH OF RAMSEY (`nj:city:borough-of-ramsey`) | CITY_OR_TOWN | http://www.ramseynj.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF RARITAN (`nj:city:borough-of-raritan`) | CITY_OR_TOWN | http://www.raritanboro.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF RED BANK (`nj:city:borough-of-red-bank`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF RIDGEFIELD (`nj:city:borough-of-ridgefield`) | CITY_OR_TOWN | http://www.ridgefieldnj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF RINGWOOD (`nj:city:borough-of-ringwood`) | CITY_OR_TOWN | http://www.ringwoodnj.net/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF RIVER EDGE (`nj:city:borough-of-river-edge`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF RIVERDALE (`nj:city:borough-of-riverdale`) | CITY_OR_TOWN | http://www.riverdalenj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF RIVERTON (`nj:city:borough-of-riverton`) | CITY_OR_TOWN | http://www.riverton-nj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ROCKAWAY (`nj:city:borough-of-rockaway`) | CITY_OR_TOWN | http://www.rockawayborough.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ROCKLEIGH (`nj:city:borough-of-rockleigh`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF ROCKY HILL (`nj:city:borough-of-rocky-hill`) | CITY_OR_TOWN | http://www.rockyhillnj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ROOSEVELT (`nj:city:borough-of-roosevelt`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF ROSELAND (`nj:city:borough-of-roseland`) | CITY_OR_TOWN | http://www.roselandny.net | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ROSELLE (`nj:city:borough-of-roselle`) | CITY_OR_TOWN | http://www.boroughofroselle.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF ROSELLE PARK (`nj:city:borough-of-roselle-park`) | CITY_OR_TOWN | http://www.rosellepark.net/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF RUMSON (`nj:city:borough-of-rumson`) | CITY_OR_TOWN | http://www.rumsonnj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF RUNNEMEDE (`nj:city:borough-of-runnemede`) | CITY_OR_TOWN | http://www.runnemedenj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF RUTHERFORD (`nj:city:borough-of-rutherford`) | CITY_OR_TOWN | http://www.rutherford-nj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SADDLE RIVER (`nj:city:borough-of-saddle-river`) | CITY_OR_TOWN | http://www.saddleriver.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SAYREVILLE (`nj:city:borough-of-sayreville`) | CITY_OR_TOWN | http://www.sayreville.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SEA BRIGHT (`nj:city:borough-of-sea-bright`) | CITY_OR_TOWN | http://www.seabrightnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SEA GIRT (`nj:city:borough-of-sea-girt`) | CITY_OR_TOWN | http://www.seagirtboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SEASIDE HEIGHTS (`nj:city:borough-of-seaside-heights`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF SEASIDE PARK (`nj:city:borough-of-seaside-park`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF SHILOH (`nj:city:borough-of-shiloh`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF SHIP BOTTOM (`nj:city:borough-of-ship-bottom`) | CITY_OR_TOWN | http://WWW.SHIPBOTTOM.ORG | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SHREWSBURY (`nj:city:borough-of-shrewsbury`) | CITY_OR_TOWN | http://www.shrewsburyboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SOMERDALE (`nj:city:borough-of-somerdale`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF SOMERVILLE (`nj:city:borough-of-somerville`) | CITY_OR_TOWN | http://WWW.SOMERVILLENJ.ORG | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SOUTH BOUND BROOK (`nj:city:borough-of-south-bound-brook`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF SOUTH PLAINFIELD (`nj:city:borough-of-south-plainfield`) | CITY_OR_TOWN | http://www.southplainfieldnj.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SOUTH RIVER (`nj:city:borough-of-south-river`) | CITY_OR_TOWN | http://www.southrivernj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SOUTH TOMS RIVER (`nj:city:borough-of-south-toms-river`) | CITY_OR_TOWN | http://www.southtomsrivernj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SPOTSWOOD (`nj:city:borough-of-spotswood`) | CITY_OR_TOWN | http://WWW.SPOTSWOODBORO.COM | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SPRING LAKE (`nj:city:borough-of-spring-lake`) | CITY_OR_TOWN | http://www.springlakeboro.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SPRING LAKE HEIGHTS (`nj:city:borough-of-spring-lake-heights`) | CITY_OR_TOWN | http://www.springlakehts.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF STANHOPE (`nj:city:borough-of-stanhope`) | CITY_OR_TOWN | http://www.stanhopenj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF STOCKTON (`nj:city:borough-of-stockton`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF STONE HARBOR (`nj:city:borough-of-stone-harbor`) | CITY_OR_TOWN | http://www.stone-harborinj.us | SOURCE_DISCOVERY_OWED |
| BOROUGH OF STRATFORD (`nj:city:borough-of-stratford`) | CITY_OR_TOWN | http://www.stratfordnj.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SURF CITY (`nj:city:borough-of-surf-city`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF SUSSEX (`nj:city:borough-of-sussex`) | CITY_OR_TOWN | http://www.sussexboro.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF SWEDESBORO (`nj:city:borough-of-swedesboro`) | CITY_OR_TOWN | http://www.swedesboro-nj.us | SOURCE_DISCOVERY_OWED |
| BOROUGH OF TAVISTOCK (`nj:city:borough-of-tavistock`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF TENAFLY (`nj:city:borough-of-tenafly`) | CITY_OR_TOWN | http://www.tenaflynj.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF TETERBORO (`nj:city:borough-of-teterboro`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF TINTON FALLS (`nj:city:borough-of-tinton-falls`) | CITY_OR_TOWN | http://WWW.TINTONFALLS.COM | SOURCE_DISCOVERY_OWED |
| BOROUGH OF TOTOWA (`nj:city:borough-of-totowa`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF TUCKERTON (`nj:city:borough-of-tuckerton`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF UNION BEACH (`nj:city:borough-of-union-beach`) | CITY_OR_TOWN | http://www.unionbeach.net | SOURCE_DISCOVERY_OWED |
| BOROUGH OF UPPER SADDLE RIVER (`nj:city:borough-of-upper-saddle-river`) | CITY_OR_TOWN | http://www.usrtoday.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF VICTORY GARDENS (`nj:city:borough-of-victory-gardens`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF WALDWICK (`nj:city:borough-of-waldwick`) | CITY_OR_TOWN | http://www.waldwickpd.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WALLINGTON (`nj:city:borough-of-wallington`) | CITY_OR_TOWN | http://www.wallingtonnj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WANAQUE (`nj:city:borough-of-wanaque`) | CITY_OR_TOWN | http://www.wanaqueborough.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WASHINGTON (`nj:city:borough-of-washington`) | CITY_OR_TOWN | http://www.washingtonboro-nj.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WATCHUNG (`nj:city:borough-of-watchung`) | CITY_OR_TOWN | http://watchungnj.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WENONAH (`nj:city:borough-of-wenonah`) | CITY_OR_TOWN | http://www.boroughofwenonah.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WEST CAPE MAY (`nj:city:borough-of-west-cape-may`) | CITY_OR_TOWN | http://www.westcapemay.us | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WEST LONG BRANCH (`nj:city:borough-of-west-long-branch`) | CITY_OR_TOWN | http://www.westlongbranch.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WEST WILDWOOD (`nj:city:borough-of-west-wildwood`) | CITY_OR_TOWN | http://www.westwildwoodnj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WESTVILLE (`nj:city:borough-of-westville`) | CITY_OR_TOWN | http://www.westvillenj.com | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WESTWOOD (`nj:city:borough-of-westwood`) | CITY_OR_TOWN | http://www.westwoodnj.gov | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WHARTON (`nj:city:borough-of-wharton`) | CITY_OR_TOWN | http://www.whartonnj.com/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WILDWOOD CREST (`nj:city:borough-of-wildwood-crest`) | CITY_OR_TOWN | http://www.wildwoodcrest.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WOOD RIDGE (`nj:city:borough-of-wood-ridge`) | CITY_OR_TOWN | http://www.wood-ridgenj.org/ | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WOODBINE (`nj:city:borough-of-woodbine`) | CITY_OR_TOWN | http://www.boroughofwoodbine.net | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WOODBURY HEIGHTS (`nj:city:borough-of-woodbury-heights`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF WOODCLIFF LAKE (`nj:city:borough-of-woodcliff-lake`) | CITY_OR_TOWN | http://WWW.WCLNJ.COM | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WOODLAND PARK (`nj:city:borough-of-woodland-park`) | CITY_OR_TOWN | http://www.wpnj.us | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WOODLYNNE (`nj:city:borough-of-woodlynne`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BOROUGH OF WOODSTOWN (`nj:city:borough-of-woodstown`) | CITY_OR_TOWN | http://www.historicwoodstown.org | SOURCE_DISCOVERY_OWED |
| BOROUGH OF WRIGHTSTOWN (`nj:city:borough-of-wrightstown`) | CITY_OR_TOWN | http://www.wrightstownnj.org | SOURCE_DISCOVERY_OWED |
| CITY OF ABSECON (`nj:city:city-of-absecon`) | CITY_OR_TOWN | http://www.abseconnewjersey.org | SOURCE_DISCOVERY_OWED |
| CITY OF ASBURY PARK (`nj:city:city-of-asbury-park`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CITY OF ATLANTIC CITY (`nj:city:city-of-atlantic-city`) | CITY_OR_TOWN | http://www.cityofatlanticcity.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF BAYONNE (`nj:city:city-of-bayonne`) | CITY_OR_TOWN | http://www.bayonnenj.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF BEVERLY (`nj:city:city-of-beverly`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CITY OF BORDENTOWN (`nj:city:city-of-bordentown`) | CITY_OR_TOWN | http://www.cityofbordentown.com | SOURCE_DISCOVERY_OWED |
| CITY OF BRIDGETON (`nj:city:city-of-bridgeton`) | CITY_OR_TOWN | http://www.city.of.bridgeton.com | SOURCE_DISCOVERY_OWED |
| CITY OF BRIGANTINE (`nj:city:city-of-brigantine`) | CITY_OR_TOWN | http://www.brigantinebeachnj.com | SOURCE_DISCOVERY_OWED |
| CITY OF BURLINGTON (`nj:city:city-of-burlington`) | CITY_OR_TOWN | http://www.burlingtonnj.us | SOURCE_DISCOVERY_OWED |
| CITY OF CAMDEN (`nj:city:city-of-camden`) | CITY_OR_TOWN | http://www.ci.camden.nj.us/ | SOURCE_DISCOVERY_OWED |
| CITY OF CAPE MAY (`nj:city:city-of-cape-may`) | CITY_OR_TOWN | http://www.capemaycity.com/ | SOURCE_DISCOVERY_OWED |
| CITY OF CLIFTON (`nj:city:city-of-clifton`) | CITY_OR_TOWN | http://www.cliftonnj.org | SOURCE_DISCOVERY_OWED |
| CITY OF CORBIN CITY (`nj:city:city-of-corbin-city`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CITY OF EAST ORANGE (`nj:city:city-of-east-orange`) | CITY_OR_TOWN | http://www.eastorange-nj.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF EGG HARBOR (`nj:city:city-of-egg-harbor`) | CITY_OR_TOWN | http://EGGHARBORCITY.ORG | SOURCE_DISCOVERY_OWED |
| CITY OF ELIZABETH (`nj:city:city-of-elizabeth`) | CITY_OR_TOWN | http://www.elizabethnj.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF ENGLEWOOD (`nj:city:city-of-englewood`) | CITY_OR_TOWN | http://www.cityofenglewood.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF ESTELL MANOR (`nj:city:city-of-estell-manor`) | CITY_OR_TOWN | http://www.estellmanor.org | SOURCE_DISCOVERY_OWED |
| CITY OF GARFIELD (`nj:city:city-of-garfield`) | CITY_OR_TOWN | http://www.garfieldnj.org | SOURCE_DISCOVERY_OWED |
| CITY OF GLOUCESTER CITY (`nj:city:city-of-gloucester-city`) | CITY_OR_TOWN | http://www.cityofglovcester.org | SOURCE_DISCOVERY_OWED |
| CITY OF HACKENSACK (`nj:city:city-of-hackensack`) | CITY_OR_TOWN | http://www.hackensack.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF HOBOKEN (`nj:city:city-of-hoboken`) | CITY_OR_TOWN | http://www.hobokennj.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF JERSEY CITY (`nj:city:city-of-jersey-city`) | CITY_OR_TOWN | http://www.jerseycitynj.gov | SOURCE_DISCOVERY_OWED |
| CITY OF LAMBERTVILLE (`nj:city:city-of-lambertville`) | CITY_OR_TOWN | http://www.lambertvillenj.org | SOURCE_DISCOVERY_OWED |
| CITY OF LINDEN (`nj:city:city-of-linden`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CITY OF LINWOOD (`nj:city:city-of-linwood`) | CITY_OR_TOWN | http://www.linwoodcity.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF LONG BRANCH (`nj:city:city-of-long-branch`) | CITY_OR_TOWN | http://www.visitlongbranch.com | SOURCE_DISCOVERY_OWED |
| CITY OF MARGATE (`nj:city:city-of-margate`) | CITY_OR_TOWN | http://WWW.MARGATE-NJ.COM | SOURCE_DISCOVERY_OWED |
| CITY OF MILLVILLE (`nj:city:city-of-millville`) | CITY_OR_TOWN | http://www.millvillenj.gov | SOURCE_DISCOVERY_OWED |
| CITY OF NEW BRUNSWICK (`nj:city:city-of-new-brunswick`) | CITY_OR_TOWN | http://www.cityofnewbrunswick.org | SOURCE_DISCOVERY_OWED |
| CITY OF NEWARK (`nj:city:city-of-newark`) | CITY_OR_TOWN | http://www.ci.newark.nj.us | SOURCE_DISCOVERY_OWED |
| CITY OF NORTH WILDWOOD (`nj:city:city-of-north-wildwood`) | CITY_OR_TOWN | http://www.northwildwood.com | SOURCE_DISCOVERY_OWED |
| CITY OF NORTHFIELD (`nj:city:city-of-northfield`) | CITY_OR_TOWN | http://www.cityofnorthfield.org | SOURCE_DISCOVERY_OWED |
| CITY OF OCEAN CITY (`nj:city:city-of-ocean-city`) | CITY_OR_TOWN | http://www.ocnj.us | SOURCE_DISCOVERY_OWED |
| CITY OF PASSAIC (`nj:city:city-of-passaic`) | CITY_OR_TOWN | http://www.cityofpassaic.com/ | SOURCE_DISCOVERY_OWED |
| CITY OF PATERSON (`nj:city:city-of-paterson`) | CITY_OR_TOWN | http://www.patersonnj.gov | SOURCE_DISCOVERY_OWED |
| CITY OF PERTH AMBOY (`nj:city:city-of-perth-amboy`) | CITY_OR_TOWN | http://www.ci.perthamboy.nj.us | SOURCE_DISCOVERY_OWED |
| CITY OF PLAINFIELD (`nj:city:city-of-plainfield`) | CITY_OR_TOWN | http://www.plainfield.com/ | SOURCE_DISCOVERY_OWED |
| CITY OF PLEASANTVILLE (`nj:city:city-of-pleasantville`) | CITY_OR_TOWN | http://www.pleasantvillenj.us | SOURCE_DISCOVERY_OWED |
| CITY OF PORT REPUBLIC (`nj:city:city-of-port-republic`) | CITY_OR_TOWN | http://www.portrepublicnj.org | SOURCE_DISCOVERY_OWED |
| CITY OF RAHWAY (`nj:city:city-of-rahway`) | CITY_OR_TOWN | http://www.cityofrahway.com | SOURCE_DISCOVERY_OWED |
| CITY OF SALEM (`nj:city:city-of-salem`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CITY OF SEA ISLE (`nj:city:city-of-sea-isle`) | CITY_OR_TOWN | http://sea-isle-city.nj.us/ | SOURCE_DISCOVERY_OWED |
| CITY OF SOMERS POINT (`nj:city:city-of-somers-point`) | CITY_OR_TOWN | http://www.somerspointgov.org | SOURCE_DISCOVERY_OWED |
| CITY OF SOUTH AMBOY (`nj:city:city-of-south-amboy`) | CITY_OR_TOWN | http://WWW.SOUTHAMBOY.COM | SOURCE_DISCOVERY_OWED |
| CITY OF SUMMIT (`nj:city:city-of-summit`) | CITY_OR_TOWN | http://www.cityofsummit.org | SOURCE_DISCOVERY_OWED |
| CITY OF TRENTON (`nj:city:city-of-trenton`) | CITY_OR_TOWN | http://www.trentonnj.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF UNION CITY (`nj:city:city-of-union-city`) | CITY_OR_TOWN | http://www.ucnj.com | SOURCE_DISCOVERY_OWED |
| CITY OF VENTNOR CITY (`nj:city:city-of-ventnor-city`) | CITY_OR_TOWN | http://www.ventnorcity.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF VINELAND (`nj:city:city-of-vineland`) | CITY_OR_TOWN | http://www.vinelandcity.org/ | SOURCE_DISCOVERY_OWED |
| CITY OF WILDWOOD (`nj:city:city-of-wildwood`) | CITY_OR_TOWN | http://www.wildwoodnj.org | SOURCE_DISCOVERY_OWED |
| CITY OF WOODBURY (`nj:city:city-of-woodbury`) | CITY_OR_TOWN | http://www.woodbury.nj.us/ | SOURCE_DISCOVERY_OWED |
| MUNICIPALITY OF PRINCETON (`nj:city:municipality-of-princeton`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF BELVIDERE (`nj:city:town-of-belvidere`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF BOONTON (`nj:city:town-of-boonton`) | CITY_OR_TOWN | http://www.boonton.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF CLINTON (`nj:city:town-of-clinton`) | CITY_OR_TOWN | http://www.clintonnj.gov | SOURCE_DISCOVERY_OWED |
| TOWN OF DOVER (`nj:city:town-of-dover`) | CITY_OR_TOWN | http://www.dover.nj.us | SOURCE_DISCOVERY_OWED |
| TOWN OF GUTTENBERG (`nj:city:town-of-guttenberg`) | CITY_OR_TOWN | http://www.guttenbergnj.org/ | SOURCE_DISCOVERY_OWED |
| TOWN OF HACKETTSTOWN (`nj:city:town-of-hackettstown`) | CITY_OR_TOWN | http://www.hackettstown.net/ | SOURCE_DISCOVERY_OWED |
| TOWN OF HAMMONTON (`nj:city:town-of-hammonton`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF HARRISON (`nj:city:town-of-harrison`) | CITY_OR_TOWN | http://www.townofharrison.com | SOURCE_DISCOVERY_OWED |
| TOWN OF KEARNY (`nj:city:town-of-kearny`) | CITY_OR_TOWN | http://www.kearnynj.org | SOURCE_DISCOVERY_OWED |
| TOWN OF MORRISTOWN (`nj:city:town-of-morristown`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF NEWTON (`nj:city:town-of-newton`) | CITY_OR_TOWN | http://www.newtontownhall.com | SOURCE_DISCOVERY_OWED |
| TOWN OF PHILLIPSBURG (`nj:city:town-of-phillipsburg`) | CITY_OR_TOWN | http://www.phillipsburgnj.org | SOURCE_DISCOVERY_OWED |
| TOWN OF SECAUCUS (`nj:city:town-of-secaucus`) | CITY_OR_TOWN | http://www.secauscusnj.org | SOURCE_DISCOVERY_OWED |
| TOWN OF WEST NEW YORK (`nj:city:town-of-west-new-york`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWN OF WESTFIELD (`nj:city:town-of-westfield`) | CITY_OR_TOWN | http://www.westfieldnj.gov | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ABERDEEN (`nj:city:township-of-aberdeen`) | CITY_OR_TOWN | http://www.aberdeennj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ALEXANDRIA (`nj:city:township-of-alexandria`) | CITY_OR_TOWN | http://www.alexandrianj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ALLAMUCHY (`nj:city:township-of-allamuchy`) | CITY_OR_TOWN | http://www.allamuchy.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ALLOWAY (`nj:city:township-of-alloway`) | CITY_OR_TOWN | http://www.allowaytownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ANDOVER (`nj:city:township-of-andover`) | CITY_OR_TOWN | http://www.andovertwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BARNEGAT (`nj:city:township-of-barnegat`) | CITY_OR_TOWN | http://www.barnegat.net | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BASS RIVER (`nj:city:township-of-bass-river`) | CITY_OR_TOWN | http://bassriver-nj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BEDMINSTER (`nj:city:township-of-bedminster`) | CITY_OR_TOWN | http://www.bedminster.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BELLEVILLE (`nj:city:township-of-belleville`) | CITY_OR_TOWN | http://www.bellevillenj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BERKELEY (`nj:city:township-of-berkeley`) | CITY_OR_TOWN | http://www.berkeley.nj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BERKELEY HEIGHTS (`nj:city:township-of-berkeley-heights`) | CITY_OR_TOWN | http://www.berkeleyheightstwp.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BERLIN (`nj:city:township-of-berlin`) | CITY_OR_TOWN | http://WWW.BERLINTWP.COM | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BERNARDS (`nj:city:township-of-bernards`) | CITY_OR_TOWN | http://www.bernards.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BETHLEHEM (`nj:city:township-of-bethlehem`) | CITY_OR_TOWN | http://www.bethlehem-twp.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BLAIRSTOWN (`nj:city:township-of-blairstown`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF BLOOMFIELD (`nj:city:township-of-bloomfield`) | CITY_OR_TOWN | http://www.bloomfieldtwpnj.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BOONTON (`nj:city:township-of-boonton`) | CITY_OR_TOWN | http://www.boontontownship.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BORDENTOWN (`nj:city:township-of-bordentown`) | CITY_OR_TOWN | http://www.bordentowntownship.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BRANCHBURG (`nj:city:township-of-branchburg`) | CITY_OR_TOWN | http://www.branchburg.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BRICK (`nj:city:township-of-brick`) | CITY_OR_TOWN | http://www.twp.brick.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BRIDGEWATER (`nj:city:township-of-bridgewater`) | CITY_OR_TOWN | http://www.bridgewaternj.gov/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BUENA VISTA (`nj:city:township-of-buena-vista`) | CITY_OR_TOWN | http://WWW.BUENAVISTATOWNSHIP.ORG | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BURLINGTON (`nj:city:township-of-burlington`) | CITY_OR_TOWN | http://www.twp.burlington.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF BYRAM (`nj:city:township-of-byram`) | CITY_OR_TOWN | http://www.byramtwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CARNEYS POINT (`nj:city:township-of-carneys-point`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF CEDAR GROVE (`nj:city:township-of-cedar-grove`) | CITY_OR_TOWN | http://www.cedargrovenj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CHATHAM (`nj:city:township-of-chatham`) | CITY_OR_TOWN | http://www.chathamtownship.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CHERRY HILL (`nj:city:township-of-cherry-hill`) | CITY_OR_TOWN | http://www.cherryhill-nj.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CHESTER (`nj:city:township-of-chester`) | CITY_OR_TOWN | http://www.chestertownship.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CHESTERFIELD (`nj:city:township-of-chesterfield`) | CITY_OR_TOWN | http://www.chesterfieldtwp.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CINNAMINSON (`nj:city:township-of-cinnaminson`) | CITY_OR_TOWN | http://CINNAMINSONNJ.ORG | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CLARK (`nj:city:township-of-clark`) | CITY_OR_TOWN | http://www.ourclark.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CLINTON (`nj:city:township-of-clinton`) | CITY_OR_TOWN | http://WWW.TOWNSHIP.CLINTON.NJ.US | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF COLTS NECK (`nj:city:township-of-colts-neck`) | CITY_OR_TOWN | http://www.colts-neck.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF COMMERCIAL (`nj:city:township-of-commercial`) | CITY_OR_TOWN | http://www.commericaltwp.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CRANBURY (`nj:city:township-of-cranbury`) | CITY_OR_TOWN | http://www.cranburytownship.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF CRANFORD (`nj:city:township-of-cranford`) | CITY_OR_TOWN | http://www.cranford.com/township/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF DEERFIELD (`nj:city:township-of-deerfield`) | CITY_OR_TOWN | http://www.deerfieldtownship.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF DELANCO (`nj:city:township-of-delanco`) | CITY_OR_TOWN | http://www.delancotownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF DELAWARE (`nj:city:township-of-delaware`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF DELRAN (`nj:city:township-of-delran`) | CITY_OR_TOWN | http://www.delrantownship.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF DENNIS (`nj:city:township-of-dennis`) | CITY_OR_TOWN | http://www.dennistwp.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF DENVILLE (`nj:city:township-of-denville`) | CITY_OR_TOWN | http://www.denvillenj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF DEPTFORD (`nj:city:township-of-deptford`) | CITY_OR_TOWN | http://www.deptfordnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF DOWNE (`nj:city:township-of-downe`) | CITY_OR_TOWN | http://www.downetwpnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EAGLESWOOD (`nj:city:township-of-eagleswood`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF EAST AMWELL (`nj:city:township-of-east-amwell`) | CITY_OR_TOWN | http://www.eastamwelltownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EAST BRUNSWICK (`nj:city:township-of-east-brunswick`) | CITY_OR_TOWN | http://www.eastbrunswick.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EAST GREENWICH (`nj:city:township-of-east-greenwich`) | CITY_OR_TOWN | http://www.eastgreenwichnj.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EAST HANOVER (`nj:city:township-of-east-hanover`) | CITY_OR_TOWN | http://www.easthanover.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EAST WINDSOR (`nj:city:township-of-east-windsor`) | CITY_OR_TOWN | http://www.eastwindsor.nj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EASTAMPTON (`nj:city:township-of-eastampton`) | CITY_OR_TOWN | http://www.eastampton.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EDGEWATER PARK (`nj:city:township-of-edgewater-park`) | CITY_OR_TOWN | http://www.edgewaterparknj.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EDISON (`nj:city:township-of-edison`) | CITY_OR_TOWN | http://www.edisonnj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EGG HARBOR (`nj:city:township-of-egg-harbor`) | CITY_OR_TOWN | http://www.ehtgov.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ELK (`nj:city:township-of-elk`) | CITY_OR_TOWN | http://www.elktownshipnj.gov | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ELSINBORO (`nj:city:township-of-elsinboro`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF EVESHAM (`nj:city:township-of-evesham`) | CITY_OR_TOWN | http://www.twp.evesham.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF EWING (`nj:city:township-of-ewing`) | CITY_OR_TOWN | http://www.ewingnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FAIRFIELD (`nj:city:township-of-fairfield`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF FAIRFIELD (`nj:city:township-of-fairfield-170284`) | CITY_OR_TOWN | http://www.fairfieldnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FLORENCE (`nj:city:township-of-florence`) | CITY_OR_TOWN | http://www.florence-nj.gov | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FRANKFORD (`nj:city:township-of-frankford`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF FRANKLIN (`nj:city:township-of-franklin`) | CITY_OR_TOWN | http://www.franklintownship.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FRANKLIN (`nj:city:township-of-franklin-109173`) | CITY_OR_TOWN | http://www.franklintwpwarren.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FRANKLIN (`nj:city:township-of-franklin-170302`) | CITY_OR_TOWN | http://www.franklin-twp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FRANKLIN (`nj:city:township-of-franklin-186570`) | CITY_OR_TOWN | http://www.franklintwpnj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FREDON (`nj:city:township-of-fredon`) | CITY_OR_TOWN | http://WWW.TWP.FREDON.NJ.US | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FREEHOLD (`nj:city:township-of-freehold`) | CITY_OR_TOWN | http://twp.freehold.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FRELINGHUYSEN (`nj:city:township-of-frelinghuysen`) | CITY_OR_TOWN | http://www.frelinghuysennj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF GALLOWAY (`nj:city:township-of-galloway`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF GLOUCESTER (`nj:city:township-of-gloucester`) | CITY_OR_TOWN | http://www.glotwp.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF GREEN (`nj:city:township-of-green`) | CITY_OR_TOWN | http://WWW.GREENTWP.COM | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF GREEN BROOK (`nj:city:township-of-green-brook`) | CITY_OR_TOWN | http://www.greenbrooktwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF GREENWICH (`nj:city:township-of-greenwich`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF GREENWICH (`nj:city:township-of-greenwich-130890`) | CITY_OR_TOWN | http://www.greenwichtwp.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF GREENWICH (`nj:city:township-of-greenwich-193754`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF HADDON (`nj:city:township-of-haddon`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF HAINESPORT (`nj:city:township-of-hainesport`) | CITY_OR_TOWN | http://www.hainesport.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HAMILTON (`nj:city:township-of-hamilton`) | CITY_OR_TOWN | http://www.townshipofhamilton.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HAMILTON (`nj:city:township-of-hamilton-184026`) | CITY_OR_TOWN | http://www.hamiltonnj.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HAMPTON (`nj:city:township-of-hampton`) | CITY_OR_TOWN | http://www.hamptontownshipnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HANOVER (`nj:city:township-of-hanover`) | CITY_OR_TOWN | http://WWW.HANOVERTOWNSHIP.COM | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HARDING (`nj:city:township-of-harding`) | CITY_OR_TOWN | http://www.hardingnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HARDWICK (`nj:city:township-of-hardwick`) | CITY_OR_TOWN | http://www.hardwick-nj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HARDYSTON (`nj:city:township-of-hardyston`) | CITY_OR_TOWN | http://www.hardyston.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HARMONY (`nj:city:township-of-harmony`) | CITY_OR_TOWN | http://www.harmonytwpnj.gov | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HARRISON (`nj:city:township-of-harrison`) | CITY_OR_TOWN | http://www.harrisontwp.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HAZLET (`nj:city:township-of-hazlet`) | CITY_OR_TOWN | http://www.hazlettwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HILLSBOROUGH (`nj:city:township-of-hillsborough`) | CITY_OR_TOWN | http://www.hillsboroughnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HILLSIDE (`nj:city:township-of-hillside`) | CITY_OR_TOWN | http://www.townshipofhillside.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HOLLAND (`nj:city:township-of-holland`) | CITY_OR_TOWN | http://www.hollandtownship.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HOLMDEL (`nj:city:township-of-holmdel`) | CITY_OR_TOWN | http://www.holmdeltownshipnj.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HOPE (`nj:city:township-of-hope`) | CITY_OR_TOWN | http://www.hopetownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HOPEWELL (`nj:city:township-of-hopewell`) | CITY_OR_TOWN | http://www.hopewelltwpnj.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HOPEWELL (`nj:city:township-of-hopewell-170306`) | CITY_OR_TOWN | http://HOPEWELLTWP.ORG | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF HOWELL (`nj:city:township-of-howell`) | CITY_OR_TOWN | http://www.twp.howell.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF INDEPENDENCE (`nj:city:township-of-independence`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF IRVINGTON (`nj:city:township-of-irvington`) | CITY_OR_TOWN | http://www.irvington.net | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF JACKSON (`nj:city:township-of-jackson`) | CITY_OR_TOWN | http://www.jacksontwpnj.net/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF JEFFERSON (`nj:city:township-of-jefferson`) | CITY_OR_TOWN | http://www.jeffersontownship.net/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF KINGWOOD (`nj:city:township-of-kingwood`) | CITY_OR_TOWN | http://www.kingwoodtownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF KNOWLTON (`nj:city:township-of-knowlton`) | CITY_OR_TOWN | http://www.knowltonnj.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LACEY (`nj:city:township-of-lacey`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF LAFAYETTE (`nj:city:township-of-lafayette`) | CITY_OR_TOWN | http://www.lafayettetwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LAKEWOOD (`nj:city:township-of-lakewood`) | CITY_OR_TOWN | http://twp.lakewood.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LAWRENCE (`nj:city:township-of-lawrence`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF LAWRENCE (`nj:city:township-of-lawrence-211232`) | CITY_OR_TOWN | http://lawrencetwp.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LEBANON (`nj:city:township-of-lebanon`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF LIBERTY (`nj:city:township-of-liberty`) | CITY_OR_TOWN | http://www.libertytownship.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LITTLE EGG HARBOR (`nj:city:township-of-little-egg-harbor`) | CITY_OR_TOWN | http://www.leht.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LITTLE FALLS (`nj:city:township-of-little-falls`) | CITY_OR_TOWN | http://www.lfnj.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LIVINGSTON (`nj:city:township-of-livingston`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF LOGAN (`nj:city:township-of-logan`) | CITY_OR_TOWN | http://www.logantwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LONG BEACH (`nj:city:township-of-long-beach`) | CITY_OR_TOWN | http://longbeachtownship.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LONG HILL (`nj:city:township-of-long-hill`) | CITY_OR_TOWN | http://www.longhillnj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LOPATCONG (`nj:city:township-of-lopatcong`) | CITY_OR_TOWN | http://www.lopatcongtwp.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LOWER (`nj:city:township-of-lower`) | CITY_OR_TOWN | http://www.townshipoflower.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LOWER ALLOWAYS CREEK (`nj:city:township-of-lower-alloways-creek`) | CITY_OR_TOWN | http://www.lowerallowayscreeknj.gov | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LUMBERTON (`nj:city:township-of-lumberton`) | CITY_OR_TOWN | http://www.lumbertontwp.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF LYNDHURST (`nj:city:township-of-lyndhurst`) | CITY_OR_TOWN | http://www.lyndhurstnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MAHWAH (`nj:city:township-of-mahwah`) | CITY_OR_TOWN | http://www.mahwahtwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MANALAPAN (`nj:city:township-of-manalapan`) | CITY_OR_TOWN | http://www.mtnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MANCHESTER (`nj:city:township-of-manchester`) | CITY_OR_TOWN | http://www.manchestertwp.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MANNINGTON (`nj:city:township-of-mannington`) | CITY_OR_TOWN | http://www.manningtontwp.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MANSFIELD (`nj:city:township-of-mansfield`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF MANSFIELD (`nj:city:township-of-mansfield-190907`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF MANTUA (`nj:city:township-of-mantua`) | CITY_OR_TOWN | http://www.mantuatownship.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MAPLE SHADE (`nj:city:township-of-maple-shade`) | CITY_OR_TOWN | http://www.mapleshade.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MAPLEWOOD (`nj:city:township-of-maplewood`) | CITY_OR_TOWN | http://www.twp.maplewood.nj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MARLBORO (`nj:city:township-of-marlboro`) | CITY_OR_TOWN | http://www.marlboro-twp.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MAURICE RIVER (`nj:city:township-of-maurice-river`) | CITY_OR_TOWN | http://www.mauricerivertwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MEDFORD (`nj:city:township-of-medford`) | CITY_OR_TOWN | http://www.medfordtownship.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MENDHAM (`nj:city:township-of-mendham`) | CITY_OR_TOWN | http://WWW.MENDHAMTOWNSHIP.ORG | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MIDDLE (`nj:city:township-of-middle`) | CITY_OR_TOWN | http://www.middletownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MIDDLETOWN (`nj:city:township-of-middletown`) | CITY_OR_TOWN | http://www.middletownnj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MILLBURN (`nj:city:township-of-millburn`) | CITY_OR_TOWN | http://www.twp.millburn.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MILLSTONE (`nj:city:township-of-millstone`) | CITY_OR_TOWN | http://www.millstone.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MINE HILL (`nj:city:township-of-mine-hill`) | CITY_OR_TOWN | http://www.minehill.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MONROE (`nj:city:township-of-monroe`) | CITY_OR_TOWN | http://www.monroetownshipnj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MONROE (`nj:city:township-of-monroe-170310`) | CITY_OR_TOWN | http://www.monroetwp.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MONTAGUE (`nj:city:township-of-montague`) | CITY_OR_TOWN | http://www.montaguenj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MONTCLAIR (`nj:city:township-of-montclair`) | CITY_OR_TOWN | http://www.montclairnjusa.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MONTGOMERY (`nj:city:township-of-montgomery`) | CITY_OR_TOWN | http://www.montgomery.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MONTVILLE (`nj:city:township-of-montville`) | CITY_OR_TOWN | http://www.montvillenj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MOORESTOWN (`nj:city:township-of-moorestown`) | CITY_OR_TOWN | http://www.moorestown.nj.us/index.cfm | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MORRIS (`nj:city:township-of-morris`) | CITY_OR_TOWN | http://www.morristwp.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MOUNT HOLLY (`nj:city:township-of-mount-holly`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF MOUNT LAUREL (`nj:city:township-of-mount-laurel`) | CITY_OR_TOWN | http://www.mountlaurel.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MOUNT OLIVE (`nj:city:township-of-mount-olive`) | CITY_OR_TOWN | http://www.mountolivetownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF MULLICA (`nj:city:township-of-mullica`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF NEPTUNE (`nj:city:township-of-neptune`) | CITY_OR_TOWN | http://www.neptunetownship.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF NEW HANOVER (`nj:city:township-of-new-hanover`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF NORTH BERGEN (`nj:city:township-of-north-bergen`) | CITY_OR_TOWN | http://www.northbergen.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF NORTH BRUNSWICK (`nj:city:township-of-north-brunswick`) | CITY_OR_TOWN | http://www.twp.north-brunswick.nj.us/index.html | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF NORTH HANOVER (`nj:city:township-of-north-hanover`) | CITY_OR_TOWN | http://www.northhanover.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF NUTLEY (`nj:city:township-of-nutley`) | CITY_OR_TOWN | http://www.nutleynj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF OCEAN (`nj:city:township-of-ocean`) | CITY_OR_TOWN | http://www.monmouth.com/~ocean/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF OCEAN (`nj:city:township-of-ocean-186569`) | CITY_OR_TOWN | http://www.townshipofocean.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF OLD BRIDGE (`nj:city:township-of-old-bridge`) | CITY_OR_TOWN | http://www.oldbridge.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF OLDMANS (`nj:city:township-of-oldmans`) | CITY_OR_TOWN | http://www.oldmanstownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ORANGE CITY (`nj:city:township-of-orange-city`) | CITY_OR_TOWN | http://www.ci.orange.nj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF OXFORD (`nj:city:township-of-oxford`) | CITY_OR_TOWN | http://www.oxfordnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF PARSIPPANY-TROY HILLS (`nj:city:township-of-parsippany-troy-hills`) | CITY_OR_TOWN | http://www.parsippany.net/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF PEMBERTON (`nj:city:township-of-pemberton`) | CITY_OR_TOWN | http://www.pembertontwp.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF PENNSAUKEN (`nj:city:township-of-pennsauken`) | CITY_OR_TOWN | http://www.twp.pennsauken.nj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF PENNSVILLE (`nj:city:township-of-pennsville`) | CITY_OR_TOWN | http://www.pennsville.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF PEQUANNOCK (`nj:city:township-of-pequannock`) | CITY_OR_TOWN | http://www.peqtwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF PILESGROVE (`nj:city:township-of-pilesgrove`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF PISCATAWAY (`nj:city:township-of-piscataway`) | CITY_OR_TOWN | http://www.piscatawaynj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF PITTSGROVE (`nj:city:township-of-pittsgrove`) | CITY_OR_TOWN | http://WWW.PITTSGROVETOWNSHIP.COM | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF PLAINSBORO (`nj:city:township-of-plainsboro`) | CITY_OR_TOWN | http://www.plainsboronj.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF PLUMSTED (`nj:city:township-of-plumsted`) | CITY_OR_TOWN | http://www.plumsted.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF POHATCONG (`nj:city:township-of-pohatcong`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF QUINTON (`nj:city:township-of-quinton`) | CITY_OR_TOWN | http://www.quintonnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF RANDOLPH (`nj:city:township-of-randolph`) | CITY_OR_TOWN | http://www.randolphnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF RARITAN (`nj:city:township-of-raritan`) | CITY_OR_TOWN | http://WWW.RARITAN-TOWNSHIP.COM | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF READINGTON (`nj:city:township-of-readington`) | CITY_OR_TOWN | http://www.township.readington.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF RIVER VALE (`nj:city:township-of-river-vale`) | CITY_OR_TOWN | http://www.rivervalenj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF RIVERSIDE (`nj:city:township-of-riverside`) | CITY_OR_TOWN | http://www.riversidetwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ROBBINSVILLE (`nj:city:township-of-robbinsville`) | CITY_OR_TOWN | http://www.robbinsvilletwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ROCHELLE PARK (`nj:city:township-of-rochelle-park`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF ROCKAWAY (`nj:city:township-of-rockaway`) | CITY_OR_TOWN | http://www.rockawaytownship.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF ROXBURY (`nj:city:township-of-roxbury`) | CITY_OR_TOWN | http://www.roxburynj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SADDLE BROOK (`nj:city:township-of-saddle-brook`) | CITY_OR_TOWN | http://www.saddlebrooknj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SANDYSTON (`nj:city:township-of-sandyston`) | CITY_OR_TOWN | http://www.sandystontownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SCOTCH PLAINS (`nj:city:township-of-scotch-plains`) | CITY_OR_TOWN | http://www.scotchplainsnj.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SHAMONG (`nj:city:township-of-shamong`) | CITY_OR_TOWN | http://www.shamong.net/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SHREWSBURY (`nj:city:township-of-shrewsbury`) | CITY_OR_TOWN | http://www.townshipofshrewsbury.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SOUTH BRUNSWICK (`nj:city:township-of-south-brunswick`) | CITY_OR_TOWN | http://www.twp.south-brunswick.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SOUTH HACKENSACK (`nj:city:township-of-south-hackensack`) | CITY_OR_TOWN | http://www.southhackensacknj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SOUTH HARRISON (`nj:city:township-of-south-harrison`) | CITY_OR_TOWN | http://www.southharrisonnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SOUTH ORANGE VILLAGE (`nj:city:township-of-south-orange-village`) | CITY_OR_TOWN | http://www.southorange.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SOUTHAMPTON (`nj:city:township-of-southampton`) | CITY_OR_TOWN | http://WWW.SOUTHAMPTONNJ.ORG | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SPARTA (`nj:city:township-of-sparta`) | CITY_OR_TOWN | http://www.spartannj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF SPRINGFIELD (`nj:city:township-of-springfield`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF SPRINGFIELD (`nj:city:township-of-springfield-170355`) | CITY_OR_TOWN | http://www.springfieldnj.us/index.php?pagehome | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF STAFFORD (`nj:city:township-of-stafford`) | CITY_OR_TOWN | http://twp.stafford.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF STILLWATER (`nj:city:township-of-stillwater`) | CITY_OR_TOWN | http://www.stillwaternj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF STOW CREEK (`nj:city:township-of-stow-creek`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF TABERNACLE (`nj:city:township-of-tabernacle`) | CITY_OR_TOWN | http://www.townshipoftabernaclenj.gov/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF TEANECK (`nj:city:township-of-teaneck`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF TEWKSBURY (`nj:city:township-of-tewksbury`) | CITY_OR_TOWN | http://www.tewksburytwp.net | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF TOMS RIVER (`nj:city:township-of-toms-river`) | CITY_OR_TOWN | http://www.tomsrivertownship.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF UNION (`nj:city:township-of-union`) | CITY_OR_TOWN | http://www.uniontwp-hcnj.gov | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF UNION (`nj:city:township-of-union-212655`) | CITY_OR_TOWN | http://www.uniontownship.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF UPPER (`nj:city:township-of-upper`) | CITY_OR_TOWN | http://www.uppertownship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF UPPER DEERFIELD (`nj:city:township-of-upper-deerfield`) | CITY_OR_TOWN | http://www.upperdeerfield.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF UPPER FREEHOLD (`nj:city:township-of-upper-freehold`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF UPPER PITTSGROVE (`nj:city:township-of-upper-pittsgrove`) | CITY_OR_TOWN | http://www.upperpittsgrovenj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF VERNON (`nj:city:township-of-vernon`) | CITY_OR_TOWN | http://www.vernontwp.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF VERONA (`nj:city:township-of-verona`) | CITY_OR_TOWN | http://WWW.VERONAONLINE.COM | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF VOORHEES (`nj:city:township-of-voorhees`) | CITY_OR_TOWN | http://www.voorheesnj.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WALL (`nj:city:township-of-wall`) | CITY_OR_TOWN | http://www.wallnj.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WALPACK (`nj:city:township-of-walpack`) | CITY_OR_TOWN | http://www.twp.walpack.nj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WANTAGE (`nj:city:township-of-wantage`) | CITY_OR_TOWN | http://WWW.WANTAGETWP.COM | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WARREN (`nj:city:township-of-warren`) | CITY_OR_TOWN | http://www.warrennj.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WASHINGTON (`nj:city:township-of-washington`) | CITY_OR_TOWN | http://www.twpofwashington.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WASHINGTON (`nj:city:township-of-washington-130916`) | CITY_OR_TOWN | http://www.washington-twp-warren.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WASHINGTON (`nj:city:township-of-washington-170296`) | CITY_OR_TOWN | http://www.twp.washington.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WASHINGTON (`nj:city:township-of-washington-208782`) | CITY_OR_TOWN | http://www.wtmorris.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WASHINGTON (`nj:city:township-of-washington-225018`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF WATERFORD (`nj:city:township-of-waterford`) | CITY_OR_TOWN | http://www.waterfordtwp.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WAYNE (`nj:city:township-of-wayne`) | CITY_OR_TOWN | http://www.waynetownship.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WEEHAWKEN (`nj:city:township-of-weehawken`) | CITY_OR_TOWN | http://www.weehawken-nj.us | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WEST AMWELL (`nj:city:township-of-west-amwell`) | CITY_OR_TOWN | http://www.westamwelltwp.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WEST CALDWELL (`nj:city:township-of-west-caldwell`) | CITY_OR_TOWN | http://www.westcaldwell.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WEST DEPTFORD (`nj:city:township-of-west-deptford`) | CITY_OR_TOWN | http://www.westdeptford.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WEST MILFORD (`nj:city:township-of-west-milford`) | CITY_OR_TOWN | http://www.township.west-milford.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WEST ORANGE (`nj:city:township-of-west-orange`) | CITY_OR_TOWN | http://www.westorange.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WEST WINDSOR (`nj:city:township-of-west-windsor`) | CITY_OR_TOWN | http://www.westwindsornj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WESTAMPTON (`nj:city:township-of-westampton`) | CITY_OR_TOWN | http://www.westampton.com/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WEYMOUTH (`nj:city:township-of-weymouth`) | CITY_OR_TOWN | http://WWW.WEYMOUTHNJ.ORG | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WHITE (`nj:city:township-of-white`) | CITY_OR_TOWN | http://www.whittwp-nj.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WILLINGBORO (`nj:city:township-of-willingboro`) | CITY_OR_TOWN | http://willingborotwp.org/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WINFIELD (`nj:city:township-of-winfield`) | CITY_OR_TOWN | http://www.winfieldnj.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WINSLOW (`nj:city:township-of-winslow`) | CITY_OR_TOWN | http://www.winslowtwonship.com | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WOODBRIDGE (`nj:city:township-of-woodbridge`) | CITY_OR_TOWN | http://www.twp.woodbridge.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WOODLAND (`nj:city:township-of-woodland`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOWNSHIP OF WOOLWICH (`nj:city:township-of-woolwich`) | CITY_OR_TOWN | http://www.woolwichtwp.org | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF WYCKOFF (`nj:city:township-of-wyckoff`) | CITY_OR_TOWN | http://www.wyckoffnj.com | SOURCE_DISCOVERY_OWED |
| VILLAGE OF LOCH ARBOUR (`nj:city:village-of-loch-arbour`) | CITY_OR_TOWN | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| VILLAGE OF RIDGEFIELD PARK (`nj:city:village-of-ridgefield-park`) | CITY_OR_TOWN | http://www.ridgefieldpark.org/ | SOURCE_DISCOVERY_OWED |
| VILLAGE OF RIDGEWOOD (`nj:city:village-of-ridgewood`) | CITY_OR_TOWN | http://www.ridgewoodnj.net/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF ATLANTIC (`nj:county:county-of-atlantic`) | COUNTY | http://www.aclink.org/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF BERGEN (`nj:county:county-of-bergen`) | COUNTY | http://www.co.bergen.nj.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF BURLINGTON (`nj:county:county-of-burlington`) | COUNTY | http://www.co.burlington.nj.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF CAMDEN (`nj:county:county-of-camden`) | COUNTY | http://www.co.camden.nj.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF CAPE MAY (`nj:county:county-of-cape-may`) | COUNTY | http://www.co.cape-may,nj.us | SOURCE_DISCOVERY_OWED |
| COUNTY OF CUMBERLAND (`nj:county:county-of-cumberland`) | COUNTY | http://www.co.cumberland.nj.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF ESSEX (`nj:county:county-of-essex`) | COUNTY | http://www.essexcountynj.org | SOURCE_DISCOVERY_OWED |
| COUNTY OF GLOUCESTER (`nj:county:county-of-gloucester`) | COUNTY | http://www.co.gloucester.nj.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF HUDSON (`nj:county:county-of-hudson`) | COUNTY | http://www.hudsoncountynj.org/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF HUNTERDON (`nj:county:county-of-hunterdon`) | COUNTY | http://www.co.hunterdon.nj.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF MERCER (`nj:county:county-of-mercer`) | COUNTY | http://www.nj.gov/counties/mercer/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF MIDDLESEX (`nj:county:county-of-middlesex`) | COUNTY | http://www.co.middlesex.nj.us/index.asp | SOURCE_DISCOVERY_OWED |
| COUNTY OF MONMOUTH (`nj:county:county-of-monmouth`) | COUNTY | http://www.visitmonmouth.com | SOURCE_DISCOVERY_OWED |
| COUNTY OF MORRIS (`nj:county:county-of-morris`) | COUNTY | http://www.co.morris.nj.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF OCEAN (`nj:county:county-of-ocean`) | COUNTY | http://www.co.ocean.nj.us | SOURCE_DISCOVERY_OWED |
| COUNTY OF PASSAIC (`nj:county:county-of-passaic`) | COUNTY | http://www.passaiccountynj.org/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF SALEM (`nj:county:county-of-salem`) | COUNTY | http://www.salemcountynj.gov/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF SOMERSET (`nj:county:county-of-somerset`) | COUNTY | http://www.co.somerset.nj.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF SUSSEX (`nj:county:county-of-sussex`) | COUNTY | http://www.sussex.nj.us/ | SOURCE_DISCOVERY_OWED |
| COUNTY OF UNION (`nj:county:county-of-union`) | COUNTY | http://www.ucnj.org | SOURCE_DISCOVERY_OWED |
| COUNTY OF WARREN (`nj:county:county-of-warren`) | COUNTY | http://co.warren.nj.us/ | SOURCE_DISCOVERY_OWED |
| ATLANTIC CAPE COMMUNITY COLLEGE (`nj:depschool:atlantic-cape-community-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.atlantic.edu | SOURCE_DISCOVERY_OWED |
| ATLANTIC COUNTY SPECIAL SERVICES DISTRICT (`nj:depschool:atlantic-county-special-services-district`) | DEPENDENT_SCHOOL_SYSTEM | http://acsssd.net/ | SOURCE_DISCOVERY_OWED |
| ATLANTIC COUNTY VOCATIONAL SCHOOL (`nj:depschool:atlantic-county-vocational-school`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.ACVTS.ORG | SOURCE_DISCOVERY_OWED |
| BAYONNE SCHOOL DISTRICT (`nj:depschool:bayonne-school-district`) | DEPENDENT_SCHOOL_SYSTEM | https://www.bboed.org/ | SOURCE_DISCOVERY_OWED |
| BAYSHORE JOINTURE COMMISSION (`nj:depschool:bayshore-jointure-commission`) | DEPENDENT_SCHOOL_SYSTEM | http://www.bayshorejointure.com/ | SOURCE_DISCOVERY_OWED |
| BERGEN COMMUNITY COLLEGE (`nj:depschool:bergen-community-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.bergen.edu | SOURCE_DISCOVERY_OWED |
| BERGEN COUNTY SPECIAL SERVICES DISTRICT (`nj:depschool:bergen-county-special-services-district`) | DEPENDENT_SCHOOL_SYSTEM | http://bcss.bergen.org | SOURCE_DISCOVERY_OWED |
| BERGEN COUNTY VOCATIONAL SCHOOL (`nj:depschool:bergen-county-vocational-school`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.BERGEN.ORG | SOURCE_DISCOVERY_OWED |
| BEVERLY CITY SCHOOL DISTRICT (`nj:depschool:beverly-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.beverlycityschool.org | SOURCE_DISCOVERY_OWED |
| BRIGANTINE CITY SCHOOL SYSTEM (`nj:depschool:brigantine-city-school-system`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.BRIGANTINE.ATLNET.ORG | SOURCE_DISCOVERY_OWED |
| BROOKDALE COMMUNITY COLLEGE (`nj:depschool:brookdale-community-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.brookdalecc.edu | SOURCE_DISCOVERY_OWED |
| BURLINGTON COUNTY SPECIAL SERVICES SCH DISTRICT (`nj:depschool:burlington-county-special-services-sch-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.BCSSSD.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| BURLINGTON COUNTY VOCATIONAL SCHOOL DISTRICT (`nj:depschool:burlington-county-vocational-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.bcit.cc/ | SOURCE_DISCOVERY_OWED |
| CAMDEN COUNTY COLLEGE (`nj:depschool:camden-county-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.camdencc.edu | SOURCE_DISCOVERY_OWED |
| CAMDEN COUNTY VOCATIONAL SCHOOL DISTRICT (`nj:depschool:camden-county-vocational-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.CCTS.TEC.NJ.US | SOURCE_DISCOVERY_OWED |
| CAPE MAY COUNTY SPECIAL SERVICES DISTRICT (`nj:depschool:cape-may-county-special-services-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.cmcspecialservices.org/ | SOURCE_DISCOVERY_OWED |
| CAPE MAY COUNTY VOCATIONAL SCHOOL DISTRICT (`nj:depschool:cape-may-county-vocational-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.CAPEMAYTECH.COM | SOURCE_DISCOVERY_OWED |
| CUMBERLAND COUNTY COLLEGE (`nj:depschool:cumberland-county-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.cccnj.edu | SOURCE_DISCOVERY_OWED |
| CUMBERLAND COUNTY VOCATIONAL SCHOOL (`nj:depschool:cumberland-county-vocational-school`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.CUMBERLAND.TEC.NJ.US | SOURCE_DISCOVERY_OWED |
| EAST ORANGE CITY SCHOOL DISTRICT (`nj:depschool:east-orange-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.eastorange.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| EDISON TOWNSHIP SCHOOL DISTRICT (`nj:depschool:edison-township-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.edison.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| EGG HARBOR CITY SCHOOL DISTRICT (`nj:depschool:egg-harbor-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.EHCS.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| ENGLEWOOD CITY SCHOOL DISTRICT (`nj:depschool:englewood-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.EPSD.ORG | SOURCE_DISCOVERY_OWED |
| ESSEX COUNTY COMMUNITY COLLEGE (`nj:depschool:essex-county-community-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.essex.edu | SOURCE_DISCOVERY_OWED |
| ESSEX COUNTY VOCATIONAL SCHOOL (`nj:depschool:essex-county-vocational-school`) | DEPENDENT_SCHOOL_SYSTEM | http://www.essextech.org | SOURCE_DISCOVERY_OWED |
| GLOUCESTER COUNTY COLLEGE (`nj:depschool:gloucester-county-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.gccnj.edu | SOURCE_DISCOVERY_OWED |
| GLOUCESTER COUNTY SPECIAL SERVICES SCHOOL DISTRICT (`nj:depschool:gloucester-county-special-services-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.gcsssd.org | SOURCE_DISCOVERY_OWED |
| GLOUCESTER COUNTY VOCATIONAL-TECHNICAL SCHOOL (`nj:depschool:gloucester-county-vocational-technical-school`) | DEPENDENT_SCHOOL_SYSTEM | http://www.gcit.org | SOURCE_DISCOVERY_OWED |
| HARRISON CITY SCHOOL DISTRICT (`nj:depschool:harrison-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.harrison.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| HUDSON COUNTY COMMUNITY COLLEGE (`nj:depschool:hudson-county-community-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.hccc.edu | SOURCE_DISCOVERY_OWED |
| HUDSON COUNTY VOCATIONAL SCHOOLS (`nj:depschool:hudson-county-vocational-schools`) | DEPENDENT_SCHOOL_SYSTEM | http://www.hcstonline.org/ | SOURCE_DISCOVERY_OWED |
| HUNTERDON COUNTY POLYTECH (`nj:depschool:hunterdon-county-polytech`) | DEPENDENT_SCHOOL_SYSTEM | http://www.hcpolytech.org/ | SOURCE_DISCOVERY_OWED |
| IRVINGTON TOWNSHIP SCHOOLS (`nj:depschool:irvington-township-schools`) | DEPENDENT_SCHOOL_SYSTEM | http://www.irvington.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| JERSEY CITY SCHOOL SYSTEM (`nj:depschool:jersey-city-school-system`) | DEPENDENT_SCHOOL_SYSTEM | http://www.jcboe.org/ | SOURCE_DISCOVERY_OWED |
| LINWOOD CITY SCHOOL DISTRICT (`nj:depschool:linwood-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.LINWOODSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| MARGATE CITY SCHOOL DISTRICT (`nj:depschool:margate-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.MARGATESCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| MERCER COUNTY COMMUNITY COLLEGE (`nj:depschool:mercer-county-community-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.mccc.edu | SOURCE_DISCOVERY_OWED |
| MERCER COUNTY SPECIAL SERVICES SCHOOL DISTRICT (`nj:depschool:mercer-county-special-services-school-district`) | DEPENDENT_SCHOOL_SYSTEM | https://www.mcsssd.info/ | SOURCE_DISCOVERY_OWED |
| MERCER COUNTY VOCATIONAL SCHOOLS (`nj:depschool:mercer-county-vocational-schools`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.MCTEC.NET | SOURCE_DISCOVERY_OWED |
| MIDDLESEX COUNTY COLLEGE (`nj:depschool:middlesex-county-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.middlesexcc.edu | SOURCE_DISCOVERY_OWED |
| MIDDLESEX COUNTY VOCATIONAL SCHOOL DISTRICT (`nj:depschool:middlesex-county-vocational-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.mcvts.net/ | SOURCE_DISCOVERY_OWED |
| MONMOUTH COUNTY VOCATIONAL SCHOOLS (`nj:depschool:monmouth-county-vocational-schools`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.MCVSD.ORG | SOURCE_DISCOVERY_OWED |
| MONTCLAIR PUBLIC SCHOOLS (`nj:depschool:montclair-public-schools`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.MONTCLAIR.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| MORRIS COUNTY COLLEGE (`nj:depschool:morris-county-college`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.CCM.EDU | SOURCE_DISCOVERY_OWED |
| MORRIS COUNTY VOCATIONAL SCHOOL DISTRICT (`nj:depschool:morris-county-vocational-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.mcvts.org/ | SOURCE_DISCOVERY_OWED |
| MORRIS-UNION JOINTURE COMMISSION (`nj:depschool:morris-union-jointure-commission`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.MUJC.ORG | SOURCE_DISCOVERY_OWED |
| NEW BRUNSWICK CITY SCHOOL DISTRICT (`nj:depschool:new-brunswick-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.nbps.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| OCEAN COUNTY COLLEGE (`nj:depschool:ocean-county-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.ocean.edu/ | SOURCE_DISCOVERY_OWED |
| OCEAN COUNTY VOCATIONAL SCHOOL (`nj:depschool:ocean-county-vocational-school`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.OCVTS.ORG | SOURCE_DISCOVERY_OWED |
| ORANGE CITY TOWNSHIP SCHOOL DISTRICT (`nj:depschool:orange-city-township-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.orange.k12.nj.us | SOURCE_DISCOVERY_OWED |
| PASSAIC COUNTY COMMUNITY COLLEGE (`nj:depschool:passaic-county-community-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.pccc.edu | SOURCE_DISCOVERY_OWED |
| PASSAIC COUNTY VOCATIONAL SCHOOLS (`nj:depschool:passaic-county-vocational-schools`) | DEPENDENT_SCHOOL_SYSTEM | https://pctvs.org/ | SOURCE_DISCOVERY_OWED |
| PORT REPUBLIC CITY SCHOOL DISTRICT (`nj:depschool:port-republic-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.port-republic.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| RARITAN VALLEY COMMUNITY COLLEGE (`nj:depschool:raritan-valley-community-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.raritanval.edu | SOURCE_DISCOVERY_OWED |
| ROWAN COLLEGE AT BURLINGTON COUNTY (`nj:depschool:rowan-college-at-burlington-county`) | DEPENDENT_SCHOOL_SYSTEM | http://www.rcbc.edu/ | SOURCE_DISCOVERY_OWED |
| SALEM CMTY COLLEGE (`nj:depschool:salem-cmty-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.salemcc.edu | SOURCE_DISCOVERY_OWED |
| SALEM COUNTY SPECIAL SERVICES SCHOOL DISTRICT (`nj:depschool:salem-county-special-services-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.scsssd.org/ | SOURCE_DISCOVERY_OWED |
| SALEM COUNTY VOCATIONAL EDUCATION SCHOOL DISTRICT (`nj:depschool:salem-county-vocational-education-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.SCVTS.ORG | SOURCE_DISCOVERY_OWED |
| SOMERSET COUNTY VOCATIONAL SCHOOLS (`nj:depschool:somerset-county-vocational-schools`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.SCTI.ORG | SOURCE_DISCOVERY_OWED |
| SOUTH BERGEN JOINTURE COMMISSION (`nj:depschool:south-bergen-jointure-commission`) | DEPENDENT_SCHOOL_SYSTEM | https://www.njsbjc.org/ | SOURCE_DISCOVERY_OWED |
| SUMMIT CITY SCHOOL DISTRICT (`nj:depschool:summit-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.summit.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| SUSSEX COUNTY COMMUNITY COLLEGE COMMISSION (`nj:depschool:sussex-county-community-college-commission`) | DEPENDENT_SCHOOL_SYSTEM | http://www.sussex.edu | SOURCE_DISCOVERY_OWED |
| SUSSEX COUNTY VOCATIONAL SCHOOL DISTRICT (`nj:depschool:sussex-county-vocational-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.sussex.tec.nj.us/ | SOURCE_DISCOVERY_OWED |
| TRENTON SCHOOL DISTRICT (`nj:depschool:trenton-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.trenton.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| UNION CITY SCHOOL DISTRICT (`nj:depschool:union-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://WWW.UNION-CITY.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| UNION COUNTY COLLEGE (`nj:depschool:union-county-college`) | DEPENDENT_SCHOOL_SYSTEM | http://www.ucc.edu | SOURCE_DISCOVERY_OWED |
| UNION COUNTY VOCATIONAL TECHNICAL SCHOOLS (`nj:depschool:union-county-vocational-technical-schools`) | DEPENDENT_SCHOOL_SYSTEM | http://www.ucvts.tec.nj.us/ | SOURCE_DISCOVERY_OWED |
| VENTNOR CITY SCHOOL DISTRICT (`nj:depschool:ventnor-city-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.veccnj.org/ | SOURCE_DISCOVERY_OWED |
| WARREN COLLEGE COMMUNITY COLLEGE COMMISSION (`nj:depschool:warren-college-community-college-commission`) | DEPENDENT_SCHOOL_SYSTEM | http://www.warren.edu | SOURCE_DISCOVERY_OWED |
| WARREN COUNTY SPECIAL SERVICES SCHOOL DISTRICT (`nj:depschool:warren-county-special-services-school-district`) | DEPENDENT_SCHOOL_SYSTEM | http://www.wcsssd.org | SOURCE_DISCOVERY_OWED |
| WARREN COUNTY VOCATIONAL SCHOOL (`nj:depschool:warren-county-vocational-school`) | DEPENDENT_SCHOOL_SYSTEM | http://www.warrennet.org/warrentech/ | SOURCE_DISCOVERY_OWED |
| WEST NEW YORK TOWN SCHOOLS (`nj:depschool:west-new-york-town-schools`) | DEPENDENT_SCHOOL_SYSTEM | http://www.wnyschools.net | SOURCE_DISCOVERY_OWED |
| ABSECON SCHOOL DISTRICT (`nj:school:absecon-school-district`) | SCHOOL_DISTRICT | http://www.abseconschools.org/ | SOURCE_DISCOVERY_OWED |
| ALEXANDRIA TWP SCH DIST (`nj:school:alexandria-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.dvrhs.org/Domain/158 | SOURCE_DISCOVERY_OWED |
| ALLAMUCHY TWP SCH DIST (`nj:school:allamuchy-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.AES.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| ALLENDALE PUBLIC SCH DIST (`nj:school:allendale-public-sch-dist`) | SCHOOL_DISTRICT | https://www.allendalek8.com/ | SOURCE_DISCOVERY_OWED |
| ALLOWAY TWP SCH DIST (`nj:school:alloway-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.allowayschool.org/ | SOURCE_DISCOVERY_OWED |
| ALPHA BORO SCH DIST (`nj:school:alpha-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.apsedu.org | SOURCE_DISCOVERY_OWED |
| ALPINE PUBLIC SCH DIST (`nj:school:alpine-public-sch-dist`) | SCHOOL_DISTRICT | http://www.alpineschool.org | SOURCE_DISCOVERY_OWED |
| ANDOVER REG SCH DIST (`nj:school:andover-reg-sch-dist`) | SCHOOL_DISTRICT | http://WWW.ANDOVERREGIONAL.ORG | SOURCE_DISCOVERY_OWED |
| ASBURY PARK SCHOOL DISTRICT (`nj:school:asbury-park-school-district`) | SCHOOL_DISTRICT | http://www.asburypark.k12.nj.us | SOURCE_DISCOVERY_OWED |
| ATLANTIC CITY SCH DISTRICT (`nj:school:atlantic-city-sch-district`) | SCHOOL_DISTRICT | http://WWW.ACBOE.ORG | SOURCE_DISCOVERY_OWED |
| ATLANTIC HIGHLANDS SCHOOL DIST (`nj:school:atlantic-highlands-school-dist`) | SCHOOL_DISTRICT | http://www.ahes.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| AUDUBON PUBLIC SCH DIST (`nj:school:audubon-public-sch-dist`) | SCHOOL_DISTRICT | http://www.audubonschools.org/ | SOURCE_DISCOVERY_OWED |
| AVALON STONE HARBOR SCH DIST (`nj:school:avalon-stone-harbor-sch-dist`) | SCHOOL_DISTRICT | https://www.avalonstoneharborschools.org/ | SOURCE_DISCOVERY_OWED |
| AVON BORO SCH DIST (`nj:school:avon-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.avonschool.com/ | SOURCE_DISCOVERY_OWED |
| BARNEGAT TWP SCH DIST (`nj:school:barnegat-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.barnegatschools.com | SOURCE_DISCOVERY_OWED |
| BARRINGTON SCH DIST (`nj:school:barrington-sch-dist`) | SCHOOL_DISTRICT | http://www.barringtonschools.net | SOURCE_DISCOVERY_OWED |
| BASS RIVER TWP SCH DIST (`nj:school:bass-river-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.bassriverschooldistrict.org/ | SOURCE_DISCOVERY_OWED |
| BAY HEAD BORO SCH DIST (`nj:school:bay-head-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.bayheadschool.org/ | SOURCE_DISCOVERY_OWED |
| BEACH HAVEN SCH DIST (`nj:school:beach-haven-sch-dist`) | SCHOOL_DISTRICT | http://www.beachhavenschool.com | SOURCE_DISCOVERY_OWED |
| BEDMINSTER TWP SCH DIST (`nj:school:bedminster-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.bedminsterschool.org/ | SOURCE_DISCOVERY_OWED |
| BELLEVILLE PUBLIC SCH DIST (`nj:school:belleville-public-sch-dist`) | SCHOOL_DISTRICT | https://www.bellevilleschools.org/ | SOURCE_DISCOVERY_OWED |
| BELLMAWR PUBLIC SCH DIST (`nj:school:bellmawr-public-sch-dist`) | SCHOOL_DISTRICT | http://www.bellmawrschools.org/ | SOURCE_DISCOVERY_OWED |
| BELMAR ELEM SCH DIST (`nj:school:belmar-elem-sch-dist`) | SCHOOL_DISTRICT | http://www.belmar.k12.nj.us | SOURCE_DISCOVERY_OWED |
| BELVIDERE SCH DIST (`nj:school:belvidere-sch-dist`) | SCHOOL_DISTRICT | http://WWW.BELVIDERESD.ORG | SOURCE_DISCOVERY_OWED |
| BERGENFIELD BORO SCH DIST (`nj:school:bergenfield-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.bergenfield.org/ | SOURCE_DISCOVERY_OWED |
| BERKELEY HEIGHTS SCH DIST (`nj:school:berkeley-heights-sch-dist`) | SCHOOL_DISTRICT | http://www.bhpsnj.org/ | SOURCE_DISCOVERY_OWED |
| BERKELEY TWP SCH DIST (`nj:school:berkeley-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.btboe.org | SOURCE_DISCOVERY_OWED |
| BERLIN BOROUGH BOARD OF EDUCATN (`nj:school:berlin-borough-board-of-educatn`) | SCHOOL_DISTRICT | https://www.bcsberlin.org/ | SOURCE_DISCOVERY_OWED |
| BERLIN TWP SCH DIST (`nj:school:berlin-twp-sch-dist`) | SCHOOL_DISTRICT | http://btwpschools.org/ | SOURCE_DISCOVERY_OWED |
| BERNARDS TWP SCH DIST (`nj:school:bernards-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.bernardsboe.com/ | SOURCE_DISCOVERY_OWED |
| BETHLEHEM TWP SCH DIST (`nj:school:bethlehem-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.btschools.org/ | SOURCE_DISCOVERY_OWED |
| BLACK HORSE PIKE REG SCH DIST (`nj:school:black-horse-pike-reg-sch-dist`) | SCHOOL_DISTRICT | http://www.bhprsd.org/ | SOURCE_DISCOVERY_OWED |
| BLAIRSTOWN TWP SCH DIST (`nj:school:blairstown-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.blairstownelem.net | SOURCE_DISCOVERY_OWED |
| BLOOMFIELD TOWN SCH DIST (`nj:school:bloomfield-town-sch-dist`) | SCHOOL_DISTRICT | http://www.bloomfield.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| BLOOMINGDALE SCHOOL DIST (`nj:school:bloomingdale-school-dist`) | SCHOOL_DISTRICT | http://www.bloomingdaleschools.org/ | SOURCE_DISCOVERY_OWED |
| BLOOMSBURY BORO SCH DIST (`nj:school:bloomsbury-boro-sch-dist`) | SCHOOL_DISTRICT | http://bburyes.org/ | SOURCE_DISCOVERY_OWED |
| BOGOTA SCH DIST (`nj:school:bogota-sch-dist`) | SCHOOL_DISTRICT | http://www.bogotaboe.com | SOURCE_DISCOVERY_OWED |
| BOONTON TOWN SCH DIST (`nj:school:boonton-town-sch-dist`) | SCHOOL_DISTRICT | http://www.boontonschools.org/ | SOURCE_DISCOVERY_OWED |
| BOONTON TWP SCH DIST (`nj:school:boonton-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.rvsnj.org/ | SOURCE_DISCOVERY_OWED |
| BORDENTOWN REGIONAL SCHOOL DIST (`nj:school:bordentown-regional-school-dist`) | SCHOOL_DISTRICT | http://WWW.BORDENTOWN.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| BOUND BROOK SCH DIST (`nj:school:bound-brook-sch-dist`) | SCHOOL_DISTRICT | http://www.bbrook.org | SOURCE_DISCOVERY_OWED |
| BRADLEY BEACH ELEM SCH DIST (`nj:school:bradley-beach-elem-sch-dist`) | SCHOOL_DISTRICT | http://www.bbesnj.org | SOURCE_DISCOVERY_OWED |
| BRANCHBURG TWP SCH DIST (`nj:school:branchburg-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.branchburg.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| BRICK TWP SCHOOL DISTRICT (`nj:school:brick-twp-school-district`) | SCHOOL_DISTRICT | http://www.brickschools.org/ | SOURCE_DISCOVERY_OWED |
| BRIDGETON CITY SCH DIST (`nj:school:bridgeton-city-sch-dist`) | SCHOOL_DISTRICT | http://www.jasperdyne.com/bridgeton/ | SOURCE_DISCOVERY_OWED |
| BRIDGEWATER-RARITAN REG SCH DT (`nj:school:bridgewater-raritan-reg-sch-dt`) | SCHOOL_DISTRICT | http://WWW.BRRSD.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| BRIELLE BORO SCH DIST (`nj:school:brielle-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.brielle.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| BROOKLAWN BORO SCH DIST (`nj:school:brooklawn-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.alicecostello.com/ | SOURCE_DISCOVERY_OWED |
| BUENA REGIONAL SCH DIST (`nj:school:buena-regional-sch-dist`) | SCHOOL_DISTRICT | http://WWW.BUENA.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| BURLINGTON CITY SCHOOL DISTRICT (`nj:school:burlington-city-school-district`) | SCHOOL_DISTRICT | HTTP://WWW.BURLINGTON-NJ.NET/ | SOURCE_DISCOVERY_OWED |
| BURLINGTON TWP SCH DIST (`nj:school:burlington-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.burltwpsch.org/ | SOURCE_DISCOVERY_OWED |
| BUTLER PUBLIC SCH DIST (`nj:school:butler-public-sch-dist`) | SCHOOL_DISTRICT | http://www.butlerboe.org/ | SOURCE_DISCOVERY_OWED |
| BYRAM TWP SCH DIST (`nj:school:byram-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.byramschools.org/ | SOURCE_DISCOVERY_OWED |
| CALDWELL-W CALDWELL SCH DIST (`nj:school:caldwell-w-caldwell-sch-dist`) | SCHOOL_DISTRICT | http://www.cwcboe.org/ | SOURCE_DISCOVERY_OWED |
| CALIFON BORO SCH DIST (`nj:school:califon-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.califonschool.org/ | SOURCE_DISCOVERY_OWED |
| CAMDEN CITY SCH DIST (`nj:school:camden-city-sch-dist`) | SCHOOL_DISTRICT | http://www.camden.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| CAPE MAY CITY SCHOOL DIST (`nj:school:cape-may-city-school-dist`) | SCHOOL_DISTRICT | http://www.capemaycityschool.org | SOURCE_DISCOVERY_OWED |
| CARLSTADT-EAST RUTHERFORD REGIONAL HIGH SCHOOL DISTRICT (`nj:school:carlstadt-east-rutherford-regional-high-school-district`) | SCHOOL_DISTRICT | http://WWW.BECTONHS.ORG | SOURCE_DISCOVERY_OWED |
| CARLSTADT PUBLIC SCH DIST (`nj:school:carlstadt-public-sch-dist`) | SCHOOL_DISTRICT | http://www.carlstadt.org/ | SOURCE_DISCOVERY_OWED |
| CARTERET PUBLIC SCH DIST (`nj:school:carteret-public-sch-dist`) | SCHOOL_DISTRICT | http://www.carteretschools.org | SOURCE_DISCOVERY_OWED |
| CEDAR GROVE TWP SCH DIST (`nj:school:cedar-grove-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.CEDARGROVE.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| CENTRAL REG HIGH SCHOOL DIST (`nj:school:central-reg-high-school-dist`) | SCHOOL_DISTRICT | http://WWW.CENTRALREG.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| CHATHAMS SCHOOL DISTRICT (`nj:school:chathams-school-district`) | SCHOOL_DISTRICT | https://www.chatham-nj.org/Domain/1 | SOURCE_DISCOVERY_OWED |
| CHERRY HILL SCHOOL DIST (`nj:school:cherry-hill-school-dist`) | SCHOOL_DISTRICT | https://www.chclc.org/ | SOURCE_DISCOVERY_OWED |
| CHESTER SCH DIST (`nj:school:chester-sch-dist`) | SCHOOL_DISTRICT | http://www.chester-nj.org/ | SOURCE_DISCOVERY_OWED |
| CHESTERFIELD TWP SCH DIST (`nj:school:chesterfield-twp-sch-dist`) | SCHOOL_DISTRICT | HTTP://WWW.CHESTERFIELDSCHOOL.COM | SOURCE_DISCOVERY_OWED |
| CINNAMINSON TWP SCH DIST (`nj:school:cinnaminson-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.CINNAMINSON.COM | SOURCE_DISCOVERY_OWED |
| CLARK TWP SCHOOL DIST (`nj:school:clark-twp-school-dist`) | SCHOOL_DISTRICT | http://WWW.CLARKSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| CLAYTON BORO SCH DIST (`nj:school:clayton-boro-sch-dist`) | SCHOOL_DISTRICT | https://claytonps.org/ | SOURCE_DISCOVERY_OWED |
| CLEARVIEW REG HIGH SCHOOL DIST (`nj:school:clearview-reg-high-school-dist`) | SCHOOL_DISTRICT | http://WWW.CLEARVIEWREGIONAL.EDU | SOURCE_DISCOVERY_OWED |
| CLEMENTON SCH DIST (`nj:school:clementon-sch-dist`) | SCHOOL_DISTRICT | http://www.clementon.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| CLIFFSIDE PK SCH DIST (`nj:school:cliffside-pk-sch-dist`) | SCHOOL_DISTRICT | http://www.cliffsidepark.edu/ | SOURCE_DISCOVERY_OWED |
| CLIFTON PUBLIC SCHOOL DISTRICT (`nj:school:clifton-public-school-district`) | SCHOOL_DISTRICT | HTTP://WWW.CLIFTON.K12.NJ.US/ | SOURCE_DISCOVERY_OWED |
| CLINTON-GLEN GARDNER SCH DIST (`nj:school:clinton-glen-gardner-sch-dist`) | SCHOOL_DISTRICT | http://www.cpsnj.org/ | SOURCE_DISCOVERY_OWED |
| CLINTON TWP SCH DIST (`nj:school:clinton-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.ctsdnj.org/ | SOURCE_DISCOVERY_OWED |
| CLOSTER PUBLIC SCH DIST (`nj:school:closter-public-sch-dist`) | SCHOOL_DISTRICT | https://www.closterschools.org/ | SOURCE_DISCOVERY_OWED |
| COLLINGSWOOD PUBLIC SCHOOL DIST (`nj:school:collingswood-public-school-dist`) | SCHOOL_DISTRICT | HTTPS://COLLINGSWOOD.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| COLTS NECK TWP SCH DIST (`nj:school:colts-neck-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.COLTSNECKSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| COMMERCIAL TWP SCH DIST (`nj:school:commercial-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.commercial.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| CRANBURY TWP SCH DIST (`nj:school:cranbury-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.CRANBURYSCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| CRANFORD PUBLIC SCH DIST (`nj:school:cranford-public-sch-dist`) | SCHOOL_DISTRICT | http://www.cranfordschools.org/ | SOURCE_DISCOVERY_OWED |
| CRESSKILL PUBLIC SCH DIST (`nj:school:cresskill-public-sch-dist`) | SCHOOL_DISTRICT | http://www.cresskillboe.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| CUMBERLAND REG SCH DIST (`nj:school:cumberland-reg-sch-dist`) | SCHOOL_DISTRICT | http://www.crhsd.org/ | SOURCE_DISCOVERY_OWED |
| DEAL BORO SCH DIST (`nj:school:deal-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.DEALSCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| DEERFIELD TWP SCH DIST (`nj:school:deerfield-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.DEERFIELD.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| DELANCO TWP SCH DIST (`nj:school:delanco-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.delanco.com/ | SOURCE_DISCOVERY_OWED |
| DELAWARE TWP SCH DIST (`nj:school:delaware-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.dtsk8.org/ | SOURCE_DISCOVERY_OWED |
| DELAWARE VALLEY REG HIGH SCHOOL DIST (`nj:school:delaware-valley-reg-high-school-dist`) | SCHOOL_DISTRICT | http://www.dvrhs.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| DELRAN TWP SCH DIST (`nj:school:delran-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.delranschools.org/ | SOURCE_DISCOVERY_OWED |
| DELSEA REGIONAL HIGH SCHOOL DISTRICT (`nj:school:delsea-regional-high-school-district`) | SCHOOL_DISTRICT | http://www.delsearegional.us | SOURCE_DISCOVERY_OWED |
| DEMAREST SCH DIST (`nj:school:demarest-sch-dist`) | SCHOOL_DISTRICT | https://nj01001706.schoolwires.net/ | SOURCE_DISCOVERY_OWED |
| DENNIS TWP SCH DIST (`nj:school:dennis-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.dennistwpschools.org/ | SOURCE_DISCOVERY_OWED |
| DENVILLE TWP SCH DIST (`nj:school:denville-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.denville.org/ | SOURCE_DISCOVERY_OWED |
| DEPTFORD TWP SCH DIST (`nj:school:deptford-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.deptford.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| DOVER PUBLIC SCH DIST (`nj:school:dover-public-sch-dist`) | SCHOOL_DISTRICT | https://www.dover-nj.net/ | SOURCE_DISCOVERY_OWED |
| DOWNE TWP SCH DIST (`nj:school:downe-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.downeschool.org/ | SOURCE_DISCOVERY_OWED |
| DUMONT PUBLIC SCH DIST (`nj:school:dumont-public-sch-dist`) | SCHOOL_DISTRICT | http://www.dumontnj.org | SOURCE_DISCOVERY_OWED |
| DUNELLEN PUBLIC SCH DIST (`nj:school:dunellen-public-sch-dist`) | SCHOOL_DISTRICT | http://www.dunellenschools.org/ | SOURCE_DISCOVERY_OWED |
| EAGLESWOOD TWP SCH DIST (`nj:school:eagleswood-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.EAGLESWOOD.ORG | SOURCE_DISCOVERY_OWED |
| EAST AMWELL TWP SCH DIST (`nj:school:east-amwell-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.EASTAMWELL.ORG | SOURCE_DISCOVERY_OWED |
| EAST BRUNSWICK TWP SCH DIST (`nj:school:east-brunswick-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.ebruns.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| EAST GREENWICH TWP SCH DIST (`nj:school:east-greenwich-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.eastgreenwich.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| EAST HANOVER TWP SCH DIST (`nj:school:east-hanover-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.easthanoverschools.org | SOURCE_DISCOVERY_OWED |
| EAST NEWARK SCH DIST (`nj:school:east-newark-sch-dist`) | SCHOOL_DISTRICT | https://www.eastnewarkschool.org/ | SOURCE_DISCOVERY_OWED |
| EAST RUTHERFORD SCH DIST (`nj:school:east-rutherford-sch-dist`) | SCHOOL_DISTRICT | http://www.erboe.net | SOURCE_DISCOVERY_OWED |
| EAST WINDSOR REGIONAL SCHOOL DISTRICT (`nj:school:east-windsor-regional-school-district`) | SCHOOL_DISTRICT | http://eastwindsorregionalschools.com | SOURCE_DISCOVERY_OWED |
| EASTAMPTON TWP SCH DIST (`nj:school:eastampton-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.eastampton.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| EASTERN CAMDEN CNTY REGIONAL SCHOOL DIST (`nj:school:eastern-camden-cnty-regional-school-dist`) | SCHOOL_DISTRICT | http://www.eastern.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| EATONTOWN PUBLIC SCH DIST (`nj:school:eatontown-public-sch-dist`) | SCHOOL_DISTRICT | http://www.eatontown.org | SOURCE_DISCOVERY_OWED |
| EDGEWATER PARK TWP SCH DIST (`nj:school:edgewater-park-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.edgewaterpark.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| EDGEWATER SCH DIST (`nj:school:edgewater-sch-dist`) | SCHOOL_DISTRICT | https://www.edgewaterschools.org/ | SOURCE_DISCOVERY_OWED |
| EGG HARBOR TWP SCH DIST (`nj:school:egg-harbor-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.eht.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| ELIZABETH CITY SCHOOL DISTRICT (`nj:school:elizabeth-city-school-district`) | SCHOOL_DISTRICT | http://www.elizabeth.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| ELK TWP SCH DIST (`nj:school:elk-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.ELK.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| ELMWOOD PARK BORO SCH DIST (`nj:school:elmwood-park-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.epps.org | SOURCE_DISCOVERY_OWED |
| ELSINBORO TWP SCH DIST (`nj:school:elsinboro-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.ELSINBOROSCH.CJB.NET | SOURCE_DISCOVERY_OWED |
| EMERSON SCHOOL DISTRICT (`nj:school:emerson-school-district`) | SCHOOL_DISTRICT | http://www.emersonschools.org/ | SOURCE_DISCOVERY_OWED |
| ENGLEWOOD CLIFFS BORO SCHOOL DIST (`nj:school:englewood-cliffs-boro-school-dist`) | SCHOOL_DISTRICT | http://www.englewoodcliffs.org | SOURCE_DISCOVERY_OWED |
| ESSEX FELLS SCH DIST (`nj:school:essex-fells-sch-dist`) | SCHOOL_DISTRICT | https://www.efsk-6.org/Domain/1 | SOURCE_DISCOVERY_OWED |
| ESTELL MANOR SCHOOL DIST (`nj:school:estell-manor-school-dist`) | SCHOOL_DISTRICT | http://www.estellmanorschool.com | SOURCE_DISCOVERY_OWED |
| EVESHAM TWP SCH DIST (`nj:school:evesham-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.EVESHAM.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| EWING TWP SCH DIST (`nj:school:ewing-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.ewing.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| FAIR HAVEN SCH DIST (`nj:school:fair-haven-sch-dist`) | SCHOOL_DISTRICT | https://WWW.FAIRHAVEN.EDU | SOURCE_DISCOVERY_OWED |
| FAIR LAWN SCH DIST (`nj:school:fair-lawn-sch-dist`) | SCHOOL_DISTRICT | http://www.fairlawnschools.org | SOURCE_DISCOVERY_OWED |
| FAIRFIELD PUBLIC SCH DIST (`nj:school:fairfield-public-sch-dist`) | SCHOOL_DISTRICT | http://www.fpsk6.org/fps/ | SOURCE_DISCOVERY_OWED |
| FAIRFIELD TWP SCH DIST (`nj:school:fairfield-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.fairfield.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| FAIRVIEW BORO SCH DIST (`nj:school:fairview-boro-sch-dist`) | SCHOOL_DISTRICT | https://fairviewps.org/ | SOURCE_DISCOVERY_OWED |
| FARMINGDALE BORO SCH DIST (`nj:school:farmingdale-boro-sch-dist`) | SCHOOL_DISTRICT | http://farmingdaleschool.com/ | SOURCE_DISCOVERY_OWED |
| FLEMINGTON-RARITAN REG SCH DIST (`nj:school:flemington-raritan-reg-sch-dist`) | SCHOOL_DISTRICT | http://WWW.FRSD.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| FLORENCE TWP SCH DIST (`nj:school:florence-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.florence.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| FLORHAM PARK SCH DISTRICT (`nj:school:florham-park-sch-district`) | SCHOOL_DISTRICT | https://www.fpks.org | SOURCE_DISCOVERY_OWED |
| FOLSOM BORO SCHOOL DIST (`nj:school:folsom-boro-school-dist`) | SCHOOL_DISTRICT | http://www.folsomschool.org/ | SOURCE_DISCOVERY_OWED |
| FORT LEE PUBLIC SCH DIST (`nj:school:fort-lee-public-sch-dist`) | SCHOOL_DISTRICT | https://www.flboe.com/ | SOURCE_DISCOVERY_OWED |
| FRANKFORD TWP SCH DIST (`nj:school:frankford-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.FRANKFORDSCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| FRANKLIN BORO SCH DIST (`nj:school:franklin-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.fboe.org/ | SOURCE_DISCOVERY_OWED |
| FRANKLIN LAKES BORO SCH (`nj:school:franklin-lakes-boro-sch`) | SCHOOL_DISTRICT | http://WWW.FRANKLINLAKES.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| FRANKLIN TWP SCH DIST (`nj:school:franklin-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.ftschool.org/ | SOURCE_DISCOVERY_OWED |
| FRANKLIN TWP SCH DIST (`nj:school:franklin-twp-sch-dist-117734`) | SCHOOL_DISTRICT | http://www.franklinboe.org/ | SOURCE_DISCOVERY_OWED |
| FRANKLIN TWP SCH DIST (`nj:school:franklin-twp-sch-dist-117754`) | SCHOOL_DISTRICT | http://www.franklinschool.org | SOURCE_DISCOVERY_OWED |
| FREDON TWP SCH DIST (`nj:school:fredon-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.FREDON.ORG | SOURCE_DISCOVERY_OWED |
| FREEHOLD BORO SCH DIST (`nj:school:freehold-boro-sch-dist`) | SCHOOL_DISTRICT | https://www.freeholdboro.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| FREEHOLD REGIONAL HIGH SCH DIST (`nj:school:freehold-regional-high-sch-dist`) | SCHOOL_DISTRICT | https://www.frhsd.com/ | SOURCE_DISCOVERY_OWED |
| FREEHOLD TWP SCH DIST (`nj:school:freehold-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.FREEHOLDTWP.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| FRELINGHUYSEN SCH DIST (`nj:school:frelinghuysen-sch-dist`) | SCHOOL_DISTRICT | http://WWW.FEN.COM/NJLFRELINGHUYSEN | SOURCE_DISCOVERY_OWED |
| FRENCHTOWN BORO SCH DIST (`nj:school:frenchtown-boro-sch-dist`) | SCHOOL_DISTRICT | https://www.dvrhs.org/FTSD | SOURCE_DISCOVERY_OWED |
| GALLOWAY TWP SCHOOL DIST (`nj:school:galloway-twp-school-dist`) | SCHOOL_DISTRICT | http://WWW.GTPS.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| GARFIELD SCHOOL DISTRICT (`nj:school:garfield-school-district`) | SCHOOL_DISTRICT | http://www.gboe.org/ | SOURCE_DISCOVERY_OWED |
| GARWOOD BORO SCH DIST (`nj:school:garwood-boro-sch-dist`) | SCHOOL_DISTRICT | http://http:s//WWW.GARWOODSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| GATEWAY REGIONAL SCHOOL DIST (`nj:school:gateway-regional-school-dist`) | SCHOOL_DISTRICT | https://www.gatewayhs.com/ | SOURCE_DISCOVERY_OWED |
| GIBBSBORO SCH DIST (`nj:school:gibbsboro-sch-dist`) | SCHOOL_DISTRICT | http://www.gibbsboroschool.org/ | SOURCE_DISCOVERY_OWED |
| GLASSBORO SCH DIST (`nj:school:glassboro-sch-dist`) | SCHOOL_DISTRICT | https://www.gpsd.us/ | SOURCE_DISCOVERY_OWED |
| GLEN RIDGE BORO SCH DIST (`nj:school:glen-ridge-boro-sch-dist`) | SCHOOL_DISTRICT | https://www.glenridge.org/ | SOURCE_DISCOVERY_OWED |
| GLEN ROCK SCH DIST (`nj:school:glen-rock-sch-dist`) | SCHOOL_DISTRICT | http://www.glenrocknj.org/ | SOURCE_DISCOVERY_OWED |
| GLOUCESTER CITY SCHOOL DISTRICT (`nj:school:gloucester-city-school-district`) | SCHOOL_DISTRICT | http://www.gcsd.k12.nj.us | SOURCE_DISCOVERY_OWED |
| GLOUCESTER TWP SCH DIST (`nj:school:gloucester-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.gloucestertownshipschools.org/ | SOURCE_DISCOVERY_OWED |
| GREAT MEADOWS REGIONAL SCHOOL DISTRICT (`nj:school:great-meadows-regional-school-district`) | SCHOOL_DISTRICT | https://WWW.GMRSD.COM | SOURCE_DISCOVERY_OWED |
| GREATER EGG HARBOR REG HIGH SCHOOL DIST (`nj:school:greater-egg-harbor-reg-high-school-dist`) | SCHOOL_DISTRICT | https://www.gehrhsd.net/ | SOURCE_DISCOVERY_OWED |
| GREEN BROOK SCH DIST (`nj:school:green-brook-sch-dist`) | SCHOOL_DISTRICT | https://www.gbtps.org/ | SOURCE_DISCOVERY_OWED |
| GREEN TWP SCH DIST (`nj:school:green-twp-sch-dist`) | SCHOOL_DISTRICT | https://WWW.GREENHILLS.ORG | SOURCE_DISCOVERY_OWED |
| GREENWICH TWP SCH DIST (`nj:school:greenwich-twp-sch-dist`) | SCHOOL_DISTRICT | http://new.greenwichstowcreekpartnershipschools.org/ | SOURCE_DISCOVERY_OWED |
| GREENWICH TWP SCH DIST (`nj:school:greenwich-twp-sch-dist-109275`) | SCHOOL_DISTRICT | http://WWW.GREENWICH.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| GREENWICH TWP SCH DIST (`nj:school:greenwich-twp-sch-dist-117755`) | SCHOOL_DISTRICT | http://www.gtsd.net | SOURCE_DISCOVERY_OWED |
| GUTTENBERG TOWN SCHOOL DISTRICT (`nj:school:guttenberg-town-school-district`) | SCHOOL_DISTRICT | https://www.alkschool.org/ | SOURCE_DISCOVERY_OWED |
| HACKENSACK SCHOOL DISTRICT (`nj:school:hackensack-school-district`) | SCHOOL_DISTRICT | https://www.hackensackschools.org/ | SOURCE_DISCOVERY_OWED |
| HACKETTSTOWN SCH DIST (`nj:school:hackettstown-sch-dist`) | SCHOOL_DISTRICT | http://www.hackettstown.org/ | SOURCE_DISCOVERY_OWED |
| HADDON HEIGHTS BORO SCH DIST (`nj:school:haddon-heights-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.HHSD.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| HADDON TWP SCH DIST (`nj:school:haddon-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.haddontwpschools.com/ | SOURCE_DISCOVERY_OWED |
| HADDONFIELD SCHOOL DIST (`nj:school:haddonfield-school-dist`) | SCHOOL_DISTRICT | http://www.haddonfield.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| HAINESPORT TWP SCH DIST (`nj:school:hainesport-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.hainesport.k12.nj.us | SOURCE_DISCOVERY_OWED |
| HALEDON PUBLIC SCH DIST (`nj:school:haledon-public-sch-dist`) | SCHOOL_DISTRICT | https://www.haledon.org/ | SOURCE_DISCOVERY_OWED |
| HAMBURG BOROUGH SCHOOL DISTRICT (`nj:school:hamburg-borough-school-district`) | SCHOOL_DISTRICT | https://hamburgschool.com | SOURCE_DISCOVERY_OWED |
| HAMILTON TWP SCH DIST (`nj:school:hamilton-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.hamiltonschools.org | SOURCE_DISCOVERY_OWED |
| HAMILTON TWP SCH DIST (`nj:school:hamilton-twp-sch-dist-117693`) | SCHOOL_DISTRICT | http://www.hamilton.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| HAMMONTON TOWN SCH DIST (`nj:school:hammonton-town-sch-dist`) | SCHOOL_DISTRICT | http://www.hammontonps.org | SOURCE_DISCOVERY_OWED |
| HAMPTON BORO SCH DIST (`nj:school:hampton-boro-sch-dist`) | SCHOOL_DISTRICT | https://www.hamptonpublicschool.org | SOURCE_DISCOVERY_OWED |
| HAMPTON TWP SCH DIST (`nj:school:hampton-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.mckeown.org/# | SOURCE_DISCOVERY_OWED |
| HANOVER PARK HIGH SCHOOL DIST (`nj:school:hanover-park-high-school-dist`) | SCHOOL_DISTRICT | https://www.hpreg.org/ | SOURCE_DISCOVERY_OWED |
| HANOVER TWP SCH DIST (`nj:school:hanover-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.hanovertwpschools.com | SOURCE_DISCOVERY_OWED |
| HARDING TWP SCH DIST (`nj:school:harding-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.hardingtwp.org/ | SOURCE_DISCOVERY_OWED |
| HARDYSTON TWP SCH DIST (`nj:school:hardyston-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.htps.org/ | SOURCE_DISCOVERY_OWED |
| HARMONY TWP SCH DIST (`nj:school:harmony-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.htesd.org/ | SOURCE_DISCOVERY_OWED |
| HARRINGTON PARK BORO SCH (`nj:school:harrington-park-boro-sch`) | SCHOOL_DISTRICT | http://WWW.HPSD.ORG | SOURCE_DISCOVERY_OWED |
| HARRISON TWP SCH DIST (`nj:school:harrison-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.harrisontwp.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| HASBROUCK HEIGHTS BORO SCHOOL DIST (`nj:school:hasbrouck-heights-boro-school-dist`) | SCHOOL_DISTRICT | https://www.hhschools.org/ | SOURCE_DISCOVERY_OWED |
| HAWORTH BORO SCH DIST (`nj:school:haworth-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.haworth.org/ | SOURCE_DISCOVERY_OWED |
| HAWTHORNE BORO SCH DIST (`nj:school:hawthorne-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.hawthorne.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| HAZLET TWP SCH DIST (`nj:school:hazlet-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.HAZLET.ORG | SOURCE_DISCOVERY_OWED |
| HENRY HUDSON REGIONAL SCH DIST (`nj:school:henry-hudson-regional-sch-dist`) | SCHOOL_DISTRICT | http://WWW.HENRYHUDSONREG.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| HIGH BRIDGE BORO SCH DIST (`nj:school:high-bridge-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.hbschools.org/ | SOURCE_DISCOVERY_OWED |
| HIGH PT REGIONAL DIST (`nj:school:high-pt-regional-dist`) | SCHOOL_DISTRICT | http://WWW.HPREGIONAL.ORG | SOURCE_DISCOVERY_OWED |
| HIGHLAND PARK BORO SCHOOL DIST (`nj:school:highland-park-boro-school-dist`) | SCHOOL_DISTRICT | http://WWW.HIGHLANDPARK.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| HIGHLANDS BORO SCH DIST (`nj:school:highlands-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.highlandselementary.org | SOURCE_DISCOVERY_OWED |
| HILLSBOROUGH SCH DIST (`nj:school:hillsborough-sch-dist`) | SCHOOL_DISTRICT | http://WWW.HILLSBOROUGH.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| HILLSDALE BORO SCH DIST (`nj:school:hillsdale-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.hillsdaleschools.com/ | SOURCE_DISCOVERY_OWED |
| HILLSIDE TWP SCH DIST (`nj:school:hillside-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.hillsidek12.org/ | SOURCE_DISCOVERY_OWED |
| HOBOKEN CITY SCHOOL DISTRICT (`nj:school:hoboken-city-school-district`) | SCHOOL_DISTRICT | http://www.hoboken.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| HOHOKUS BORO SCH DIST (`nj:school:hohokus-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.hohokus.org/ | SOURCE_DISCOVERY_OWED |
| HOLLAND TWP SCH DIST (`nj:school:holland-twp-sch-dist`) | SCHOOL_DISTRICT | http://hts.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| HOLMDEL TWP SCH DIST (`nj:school:holmdel-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.holmdel.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| HOPATCONG SCHOOL DIST (`nj:school:hopatcong-school-dist`) | SCHOOL_DISTRICT | http://WWW.HOPATCONGSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| HOPE TWP SCH DIST (`nj:school:hope-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.HOPE-ELEM.ORG | SOURCE_DISCOVERY_OWED |
| HOPEWELL TWP SCH DIST (`nj:school:hopewell-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.hopewellcrest.org/ | SOURCE_DISCOVERY_OWED |
| HOPEWELL VALLEY REG SCH DIST (`nj:school:hopewell-valley-reg-sch-dist`) | SCHOOL_DISTRICT | http://www.hvrsd.org/ | SOURCE_DISCOVERY_OWED |
| HOWELL TWP SCH DIST (`nj:school:howell-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.howell.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| HUNTERDON CENTRAL HIGH SCH DIST (`nj:school:hunterdon-central-high-sch-dist`) | SCHOOL_DISTRICT | http://www.hcrhs.k12.nj.us | SOURCE_DISCOVERY_OWED |
| ISLAND HEIGHTS BORO SCH DIST (`nj:school:island-heights-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.islandheights.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| JACKSON TWP SCH DIST (`nj:school:jackson-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.jacksonsd.org/ | SOURCE_DISCOVERY_OWED |
| JAMESBURG BORO SCH DIST (`nj:school:jamesburg-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.jamesburg.org/ | SOURCE_DISCOVERY_OWED |
| JEFFERSON TWP SCH DIST (`nj:school:jefferson-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.JEFFTWP.ORG | SOURCE_DISCOVERY_OWED |
| KEANSBURG BORO SCH DIST (`nj:school:keansburg-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.KEANSBURG.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| KEARNY TOWN SCHOOL DIST (`nj:school:kearny-town-school-dist`) | SCHOOL_DISTRICT | http://WWW.KEARNYSCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| KENILWORTH BORO SCH DIST (`nj:school:kenilworth-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.KENILWORTHSCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| KEYPORT BORO SCH DIST (`nj:school:keyport-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.keyportschools.org/Keyport/_body | SOURCE_DISCOVERY_OWED |
| KINGSWAY REGIONAL HIGH SCHOOL DIST (`nj:school:kingsway-regional-high-school-dist`) | SCHOOL_DISTRICT | http://www.kingsway.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| KINGWOOD TWP SCH DIST (`nj:school:kingwood-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.KINGWOODSCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| KINNELON BORO SCH DIST (`nj:school:kinnelon-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.kinnelonpublicschools.org/ | SOURCE_DISCOVERY_OWED |
| KITTATINNY REGIONAL SCH DIST (`nj:school:kittatinny-regional-sch-dist`) | SCHOOL_DISTRICT | http://WWW.KRHS.NET | SOURCE_DISCOVERY_OWED |
| KNOWLTON TWP SCH DIST (`nj:school:knowlton-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.knowltonschool.com/ | SOURCE_DISCOVERY_OWED |
| LACEY TWP SCH DIST (`nj:school:lacey-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.laceyschools.org/ | SOURCE_DISCOVERY_OWED |
| LAFAYETTE TWP SCH DIST (`nj:school:lafayette-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.ltes.org/ | SOURCE_DISCOVERY_OWED |
| LAKEHURST BORO SCH DIST (`nj:school:lakehurst-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.lakehurstschool.org/ | SOURCE_DISCOVERY_OWED |
| LAKELAND HIGH SCH DIST (`nj:school:lakeland-high-sch-dist`) | SCHOOL_DISTRICT | http://www.lakeland.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| LAKEWOOD PUBLIC SCH DIST (`nj:school:lakewood-public-sch-dist`) | SCHOOL_DISTRICT | https://www.lakewoodpiners.org/ | SOURCE_DISCOVERY_OWED |
| LAUREL SPGS BORO SCH DIST (`nj:school:laurel-spgs-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.laurelspringschool.org/ | SOURCE_DISCOVERY_OWED |
| LAVALLETTE BORO SCH DIST (`nj:school:lavallette-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.lavallettek12.org/lavallette | SOURCE_DISCOVERY_OWED |
| LAWNSIDE BORO SCH DIST (`nj:school:lawnside-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.lawnside.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| LAWRENCE TWP SCH DIST (`nj:school:lawrence-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MLP.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| LAWRENCE TWP SCH DIST (`nj:school:lawrence-twp-sch-dist-117694`) | SCHOOL_DISTRICT | http://WWW.LTPS.ORG | SOURCE_DISCOVERY_OWED |
| LEBANON BOROUGH SCHOOL DISTRICT (`nj:school:lebanon-borough-school-district`) | SCHOOL_DISTRICT | http://lbsd.schoolwires.com/lebanonborough/site/default.asp? | SOURCE_DISCOVERY_OWED |
| LEBANON TWP SCH DIST (`nj:school:lebanon-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LEBTWPK8.ORG. | SOURCE_DISCOVERY_OWED |
| LENAPE REGIONAL SCH DIST (`nj:school:lenape-regional-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LR.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| LENAPE VALLEY REGIONAL HIGH SCH DIST (`nj:school:lenape-valley-regional-high-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LVHS.ORG | SOURCE_DISCOVERY_OWED |
| LEONIA BORO SCH DIST (`nj:school:leonia-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.leoniaschools.org/ | SOURCE_DISCOVERY_OWED |
| LINCOLN PARK BORO SCHOOL DIST (`nj:school:lincoln-park-boro-school-dist`) | SCHOOL_DISTRICT | http://www.lincolnparkboe.org | SOURCE_DISCOVERY_OWED |
| LINDEN CITY SCHOOL DIST (`nj:school:linden-city-school-dist`) | SCHOOL_DISTRICT | http://linden.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| LINDENWOLD BORO SCH DIST (`nj:school:lindenwold-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.lindenwold.k12.nj.us | SOURCE_DISCOVERY_OWED |
| LITTLE EGG HARBOR TWP SCH DIST (`nj:school:little-egg-harbor-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.lehsd.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| LITTLE FALLS TWP SCH DIST (`nj:school:little-falls-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.lfnjschools.org | SOURCE_DISCOVERY_OWED |
| LITTLE FERRY BORO SCH DIST (`nj:school:little-ferry-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LITTLEFERRY.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| LITTLE SILVER BOROUGH SCH DIST (`nj:school:little-silver-borough-sch-dist`) | SCHOOL_DISTRICT | http://www.monmouth.com/~lsboe/ | SOURCE_DISCOVERY_OWED |
| LIVINGSTON TWP SCH DIST (`nj:school:livingston-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.livingston.org/ | SOURCE_DISCOVERY_OWED |
| LODI BORO SCH DIST (`nj:school:lodi-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.lodi.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| LOGAN TWP SCH DIST (`nj:school:logan-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.logan.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| LONG BEACH ISLAND SCH DIST (`nj:school:long-beach-island-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LBI.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| LONG BRANCH CITY SCH DIST (`nj:school:long-branch-city-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LONGBRANCH.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| LONG HILL TWP SCHOOL DIST (`nj:school:long-hill-twp-school-dist`) | SCHOOL_DISTRICT | http://WWW.LONGHILL.ORG | SOURCE_DISCOVERY_OWED |
| LOPATCONG TWP SCH DIST (`nj:school:lopatcong-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.lopatcongschool.org/ | SOURCE_DISCOVERY_OWED |
| LOWER ALLOWAY CREEK TWP SCHOOL DIST (`nj:school:lower-alloway-creek-twp-school-dist`) | SCHOOL_DISTRICT | http://www.lac-k8.net | SOURCE_DISCOVERY_OWED |
| LOWER CAPE MAY REG SCHOOL DIST (`nj:school:lower-cape-may-reg-school-dist`) | SCHOOL_DISTRICT | http://lcmrschool.org/ | SOURCE_DISCOVERY_OWED |
| LOWER TWP SCH DIST (`nj:school:lower-twp-sch-dist`) | SCHOOL_DISTRICT | http://lowertwpschools.com/ | SOURCE_DISCOVERY_OWED |
| LUMBERTON TWP SCH DIST (`nj:school:lumberton-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.LUMBERTON.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| LYNDHURST TWP SCH DIST (`nj:school:lyndhurst-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.lyndhurstschools.net/ | SOURCE_DISCOVERY_OWED |
| MADISON BORO SCH DIST (`nj:school:madison-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.ROSENET.ORG/MADISONPUBLICSCHOOLS | SOURCE_DISCOVERY_OWED |
| MAGNOLIA BORO SCH DIST (`nj:school:magnolia-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.magnoliaschools.org/ | SOURCE_DISCOVERY_OWED |
| MAHWAH TWP SCH DIST (`nj:school:mahwah-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.mahwah.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| MAINLAND REG HIGH SCHOOL DIST (`nj:school:mainland-reg-high-school-dist`) | SCHOOL_DISTRICT | http://WWW.MAINLANDREGIONAL.NET | SOURCE_DISCOVERY_OWED |
| MANALAPAN-ENGLISHTOWN REG SCH DIST (`nj:school:manalapan-englishtown-reg-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MERS.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| MANASQUAN BORO SCH DIST (`nj:school:manasquan-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.manasquanboe.org/ | SOURCE_DISCOVERY_OWED |
| MANCHESTER TWP SCH DIST (`nj:school:manchester-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.manchestertwp.org/ | SOURCE_DISCOVERY_OWED |
| MANNINGTON TWP SCH DIST (`nj:school:mannington-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.manningtonschool.org/ | SOURCE_DISCOVERY_OWED |
| MANSFIELD TWP SCH DIST (`nj:school:mansfield-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MANSFIELDSCHOOL.COM | SOURCE_DISCOVERY_OWED |
| MANSFIELD TWP SCH DIST (`nj:school:mansfield-twp-sch-dist-109311`) | SCHOOL_DISTRICT | http://www.warrennet.org/mansfield/ | SOURCE_DISCOVERY_OWED |
| MANTUA TWP SCH DIST (`nj:school:mantua-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.mantuaschools.com/ | SOURCE_DISCOVERY_OWED |
| MANVILLE BORO SCH DIST (`nj:school:manville-boro-sch-dist`) | SCHOOL_DISTRICT | HTTP://WWW.MANVILLESCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| MAPLE SHADE TWP SCH DIST (`nj:school:maple-shade-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MAPLESHADE.ORG | SOURCE_DISCOVERY_OWED |
| MARLBORO TWP SCH DIST (`nj:school:marlboro-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MARLBORO.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| MATAWAN-ABERDEEN REG SCH DIST (`nj:school:matawan-aberdeen-reg-sch-dist`) | SCHOOL_DISTRICT | http://www.marsd.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| MAURICE RIVER TWP SCH DIST (`nj:school:maurice-river-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.mrtschool.com/ | SOURCE_DISCOVERY_OWED |
| MAYWOOD BORO SCH DIST (`nj:school:maywood-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.maywoodschools.org/index.php | SOURCE_DISCOVERY_OWED |
| MEDFORD LAKES BOROUGH SCH DIST (`nj:school:medford-lakes-borough-sch-dist`) | SCHOOL_DISTRICT | https://www.medford.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| MEDFORD TWP SCH DIST (`nj:school:medford-twp-sch-dist`) | SCHOOL_DISTRICT | https://WWW.MEDFORD.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| MENDHAM BORO SCH DIST (`nj:school:mendham-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MENDHAMBORO.ORG | SOURCE_DISCOVERY_OWED |
| MENDHAM TWP SCH DIST (`nj:school:mendham-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.mendhamtwp.org/ | SOURCE_DISCOVERY_OWED |
| MERCHANTVILLE BORO SCH DIST (`nj:school:merchantville-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.merchantville.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| METUCHEN BORO SCH DIST (`nj:school:metuchen-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.metuchenschools.org/metuchen | SOURCE_DISCOVERY_OWED |
| MIDDLE TWP SCH DIST (`nj:school:middle-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.middletwp.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| MIDDLESEX BORO SCH DIST (`nj:school:middlesex-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.middlesex.k12.nj.us | SOURCE_DISCOVERY_OWED |
| MIDDLETOWN TWP SCH DIST (`nj:school:middletown-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.middletownk12.org/ | SOURCE_DISCOVERY_OWED |
| MIDLAND PARK SCH DIST (`nj:school:midland-park-sch-dist`) | SCHOOL_DISTRICT | http://midlandparkschools.k12.nj.us | SOURCE_DISCOVERY_OWED |
| MILFORD BORO SCH DIST (`nj:school:milford-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.milfordpublicschool.com | SOURCE_DISCOVERY_OWED |
| MILLBURN TWP SCH DIST (`nj:school:millburn-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.edline.net/pages/Millburn_Township_PS | SOURCE_DISCOVERY_OWED |
| MILLSTONE TWP SCH DIST (`nj:school:millstone-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MILLSTONE.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| MILLTOWN BORO SCH DIST (`nj:school:milltown-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.milltownps.org | SOURCE_DISCOVERY_OWED |
| MILLVILLE CITY SCHOOL DISTRICT (`nj:school:millville-city-school-district`) | SCHOOL_DISTRICT | http://WWW.MILLVILLE.ORG | SOURCE_DISCOVERY_OWED |
| MINE HILL TWP SCH DIST (`nj:school:mine-hill-twp-sch-dist`) | SCHOOL_DISTRICT | http://minehill.com/schools/ | SOURCE_DISCOVERY_OWED |
| MONMOUTH BEACH BORO SCH DIST (`nj:school:monmouth-beach-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.expage.com/page/monbeachschool | SOURCE_DISCOVERY_OWED |
| MONMOUTH REG HIGH SCHOOL DIST (`nj:school:monmouth-reg-high-school-dist`) | SCHOOL_DISTRICT | http://WWW.MONMOUTHREGIONAL.NET | SOURCE_DISCOVERY_OWED |
| MONROE TWP SCH DIST (`nj:school:monroe-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.monroetwp.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| MONROE TWP SCH DIST (`nj:school:monroe-twp-sch-dist-181330`) | SCHOOL_DISTRICT | https://www.monroe.k12.nj.us/Domain/1 | SOURCE_DISCOVERY_OWED |
| MONTAGUE TWP SCH DIST (`nj:school:montague-twp-sch-dist`) | SCHOOL_DISTRICT | HTTP://WWW.MONTAGUESCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| MONTGOMERY TWP SCH DIST (`nj:school:montgomery-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.mtsd.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| MONTVALE BORO SCHOOL DIST (`nj:school:montvale-boro-school-dist`) | SCHOOL_DISTRICT | https://www.montvalek8.org/ | SOURCE_DISCOVERY_OWED |
| MONTVILLE TWP SCH DIST (`nj:school:montville-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MONTVILLE.NET | SOURCE_DISCOVERY_OWED |
| MOONACHIE BORO SCH DIST (`nj:school:moonachie-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.rlcraig.org/ | SOURCE_DISCOVERY_OWED |
| MOORESTOWN TWP SCH DIST (`nj:school:moorestown-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MTPS.COM | SOURCE_DISCOVERY_OWED |
| MORRIS HILLS REGIONAL DIST (`nj:school:morris-hills-regional-dist`) | SCHOOL_DISTRICT | http://www.mhrd.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| MORRIS PLAINS SCH DIST (`nj:school:morris-plains-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MORRIS.K12.NJ.US/MPS | SOURCE_DISCOVERY_OWED |
| MORRIS SCH DIST (`nj:school:morris-sch-dist`) | SCHOOL_DISTRICT | http://www.morrisschooldistrict.org/ | SOURCE_DISCOVERY_OWED |
| MOUNT ARLINGTON BORO SCH DIST (`nj:school:mount-arlington-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.gti.net/mtas/ | SOURCE_DISCOVERY_OWED |
| MOUNT HOLLY TWP SCH DIST (`nj:school:mount-holly-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.mtholly.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| MOUNT LAUREL TWP SCH DIST (`nj:school:mount-laurel-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.mountlaurel.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| MOUNT OLIVE TWP SCH DIST (`nj:school:mount-olive-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.mtoliveboe.org/ | SOURCE_DISCOVERY_OWED |
| MOUNTAIN LAKES BORO SCH DIST (`nj:school:mountain-lakes-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MTLAKES.ORG | SOURCE_DISCOVERY_OWED |
| MOUNTAINSIDE BORO SCHOOL DIST (`nj:school:mountainside-boro-school-dist`) | SCHOOL_DISTRICT | http://www.mountainsideschools.org/ | SOURCE_DISCOVERY_OWED |
| MT EPHRAIM BORO SCH DIST (`nj:school:mt-ephraim-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.mtephraimschools.org/ | SOURCE_DISCOVERY_OWED |
| MULLICA TWP SCH DIST (`nj:school:mullica-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.mullicaschools.com | SOURCE_DISCOVERY_OWED |
| NATIONAL PARK BORO SCHOOL DIST (`nj:school:national-park-boro-school-dist`) | SCHOOL_DISTRICT | http://www.npelem.com/ | SOURCE_DISCOVERY_OWED |
| NEPTUNE CITY BORO SCHOOL DIST (`nj:school:neptune-city-boro-school-dist`) | SCHOOL_DISTRICT | http://MYSCHOOLONLINE.COM/NJ/WILSON | SOURCE_DISCOVERY_OWED |
| NEPTUNE TWP SCH DIST (`nj:school:neptune-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.NEPTUNE.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| NETCONG BORO SCH DIST (`nj:school:netcong-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.netcongschool.org/ | SOURCE_DISCOVERY_OWED |
| NEW HANOVER TWP SCH DIST (`nj:school:new-hanover-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.newhanover.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| NEW MILFORD BORO SCH DIST (`nj:school:new-milford-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.NEWMILFORDSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| NEW PROVIDENCE BORO SCH DIST (`nj:school:new-providence-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.npsd.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| NEWARK CITY SCHOOL SYSTEM (`nj:school:newark-city-school-system`) | SCHOOL_DISTRICT | http://WWW.NPS.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| NEWTON TOWN SCH DIST (`nj:school:newton-town-sch-dist`) | SCHOOL_DISTRICT | http://www.newtonnj.org/ | SOURCE_DISCOVERY_OWED |
| NORTH ARLINGTON SCH DIST (`nj:school:north-arlington-sch-dist`) | SCHOOL_DISTRICT | http://www.narlington.k12.nj.us | SOURCE_DISCOVERY_OWED |
| NORTH BERGEN TWP SCHOOL DISTRICT (`nj:school:north-bergen-twp-school-district`) | SCHOOL_DISTRICT | http://www.northbergen.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| NORTH BRUNSWICK TWP SCH DIST (`nj:school:north-brunswick-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.NBTSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| NORTH BURLINGTON COUNTY REGIONAL HIGH SCHOOL DISTRICT (`nj:school:north-burlington-county-regional-high-school-district`) | SCHOOL_DISTRICT | http://WWW.NBURLINGTON.COM | SOURCE_DISCOVERY_OWED |
| NORTH CALDWELL BORO SCH DIST (`nj:school:north-caldwell-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.ncboe.org/ | SOURCE_DISCOVERY_OWED |
| NORTH HALEDON BOROUGH SCHOOL DISTRICT (`nj:school:north-haledon-borough-school-district`) | SCHOOL_DISTRICT | http://WWW.NORTHHALEDONSCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| NORTH HANOVER TWP SCH DIST (`nj:school:north-hanover-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.nhanover.com/ | SOURCE_DISCOVERY_OWED |
| NORTH HUNTERDON-VOORHEES REG SCH DIST (`nj:school:north-hunterdon-voorhees-reg-sch-dist`) | SCHOOL_DISTRICT | http://WWW.NHVWEB.NET | SOURCE_DISCOVERY_OWED |
| NORTH PLAINFIELD BORO SCHOOL DIST (`nj:school:north-plainfield-boro-school-dist`) | SCHOOL_DISTRICT | http://www.nplainfield.org/ | SOURCE_DISCOVERY_OWED |
| NORTH WARREN REG SCH DIST (`nj:school:north-warren-reg-sch-dist`) | SCHOOL_DISTRICT | http://www.northwarren.org/ | SOURCE_DISCOVERY_OWED |
| NORTH WILDWOOD CITY SCHOOL DIST (`nj:school:north-wildwood-city-school-dist`) | SCHOOL_DISTRICT | http://MMACE.CAPEMAYSCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| NORTHERN HIGHLANDS REG HIGH SCHOOL DIST (`nj:school:northern-highlands-reg-high-school-dist`) | SCHOOL_DISTRICT | http://www.northernhighlands.org/ | SOURCE_DISCOVERY_OWED |
| NORTHERN VALLEY REG HIGH SCHOOL DISTRICT (`nj:school:northern-valley-reg-high-school-district`) | SCHOOL_DISTRICT | http://WWW.NVNET.ORG | SOURCE_DISCOVERY_OWED |
| NORTHFIELD CITY SCHOOL DIST (`nj:school:northfield-city-school-dist`) | SCHOOL_DISTRICT | http://northfield.groupfusion.net/ | SOURCE_DISCOVERY_OWED |
| NORTHVALE BORO SCH DIST (`nj:school:northvale-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.nvnet.org/k8/nvale/index.html | SOURCE_DISCOVERY_OWED |
| NORWOOD BORO SCH DIST (`nj:school:norwood-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.nvnet.org/k8/norwood/index.html | SOURCE_DISCOVERY_OWED |
| NUTLEY TOWN SCH DIST (`nj:school:nutley-town-sch-dist`) | SCHOOL_DISTRICT | http://www.nutleyschools.org/ | SOURCE_DISCOVERY_OWED |
| OAKLAND BORO SCH DIST (`nj:school:oakland-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.oaklandschoolsnj.org | SOURCE_DISCOVERY_OWED |
| OAKLYN BORO SCH DIST (`nj:school:oaklyn-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.oaklyn.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| OCEAN CITY SCHOOL DIST (`nj:school:ocean-city-school-dist`) | SCHOOL_DISTRICT | http://www.ocean.city.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| OCEAN GATE BORO SCH DIST (`nj:school:ocean-gate-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.oceangateschool.net | SOURCE_DISCOVERY_OWED |
| OCEAN TWP SCH DIST (`nj:school:ocean-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.otsdk6.org | SOURCE_DISCOVERY_OWED |
| OCEANPORT BORO SCH DIST (`nj:school:oceanport-boro-sch-dist`) | SCHOOL_DISTRICT | https://WWW.OCEANPORT.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| OGDENSBURG BORO SCH DIST (`nj:school:ogdensburg-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.obboe.com/ | SOURCE_DISCOVERY_OWED |
| OLD BRIDGE TWP PUBLIC SCHS. (`nj:school:old-bridge-twp-public-schs`) | SCHOOL_DISTRICT | https://www.oldbridgeadmin.org/ | SOURCE_DISCOVERY_OWED |
| OLD TAPPAN BORO SCH DIST (`nj:school:old-tappan-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.oldtappanschools.org/ | SOURCE_DISCOVERY_OWED |
| OLDMANS TWP SCH DIST (`nj:school:oldmans-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.oldmans.org | SOURCE_DISCOVERY_OWED |
| ORADELL BORO SCH DIST (`nj:school:oradell-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.oradell.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| OXFORD TWP SCH DIST (`nj:school:oxford-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.oxfordcentral.org/ | SOURCE_DISCOVERY_OWED |
| PALISADES PARK BORO SCH DIST (`nj:school:palisades-park-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.palpkschools.org/ | SOURCE_DISCOVERY_OWED |
| PALYMRA BORO SCH DIST (`nj:school:palymra-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.palmyra.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PARAMUS BORO SCH DIST (`nj:school:paramus-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.PARAMUS.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| PARK RIDGE BORO SCH DIST (`nj:school:park-ridge-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.parkridge.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PARSIPPANY TROY HILLS SCHOOL DIST (`nj:school:parsippany-troy-hills-school-dist`) | SCHOOL_DISTRICT | http://www.pthsd.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PASCACK VALLEY REG HIGH SCHOOL DIST (`nj:school:pascack-valley-reg-high-school-dist`) | SCHOOL_DISTRICT | http://www.pascack.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PASSAIC CITY SCH DIST (`nj:school:passaic-city-sch-dist`) | SCHOOL_DISTRICT | http://www.passaic-city.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PASSAIC CNTY-MANCHESTER REG SCHOOL DIST (`nj:school:passaic-cnty-manchester-reg-school-dist`) | SCHOOL_DISTRICT | http://www.mrhs.net/ | SOURCE_DISCOVERY_OWED |
| PASSAIC VALLEY REGIONAL HIGH SCHOOL DISTRICT 1 (`nj:school:passaic-valley-regional-high-school-district-1`) | SCHOOL_DISTRICT | http://www.pvhs.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PATERSON PUBLIC SCHOOL DISTRICT (`nj:school:paterson-public-school-district`) | SCHOOL_DISTRICT | http://www.paterson.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PAULSBORO BORO SCH DIST (`nj:school:paulsboro-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.paulsboro.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PEMBERTON TWP SCH DIST (`nj:school:pemberton-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.PEMBERTON.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| PENNS GROVE CARNEYS POINT REG SCH DIST (`nj:school:penns-grove-carneys-point-reg-sch-dist`) | SCHOOL_DISTRICT | http://WWW.PENNSGROVE.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| PENNSAUKEN TWP SCH DIST (`nj:school:pennsauken-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.PENNSAUKEN.NET | SOURCE_DISCOVERY_OWED |
| PENNSVILLE SCHOOL DIST (`nj:school:pennsville-school-dist`) | SCHOOL_DISTRICT | http://WWW.PENNSVILLE.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| PEQUANNOCK TWP SCH DIST (`nj:school:pequannock-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.pequannock.org/ | SOURCE_DISCOVERY_OWED |
| PERTH AMBOY SCH DIST (`nj:school:perth-amboy-sch-dist`) | SCHOOL_DISTRICT | http://www.perthamboy.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PHILLIPSBURG TOWN SCHOOL DIST (`nj:school:phillipsburg-town-school-dist`) | SCHOOL_DISTRICT | http://WWW.PBURG.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| PINE HILL BORO SCH DIST (`nj:school:pine-hill-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.pinehill.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| PINELANDS REG SCH DIST (`nj:school:pinelands-reg-sch-dist`) | SCHOOL_DISTRICT | http://www.pinelandsregional.org/ | SOURCE_DISCOVERY_OWED |
| PISCATAWAY TWP SCH DIST (`nj:school:piscataway-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.FAMILYEDUCATION.COM/NJ/PISCATAWAY | SOURCE_DISCOVERY_OWED |
| PITMAN BORO SCH DIST (`nj:school:pitman-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.PITMAN.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| PITTSGROVE TWP SCH DIST (`nj:school:pittsgrove-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.PITTSGROVE.ORG | SOURCE_DISCOVERY_OWED |
| PLAINFIELD SCHOOL DISTRICT (`nj:school:plainfield-school-district`) | SCHOOL_DISTRICT | http://www.plainfieldnjk12.org/ | SOURCE_DISCOVERY_OWED |
| PLEASANTVILLE CITY SCHOOL DIST (`nj:school:pleasantville-city-school-dist`) | SCHOOL_DISTRICT | http://WWW.PLEASANTVILLE.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| PLUMSTED TWP SCH DIST (`nj:school:plumsted-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.newegypt.us/ | SOURCE_DISCOVERY_OWED |
| POHATCONG TWP SCH DIST (`nj:school:pohatcong-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.pohatcong.com/school | SOURCE_DISCOVERY_OWED |
| POINT PLEASANT BEACH BORO SCH DIST (`nj:school:point-pleasant-beach-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.ptbeach.com/ | SOURCE_DISCOVERY_OWED |
| POINT PLEASANT BOROUGH SCH DIST (`nj:school:point-pleasant-borough-sch-dist`) | SCHOOL_DISTRICT | http://WWW.POINTPLEASANT.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| POMPTON LAKES BORO SCHOOL DIST (`nj:school:pompton-lakes-boro-school-dist`) | SCHOOL_DISTRICT | http://PLPS.ORG | SOURCE_DISCOVERY_OWED |
| PRINCETON PUBLIC SCH DIST (`nj:school:princeton-public-sch-dist`) | SCHOOL_DISTRICT | http://WWW.PRS.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| PROSPECT PARK BORO SCHOOL DIST (`nj:school:prospect-park-boro-school-dist`) | SCHOOL_DISTRICT | http://www.prospectparknj.com | SOURCE_DISCOVERY_OWED |
| QUINTON TWP SCH DIST (`nj:school:quinton-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.quintonschool.info/ | SOURCE_DISCOVERY_OWED |
| RAHWAY SCHOOL DIST (`nj:school:rahway-school-dist`) | SCHOOL_DISTRICT | https://www.rahway.net/ | SOURCE_DISCOVERY_OWED |
| RAMAPO-INDIAN HILLS REG HIGH SCHOOL DIST (`nj:school:ramapo-indian-hills-reg-high-school-dist`) | SCHOOL_DISTRICT | http://www.rih.org/ | SOURCE_DISCOVERY_OWED |
| RAMSEY BORO SCH DIST (`nj:school:ramsey-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.RAMSEY.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| RANCOCAS VALLEY REG HIGH SCHOOL DIST (`nj:school:rancocas-valley-reg-high-school-dist`) | SCHOOL_DISTRICT | http://WWW.RVRHS.COM | SOURCE_DISCOVERY_OWED |
| RANDOLPH TWP SCH DIST (`nj:school:randolph-twp-sch-dist`) | SCHOOL_DISTRICT | https://WWW.RTNJ.ORG | SOURCE_DISCOVERY_OWED |
| READINGTON TWP SCH DIST (`nj:school:readington-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.READINGTON.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| RED BANK BORO SCH DIST (`nj:school:red-bank-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.redbankregional.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| RED BANK REGIONAL HIGH SCH DIST (`nj:school:red-bank-regional-high-sch-dist`) | SCHOOL_DISTRICT | http://WWW.REDBANKREGIONAL.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| RIDGEFIELD BORO SCH DIST (`nj:school:ridgefield-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.ridgefieldschools.com | SOURCE_DISCOVERY_OWED |
| RIDGEFIELD PARK VIL SCHOOL D (`nj:school:ridgefield-park-vil-school-d`) | SCHOOL_DISTRICT | http://WWW.RPPS.NET | SOURCE_DISCOVERY_OWED |
| RIDGEWOOD TWP SCHOOL DISTRICT (`nj:school:ridgewood-twp-school-district`) | SCHOOL_DISTRICT | http://www.ridgewood.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| RINGWOOD BORO SCH DIST (`nj:school:ringwood-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.ringwoodschools.org/ | SOURCE_DISCOVERY_OWED |
| RIVER DELL REGIONAL HIGH SCH DIST (`nj:school:river-dell-regional-high-sch-dist`) | SCHOOL_DISTRICT | http://www.riverdell.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| RIVER EDGE BORO SCH DIST (`nj:school:river-edge-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.riveredgeschools.org/ | SOURCE_DISCOVERY_OWED |
| RIVER VALE TWP SCH DIST (`nj:school:river-vale-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.RIVERVALESCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| RIVERDALE BORO SCH DIST (`nj:school:riverdale-boro-sch-dist`) | SCHOOL_DISTRICT | https://www.rpsnj.org/ | SOURCE_DISCOVERY_OWED |
| RIVERSIDE TWP SCHOOL DIST (`nj:school:riverside-twp-school-dist`) | SCHOOL_DISTRICT | http://www.riverside.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| RIVERTON BORO SCH DIST (`nj:school:riverton-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.RIVERTON.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| ROBBINSVILLE SCHOOL DISTRICT (`nj:school:robbinsville-school-district`) | SCHOOL_DISTRICT | http://www.robbinsville.k12.nj.us/rpsd/site/default.asp | SOURCE_DISCOVERY_OWED |
| ROCHELLE PARK SCH DIST (`nj:school:rochelle-park-sch-dist`) | SCHOOL_DISTRICT | http://www.rp.bergen.org/ | SOURCE_DISCOVERY_OWED |
| ROCKAWAY BORO SCH DIST (`nj:school:rockaway-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.rockboro.org | SOURCE_DISCOVERY_OWED |
| ROCKAWAY TWP SCH DIST (`nj:school:rockaway-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.morris.k12.nj.us/rocktwp/ | SOURCE_DISCOVERY_OWED |
| ROOSEVELT BORO SCH DIST (`nj:school:roosevelt-boro-sch-dist`) | SCHOOL_DISTRICT | http://RPSI.ORG | SOURCE_DISCOVERY_OWED |
| ROSELAND BORO SCH DIST (`nj:school:roseland-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.roselandnjboe.org/rose/ | SOURCE_DISCOVERY_OWED |
| ROSELLE BORO SCH DIST (`nj:school:roselle-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.ROSELLESCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| ROSELLE PARK BORO SCH DIST (`nj:school:roselle-park-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.rpsd.org | SOURCE_DISCOVERY_OWED |
| ROXBURY TWP SCH DIST (`nj:school:roxbury-twp-sch-dist`) | SCHOOL_DISTRICT | HTTP://WWW.ROXBURY.ORG | SOURCE_DISCOVERY_OWED |
| RUMSON BORO SCH DIST (`nj:school:rumson-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.RUMSON.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| RUMSON FAIR HAVEN REG HIGH SCHOOL DIST (`nj:school:rumson-fair-haven-reg-high-school-dist`) | SCHOOL_DISTRICT | http://WWW.RFHRHS.ORG | SOURCE_DISCOVERY_OWED |
| RUNNEMEDE BORO SCH DIST (`nj:school:runnemede-boro-sch-dist`) | SCHOOL_DISTRICT | HTTPS://WWW.RUNNEMEDESCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| RUTHERFORD BORO SCH DIST (`nj:school:rutherford-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.rutherfordschools.org/ | SOURCE_DISCOVERY_OWED |
| SADDLE BROOK TWP SCH DIST (`nj:school:saddle-brook-twp-sch-dist`) | SCHOOL_DISTRICT | http://saddlebrookschools.org/ | SOURCE_DISCOVERY_OWED |
| SADDLE RIVER BORO SCH DIST (`nj:school:saddle-river-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.wandellschool.org | SOURCE_DISCOVERY_OWED |
| SALEM SCHOOL DISTRICT (`nj:school:salem-school-district`) | SCHOOL_DISTRICT | http://WWW.SALEMNJ.ORG | SOURCE_DISCOVERY_OWED |
| SANDYSTON-WALPACK SCHOOL DIST (`nj:school:sandyston-walpack-school-dist`) | SCHOOL_DISTRICT | http://users.tellurian.net/sws/ | SOURCE_DISCOVERY_OWED |
| SAYREVILLE BORO SCH DIST (`nj:school:sayreville-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.sayrevillek12.net/ | SOURCE_DISCOVERY_OWED |
| SCOTCH PLAINS FANWOOD REG SCHOOL DIST (`nj:school:scotch-plains-fanwood-reg-school-dist`) | SCHOOL_DISTRICT | http://www.spfk12.org/ | SOURCE_DISCOVERY_OWED |
| SEA GIRT SCH DIST (`nj:school:sea-girt-sch-dist`) | SCHOOL_DISTRICT | http://www.seagirt.k12.nj.us | SOURCE_DISCOVERY_OWED |
| SEASIDE HEIGHTS BORO SCHOOL DIST (`nj:school:seaside-heights-boro-school-dist`) | SCHOOL_DISTRICT | http://www.ssheights.k12.nj.us | SOURCE_DISCOVERY_OWED |
| SECAUCAS TOWN SCH DIST (`nj:school:secaucas-town-sch-dist`) | SCHOOL_DISTRICT | http://www.sboe.org/ | SOURCE_DISCOVERY_OWED |
| SHAMONG TWP SCH DIST (`nj:school:shamong-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.ims.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| SHORE REGIONAL HIGH SCHOOL DISTRICT (`nj:school:shore-regional-high-school-district`) | SCHOOL_DISTRICT | https://www.shoreregional.org/ | SOURCE_DISCOVERY_OWED |
| SHREWSBURY BORO SCH DIST (`nj:school:shrewsbury-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SBS.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| SOMERDALE BORO SCH DIST (`nj:school:somerdale-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.somerdale-park.org/ | SOURCE_DISCOVERY_OWED |
| SOMERS POINT CITY SCH DIST (`nj:school:somers-point-city-sch-dist`) | SCHOOL_DISTRICT | http://www.somersptschools.org/ | SOURCE_DISCOVERY_OWED |
| SOMERSET HILLS SCHOOL DISTRICT (`nj:school:somerset-hills-school-district`) | SCHOOL_DISTRICT | HTTP://WWW.SHSD.ORG/ | SOURCE_DISCOVERY_OWED |
| SOMERVILLE BORO SCH DIST (`nj:school:somerville-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.somervillenjk12.org | SOURCE_DISCOVERY_OWED |
| SOUTH AMBOY CITY SCHOOL DIST (`nj:school:south-amboy-city-school-dist`) | SCHOOL_DISTRICT | http://www.saboe.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| SOUTH BOUND BROOK BORO SCHOOL DIST (`nj:school:south-bound-brook-boro-school-dist`) | SCHOOL_DISTRICT | http://www.rmschool.com/ | SOURCE_DISCOVERY_OWED |
| SOUTH BRUNSWICK TWP SCH DIST (`nj:school:south-brunswick-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SBSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| SOUTH HACKENSACK TWP SCH DIST (`nj:school:south-hackensack-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.shmemorial.org | SOURCE_DISCOVERY_OWED |
| SOUTH HARRISON TWP SCH DIST (`nj:school:south-harrison-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SOUTHHARRISON.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| SOUTH HUNTERDON REGIONAL SCH DIST (`nj:school:south-hunterdon-regional-sch-dist`) | SCHOOL_DISTRICT | http://www.shrsd.org | SOURCE_DISCOVERY_OWED |
| SOUTH ORANGE-MAPLEWOOD SCHOOL DIST (`nj:school:south-orange-maplewood-school-dist`) | SCHOOL_DISTRICT | http://www.somsd.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| SOUTH PLAINFIELD BORO SCHOOL DIST (`nj:school:south-plainfield-boro-school-dist`) | SCHOOL_DISTRICT | http://www.spnet.k12.nj.us/district.htm | SOURCE_DISCOVERY_OWED |
| SOUTH REGIONAL HIGH SCH DIST (`nj:school:south-regional-high-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SRSD.ORG | SOURCE_DISCOVERY_OWED |
| SOUTH RIVER BORO SCH DIST (`nj:school:south-river-boro-sch-dist`) | SCHOOL_DISTRICT | https://www.srivernj.org/ | SOURCE_DISCOVERY_OWED |
| SOUTHAMPTON TWP SCH DIST (`nj:school:southampton-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.FAMILYEDUCATION.COM/NJ/SOUTHAMPTON | SOURCE_DISCOVERY_OWED |
| SPARTA TWP SCH DIST (`nj:school:sparta-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.sparta.org/ | SOURCE_DISCOVERY_OWED |
| SPOTSWOOD BORO SCH DIST (`nj:school:spotswood-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.spotswood.k12.nj.us | SOURCE_DISCOVERY_OWED |
| SPRING LAKE BORO SCH DIST (`nj:school:spring-lake-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.hwmountz.k12.nj.us | SOURCE_DISCOVERY_OWED |
| SPRING LAKE HGHT BORO SCH DIST (`nj:school:spring-lake-hght-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SLH.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| SPRINGFIELD PUBLIC SCH DIST (`nj:school:springfield-public-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SPRINGFIELDSCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| SPRINGFIELD TWP SCH DIST (`nj:school:springfield-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.SPRINGFIELDSCHOOL.ORG | SOURCE_DISCOVERY_OWED |
| STAFFORD TWP SCH DIST (`nj:school:stafford-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.STAFFORDSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| STANHOPE BORO SCH DIST (`nj:school:stanhope-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.STANHOPESCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| STERLING HIGH SCH DIST (`nj:school:sterling-high-sch-dist`) | SCHOOL_DISTRICT | http://WWW.STERLING.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| STILLWATER TWP SCH DIST (`nj:school:stillwater-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.stillwaterschool.net/ | SOURCE_DISCOVERY_OWED |
| STONE HARBOR SCH DIST (`nj:school:stone-harbor-sch-dist`) | SCHOOL_DISTRICT | http://sh.capemayschools.com/ | SOURCE_DISCOVERY_OWED |
| STOW CREEK TWP SCH DIST (`nj:school:stow-creek-twp-sch-dist`) | SCHOOL_DISTRICT | HTTP://NEW.GREENWICHSTOWCREEKPARTNERSHIPSCHOOLS.ORG/ | SOURCE_DISCOVERY_OWED |
| STRATFORD BORO SCH DIST (`nj:school:stratford-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.stratford.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| SUSSEX WANTAGE REGIONAL SCHOOL DIST (`nj:school:sussex-wantage-regional-school-dist`) | SCHOOL_DISTRICT | http://www.swregional.org | SOURCE_DISCOVERY_OWED |
| SWEDESBORO-WOOLWICH SCH DIST (`nj:school:swedesboro-woolwich-sch-dist`) | SCHOOL_DISTRICT | http://swedesboro-woolwich.com/ | SOURCE_DISCOVERY_OWED |
| TABERNACLE TWP SCH DIST (`nj:school:tabernacle-twp-sch-dist`) | SCHOOL_DISTRICT | http://TABERNACLE.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| TEANECK TWP SCH DIST (`nj:school:teaneck-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.teaneckschools.org | SOURCE_DISCOVERY_OWED |
| TENAFLY BORO SCH DIST (`nj:school:tenafly-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.tenafly.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| TEWKSBURY TWP SCH DIST (`nj:school:tewksbury-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.tewksburyschools.org/ | SOURCE_DISCOVERY_OWED |
| TINTON FALLS SCH DIST (`nj:school:tinton-falls-sch-dist`) | SCHOOL_DISTRICT | http://www.tfs.k12.nj.us | SOURCE_DISCOVERY_OWED |
| TOMS RIVER REGIONAL SCH DIST (`nj:school:toms-river-regional-sch-dist`) | SCHOOL_DISTRICT | http://www.trschools.com/ | SOURCE_DISCOVERY_OWED |
| TOTOWA BORO SCH DIST (`nj:school:totowa-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.totowa.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF FRANKLIN SCH DIST (`nj:school:township-of-franklin-sch-dist`) | SCHOOL_DISTRICT | http://WWW.FRANKLINTWPSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF OCEAN SCHOOL DIST (`nj:school:township-of-ocean-school-dist`) | SCHOOL_DISTRICT | http://ocean.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| TOWNSHIP OF UNION PUBLIC SCHOOLS (`nj:school:township-of-union-public-schools`) | SCHOOL_DISTRICT | http://WWW.TWPUNIONSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| TUCKERTON BORO SCH DIST (`nj:school:tuckerton-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.tuckerton.k12.nj.us | SOURCE_DISCOVERY_OWED |
| UNION BEACH BORO SCH DIST (`nj:school:union-beach-boro-sch-dist`) | SCHOOL_DISTRICT | http://ub.k12.nj.us | SOURCE_DISCOVERY_OWED |
| UNION TWP SCH DIST (`nj:school:union-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.uniontwpschool.org/ | SOURCE_DISCOVERY_OWED |
| UPPER DEERFIELD TWP SCH DIST (`nj:school:upper-deerfield-twp-sch-dist`) | SCHOOL_DISTRICT | http://upperdeerfieldschools.org | SOURCE_DISCOVERY_OWED |
| UPPER FREEHOLD REG SCHOOL DIST (`nj:school:upper-freehold-reg-school-dist`) | SCHOOL_DISTRICT | http://www.ufrsd.net/ | SOURCE_DISCOVERY_OWED |
| UPPER PITTSGROVE TWP SCH DIST (`nj:school:upper-pittsgrove-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.MYSCHOOLONLINE.COM | SOURCE_DISCOVERY_OWED |
| UPPER SADDLE RIVER SCH DIST (`nj:school:upper-saddle-river-sch-dist`) | SCHOOL_DISTRICT | http://www.usronline.org/ | SOURCE_DISCOVERY_OWED |
| UPPER TWP SCH DIST (`nj:school:upper-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.upperschools.org/ | SOURCE_DISCOVERY_OWED |
| VERNON TWP SCH DIST (`nj:school:vernon-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.UTSD.COM | SOURCE_DISCOVERY_OWED |
| VERONA BORO SCH DIST (`nj:school:verona-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.VERONASCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| VINELAND SCHOOL DISTRICT (`nj:school:vineland-school-district`) | SCHOOL_DISTRICT | http://WWW.VINELAND.ORG | SOURCE_DISCOVERY_OWED |
| VOORHEES TWP SCH DIST (`nj:school:voorhees-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.VOORHEES.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| WALDWICK BORO SCH DIST (`nj:school:waldwick-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.waldwick.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| WALL TWP SCH DIST (`nj:school:wall-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WALL.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| WALLINGTON BORO SCH DIST (`nj:school:wallington-boro-sch-dist`) | SCHOOL_DISTRICT | https://WWW.WBOE.ORG | SOURCE_DISCOVERY_OWED |
| WALLKILL VALLEY REGIONAL HIGH SCH DIST (`nj:school:wallkill-valley-regional-high-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WALLKILL.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| WANAQUE BORO SCH DIST (`nj:school:wanaque-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.wanaque.k12.nj.us | SOURCE_DISCOVERY_OWED |
| WARREN HILLS REGIONAL SCHOOL DIST (`nj:school:warren-hills-regional-school-dist`) | SCHOOL_DISTRICT | http://www.warrenhills.org/ | SOURCE_DISCOVERY_OWED |
| WARREN TWP SCH DIST (`nj:school:warren-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.warrentboe.org/ | SOURCE_DISCOVERY_OWED |
| WASHINGTON BORO SCH DIST (`nj:school:washington-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.warrennet.org/washingtonboro/ | SOURCE_DISCOVERY_OWED |
| WASHINGTON TWP SCH DIST (`nj:school:washington-twp-sch-dist`) | SCHOOL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WASHINGTON TWP SCH DIST (`nj:school:washington-twp-sch-dist-131011`) | SCHOOL_DISTRICT | http://WWW.WTPS.ORG | SOURCE_DISCOVERY_OWED |
| WASHINGTON TWP SCH DIST (`nj:school:washington-twp-sch-dist-181427`) | SCHOOL_DISTRICT | http://www.warrennet.org/wtsd/ | SOURCE_DISCOVERY_OWED |
| WASHINGTON TWP SCH DIST (`nj:school:washington-twp-sch-dist-202179`) | SCHOOL_DISTRICT | http://WWW.WTSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| WATCHUNG BORO SCH DIST (`nj:school:watchung-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.watchungschools.com/watchung | SOURCE_DISCOVERY_OWED |
| WATCHUNG HILLS REGIONAL HIGH SCH DIST (`nj:school:watchung-hills-regional-high-sch-dist`) | SCHOOL_DISTRICT | http://www.whrhs.org/ | SOURCE_DISCOVERY_OWED |
| WATERFORD TWP SCH DIST (`nj:school:waterford-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.wtsd.org/ | SOURCE_DISCOVERY_OWED |
| WAYNE TWP SCH DIST (`nj:school:wayne-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.wayneschools.com/ | SOURCE_DISCOVERY_OWED |
| WEEHAWKEN TWP SCH DIST (`nj:school:weehawken-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.weehawken.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| WENONAH BORO SCH DIST (`nj:school:wenonah-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.wenonahschool.org/ | SOURCE_DISCOVERY_OWED |
| WEST CAPE MAY BORO SCHOOL DIST (`nj:school:west-cape-may-boro-school-dist`) | SCHOOL_DISTRICT | http://WCM.CAPEMAYSCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| WEST DEPTFORD SCH DIST (`nj:school:west-deptford-sch-dist`) | SCHOOL_DISTRICT | http://www.wdeptford.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| WEST ESSEX REG SCH DIST (`nj:school:west-essex-reg-sch-dist`) | SCHOOL_DISTRICT | http://www.westex.org/ | SOURCE_DISCOVERY_OWED |
| WEST LONG BRANCH SCH DIST (`nj:school:west-long-branch-sch-dist`) | SCHOOL_DISTRICT | http://www.wlbschools.com | SOURCE_DISCOVERY_OWED |
| WEST MILFORD TWP SCH DIST (`nj:school:west-milford-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.wmtps.org/ | SOURCE_DISCOVERY_OWED |
| WEST MORRIS HIGH SCH DIST (`nj:school:west-morris-high-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WMRHSD.ORG | SOURCE_DISCOVERY_OWED |
| WEST ORANGE TOWN SCH DIST (`nj:school:west-orange-town-sch-dist`) | SCHOOL_DISTRICT | http://www.westorange.k12.nj.us/default.htm | SOURCE_DISCOVERY_OWED |
| WEST WINDSOR-PLAINSBORO REG SCH DIST (`nj:school:west-windsor-plainsboro-reg-sch-dist`) | SCHOOL_DISTRICT | http://www.ww-p.org/ | SOURCE_DISCOVERY_OWED |
| WESTAMPTON TWP SCH DIST (`nj:school:westampton-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.westamptonschools.org | SOURCE_DISCOVERY_OWED |
| WESTFIELD TOWN SCH DIST (`nj:school:westfield-town-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WESTFIELDNJ.COM | SOURCE_DISCOVERY_OWED |
| WESTVILLE BORO SCH DIST (`nj:school:westville-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.westville.k12.nj.us/ | SOURCE_DISCOVERY_OWED |
| WESTWOOD REGIONAL SCH DIST (`nj:school:westwood-regional-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WESTWOOD.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| WEYMOUTH TWP SCH DIST (`nj:school:weymouth-twp-sch-dist`) | SCHOOL_DISTRICT | http://users.ettc.net/weymouth/ | SOURCE_DISCOVERY_OWED |
| WHARTON BORO SCH DIST (`nj:school:wharton-boro-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WBPS.ORG | SOURCE_DISCOVERY_OWED |
| WHITE TWP SCHOOL DISTRICT (`nj:school:white-twp-school-district`) | SCHOOL_DISTRICT | http://www.warrennet.org/whiteschool/ | SOURCE_DISCOVERY_OWED |
| WILDWOOD CITY SCH DIST (`nj:school:wildwood-city-sch-dist`) | SCHOOL_DISTRICT | https://www.edline.net/pages/Wildwood_PSD | SOURCE_DISCOVERY_OWED |
| WILDWOOD CREST BORO SCH DIST (`nj:school:wildwood-crest-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.edline.net/pages/Wildwood_Crest_School | SOURCE_DISCOVERY_OWED |
| WILLINGBORO TWP SCH DIST (`nj:school:willingboro-twp-sch-dist`) | SCHOOL_DISTRICT | https://www.willingboroschools.org/ | SOURCE_DISCOVERY_OWED |
| WINFIELD TWP SCH DIST (`nj:school:winfield-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.winfieldschool.org | SOURCE_DISCOVERY_OWED |
| WINSLOW TWP SCH DIST (`nj:school:winslow-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WINSLOW-SCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| WOOD-RIDGE SCHOOL DIST (`nj:school:wood-ridge-school-dist`) | SCHOOL_DISTRICT | http://www.wood-ridgeschools.org/ | SOURCE_DISCOVERY_OWED |
| WOODBINE BORO SCH DIST (`nj:school:woodbine-boro-sch-dist`) | SCHOOL_DISTRICT | http://WOODBINE.CAPEMAYSCHOOLS.COM | SOURCE_DISCOVERY_OWED |
| WOODBRIDGE TWP SCH DIST (`nj:school:woodbridge-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WOODBRIDGE.K12.NJ.US | SOURCE_DISCOVERY_OWED |
| WOODBURY CITY SCH DIST (`nj:school:woodbury-city-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WOODBURYSCH.COM | SOURCE_DISCOVERY_OWED |
| WOODBURY HEIGHTS BORO SCH DIST (`nj:school:woodbury-heights-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.woodburyhtselem.com | SOURCE_DISCOVERY_OWED |
| WOODCLIFF LAKE SCHOOL DIST (`nj:school:woodcliff-lake-school-dist`) | SCHOOL_DISTRICT | http://www.woodcliff-lake.com | SOURCE_DISCOVERY_OWED |
| WOODLAND PARK SCHOOL DISTRICT (`nj:school:woodland-park-school-district`) | SCHOOL_DISTRICT | http://www.wpschools.org/ | SOURCE_DISCOVERY_OWED |
| WOODLAND TWP SCH DIST (`nj:school:woodland-twp-sch-dist`) | SCHOOL_DISTRICT | http://www.woodlandboe.org | SOURCE_DISCOVERY_OWED |
| WOODLYNNE BORO SCH DIST (`nj:school:woodlynne-boro-sch-dist`) | SCHOOL_DISTRICT | http://www.woodlynne.k12.nj.us | SOURCE_DISCOVERY_OWED |
| WOODSTOWN-PILESGROVE REGIONAL SCHOOL DIST (`nj:school:woodstown-pilesgrove-regional-school-dist`) | SCHOOL_DISTRICT | http://www.woodstown.org/ | SOURCE_DISCOVERY_OWED |
| WYCKOFF TWP SCH DIST (`nj:school:wyckoff-twp-sch-dist`) | SCHOOL_DISTRICT | http://WWW.WYCKOFFSCHOOLS.ORG | SOURCE_DISCOVERY_OWED |
| ABERDEEN TOWNSHIP FIRE DISTRICT 1 (`nj:special:aberdeen-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ABERDEEN TOWNSHIP FIRE DISTRICT 2 (`nj:special:aberdeen-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BAY SHORE REGIONAL SEWERAGE AUTHORITY (`nj:special:bay-shore-regional-sewerage-authority`) | SPECIAL_DISTRICT | http://www.bayshorersa.com | SOURCE_DISCOVERY_OWED |
| BERGEN COUNTY SOIL CONSERVATION DISTRICT (`nj:special:bergen-county-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.bergenscd.org | SOURCE_DISCOVERY_OWED |
| BERLIN TOWNSHIP FIRE DISTRICT 1 (`nj:special:berlin-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BEVERLY FIRE DISTRICT 1 (`nj:special:beverly-fire-district-1`) | SPECIAL_DISTRICT | http://www.thecityofbeverly.com | SOURCE_DISCOVERY_OWED |
| BORDENTOWN FIRE DISTRICT 1 (`nj:special:bordentown-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BORDENTOWN FIRE DISTRICT 2 (`nj:special:bordentown-fire-district-2`) | SPECIAL_DISTRICT | http://www.btfd2.org | SOURCE_DISCOVERY_OWED |
| BORDENTOWN SEWERAGE AUTHORITY (`nj:special:bordentown-sewerage-authority`) | SPECIAL_DISTRICT | http://www.bordentownsa.org/history.html | SOURCE_DISCOVERY_OWED |
| BRICK TOWNSHIP FIRE DISTRICT 1 (`nj:special:brick-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.brickfire.org | SOURCE_DISCOVERY_OWED |
| BRICK TOWNSHIP FIRE DISTRICT 2 (`nj:special:brick-township-fire-district-2`) | SPECIAL_DISTRICT | http://www.brickfire.org | SOURCE_DISCOVERY_OWED |
| BRICK TOWNSHIP FIRE DISTRICT 3 (`nj:special:brick-township-fire-district-3`) | SPECIAL_DISTRICT | http://www.brickfire.org | SOURCE_DISCOVERY_OWED |
| BRIDGEWATER TOWNSHIP FIRE DISTRICT 1 (`nj:special:bridgewater-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BRIDGEWATER TOWNSHIP FIRE DISTRICT 2 (`nj:special:bridgewater-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BRIDGEWATER TOWNSHIP FIRE DISTRICT 3 (`nj:special:bridgewater-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BRIDGEWATER TOWNSHIP FIRE DISTRICT 4 (`nj:special:bridgewater-township-fire-district-4`) | SPECIAL_DISTRICT | http://www.findernefd.com/home.php | SOURCE_DISCOVERY_OWED |
| BUENA BOROUGH FIRE DISTRICT 1 (`nj:special:buena-borough-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BUENA BOROUGH FIRE DISTRICT 2 (`nj:special:buena-borough-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BUENA VISTA TOWNSHIP FIRE DISTRICT 1 (`nj:special:buena-vista-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BUENA VISTA TOWNSHIP FIRE DISTRICT 2 (`nj:special:buena-vista-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BUENA VISTA TOWNSHIP FIRE DISTRICT 3 (`nj:special:buena-vista-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BUENA VISTA TOWNSHIP FIRE DISTRICT 4 (`nj:special:buena-vista-township-fire-district-4`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| BUENA VISTA TOWNSHIP FIRE DISTRICT 5 (`nj:special:buena-vista-township-fire-district-5`) | SPECIAL_DISTRICT | http://www.clfd.org/ | SOURCE_DISCOVERY_OWED |
| BURLINGTON COUNTY SOIL CONSERVATION DISTRICT (`nj:special:burlington-county-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.bscd.org | SOURCE_DISCOVERY_OWED |
| BURLINGTON TOWNSHIP FIRE DISTRICT (`nj:special:burlington-township-fire-district`) | SPECIAL_DISTRICT | http://www.btfd.org | SOURCE_DISCOVERY_OWED |
| CAMDEN COUNTY MUNICIPAL UTILITIES AUTHORITY (`nj:special:camden-county-municipal-utilities-authority`) | SPECIAL_DISTRICT | http://www.ccmua.org/ | SOURCE_DISCOVERY_OWED |
| CAMDEN COUNTY SOIL CONSERVATION DISTRICT (`nj:special:camden-county-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.camdenscd.org | SOURCE_DISCOVERY_OWED |
| CAPE ATLANTIC SOIL CONSERVATION DISTRICT (`nj:special:cape-atlantic-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.capeatlantic.org/ | SOURCE_DISCOVERY_OWED |
| CAPE MAY COUNTY BRIDGE COMMISSION (`nj:special:cape-may-county-bridge-commission`) | SPECIAL_DISTRICT | http://www.followthegull.com | SOURCE_DISCOVERY_OWED |
| CHERRY HILL TOWNSHIP FIRE DISTRICT 13 (`nj:special:cherry-hill-township-fire-district-13`) | SPECIAL_DISTRICT | http://WWW.CHERRYHILLFIRE.ORG | SOURCE_DISCOVERY_OWED |
| CHESTERFIELD AND HAMILTON TOWNSHIPS FIRE DISTRICT 1 (`nj:special:chesterfield-and-hamilton-townships-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CINNAMINSON FIRE DISTRICT 1 (`nj:special:cinnaminson-fire-district-1`) | SPECIAL_DISTRICT | http://www.cinnaminsonfire.org | SOURCE_DISCOVERY_OWED |
| COMMERCIAL TOWNSHIP FIRE DISTRICT 1 (`nj:special:commercial-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.portnorrisfire.com | SOURCE_DISCOVERY_OWED |
| COMMERCIAL TOWNSHIP FIRE DISTRICT 2 (`nj:special:commercial-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| COMMERCIAL TOWNSHIP FIRE DISTRICT 3 (`nj:special:commercial-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| CUMBERLAND COUNTY UTILITIES AUTHORITY (`nj:special:cumberland-county-utilities-authority`) | SPECIAL_DISTRICT | http://www.ccua.info/ | SOURCE_DISCOVERY_OWED |
| CUMBERLAND-SALEM SOIL CONSERVATION DISTRICT (`nj:special:cumberland-salem-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.cumberlandsoil.com | SOURCE_DISCOVERY_OWED |
| DELANCO TOWNSHIP FIRE DISTRICT (`nj:special:delanco-township-fire-district`) | SPECIAL_DISTRICT | http://www.delancofire.org | SOURCE_DISCOVERY_OWED |
| DELAWARE RIVER PORT AUTHORITY (`nj:special:delaware-river-port-authority`) | SPECIAL_DISTRICT | http://www.drpa.org/ | SOURCE_DISCOVERY_OWED |
| DELRAN TOWNSHIP FIRE DISTRICT 1 (`nj:special:delran-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.delranfire.com | SOURCE_DISCOVERY_OWED |
| DENNIS TOWNSHIP FIRE DISTRICT 1 (`nj:special:dennis-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DENNIS TOWNSHIP FIRE DISTRICT 2 (`nj:special:dennis-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DENNIS TOWNSHIP FIRE DISTRICT 3 (`nj:special:dennis-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DEPTFORD TOWNSHIP FIRE DISTRICT (`nj:special:deptford-township-fire-district`) | SPECIAL_DISTRICT | http://www.deptfordfd.org | SOURCE_DISCOVERY_OWED |
| DOWNE TOWNSHIP FIRE DISTRICT 1 (`nj:special:downe-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| DOWNE TOWNSHIP FIRE DISTRICT 2 (`nj:special:downe-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EAST AMWELL TOWNSHIP FIRE DISTRICT 1 (`nj:special:east-amwell-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EAST BRUNSWICK FIRE DISTRICT 1 (`nj:special:east-brunswick-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EAST BRUNSWICK FIRE DISTRICT 2 (`nj:special:east-brunswick-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EAST BRUNSWICK FIRE DISTRICT 3 (`nj:special:east-brunswick-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EASTAMPTON FIRE DISTRICT (`nj:special:eastampton-fire-district`) | SPECIAL_DISTRICT | http://www.eastamptonfiredistrict.com | SOURCE_DISCOVERY_OWED |
| EDGEWATER PARK TOWNSHIP FIRE DISTRICT 1 (`nj:special:edgewater-park-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| ENGLISHTOWN BOROUGH FIRE DISTRICT 1 (`nj:special:englishtown-borough-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| EVESHAM TOWNSHIP FIRE DISTRICT NO 1 (`nj:special:evesham-township-fire-district-no-1`) | SPECIAL_DISTRICT | http://WWW.EVESHAMFIRE.ORG | SOURCE_DISCOVERY_OWED |
| EWING-LAWRENCE SEWERAGE AUTHORITY (`nj:special:ewing-lawrence-sewerage-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FLORENCE TOWNSHIP FIRE DISTRICT (`nj:special:florence-township-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 1 (`nj:special:franklin-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 1 (`nj:special:franklin-township-fire-district-1-152477`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 1 (`nj:special:franklin-township-fire-district-1-217023`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 2 (`nj:special:franklin-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 2 (`nj:special:franklin-township-fire-district-2-152483`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 3 (`nj:special:franklin-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 3 (`nj:special:franklin-township-fire-district-3-152484`) | SPECIAL_DISTRICT | http://www.ftfd3.com | SOURCE_DISCOVERY_OWED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 4 (`nj:special:franklin-township-fire-district-4`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 4 (`nj:special:franklin-township-fire-district-4-202166`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FRANKLIN TOWNSHIP FIRE DISTRICT 5 (`nj:special:franklin-township-fire-district-5`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FREEHOLD SOIL CONSERVATION DISTRICT (`nj:special:freehold-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.freeholdscd.org/ | SOURCE_DISCOVERY_OWED |
| FREEHOLD TOWNSHIP FIRE DISTRICT 1 (`nj:special:freehold-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| FREEHOLD TOWNSHIP FIRE DISTRICT 2 (`nj:special:freehold-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GLOUCESTER COUNTY SOIL CONSERVATION DISTRICT (`nj:special:gloucester-county-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.gloucesterscd.org/ | SOURCE_DISCOVERY_OWED |
| GLOUCESTER COUNTY UTILITIES AUTHORITY (`nj:special:gloucester-county-utilities-authority`) | SPECIAL_DISTRICT | http://www.gcuanj.com/ | SOURCE_DISCOVERY_OWED |
| GLOUCESTER TOWNSHIP FIRE DISTRICT 1 (`nj:special:gloucester-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GLOUCESTER TOWNSHIP FIRE DISTRICT 2 (`nj:special:gloucester-township-fire-district-2`) | SPECIAL_DISTRICT | http://www.chewslandingfire.org/contactus.php | SOURCE_DISCOVERY_OWED |
| GLOUCESTER TOWNSHIP FIRE DISTRICT 3 (`nj:special:gloucester-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GLOUCESTER TOWNSHIP FIRE DISTRICT 4 (`nj:special:gloucester-township-fire-district-4`) | SPECIAL_DISTRICT | http://www.blackwoodfire.org | SOURCE_DISCOVERY_OWED |
| GLOUCESTER TOWNSHIP FIRE DISTRICT 5 (`nj:special:gloucester-township-fire-district-5`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| GLOUCESTER TOWNSHIP FIRE DISTRICT 6 (`nj:special:gloucester-township-fire-district-6`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HADDON TOWNSHIP FIRE DISTRICT 1 (`nj:special:haddon-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HADDON TOWNSHIP FIRE DISTRICT 3 (`nj:special:haddon-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HADDON TOWNSHIP FIRE DISTRICT 4 (`nj:special:haddon-township-fire-district-4`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HANOVER TOWNSHIP FIRE DISTRICT 2 (`nj:special:hanover-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HANOVER TOWNSHIP FIRE DISTRICT 3 (`nj:special:hanover-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HARRISON TOWNSHIP FIRE DISTRICT 1 (`nj:special:harrison-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HAZLET FIRE DISTRICT 1 (`nj:special:hazlet-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HILLSBOROUGH TOWNSHIP FIRE DISTRICT (`nj:special:hillsborough-township-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOPEWELL BOROUGH FIRE DISTRICT 1 (`nj:special:hopewell-borough-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOPEWELL TOWNSHIP FIRE DISTRICT 1 (`nj:special:hopewell-township-fire-district-1`) | SPECIAL_DISTRICT | http://hopewelltwpfire.org/ | SOURCE_DISCOVERY_OWED |
| HOWELL TOWNSHIP FIRE DISTRICT 1 (`nj:special:howell-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOWELL TOWNSHIP FIRE DISTRICT 2 (`nj:special:howell-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOWELL TOWNSHIP FIRE DISTRICT 3 (`nj:special:howell-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HOWELL TOWNSHIP FIRE DISTRICT 4 (`nj:special:howell-township-fire-district-4`) | SPECIAL_DISTRICT | http://www.ramtownfire.org | SOURCE_DISCOVERY_OWED |
| HOWELL TOWNSHIP FIRE DISTRICT 5 (`nj:special:howell-township-fire-district-5`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| HUDSON-ESSEX-PASSAIC SOIL CONSERVATION DISTRICT (`nj:special:hudson-essex-passaic-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.hepsoilnj.org | SOURCE_DISCOVERY_OWED |
| HUNTERDON SOIL CONSERVATION DISTRICT (`nj:special:hunterdon-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.hcsd.weebly.com | SOURCE_DISCOVERY_OWED |
| JACKSON TOWNSHIP FIRE DISTRICT 2 (`nj:special:jackson-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| JACKSON TOWNSHIP FIRE DISTRICT 3 (`nj:special:jackson-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| JACKSON TOWNSHIP FIRE DISTRICT 4 (`nj:special:jackson-township-fire-district-4`) | SPECIAL_DISTRICT | http://www.jacksonmillsfirecompany.com | SOURCE_DISCOVERY_OWED |
| JAMESBURG FIRE DISTRICT 1 (`nj:special:jamesburg-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LAKEWOOD TOWNSHIP FIRE DISTRICT 1 (`nj:special:lakewood-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LAMBERTVILLE FIRE DISTRICT 1 (`nj:special:lambertville-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LINDEN-ROSELLE SEWERAGE AUTHORITY (`nj:special:linden-roselle-sewerage-authority`) | SPECIAL_DISTRICT | http://www.lrsanj.org | SOURCE_DISCOVERY_OWED |
| LINDENWOLD FIRE DISTRICT 1 (`nj:special:lindenwold-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LITTLE EGG HARBOR TOWNSHIP FIRE DISTRICT (`nj:special:little-egg-harbor-township-fire-district`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LITTLE EGG HARBOR TOWNSHIP FIRE DISTRICT 2 (`nj:special:little-egg-harbor-township-fire-district-2`) | SPECIAL_DISTRICT | http://station71.org/ | SOURCE_DISCOVERY_OWED |
| LITTLE EGG HARBOR TOWNSHIP FIRE DISTRICT 3 (`nj:special:little-egg-harbor-township-fire-district-3`) | SPECIAL_DISTRICT | http://sta72.com/ | SOURCE_DISCOVERY_OWED |
| LOWER TOWNSHIP FIRE DISTRICT 1 (`nj:special:lower-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LOWER TOWNSHIP FIRE DISTRICT 2 (`nj:special:lower-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| LOWER TOWNSHIP FIRE DISTRICT 3 (`nj:special:lower-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MANALAPAN TOWNSHIP FIRE DISTRICT 1 (`nj:special:manalapan-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MANALAPAN TOWNSHIP FIRE DISTRICT 2 (`nj:special:manalapan-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MANASQUAN BOROUGH FIRE DISTRICT 1 (`nj:special:manasquan-borough-fire-district-1`) | SPECIAL_DISTRICT | http://www.manasquanfire.org | SOURCE_DISCOVERY_OWED |
| MANASQUAN RIVER REGIONAL SEWERAGE AUTHORITY (`nj:special:manasquan-river-regional-sewerage-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MANTUA TWP FIRE DIST 1 (`nj:special:mantua-twp-fire-dist-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARLBORO TOWNSHIP FIRE DISTRICT 1 (`nj:special:marlboro-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARLBORO TOWNSHIP FIRE DISTRICT 2 (`nj:special:marlboro-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MARLBORO TOWNSHIP FIRE DISTRICT 3 (`nj:special:marlboro-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MAURICE RIVER TOWNSHIP FIRE DISTRICT 1 (`nj:special:maurice-river-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MAURICE RIVER TOWNSHIP FIRE DISTRICT 2 (`nj:special:maurice-river-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MAURICE RIVER TOWNSHIP FIRE DISTRICT 3 (`nj:special:maurice-river-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MAURICE RIVER TOWNSHIP FIRE DISTRICT 4 (`nj:special:maurice-river-township-fire-district-4`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MERCER COUNTY SOIL CONSERVATION DISTRICT (`nj:special:mercer-county-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.mercerscd.org/ | SOURCE_DISCOVERY_OWED |
| MERCHANTVILLE PENNSAUKEN WATER COMMISSION (`nj:special:merchantville-pennsauken-water-commission`) | SPECIAL_DISTRICT | http://www.mpwc.com/ | SOURCE_DISCOVERY_OWED |
| MIDDLE TOWNSHIP FIRE DISTRICT 1 (`nj:special:middle-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.cmchfire.com | SOURCE_DISCOVERY_OWED |
| MIDDLE TOWNSHIP FIRE DISTRICT 2 (`nj:special:middle-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MIDDLE TOWNSHIP FIRE DISTRICT 3 (`nj:special:middle-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MIDDLE TOWNSHIP FIRE DISTRICT 4 (`nj:special:middle-township-fire-district-4`) | SPECIAL_DISTRICT | http://www.goshen74.net | SOURCE_DISCOVERY_OWED |
| MILLSTONE FIRE DISTRICT 1 (`nj:special:millstone-fire-district-1`) | SPECIAL_DISTRICT | http://www.mtbfc.com | SOURCE_DISCOVERY_OWED |
| MONMOUTH COUNTY BAYSHORE OUTFALL AUTHORITY (`nj:special:monmouth-county-bayshore-outfall-authority`) | SPECIAL_DISTRICT | http://www.mcboanj.com | SOURCE_DISCOVERY_OWED |
| MONROE FIRE DISTRICT 1 (`nj:special:monroe-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MONROE FIRE DISTRICT 2 (`nj:special:monroe-fire-district-2`) | SPECIAL_DISTRICT | http://www.avec1.org | SOURCE_DISCOVERY_OWED |
| MONROE FIRE DISTRICT 3 (`nj:special:monroe-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MONTGOMERY FIRE DISTRICT 1 (`nj:special:montgomery-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MONTGOMERY FIRE DISTRICT 2 (`nj:special:montgomery-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MONTVILLE TOWNSHIP FIRE DISTRICT 1 (`nj:special:montville-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MONTVILLE TOWNSHIP FIRE DISTRICT 2 (`nj:special:montville-township-fire-district-2`) | SPECIAL_DISTRICT | http://www.towaco.fd.org | SOURCE_DISCOVERY_OWED |
| MONTVILLE TOWNSHIP FIRE DISTRICT 3 (`nj:special:montville-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| MOORESTOWN TOWNSHIP FIRE DISTRICT 1 (`nj:special:moorestown-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.moorestownfire.org | SOURCE_DISCOVERY_OWED |
| MOORESTOWN TOWNSHIP FIRE DISTRICT 2 (`nj:special:moorestown-township-fire-district-2`) | SPECIAL_DISTRICT | http://www.moorestownfire2.com | SOURCE_DISCOVERY_OWED |
| MORRIS COUNTY SOIL CONSERVATION DISTRICT (`nj:special:morris-county-soil-conservation-district`) | SPECIAL_DISTRICT | http://www.mcscd.org | SOURCE_DISCOVERY_OWED |
| MOUNT HOLLY TOWNSHIP FIRE DISTRICT 1 (`nj:special:mount-holly-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.mounthollyfire.org | SOURCE_DISCOVERY_OWED |
| MOUNT LAUREL FIRE DISTRICT 1 (`nj:special:mount-laurel-fire-district-1`) | SPECIAL_DISTRICT | http://WWW.MOUNTLAURELFIRE.COM | SOURCE_DISCOVERY_OWED |
| MUSCONETCONG SEWERAGE AUTHORITY (`nj:special:musconetcong-sewerage-authority`) | SPECIAL_DISTRICT | http://www.musconetcong.users.nac.net | SOURCE_DISCOVERY_OWED |
| NEPTUNE TOWNSHIP FIRE DISTRICT 1 (`nj:special:neptune-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEPTUNE TOWNSHIP (OCEAN GROVE) FIRE DISTRICT 2 (`nj:special:neptune-township-ocean-grove-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NEW JERSEY PUBLIC POWER AUTHORITY (`nj:special:new-jersey-public-power-authority`) | SPECIAL_DISTRICT | http://www.butlerborough.com/cit-e-access/webpage.cfm?TID=19&TPID=16167 | SOURCE_DISCOVERY_OWED |
| NORTH HUDSON SEWERAGE AUTHORITY (`nj:special:north-hudson-sewerage-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| NORTHWEST BERGEN COUNTY UTILITY AUTHORITY (`nj:special:northwest-bergen-county-utility-authority`) | SPECIAL_DISTRICT | http://www.nbcua.com | SOURCE_DISCOVERY_OWED |
| OCEAN COUNTY SOIL CONSERVATION DISTRICT (`nj:special:ocean-county-soil-conservation-district`) | SPECIAL_DISTRICT | https://www.soildistrict.org/ | SOURCE_DISCOVERY_OWED |
| OCEAN COUNTY UTILITIES AUTHORITY (`nj:special:ocean-county-utilities-authority`) | SPECIAL_DISTRICT | http://www.ocua.com/ | SOURCE_DISCOVERY_OWED |
| OCEAN TOWNSHIP FIRE DISTRICT 1 (`nj:special:ocean-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| OCEAN TOWNSHIP FIRE DISTRICT 2 (`nj:special:ocean-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| OLD BRIDGE TOWNSHIP FIRE DISTRICT 1 (`nj:special:old-bridge-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| OLD BRIDGE TOWNSHIP FIRE DISTRICT 2 (`nj:special:old-bridge-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| OLD BRIDGE TOWNSHIP FIRE DISTRICT 3 (`nj:special:old-bridge-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| OLD BRIDGE TOWNSHIP FIRE DISTRICT 4 (`nj:special:old-bridge-township-fire-district-4`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 1 (`nj:special:parsippany-troy-hills-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 2 (`nj:special:parsippany-troy-hills-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 3 (`nj:special:parsippany-troy-hills-township-fire-district-3`) | SPECIAL_DISTRICT | http://www.lpvfc3.com | SOURCE_DISCOVERY_OWED |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 4 (`nj:special:parsippany-troy-hills-township-fire-district-4`) | SPECIAL_DISTRICT | http://WWW.LHFD.ORG | SOURCE_DISCOVERY_OWED |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 5 (`nj:special:parsippany-troy-hills-township-fire-district-5`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 6 (`nj:special:parsippany-troy-hills-township-fire-district-6`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PASSAIC VALLEY SEWERAGE DISTRICT (`nj:special:passaic-valley-sewerage-district`) | SPECIAL_DISTRICT | http://www.pvsc.com/ | SOURCE_DISCOVERY_OWED |
| PASSAIC VALLEY WATER COMMISSION (`nj:special:passaic-valley-water-commission`) | SPECIAL_DISTRICT | http://WWW.PVWC.COM | SOURCE_DISCOVERY_OWED |
| PENNINGTON BOROUGH FIRE DISTRICT 1 (`nj:special:pennington-borough-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PEQUANNOCK-LINCOLN PARK-FAIRFIELD SEWERAGE AUTH (TWO BRIDGES) (`nj:special:pequannock-lincoln-park-fairfield-sewerage-auth-two-bridges`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PEQUANNOCK RIVER BASIN REGIONAL SEWERAGE AUTHORITY (`nj:special:pequannock-river-basin-regional-sewerage-authority`) | SPECIAL_DISTRICT | http://www.prbrsa.org | SOURCE_DISCOVERY_OWED |
| PEQUEST RIVERS MUNICIPAL UTILITIES AUTHORITY (`nj:special:pequest-rivers-municipal-utilities-authority`) | SPECIAL_DISTRICT | http://www.prmva.com | SOURCE_DISCOVERY_OWED |
| PINE HILL BOROUGH FIRE DISTRICT 1 (`nj:special:pine-hill-borough-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PISCATAWAY TOWNSHIP FIRE DISTRICT 1 (`nj:special:piscataway-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PISCATAWAY TOWNSHIP FIRE DISTRICT 2 (`nj:special:piscataway-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PISCATAWAY TOWNSHIP FIRE DISTRICT 3 (`nj:special:piscataway-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PISCATAWAY TOWNSHIP FIRE DISTRICT 4 (`nj:special:piscataway-township-fire-district-4`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PITTSGROVE TOWNSHIP FIRE DISTRICT 1 (`nj:special:pittsgrove-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PITTSGROVE TOWNSHIP FIRE DISTRICT 2 (`nj:special:pittsgrove-township-fire-district-2`) | SPECIAL_DISTRICT | http://www.willowgrovefire.com | SOURCE_DISCOVERY_OWED |
| PITTSGROVE TOWNSHIP FIRE DISTRICT 3 (`nj:special:pittsgrove-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PLAINFIELD AREA REGIONAL SEWER AUTHORITY (`nj:special:plainfield-area-regional-sewer-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PLAINSBORO TOWNSHIP FIRE DISTRICT 1 (`nj:special:plainsboro-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| PLUMSTED TOWNSHIP FIRE DISTRICT 1 (`nj:special:plumsted-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RAHWAY VALLEY SEWERAGE AUTHORITY (`nj:special:rahway-valley-sewerage-authority`) | SPECIAL_DISTRICT | http://www.rahwayvalleysa.com | SOURCE_DISCOVERY_OWED |
| READINGTON-LEBANON SEWERAGE AUTHORITY (`nj:special:readington-lebanon-sewerage-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| RIVERSIDE TOWNSHIP FIRE DISTRICT 1 (`nj:special:riverside-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.riversidefire.org | SOURCE_DISCOVERY_OWED |
| ROCKAWAY VALLEY REGIONAL SEWAGE AUTHORITY (`nj:special:rockaway-valley-regional-sewage-authority`) | SPECIAL_DISTRICT | http://www.rvrsa.org | SOURCE_DISCOVERY_OWED |
| ROCKLEIGH BOROUGH SEWERAGE AUTHORITY (`nj:special:rockleigh-borough-sewerage-authority`) | SPECIAL_DISTRICT | https://rockleighnj.org/sewer/ | SOURCE_DISCOVERY_OWED |
| SOMERSET RARITAN VALLEY SEWERAGE AUTHORITY (`nj:special:somerset-raritan-valley-sewerage-authority`) | SPECIAL_DISTRICT | http://www.srvsa.org | SOURCE_DISCOVERY_OWED |
| SOMERSET UNION SOIL CONSERVATION DISTRICT (`nj:special:somerset-union-soil-conservation-district`) | SPECIAL_DISTRICT | https://www.co.somerset.nj.us/government/public-works/soil-conservation | SOURCE_DISCOVERY_OWED |
| SOUTH BRUNSWICK TOWNSHIP FIRE DISTRICT 1 (`nj:special:south-brunswick-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SOUTH BRUNSWICK TOWNSHIP FIRE DISTRICT 2 (`nj:special:south-brunswick-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SOUTH BRUNSWICK TOWNSHIP FIRE DISTRICT 3 (`nj:special:south-brunswick-township-fire-district-3`) | SPECIAL_DISTRICT | http://www.sbfiredistrict3.com | SOURCE_DISCOVERY_OWED |
| SOUTH MONMOUTH REGIONAL SEWERAGE AUTHORITY (`nj:special:south-monmouth-regional-sewerage-authority`) | SPECIAL_DISTRICT | http://www.smrsa.org | SOURCE_DISCOVERY_OWED |
| SOUTHEAST MONMOUTH MUNICIPAL UTILITIES AUTHORITY (`nj:special:southeast-monmouth-municipal-utilities-authority`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| SOUTHEAST MORRIS COUNTY MUNICIPAL UTILITIES AUTHORITY (`nj:special:southeast-morris-county-municipal-utilities-authority`) | SPECIAL_DISTRICT | http://www.smcmua.org/ | SOURCE_DISCOVERY_OWED |
| STONY BROOK REGIONAL SEWER AUTHORITY (`nj:special:stony-brook-regional-sewer-authority`) | SPECIAL_DISTRICT | http://www.sbrsa.org | SOURCE_DISCOVERY_OWED |
| TINTON FALLS FIRE DISTRICT 1 (`nj:special:tinton-falls-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TINTON FALLS FIRE DISTRICT 2 (`nj:special:tinton-falls-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| TOMS RIVER TOWNSHIP FIRE DISTRICT 1 (`nj:special:toms-river-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.dovertwpfire.com/ | SOURCE_DISCOVERY_OWED |
| TOMS RIVER TOWNSHIP FIRE DISTRICT 2 (`nj:special:toms-river-township-fire-district-2`) | SPECIAL_DISTRICT | http://www.dovertwpfire.com/ | SOURCE_DISCOVERY_OWED |
| TWO RIVERS WATER RECLAMATION AUTHORITY (`nj:special:two-rivers-water-reclamation-authority`) | SPECIAL_DISTRICT | http://WWW.TRWRA.ORG | SOURCE_DISCOVERY_OWED |
| UNION COUNTY UTILITIES AUTHORITY (`nj:special:union-county-utilities-authority`) | SPECIAL_DISTRICT | http://www.ucua.org/ | SOURCE_DISCOVERY_OWED |
| UPPER DELAWARE SOIL CONSERVATION DISTRICT (`nj:special:upper-delaware-soil-conservation-district`) | SPECIAL_DISTRICT | https://www.upperdelawarescd-nj.com/ | SOURCE_DISCOVERY_OWED |
| UPPER TOWNSHIP FIRE DISTRICT 1 (`nj:special:upper-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| UPPER TOWNSHIP FIRE DISTRICT 2 (`nj:special:upper-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| UPPER TOWNSHIP FIRE DISTRICT 3 (`nj:special:upper-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| UPPER TOWNSHIP FIRE DISTRICT 4 (`nj:special:upper-township-fire-district-4`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WALL TOWNSHIP FIRE DISTRICT 1 (`nj:special:wall-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WALL TOWNSHIP FIRE DISTRICT 2 (`nj:special:wall-township-fire-district-2`) | SPECIAL_DISTRICT | http://GLENDOLAFD.COM | SOURCE_DISCOVERY_OWED |
| WALL TOWNSHIP FIRE DISTRICT 3 (`nj:special:wall-township-fire-district-3`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WANAQUE VALLEY REGIONAL SEWERAGE AUTHORITY (`nj:special:wanaque-valley-regional-sewerage-authority`) | SPECIAL_DISTRICT | http://www.wvrsa.com | SOURCE_DISCOVERY_OWED |
| WASHINGTON TOWNSHIP FIRE DISTRICT (`nj:special:washington-township-fire-district`) | SPECIAL_DISTRICT | http://www.wtfd10.com | SOURCE_DISCOVERY_OWED |
| WASHINGTON TOWNSHIP FIRE DISTRICT 1 (`nj:special:washington-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.76fire.org/index.html | SOURCE_DISCOVERY_OWED |
| WESTERN MONMOUTH UTILITIES AUTHORITY (`nj:special:western-monmouth-utilities-authority`) | SPECIAL_DISTRICT | http://www.wmua.manalapan.nj.us | SOURCE_DISCOVERY_OWED |
| WESTVILLE BOROUGH FIRE DISTRICT 1 (`nj:special:westville-borough-fire-district-1`) | SPECIAL_DISTRICT | http://WWW.WESTVILLEFD.COM | SOURCE_DISCOVERY_OWED |
| WEYMOUTH TOWNSHIP FD NO. 1 (`nj:special:weymouth-township-fd-no-1`) | SPECIAL_DISTRICT | HTTP://WWW.WEYMOUTHFIRECOMMISSION.ORG/ | SOURCE_DISCOVERY_OWED |
| WINSLOW TOWNSHIP FIRE DISTRICT 1 (`nj:special:winslow-township-fire-district-1`) | SPECIAL_DISTRICT | http://www.winslowtwpfd.org | SOURCE_DISCOVERY_OWED |
| WOODBRIDGE TOWNSHIP FIRE DISTRICT 1 (`nj:special:woodbridge-township-fire-district-1`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODBRIDGE TOWNSHIP FIRE DISTRICT 11 (`nj:special:woodbridge-township-fire-district-11`) | SPECIAL_DISTRICT | http://WWW.ISELINFIRE.ORG | SOURCE_DISCOVERY_OWED |
| WOODBRIDGE TOWNSHIP FIRE DISTRICT 12 (`nj:special:woodbridge-township-fire-district-12`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODBRIDGE TOWNSHIP FIRE DISTRICT 2 (`nj:special:woodbridge-township-fire-district-2`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODBRIDGE TOWNSHIP FIRE DISTRICT 4 (`nj:special:woodbridge-township-fire-district-4`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODBRIDGE TOWNSHIP FIRE DISTRICT 5 (`nj:special:woodbridge-township-fire-district-5`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODBRIDGE TOWNSHIP FIRE DISTRICT 7 (`nj:special:woodbridge-township-fire-district-7`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODBRIDGE TOWNSHIP FIRE DISTRICT 8 (`nj:special:woodbridge-township-fire-district-8`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| WOODBRIDGE TOWNSHIP FIRE DISTRICT 9 (`nj:special:woodbridge-township-fire-district-9`) | SPECIAL_DISTRICT | none recorded | NO_MEETINGS_SOURCE_RECORDED |
| New Jersey (`nj:state:new-jersey`) | STATE | none recorded | NO_MEETINGS_SOURCE_RECORDED |

