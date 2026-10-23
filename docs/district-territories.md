# District territories

How a ZIP, an address or a map point gets every district its residents live in: school, fire, water, library,
sewer, park, hospital, tribal and the rest.

## What is built

`scripts/district-territories.mts` builds, for every state:

- **Who lives where in each ZIP.** Each 2020 Census block (PL 94-171 redistricting file: population, internal point,
  county, county subdivision, place, school districts, AIANNH area) is joined to its ZCTA by the Census 2020
  ZCTA-to-block relationship file. Each ZIP shard in `data/derived/zip-divisions/` then carries, beside every division,
  the residents living in that part of the ZIP (`residents`, index-aligned with `zips`; `-1` where the blocks do not
  measure the division) and the ZIP's total (`zipResidents`).
- **Special districts on their own territory.** Every layer in `data/reference/district-boundary-sources.json`
  is read (ArcGIS layer or GeoJSON). Each feature is tied to the one Census of Governments special district of its kind
  whose name matches (`districtNameKey`, `lib/registration/district-sources.ts`), preferring the layer's county. A
  matched district gets a division `ocd-division/country:us/state:xx/special_district:<name>` and its government row
  pairs to it (`BOUNDARY_SOURCE`). A layer that draws only special districts (`"unmatched": "list"`) also lists the
  districts the Census does not (`BOUNDARY_SOURCE_ONLY`). A layer that also draws cities' or companies' systems (water
  service areas) is `"skip"`: only Census special districts are taken from it. Census blocks inside each polygon give
  the district's residents per ZIP.
- **Districts named for their county** ("Morris County Soil Conservation District") serve that county (`COUNTY_NAMED`).
- **Tribal areas.** Every Census AIANNH area with residents in a state is a division `ocd-division/country:us/aiannh:<code>`
  and a listed government (`AIANNH_CODE`, class `TRIBAL AREA`), named as the Census names the area.
- **Point geometry.** Simplified polygons, one file per state holding its special districts and tribal areas:
  `data/states/<st>/geo/territory-NN.geojson`. Together they are too large to pack into a server function (Netlify's
  250 MB limit), so `netlify.toml` and `next.config.ts` leave them out of every function and `pnpm resolver:manifest`
  lists them as excluded; until they are served from the edge store, an address or map point does not add them.

A special district no layer draws is not placed anywhere: the fact store keeps it on the state, never on its office's
county, so its boards never show to the whole county.

## How readers see it

- `shardEntry` (`lib/geo/zip-division-index.ts`) lists a division for a ZIP when at least `ZIP_RESIDENT_SHARE_SHOWN`
  (5%) of the ZIP's residents live in it. One home to fewer is `fringe`: the ZIP page names it ("A small part of 85641
  is in Tucson city") and does not list its boards. A division holding 99.5% or more of the residents governs the
  whole ZIP and carries no "could govern you" pill.
- A mail-only ZIP that is its own Census ZCTA (Bethel, 99559) keeps its residents' districts; only a ZIP borrowing
  another ZCTA's area is reduced to its town and county (`postalAreaNeedsAddress`).
- The registration candidate turns the reference rows into government listings with associations, so the ZIP page's
  government listings and board list read them through `lib/reader/place.ts`.
- An address or map point adds the special districts and tribal areas whose polygons hold it (`territoryDivisionsAt`) once
  the territory files are served to the resolver; ZIP pages already list them from the shards.

## Running it

    node --max-old-space-size=8192 --experimental-strip-types --import ./scripts/register-test-loader.mjs \
      scripts/district-territories.mts [--states az,ak] [--cache DIR]
    pnpm resolver:manifest

The cache keeps the Census downloads and each layer's features between runs. Adding a layer is a data change to the
sources file followed by a rebuild; no code changes.
