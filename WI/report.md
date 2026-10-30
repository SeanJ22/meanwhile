# Wisconsin (WI) polling-place doors, Nov 3, 2026

Read-only checkout: `/home/user/wt-fold153` (origin/river-next-153 at 0fcdce106). I could not create `/home/user/wt-doors-wi` because the root disk was full (0-9 MB free). wt-fold153 is the same commit with no local changes, so I read it there and changed nothing in it. Every door below was read with the repo's own `readVotingSource` (lib/ballot/voting-source-readers.ts:378), using plain `fetch` and the same browser-UA rung as `scripts/fetch-voting-sites.mts`, with no database writes. The harness and per-door results are in /dev/shm/wi/h (read-door.mts, verify.mts, verify.json).

## Statewide GIS hub: no statewide polling-place layer
- The Wisconsin Elections Commission does not publish polling places as a public GIS layer. ArcGIS Online/Hub searches ("polling wisconsin", "wisconsin elections commission", owner WI_Legislature) return only LTSB ward and election-results layers (`WI Municipal Wards (Current/July 2026)`, `2024 Election Data with 2025 Wards`). None of them includes polling places.
- The only WEC polling-place entry points are the "My Vote WI - Polling Place" app items, which link to myvote.wi.gov/en-us/Find-My-Polling-Place. myvote.wi.gov and elections.wi.gov both answer 403 (Cloudflare). geodata.wisc.edu answers 403. mapservices.legis.wisconsin.gov reset the connection.
- Result: no single statewide door exists. I worked municipality by municipality and used county sources wherever one existed.

## Results
- 35 doors written (doors.json, appended biggest-first). All 35 parse live: **465 sites**, 126 of them with the Nov 3, 2026 date confirmed by the page itself.
- 115 of 1,849 municipalities now have sites. They hold about 2.34M of the 5.89M people in the Census governments file (about 40%). 48 municipalities have Election Day sites and 78 have early-voting sites.
- County-level doors that cover many municipalities:
  - Dane County Clerk in-person absentee table: 59 sites across 58 municipalities (Madison links its own page).
  - Racine County ArcGIS ElectionPollingPlaces: 44 Election Day sites for all 17 Racine County municipalities.
  - Vilas County ArcGIS Polling_Locations: one site for each of its 15 municipalities.
  - Joint Cudahy/Franklin/St. Francis/South Milwaukee absentee notice: 4 sites.

| door id | scope | shape | covers | sites | Nov 3 verified |
|---|---|---|---|---|---|
| `wi-madison-in-person-absentee` | Madison city | list-page | EARLY_VOTING | 22 | yes |
| `wi-dane-county-in-person-absentee` | Dane County | list-page | EARLY_VOTING | 59 | no |
| `wi-milwaukee-city-polling-places-gis` | Milwaukee city | map-service | ELECTION_DAY | 176 | no |
| `wi-racine-city-in-person-absentee` | Racine city | list-page | EARLY_VOTING | 15 | yes |
| `wi-racine-county-polling-places-gis` | Racine County | map-service | ELECTION_DAY | 44 | no |
| `wi-green-bay-in-person-absentee` | Green Bay city | list-page | EARLY_VOTING | 4 | yes |
| `wi-vilas-county-polling-locations-gis` | Vilas County | map-service | ELECTION_DAY | 15 | no |
| `wi-sheboygan-city-polling-stations-gis` | Sheboygan city | map-service | ELECTION_DAY | 8 | no |
| `wi-fox-crossing-voting-wards-gis` | Fox Crossing village | map-service | ELECTION_DAY | 4 | no |
| `wi-fond-du-lac-city-in-person-absentee` | Fond du Lac city | list-page | EARLY_VOTING | 1 | yes |
| `wi-wauwatosa-voting-locations` | Wauwatosa city | list-page | ELECTION_DAY | 9 | no |
| `wi-wauwatosa-in-person-absentee` | Wauwatosa city | list-page | EARLY_VOTING | 1 | no |
| `wi-appleton-polling-locations` | Appleton city | list-page | ELECTION_DAY | 11 | yes |
| `wi-appleton-in-person-absentee` | Appleton city | list-page | EARLY_VOTING | 1 | yes |
| `wi-oshkosh-polling-locations` | Oshkosh city | list-page | ELECTION_DAY | 9 | yes |
| `wi-oshkosh-in-person-absentee` | Oshkosh city | list-page | EARLY_VOTING | 1 | yes |
| `wi-waukesha-city-in-person-absentee` | Waukesha city | list-page | EARLY_VOTING | 1 | yes |
| `wi-eau-claire-polling-places` | Eau Claire city | list-page | ELECTION_DAY | 19 | yes |
| `wi-eau-claire-in-person-absentee` | Eau Claire city | list-page | EARLY_VOTING | 1 | yes |
| `wi-west-allis-in-person-absentee` | West Allis city | list-page | EARLY_VOTING | 1 | no |
| `wi-greenfield-polling-locations` | Greenfield city | list-page | ELECTION_DAY | 4 | yes |
| `wi-greenfield-in-person-absentee` | Greenfield city | list-page | EARLY_VOTING | 1 | yes |
| `wi-franklin-polling-places-notice` | Franklin city | list-page | ELECTION_DAY | 5 | yes |
| `wi-milwaukee-south-cities-in-person-absentee-notice` | Milwaukee County | list-page | EARLY_VOTING | 4 | yes |
| `wi-oak-creek-voting-locations` | Oak Creek city | list-page | ELECTION_DAY | 5 | no |
| `wi-brookfield-city-polling-places` | Brookfield city | list-page | ELECTION_DAY | 5 | yes |
| `wi-brookfield-city-in-person-absentee` | Brookfield city | list-page | EARLY_VOTING | 1 | yes |
| `wi-west-bend-polling-locations` | West Bend city | list-page | ELECTION_DAY | 8 | no |
| `wi-new-berlin-in-person-absentee` | New Berlin city | list-page | EARLY_VOTING | 1 | yes |
| `wi-menomonee-falls-polling-places` | Menomonee Falls village | list-page | ELECTION_DAY | 7 | yes |
| `wi-menomonee-falls-in-person-absentee` | Menomonee Falls village | list-page | EARLY_VOTING | 1 | yes |
| `wi-new-berlin-polling-locations` | New Berlin city | list-page | ELECTION_DAY | 5 | yes |
| `wi-beloit-polling-locations` | Beloit city | list-page | ELECTION_DAY | 7 | yes |
| `wi-neenah-in-person-absentee` | Neenah city | list-page | EARLY_VOTING | 1 | no |
| `wi-sun-prairie-polling-places-gis` | Sun Prairie city | map-service | ELECTION_DAY | 8 | no |
"Nov 3 verified = no" means the sites parse, but no reachable official page prints "November 3, 2026" next to the list, so the reader leaves `site.electionDate` unset. Those sites still publish under the jurisdiction's election date. These pages are clearly current (for example, Dane County's table was last updated Oct 21, 2026 and lists Oct 20-30 hours). The gap is that the page shows no year beside the election, or that the linking page is behind Cloudflare (Milwaukee, Racine County, Sheboygan).

## Official sources
All are the municipality's or county's own sites: .gov, or a city/county domain linked from one. They are listed in each door's `discoveredFrom`.
- voteracine.org is linked from cityofracinewi.gov.
- elections.countyofdane.com is Dane County's election site.
- The ArcGIS layers are hosted by the governments themselves (milwaukeemaps.milwaukee.gov, arcgis.racinecounty.gov, maps.vilascountywi.gov) or published by the city's own AGOL org (Sheboygan, Sun Prairie, Fox Crossing).

## Blocked or unparsed (named reasons are in coverage.csv)
- **Milwaukee:** city.milwaukee.gov and county.milwaukee.gov answer 403 (Cloudflare). Election Day sites come from the city's public ArcGIS `election/election_wards/MapServer/1` layer (356 wards mapped to 176 sites). Early voting is still missing.
- **Kenosha** (Cloudflare). The city's ArcGIS VotingWards layer has polling-place names but no addresses.
- **403 Access Denied:** Janesville (also co.rock.wi.us), La Crosse (also lacrossecounty.org), Wausau, sheboyganwi.gov and sheboygancounty.com, racinecounty.gov, kenoshacountywi.gov.
- **Unreachable:** Mequon (CONNECT 502) and Germantown (connection reset).
- **Madison, Waukesha, West Allis Election Day:** these cities publish polling places only through MyVote, which is blocked.
- **Fond du Lac Election Day:** the page lists ward groups and site names, with addresses only in per-ward map PDFs. The city GIS layer dates from April 2019.
- **Oak Creek early voting:** no hours in the page HTML.
- **Superior early voting:** the schedule is an image.

## Reader gap that blocks many municipalities
**Wisconsin county "Type B/C/D" legal notices.** Every WI county clerk publishes this notice before each election. It lists the polling place for every municipality and ward group in the county, which is the best route to the roughly 1,700 small towns and villages.

Example: Brown County, https://www.browncountywi.gov/i/f/files/County-Clerk/Elections/Legal%20Notices/26-NOV%20TYPE%20BCD%20LEGAL%20NOTICE%20-%20PRESS%20GAZETTE%20-%20AC.pdf. It is headed "NOVEMBER 3, 2026, BROWN COUNTY POLLS" and covers all 24 Brown municipalities, including Green Bay's 40+ ward sites.

The notices are typeset as newspaper pages: two or more side-by-side column groups, each a series of municipality headings followed by "Wards 1-4 | Site, Address" lines. `pdfVotingTables` (lib/ballot/voting-source-tables.ts:143-236) has no way to split a page into column groups and read each one top to bottom:
- `pdfColumns` assigns every x-range to one flat row (lines 211-218), so the left and right halves of the page merge into the same row.
- `pdfBlocks` needs a heading and end marker per block.
- `records` runs on `votingPdfText`, which joins the text layer in reading order across both column groups.

What would unlock it is a data-only option: "column groups", meaning x-ranges read separately and concatenated before the `pdfRecordStart`/`records` step, plus inheriting the current municipality heading (like `records.within`, but for PDF lines). With that, each county notice becomes one door covering all of its municipalities.

## Next steps (owner: next WI hunter)
1. Once the reader gap is closed, add a Type B/C/D notice door for each county, starting with Brown, then Waukesha, Outagamie, Winnebago and so on. That is the route to most remaining municipalities.
2. Not yet reached: Stevens Point, Manitowoc, Muskego, Pleasant Prairie, Watertown, Grand Chute and everything below about 21k population, plus Election Day sites for Dane County municipalities other than Madison.
3. Milwaukee early voting and all Kenosha sites need a non-Cloudflare official route. A newspaper legal notice reprint would not qualify as an official source.
