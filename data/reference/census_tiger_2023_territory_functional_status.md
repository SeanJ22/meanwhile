# census_tiger_2023_territory_functional_status.csv — source note

## What it is
Every row of the U.S. Census Bureau's **2023 TIGER/Line** attribute tables for the five territories — American
Samoa (60), Guam (66), the Northern Mariana Islands (69), Puerto Rico (72) and the U.S. Virgin Islands (78) — in three
layers: county-equivalents, county subdivisions and places. Eight columns only: `layer`, `statefp`, `geoid`, `name`,
`namelsad`, `lsad`, `classfp`, `funcstat`. No geometry, and no other attribute, is kept.

## Why it exists
The 2022 Census of Governments (`census_govt_units_2022.csv`) does not enumerate the territories, so it lists no
government in any of them and registration refused all five. `FUNCSTAT` (functional status) is the Census's own
per-division statement of whether a government sits on it: `A`, `B`, `C` and `G` govern;
`F`, `N`, `S` and `I` do not. It exists only in full TIGER/Line, never in the cartographic (`cb_*`) files the division
ids come from, so it is read here and joined on GEOID, the method `scripts/fetch-districts.ts` established. Used by
`scripts/build-registration-reference.mts` (territory files under `data/derived/registration/`) and nothing else.

## Acquisition
- By `scripts/extract-territory-functional-status.mts` on **2026-09-25, 10:29:47–10:29:57 MST (America/Phoenix)**,
  from this machine, serialized plain HTTPS GETs with User-Agent
  `we-the-people registration (https://github.com/SeanJ22/we-the-people)`. Every
  response was HTTP 200 from `www2.census.gov`. Archives cached at `.cache/tiger/` (main checkout) with a receipt
  beside each; a rerun from cache produced byte-identical output.
- Only each archive's `.dbf` attribute table was parsed, in the encoding its `.cpg` declares (UTF-8).
- Output sha256 `6da303e89c501d8b8e206aa9ef2c980c7ee9aee2454f3de94317ba785640fbb3`, 95,028 bytes, 1,672 data rows.

| File read (all under `https://www2.census.gov/geo/tiger/TIGER2023/`) | Bytes | sha256 | Last-Modified |
|---|---:|---|---|
| `COUNTY/tl_2023_us_county.zip` (territory rows kept) | 83,451,409 | `692e12c30c83adcaabdbac0d3954fafa55e1c89a24b36d95e72e02dff938652e` | Thu, 23 Nov 2023 02:21:53 GMT |
| `COUSUB/tl_2023_60_cousub.zip` | 33,418 | `003963b85b6c1313b8ec122a2b35a480bf066a1517d696fffd7ec357a661a318` | Thu, 23 Nov 2023 02:29:34 GMT |
| `PLACE/tl_2023_60_place.zip` | 85,138 | `75d95fe68dddd6d49c374d5f1cbf9e0812e51e6686f964bf8b75023338973377` | Thu, 23 Nov 2023 02:29:34 GMT |
| `COUSUB/tl_2023_66_cousub.zip` | 464,874 | `e77fbea96b03d0ee3c66bb86702e2677636e17874fd3fd406498b410e12e8eb6` | Thu, 23 Nov 2023 02:29:39 GMT |
| `PLACE/tl_2023_66_place.zip` | 266,203 | `eeb749d9ad2747a08c176a004f05a3afb430ed039d17a0682d1cb8a1e14de520` | Thu, 23 Nov 2023 02:29:39 GMT |
| `COUSUB/tl_2023_69_cousub.zip` | 845,483 | `74adb7ddd0463884eb6c2940d25551843998bf951f3d1c6ce8636cc177eb934f` | Thu, 23 Nov 2023 02:29:44 GMT |
| `PLACE/tl_2023_69_place.zip` | 576,886 | `aa5ed6babc234907e8d95e825bc457fa839f3032cb00be360cf45664e6e8aaf6` | Thu, 23 Nov 2023 02:29:45 GMT |
| `COUSUB/tl_2023_72_cousub.zip` | 3,836,360 | `fabe84eedbaaec17573abf8a1dba4a1ea187e5449274390d4a447671498c4838` | Thu, 23 Nov 2023 02:29:49 GMT |
| `PLACE/tl_2023_72_place.zip` | 754,412 | `23e62d24cf021c7642deace313b976c0b75cc13c341cd9f767ee8da58d36ccb1` | Thu, 23 Nov 2023 02:29:50 GMT |
| `COUSUB/tl_2023_78_cousub.zip` | 880,215 | `b6d8d0cedc7fffae5970db4f3c0122e4aacca9222cd8123d45f24493b2d6cc72` | Thu, 23 Nov 2023 02:29:57 GMT |
| `PLACE/tl_2023_78_place.zip` | 56,898 | `ee0e1986d2ca5d77a6a0a99989e98ba827b383db7c551ad133ec175dd606d8fd` | Thu, 23 Nov 2023 02:29:58 GMT |

## robots.txt — recorded, not resolved
`https://www2.census.gov/robots.txt` (read 2026-09-25; 398 bytes; Last-Modified Tue, 14 May 2024 20:27:57 GMT) opens
with `User-agent: *` followed by a blank line and no rule, then bot-specific groups (`RavenCrawler`, `MegaIndex`,
`BLP_bbot`, `TweetmemeBot` with `Disallow: /`; `Applebot`, `Googlebot`, `Yahoo! Slurp`, `bingbot` with
`Crawl-delay: 30`). Read with blank lines ending a record, `*` carries no rule and nothing is disallowed to us; read
under RFC 9309, where blank lines do not end a group, `*` joins the `RavenCrawler` group and `Disallow: /` applies to
every agent. The project's authorized Census routes (`census-bulk-products`: `https://www2.census.gov/geo/tiger/`)
read this host, and `pnpm research:fetch` was not used. **The owner will rule on the reading separately;** until
then this file is the one-time read above, pinned by hash, and nothing re-fetches it on a schedule.

## What it says (counts by FUNCSTAT)
| Territory | County-equivalents | County subdivisions | Places |
|---|---|---|---|
| American Samoa | A 3 (Eastern, Western, Manu'a districts), N 2 (Rose, Swains islands) | A 14 (counties), N 2 | A 77 (villages) |
| Guam | F 1 (Guam) | N 19 (villages), F 1 | S 57 (CDPs) |
| Northern Mariana Islands | A 3, B 1 (Northern Islands) — the four municipalities | N 8 (districts), F 4 | N 135 (villages) |
| Puerto Rico | A 78 (municipios) | N 901 (barrios), F 38 | S 292 (zonas urbanas, comunidades) |
| U.S. Virgin Islands | N 3 (islands) | N 20 (subdistricts), F 3 | N 3 (towns), S 7 (CDPs) |

The 46 `F` county-subdivision rows are TIGER's "subdivision not defined" water placeholders (`CLASSFP Z9`); the
cartographic files omit them, so they are no division. Every territory division in the cartographic files has a row
here. **Registration reads: 94 governments in American Samoa, 4 in the Northern Mariana Islands, 78 in Puerto Rico,
and none recorded by the Census in Guam or the U.S. Virgin Islands.**

## License
A work of the United States federal government: public domain. Cite as *U.S. Census Bureau, 2023 TIGER/Line
Shapefiles.*
