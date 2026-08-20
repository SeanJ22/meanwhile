# The gap ledger

Generated 2026-08-20 (America/Phoenix, `corepack pnpm stamp`).
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

**Stamped tier: TIER_0** (stamped 2026-08-20).

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

#### Territory-resolved but bodies NOT enumerated — named

None. Every government resolved to this zip has at least one enumerated body.

#### Not governments, and never rendered as one

These are Census STATISTICAL entities — a CDP is a name the Census gives a populated area so it can publish statistics for it, and a CCD is a statistical subdivision drawn in states with no minor civil divisions. Neither has a council, a budget, a meeting or an elected official.

- Tucson CCD — STATISTICAL (LSAD 22)

#### The 24 unresolved special districts, by name

Every one of these is a government the Census counts, in a county over this zip, whose territory nobody has resolved. Whether each reaches this zip is **UNRESOLVED — a work item, never a false.**

| Census PID6 | District | Office city | State |
|---|---|---|---|
| 205795 | AJO-LUKEVILLE HEALTH SERVICES DISTRICT | AJO | AZ |
| 239921 | ARIVACA FIRE DISTRICT | ARIVACA | AZ |
| 141421 | AVRA VALLEY FIRE DISTRICT | MARANA | AZ |
| 141420 | AVRA VALLEY IRRIGATION AND DRAINAGE DISTRICT | MARANA | AZ |
| 205798 | CORONA DE TUCSON FIRE DISTRICT | CORONA | AZ |
| 100288 | CORTARO-MARANA IRRIGATION DISTRICT | MARANA | AZ |
| 141423 | DREXEL HEIGHTS FIRE DISTRICT | TUCSON | AZ |
| 141416 | FLOWING WELLS IRRIGATION DISTRICT | TUCSON | AZ |
| 201336 | GOLDER RANCH FIRE DISTRICT | TUCSON | AZ |
| 122791 | GREEN VALLEY FIRE DISTRICT | GREEN VALLEY | AZ |
| 195317 | HIDDEN VALLEY FIRE DISTRICT | TUCSON | AZ |
| 205799 | MT LEMMON FIRE DISTRICT | MOUNT LEMMON | AZ |
| 141419 | NORTHWEST FIRE DISTRICT | TUCSON | AZ |
| 141424 | PICTURE ROCKS FIRE DISTRICT | TUCSON | AZ |
| 214891 | PIMA COUNTY REGIONAL TRANSPORTATION AUTHORITY | TUCSON | AZ |
| 203941 | RINCON VALLEY FIRE DISTRICT | VAIL | AZ |
| 251411 | RIO NUEVO MULTIPURPOSE FACILITIES DISTRICT | TUCSON | AZ |
| 122792 | SABINO VISTA FIRE DISTRICT | TUCSON | AZ |
| 141425 | SILVERBELL IRRIGATION DISTRICT | ARIZONA CITY | AZ |
| 220681 | SONOITA-ELGIN FIRE DISTRICT | SONOITA | AZ |
| 220664 | TANQUE VERDE VALLEY FIRE DISTRICT | TUCSON | AZ |
| 205796 | THREE POINTS FIRE DISTRICT | TUCSON | AZ |
| 100289 | TUCSON COUNTRY CLUB ESTATES FIRE DISTRICT | TUCSON | AZ |
| 205797 | WHY FIRE DISTRICT | AJO | AZ |

#### What stands between this zip and the next tier

Work out which of the remaining governments reach this ZIP code.

Concretely: 24 named special districts above have no published boundary, and until their territory is resolved this zip cannot leave Tier 0 — because a tier is the floor across the governments touching it, and an unresolved government is exactly the one a reader might live under and hear nothing about.

### 85641 — Vail, Arizona (unincorporated)

**Stamped tier: TIER_0** (stamped 2026-08-20).

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

#### Territory-resolved but bodies NOT enumerated — named

None. Every government resolved to this zip has at least one enumerated body.

#### Not governments, and never rendered as one

These are Census STATISTICAL entities — a CDP is a name the Census gives a populated area so it can publish statistics for it, and a CCD is a statistical subdivision drawn in states with no minor civil divisions. Neither has a council, a budget, a meeting or an elected official.

- Corona de Tucson CDP — STATISTICAL (LSAD 57)
- Vail CDP — STATISTICAL (LSAD 57)
- Rincon Valley CDP — STATISTICAL (LSAD 57)
- Tucson CCD — STATISTICAL (LSAD 22)

#### The 24 unresolved special districts, by name

Every one of these is a government the Census counts, in a county over this zip, whose territory nobody has resolved. Whether each reaches this zip is **UNRESOLVED — a work item, never a false.**

| Census PID6 | District | Office city | State |
|---|---|---|---|
| 205795 | AJO-LUKEVILLE HEALTH SERVICES DISTRICT | AJO | AZ |
| 239921 | ARIVACA FIRE DISTRICT | ARIVACA | AZ |
| 141421 | AVRA VALLEY FIRE DISTRICT | MARANA | AZ |
| 141420 | AVRA VALLEY IRRIGATION AND DRAINAGE DISTRICT | MARANA | AZ |
| 205798 | CORONA DE TUCSON FIRE DISTRICT | CORONA | AZ |
| 100288 | CORTARO-MARANA IRRIGATION DISTRICT | MARANA | AZ |
| 141423 | DREXEL HEIGHTS FIRE DISTRICT | TUCSON | AZ |
| 141416 | FLOWING WELLS IRRIGATION DISTRICT | TUCSON | AZ |
| 201336 | GOLDER RANCH FIRE DISTRICT | TUCSON | AZ |
| 122791 | GREEN VALLEY FIRE DISTRICT | GREEN VALLEY | AZ |
| 195317 | HIDDEN VALLEY FIRE DISTRICT | TUCSON | AZ |
| 205799 | MT LEMMON FIRE DISTRICT | MOUNT LEMMON | AZ |
| 141419 | NORTHWEST FIRE DISTRICT | TUCSON | AZ |
| 141424 | PICTURE ROCKS FIRE DISTRICT | TUCSON | AZ |
| 214891 | PIMA COUNTY REGIONAL TRANSPORTATION AUTHORITY | TUCSON | AZ |
| 203941 | RINCON VALLEY FIRE DISTRICT | VAIL | AZ |
| 251411 | RIO NUEVO MULTIPURPOSE FACILITIES DISTRICT | TUCSON | AZ |
| 122792 | SABINO VISTA FIRE DISTRICT | TUCSON | AZ |
| 141425 | SILVERBELL IRRIGATION DISTRICT | ARIZONA CITY | AZ |
| 220681 | SONOITA-ELGIN FIRE DISTRICT | SONOITA | AZ |
| 220664 | TANQUE VERDE VALLEY FIRE DISTRICT | TUCSON | AZ |
| 205796 | THREE POINTS FIRE DISTRICT | TUCSON | AZ |
| 100289 | TUCSON COUNTRY CLUB ESTATES FIRE DISTRICT | TUCSON | AZ |
| 205797 | WHY FIRE DISTRICT | AJO | AZ |

#### What stands between this zip and the next tier

Work out which of the remaining governments reach this ZIP code.

Concretely: 24 named special districts above have no published boundary, and until their territory is resolved this zip cannot leave Tier 0 — because a tier is the floor across the governments touching it, and an unresolved government is exactly the one a reader might live under and hear nothing about.

### 07866 — Rockaway Township, New Jersey

**Stamped tier: TIER_0** (stamped 2026-08-20).

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

#### Territory-resolved but bodies NOT enumerated — named

- **Rockaway borough** (cousub 3402764050)

#### Not governments, and never rendered as one

These are Census STATISTICAL entities — a CDP is a name the Census gives a populated area so it can publish statistics for it, and a CCD is a statistical subdivision drawn in states with no minor civil divisions. Neither has a council, a budget, a meeting or an elected official.

- White Meadow Lake CDP — STATISTICAL (LSAD 57)
- Hibernia CDP — STATISTICAL (LSAD 57)
- Lake Telemark CDP — STATISTICAL (LSAD 57)

#### The 18 unresolved special districts, by name

Every one of these is a government the Census counts, in a county over this zip, whose territory nobody has resolved. Whether each reaches this zip is **UNRESOLVED — a work item, never a false.**

| Census PID6 | District | Office city | State |
|---|---|---|---|
| 109232 | HANOVER TOWNSHIP FIRE DISTRICT 2 | WHIPPANY | NJ |
| 152436 | HANOVER TOWNSHIP FIRE DISTRICT 3 | CEDAR KNOLLS | NJ |
| 109231 | MONTVILLE TOWNSHIP FIRE DISTRICT 1 | MONTVILLE | NJ |
| 206836 | MONTVILLE TOWNSHIP FIRE DISTRICT 2 | TOWACO | NJ |
| 130980 | MONTVILLE TOWNSHIP FIRE DISTRICT 3 | PINE BROOK | NJ |
| 152430 | MORRIS COUNTY SOIL CONSERVATION DISTRICT | MORRISTOWN | NJ |
| 202164 | MUSCONETCONG SEWERAGE AUTHORITY | BUDD LAKE | NJ |
| 248663 | NEW JERSEY PUBLIC POWER AUTHORITY | BUTLER | NJ |
| 130981 | PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 1 | MOUNT TABOR | NJ |
| 206837 | PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 2 | DENVILLE | NJ |
| 152433 | PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 3 | PARSIPPANY | NJ |
| 130982 | PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 4 | LAKE HIAWATHA | NJ |
| 211392 | PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 5 | PARSIPPANY | NJ |
| 206838 | PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICT 6 | PARSIPPANY | NJ |
| 152439 | PEQUANNOCK RIVER BASIN REGIONAL SEWERAGE AUTHORITY | BUTLER | NJ |
| 152443 | PEQUANNOCK-LINCOLN PARK-FAIRFIELD SEWERAGE AUTH (TWO BRIDGES) | LINCOLN PARK | NJ |
| 152435 | ROCKAWAY VALLEY REGIONAL SEWAGE AUTHORITY | BOONTON | NJ |
| 152438 | SOUTHEAST MORRIS COUNTY MUNICIPAL UTILITIES AUTHORITY | CEDAR KNOLLS | NJ |

#### What stands between this zip and the next tier

Work out which of the remaining governments reach this ZIP code.

Concretely: 18 named special districts above have no published boundary, and until their territory is resolved this zip cannot leave Tier 0 — because a tier is the floor across the governments touching it, and an unresolved government is exactly the one a reader might live under and hear nothing about.

### 03255 — Newbury, New Hampshire

**Stamped tier: TIER_0** (stamped 2026-08-20).

| Denominator | Count |
|---|---:|
| Governments in the universe touching this zip | 21 |
| — territory-resolved | 3 |
| — of those, bodies enumerated (Tier 2) | 3 |
| — UNRESOLVED (special districts, named below) | 18 |

#### Territory-resolved governments

| Government | Layer | Tier | Evidence |
|---|---|---|---|
| Merrimack County | county | TIER_2 | 109 sample points |
| Newbury town | cousub | TIER_2 | 109 sample points |
| Kearsarge Regional School District | unsd | TIER_2 | 109 sample points |

#### Territory-resolved but bodies NOT enumerated — named

None. Every government resolved to this zip has at least one enumerated body.

#### Not governments, and never rendered as one

These are Census STATISTICAL entities — a CDP is a name the Census gives a populated area so it can publish statistics for it, and a CCD is a statistical subdivision drawn in states with no minor civil divisions. Neither has a council, a budget, a meeting or an elected official.

- Blodgett Landing CDP — STATISTICAL (LSAD 57)

#### The 18 unresolved special districts, by name

Every one of these is a government the Census counts, in a county over this zip, whose territory nobody has resolved. Whether each reaches this zip is **UNRESOLVED — a work item, never a false.**

| Census PID6 | District | Office city | State |
|---|---|---|---|
| 152217 | ANDOVER FIRE DISTRICT | ANDOVER | NH |
| 130791 | ANDOVER VILLAGE DISTRICT | ANDOVER | NH |
| 152222 | B C E P SOLID WASTE DISTRICT | PITTSFIELD | NH |
| 130788 | CENTRAL HOOKSETT WATER PRECINCT | HOOKSETT | NH |
| 152226 | CONCORD HOUSING AUTHORITY | CONCORD | NH |
| 186525 | CONTOOCOOK VILLAGE PRECINCT | CONTOOCOOK | NH |
| 152218 | EAST ANDOVER FIRE PRECINCT | ANDOVER | NH |
| 108989 | EPSOM VILLAGE DISTRICT | EPSOM | NH |
| 130790 | HARDY ROAD VILLAGE DISTRICT | LOUDON | NH |
| 216991 | HIGHLANDS VILLAGE DISTRICT | NORTHFIELD | NH |
| 152219 | HOOKSETT VILLAGE WATER PRECINCT | HOOKSETT | NH |
| 152220 | HOPKINTON VILLAGE PRECINCT | HOPKINTON | NH |
| 217017 | LAKE TODD VILLAGE DISTRICT | BRADFORD | NH |
| 152224 | MERRIMACK COUNTY CONSERVATION DISTRICT | CONCORD | NH |
| 152221 | NEW LONDON SPRINGFIELD WATER SYSTEM PRECINCT | NEW LONDON | NH |
| 221008 | NORTHFIELD SEWER DISTRICT | NORTHFIELD | NH |
| 130789 | PENACOOK BOSCAWEN WATER PRECINCT | BOSCAWEN | NH |
| 108988 | WARNER VILLAGE WATER DISTRICT | WARNER | NH |

#### What stands between this zip and the next tier

Work out which of the remaining governments reach this ZIP code.

Concretely: 18 named special districts above have no published boundary, and until their territory is resolved this zip cannot leave Tier 0 — because a tier is the floor across the governments touching it, and an unresolved government is exactly the one a reader might live under and hear nothing about.

## 03255 against `HUNT05`

`HUNT05` records **40 UNRESOLVED special districts at 03255**, found by the h session on 2026-08-16 by building the denominator.

**This session resolves 0 of the 40.** The method that resolved every other government type cannot reach a single special district, because TIGER publishes no boundary for any of them. What this session adds is the NAMES: 18 districts in Merrimack County are listed above with their Census PID6 and office city, so the next session can start dialling instead of enumerating.

The two counts differ because they are counts of different things: `HUNT05` counted the districts inside 03255's own 166-unit enumerated universe, and this counts every special district in the counties whose territory overlaps the ZCTA. Neither is wrong; the second is the wider bound and the one a coverage claim has to clear.

## `AUD-06`

`AUD-06` assigns a coverage manifest gated by `tests/coverage-manifest.test.ts`. Item 1d confirmed that test now allowlists correctly on Linux — the separator bug that put `lib/coverage/states.ts` in its own offender list is fixed at the shared code path and guarded by `tests/path-separator.test.ts`. That is the part of `AUD-06` this session can close.

